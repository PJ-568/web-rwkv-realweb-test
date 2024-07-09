interface HTMLElementWithContent extends HTMLElement {
    innerHTML: string;
}

// 引入内嵌的 marked.js
declare var marked: any;

// 引入内嵌的 Javascript 置底函数
declare function scrollToBottom(): void;

// 引入内嵌的 Javascript 发送函数
declare function send(): number;

// 引入内嵌的 Javascript 回复函数
declare function post(): HTMLElement;

// Prompt 格式化函数
//// export declare function constructPrompt(text: String): String;
function constructPrompt(text: String): string {
    const contentElement = document.querySelector('.content') as HTMLElement;
    if (!contentElement) {
        console.error('info(): .content 元素不存在');
        return '';
    }

    let prompt = '';

    for (const child of contentElement.children) {
        if (child.classList.contains('item-right')) {
            const bubbleElement = child.querySelector('.bubble') as HTMLElement;
            if (bubbleElement) {
                if (!bubbleElement.title) {
                    console.warn('找不到 bubbleElement.title')
                }
                prompt += `User: ${bubbleElement.title.trim() || bubbleElement.innerHTML.trim()}\n\n`;
            }
        }
        if (child.classList.contains('item-left')) {
            const bubbleElement = child.querySelector('.bubble') as HTMLElement;
            if (bubbleElement) {
                if (!bubbleElement.title) {
                    console.warn('找不到 bubbleElement.title')
                }
                prompt += `Assistant: ${bubbleElement.title.trim() || bubbleElement.innerHTML.trim()}\n\n`;
            }
        }
    }

    return prompt + `User: ${text}\n\nAssistant:`;
}

// 清空聊天区域
function cleanContent(): void {
    const contentElement = document.querySelector('.content') as HTMLElementWithContent;
    if (contentElement) {
        contentElement.innerHTML = '<div class="item item-center"><span>LB 语言助手加载完毕，可开始对话</span></div><div class="item item-right"><div class="bubble" title="Hi!"><p>Hi!</p></div><div class="avatar"></div></div><div class="item item-left"><div class="avatar"></div><div class="bubble" title="Hello! I\'m the LB, your AI assistant. I\'m here to help you with various tasks."><p>Hello! I\'m the LB, your AI assistant. I\'m here to help you with various tasks.</p></div></div>';
    }
}

// 在聊天区域插入一个提示信息
function info(text: string): void {
    let item = document.createElement('div');
    item.className = 'item item-center';
    item.innerHTML = `<span>${text}</span>`;

    const contentElement = document.querySelector('.content') as HTMLDivElement;
    if (contentElement) {
        contentElement.appendChild(item);

        scrollToBottom();
    } else {
        console.error('info(): .content 元素不存在');
    }
}

// 以上代码为新增
// 以下代码为更改

interface LoadOk {
    ok: undefined
}

async function load() {
    const modelElem = document.getElementById("model")!;    // 当开始加载模型时，这个元素消失
    const downloadElem = document.getElementById("download")!;    // 当开始加载模型时，这个元素显示
    const progressElem = document.getElementById("progress") as HTMLProgressElement;   // 进度条
    const statusElem = document.getElementById("status")!;    // 进度条上方的数据显示
    const chatElem = document.getElementById("chat")!;    // 用户输入聊天信息区域，在加载完毕后显示
    const sendElem = document.getElementById("send-btn")!;    // 我添加的：发送按钮，用于监听点击事件，当点击时触发聊天区显示并发送给模型函数
    // const replyElem = document.getElementById("reply")!;    // 已弃用
    var replyElem: HTMLElementWithContent;
    var url = (document.getElementById("url") as HTMLInputElement).value;    // 模型加载前的模型地址输入框元素

    modelElem.style.display = "none";
    downloadElem.style.display = "";

    var cache = await caches.open("rwkv");

    let response = await cache.match(url).then(async (value) => {
        if (value !== undefined) {
            console.log("加载已缓存模型");
            return value;
        }
        console.log("加载未缓存模型");
        let response = await fetch(url);
        cache.put(url, response.clone());
        return response;
    });
    // let response = await fetch(url);

    if ((response.status >= 200 && response.status < 300) || (response.status === 0 /* Loaded from local file */)) {
        // replyElem.innerText = "";
        modelElem.style.display = "none";
        downloadElem.style.display = "";
    } else if (response.status === 404 && url.startsWith('http://localhost')) {
        info("<button onclick='javascript:location.reload();'>⚠错误：Model not found locally ，点我重载</button>");    // replyElem.innerText = "Model not found locally.";
        return;
    } else {
        info("<button onclick='javascript:location.reload();'>⚠错误：Incorrect URL ，点我重载</button>");    // replyElem.innerText = "Incorrect URL.";
        return;
    }

    const reader = response.body!.getReader();
    const contentLength = +response.headers!.get('Content-Length')!;

    let receivedLength = 0;
    let chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
        receivedLength += value.length;
        // console.log(`Received ${receivedLength} of ${contentLength}`)

        progressElem.value = receivedLength / contentLength;
        statusElem.innerHTML = `<p><strong>操作状态</strong></p><pre><code>正在加载：${url}</code></pre><p><strong>进度</strong></p><pre><code>${receivedLength * 1.0e-6} / ${contentLength * 1.0e-6} MB</code></pre>`;
    }

    cleanContent(); // downloadElem.style.display = "none";
    chatElem.style.display = ''; // 显示输入区域
    var reply: string = '';

    var worker = new Worker('worker.js');
    worker.onmessage = (e: MessageEvent<string | null>) => {
        // e.data ? replyElem.innerHTML += marked.parse(e.data) : replyElem.innerText = "";
        if (e.data) {
            if (e.data === '【结束】') {
                replyElem.classList.remove('loading');
                scrollToBottom();
            } else if (e.data === '【超出】') {
                replyElem.classList.remove('loading');
                replyElem.classList.add('interrupted');
                scrollToBottom();
            } else {
                reply += e.data;
                replyElem.title = reply;
                replyElem.innerHTML = marked.parse(reply);
            }
        } else {
            reply = '';
            replyElem.title = '';
            replyElem.innerHTML = '';
        }
    }

    worker.postMessage(chunks, chunks.map(x => x.buffer));

    function interrupt() {
        if (replyElem && replyElem.classList.contains('loading')) {
            worker.postMessage('/user-lb-interrupt');
            replyElem.classList.remove('loading');
            replyElem.classList.add('interrupted');
        }
    }

    function sendPrompt() {
        const inputElem = document.getElementById("textarea") as HTMLInputElement;
        var input = new String(inputElem.value);
        interrupt();
        if (send() !== 1) {
            worker.postMessage(constructPrompt(input));
            replyElem = post();
        }
    }

    // 已弃用
    /* chatElem.addEventListener("submit", (e) => {
        e.preventDefault();
        const inputElem = document.getElementById("textarea") as HTMLInputElement;
        var input = new String(inputElem.value);
        worker.postMessage(input);
    }); */
    sendElem.addEventListener("click", (e) => {
        // e.preventDefault();
        sendPrompt();
    });

    document.getElementById('textarea')!.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.ctrlKey && event.key === 'Enter') {    // Ctrl + Enter
            event.preventDefault();    // 阻止默认的换行行为
            sendPrompt();
        }
    });
}

// 模型地址键值对
const urls = new Map([
    ["v4", "https://hf-mirror.com/cgisky/RWKV-safetensors-fp16/resolve/main/RWKV-4-World-0.4B-v1-20230529-ctx4096.st"],
    ["default", "https://pj568.sbs/web-rwkv-realweb-test/assets/resolve/RWKV-5-World-0.4B-v2-20231113-ctx4096.st"],
    ["test", "https://pj568.sbs/web-rwkv-realweb-test/assets/resolve/RWKV-4-World-0.1B-v1-20230520-ctx4096.st"],
    ["v5", "https://hf-mirror.com/cgisky/AI00_RWKV_V5/resolve/main/RWKV-5-World-0.4B-v2-20231113-ctx4096.st"],
    ["v5 1b5", "https://hf-mirror.com/cgisky/AI00_RWKV_V5/resolve/main/RWKV-5-World-1B5-v2-20231025-ctx4096.st"],
    ["v6 1b6", "https://hf-mirror.com/cgisky/ai00_rwkv_x060/resolve/main/rwkv-x606-1b6-world-v2.st"],
    ["v5 local", "http://localhost:5500/assets/models/RWKV-5-World-0.4B-v2-20231113-ctx4096.st"],
    ["v6 local", "http://localhost:5500/assets/models/RWKV-x060-World-1B6-v2-20240208-ctx4096.st"],
]);

// 根据输入的键，从键值对中找到地址并应用
function loadUrl(key: string) {
    (document.getElementById("url") as HTMLInputElement).value = urls.get(key)!;
}
