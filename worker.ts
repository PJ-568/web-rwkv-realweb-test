// 以上代码为新增
// 以下代码为更改

importScripts("./pkg/web_rwkv_realweb.js")

const { Runtime, Sampler, StateId, Tensor, TensorReader } = wasm_bindgen;

function getUint64(dataview: DataView, byteOffset: number, littleEndian?: boolean) {
    // split 64-bit number into two 32-bit (4-byte) parts
    const left = dataview.getUint32(byteOffset, littleEndian);
    const right = dataview.getUint32(byteOffset + 4, littleEndian);

    // combine the two 32-bit values
    const combined = littleEndian
        ? left + 2 ** 32 * right
        : 2 ** 32 * left + right;

    if (!Number.isSafeInteger(combined))
        console.warn(combined, "变量 combined 超过了 JavaScript 中的最大安全整数 MAX_SAFE_INTEGER，或导致精度损失。");

    return combined;
}

interface TensorInfo {
    shape: Uint32Array;
    data_offsets: [number, number];
}

async function initReader(blob: Blob) {
    console.log("模型数据大小：", blob.size);

    if (blob.size < 8) {
        throw "header too small";
    }

    let n = getUint64(new DataView(await blob.slice(0, 8).arrayBuffer()), 0, true);
    if (n > 100000000) {
        throw "header too large";
    }
    if (n > blob.size) {
        throw "invalid header len";
    }

    let str = new TextDecoder().decode(new Uint8Array(await blob.slice(8, n + 8).arrayBuffer()));
    let metadata = JSON.parse(str);

    let tensors = new Array();
    for (let name in metadata) {
        if (name !== "__metadata__") {
            let info: TensorInfo = metadata[name];
            let start = 8 + n + info.data_offsets[0];
            let end = 8 + n + info.data_offsets[1];
            let tensor = new Tensor(name, info.shape, blob.slice(start, end));
            tensors.push(tensor);
        }
    }

    return new TensorReader(tensors);
}

async function initTokenizer() {
    await wasm_bindgen("./pkg/web_rwkv_realweb_bg.wasm");

    var req = await fetch("assets/rwkv_vocab_v20230424.json");
    var vocab = await req.text();
    console.log("分词器：" + vocab.length);
    return new wasm_bindgen.Tokenizer(vocab);
}

async function initRuntime(blob: Blob) {
    await wasm_bindgen("./pkg/web_rwkv_realweb_bg.wasm");

    // var req = await fetch("assets/models/RWKV-5-World-0.4B-v2-20231113-ctx4096.st");
    // var bin = await req.arrayBuffer();
    // console.log("model: ", bin.byteLength);

    let reader = await initReader(blob);
    let runtime = await new Runtime(reader, 0, 0, true);
    console.log("已加载运行时")
    return runtime;
}

var _tokenizer = initTokenizer();
var _runtime: undefined | Promise<wasm_bindgen.Runtime> = undefined;

this.addEventListener("message", async function (e: MessageEvent<Uint8Array[] | String>) {
    if (e.data instanceof Array) {
        let blob = new Blob(e.data);
        _runtime = initRuntime(blob);
        return;
    }

    if (await _runtime === undefined) {
        this.postMessage(null);
        this.postMessage("Error: Model is not loaded.");
        return;
    }

    var tokenizer = await _tokenizer;
    var runtime = await _runtime!;
    var sampler = new Sampler(1.0, 0.5);

    var input = e.data;
    console.log(input);

    var prompt = input as string;// var prompt = `User: Hi!\n\nAssistant: Hello! I'm the LB, your AI assistant. I'm here to help you with various tasks.\n\nUser: ${input}\n\nAssistant:`;
    var state = new StateId;

    var encoder = new TextEncoder;
    var decoder = new TextDecoder;

    var tokens = tokenizer.encode(encoder.encode(prompt));
    var response = "";
    var out = []
    console.log(`提示词长度：${tokens.length}`);

    var logits = new Float32Array(65536);
    var probs = new Float32Array(65536);

    let shouldInterrupt = false; // 是否中断输出

    await this.navigator.locks.request("model", async (lock) => {
        this.postMessage(null);

        // 添加一个消息监听器来处理中断信号
        this.addEventListener("message", function interruptHandler(interruptEvent) {
            if (interruptEvent.data === '/user-lb-interrupt') {
                shouldInterrupt = true;
                this.removeEventListener("message", interruptHandler);
            }
        });

        while (!response.includes("\n\n") && out.length < 500 && !shouldInterrupt) {
            await runtime.run_one(tokens, logits, state);
            await runtime.softmax_one(logits, probs);

            let out_token = sampler.sample(probs);
            let word = decoder.decode(tokenizer.decode(new Uint16Array([out_token])));
            tokens = new Uint16Array([out_token]);

            out.push(out_token);
            response += word;
            this.postMessage(word);
        }

        if (out.length >= 500) {
            this.postMessage('【超出】');
        } else {
            this.postMessage('【结束】');
        }

        // 清除中断标志，以便下次运行
        shouldInterrupt = false;
    });
}, false);
