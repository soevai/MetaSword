/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.0.9
 * @Since       2023-08-31
 * @LastUpdated 2026-06-28
 * @Description 负责 Frida 编辑器逻辑
 * @License     MIT
 */

const { ipcRenderer } = require('electron');
var editor = ace.edit("editor");
var currentFontSize = 20;
var minFontSize = 15;
var maxFontSize = 35;

editor.setTheme("ace/theme/one_dark");
editor.session.setMode("ace/mode/javascript");
editor.setValue(`function main() {
    console.log("Hello, MetaSword!");
}
main();`, 1);
editor.setOptions({
    fontSize: currentFontSize + "px",
    enableBasicAutocompletion: true,
    enableSnippets: true,
    enableLiveAutocompletion: true,
    showPrintMargin: false
});

document.addEventListener('keydown', function (e) {
    if (e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
            e.preventDefault();
            currentFontSize = Math.min(currentFontSize + 1, maxFontSize);
            editor.setOptions({ fontSize: currentFontSize + "px" });
        }
        if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            currentFontSize = Math.max(currentFontSize - 1, minFontSize);
            editor.setOptions({ fontSize: currentFontSize + "px" });
        }
    }
});

const fridaCompletions = [
    { value: 'Script.nextTick', meta: 'function' },
    { value: 'Script.pin', meta: 'function' },
    { value: 'Script.unpin', meta: 'function' },
    { value: 'Script.bindWeak', meta: 'function' },
    { value: 'Script.unbindWeak', meta: 'function' },
    { value: 'Process.id', meta: 'number' },
    { value: 'Process.arch', meta: 'string' },
    { value: 'Process.platform', meta: 'string' },
    { value: 'Process.pageSize', meta: 'number' },
    { value: 'Process.pointerSize', meta: 'number' },
    { value: 'Process.mainModule', meta: 'Module' },
    { value: 'Process.enumerateThreads', meta: 'function' },
    { value: 'Process.getCurrentDir', meta: 'function' },
    { value: 'Process.getHomeDir', meta: 'function' },
    { value: 'Process.getTmpDir', meta: 'function' },
    { value: 'Thread.backtrace', meta: 'function' },
    { value: 'Thread.sleep', meta: 'function' },
    { value: 'Memory.alloc', meta: 'function' },
    { value: 'Memory.allocUtf8String', meta: 'function' },
    { value: 'Memory.allocAnsiString', meta: 'function' },
    { value: 'Memory.readCString', meta: 'function' },
    { value: 'Memory.readUtf8String', meta: 'function' },
    { value: 'Memory.readUtf16String', meta: 'function' },
    { value: 'Memory.readAnsiString', meta: 'function' },
    { value: 'Memory.writeUtf8String', meta: 'function' },
    { value: 'Memory.writeUtf16String', meta: 'function' },
    { value: 'Memory.writeAnsiString', meta: 'function' },
    { value: 'Memory.readPointer', meta: 'function' },
    { value: 'Memory.writePointer', meta: 'function' },
    { value: 'Memory.protect', meta: 'function' },
    { value: 'Memory.scan', meta: 'function' },
    { value: 'Memory.scanSync', meta: 'function' },
    { value: 'Memory.patchCode', meta: 'function' },
    { value: 'Module.enumerateModulesSync', meta: 'function' },
    { value: 'Module.enumerateImports', meta: 'function' },
    { value: 'Module.enumerateExports', meta: 'function' },
    { value: 'Module.enumerateRanges', meta: 'function' },
    { value: 'Module.findExportByName', meta: 'function' },
    { value: 'Module.getExportByName', meta: 'function' },
    { value: 'Module.load', meta: 'function' },
    { value: 'ApiResolver', meta: 'class' },
    { value: 'DebugSymbol.fromAddress', meta: 'function' },
    { value: 'NativePointer', meta: 'class' },
    { value: 'NativeFunction', meta: 'class' },
    { value: 'NativeCallback', meta: 'class' },
    { value: 'CModule', meta: 'class' },
    { value: 'Java.perform', meta: 'function' },
    { value: 'Java.use', meta: 'function' },
    { value: 'Java.choose', meta: 'function' },
    { value: 'Java.cast', meta: 'function' },
    { value: 'Java.enumerateLoadedClasses', meta: 'function' },
    { value: 'Java.deoptimizeEverything', meta: 'function' },
    { value: 'ObjC.classes', meta: 'object' },
    { value: 'ObjC.choose', meta: 'function' },
    { value: 'ObjC.selector', meta: 'function' },
    { value: 'ObjC.enumerateLoadedClasses', meta: 'function' },
    { value: 'Interceptor.attach', meta: 'function' },
    { value: 'Interceptor.replace', meta: 'function' },
    { value: 'Interceptor.revert', meta: 'function' },
    { value: 'Stalker.follow', meta: 'function' },
    { value: 'Stalker.unfollow', meta: 'function' },
    { value: 'Stalker.trace', meta: 'function' },
];

var localCompleter = {
    getCompletions: function (editor, session, pos, prefix, callback) {
        var completions = [{ value: "console", meta: "var console: Console" }];
        var line = session.getLine(pos.row);
        var beforePrefix = line.slice(0, pos.column - prefix.length);
        if (beforePrefix.endsWith('console.')) {
            completions.push({ value: 'log', meta: 'method' });
            completions.push({ value: 'info', meta: 'method' });
        }
        completions = completions.concat(fridaCompletions);
        callback(null, completions);
    }
};
editor.completers.push(localCompleter);

function formatCode() {
    const code = editor.getValue();
    const formattedCode = js_beautify(code, { indent_size: 4, space_in_empty_paren: true });
    editor.setValue(formattedCode, 1);
}

editor.commands.addCommand({
    name: 'formatCode',
    bindKey: { win: 'Shift-Alt-F' },
    exec: formatCode
});

function typeTextLikeHuman(text, onDone) {
    let i = 0;
    const originalOptions = editor.getOptions();
    editor.setOptions({
        behavioursEnabled: false,
        autoClosingBrackets: 'never',
        autoClosingQuotes: 'never'
    });
    function typeNext() {
        if (i < text.length) {
            if (!aiAbortController) { return; }
            const char = text[i++];
            const session = editor.session;
            const lastRow = session.getLength() - 1;
            editor.session.insert({ row: lastRow, column: session.getLine(lastRow).length }, char);
            editor.clearSelection();
            setTimeout(typeNext, 1);
        } else {
            editor.setOptions(originalOptions);
            if (typeof onDone === 'function') onDone();
        }
    }
    typeNext();
}

const FridaPrompt = `
    You are a Frida expert focusing on Android and Windows reverse engineering.
    Return ONLY directly executable Frida JavaScript code.
    DO NOT include any Markdown, code blocks, formatting tags (such as \`\`\`, <code>, or others).
    DO NOT include any comments or explanatory text.
    DO NOT use placeholders or stub functions.
    Your response must be valid, complete, and ready to run as-is.
    Strictly return raw JavaScript code only.
`;

let aiAbortController = null;

const cancelHint = document.createElement('div');
cancelHint.id = 'Frida-IDE-cancel-hint';
cancelHint.textContent = '按 Esc 取消';
cancelHint.style.cssText = `
    position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%);
    background: #1a1a1a; color: #d4d4d8; padding: 12px 24px;
    border-radius: 12px; font-size: 13px; font-family: system-ui, sans-serif;
    z-index: 10001; display: none; pointer-events: none;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
`;
document.body.appendChild(cancelHint);

function startAiGeneration() {
    aiAbortController = new AbortController();
    cancelHint.style.display = 'block';
}

function stopAiGeneration() {
    aiAbortController = null;
    cancelHint.style.display = 'none';
}

async function askDeepSeekStream(apiKey, question, onData) {
    const url = 'https://api.deepseek.com/chat/completions';
    const payload = {
        model: "deepseek-chat",
        messages: [
            { role: "system", content: FridaPrompt },
            { role: "user", content: question }
        ],
        temperature: 0.7,
        stream: true
    };
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: aiAbortController?.signal
        });
        if (!response.ok || !response.body) {
            showMessage("请求失败，请检查配置");
            editor.setReadOnly(false);
            stopAiGeneration();
            return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                if (typeof onData === 'function') onData(null, true);
                break;
            }
            const chunk = decoder.decode(value);
            const lines = chunk.split("\n");
            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr === "[DONE]") {
                        if (typeof onData === 'function') onData(null, true);
                        return;
                    }
                    try {
                        const parsed = JSON.parse(jsonStr);
                        const token = parsed.choices?.[0]?.delta?.content;
                        if (token && typeof onData === 'function') onData(token, false);
                    } catch (err) { }
                }
            }
        }
    } catch (err) {
        editor.setReadOnly(false);
        stopAiGeneration();
    }
}

function showAiPrompt(initialContent = "", customHeight = 150) {
    const existing = document.getElementById("Frida-IDE-ai-prompt");
    if (existing) existing.remove();
    const input = document.createElement('textarea');
    input.id = "Frida-IDE-ai-prompt";
    input.placeholder = " 请输入你的想法…（Enter 发送｜Esc 关闭）";
    input.value = initialContent;
    input.setAttribute("spellcheck", "false");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.style.minHeight = `${customHeight}px`;
    input.style.position = 'absolute';
    input.style.zIndex = 9999;
    input.style.transition = 'opacity 100ms ease, transform 100ms ease';
    input.style.opacity = '0';
    input.style.transform = 'scale(0.95)';
    input.style.pointerEvents = 'auto';
    document.body.appendChild(input);
    const cursorPos = editor.getCursorPosition();
    const coords = editor.renderer.textToScreenCoordinates(cursorPos.row, cursorPos.column);
    const inputWidth = 400;
    const inputHeight = customHeight + 20;
    let left = coords.pageX;
    let top = coords.pageY + 30;
    if (left + inputWidth > window.innerWidth - 40) {
        left = window.innerWidth - inputWidth - 40;
        if (left < 40) left = 40;
    }
    if (top + inputHeight > window.innerHeight - 10) {
        top = coords.pageY - inputHeight - 10;
        if (top < 10) top = 10;
    }
    input.style.left = `${left}px`;
    input.style.top = `${top}px`;
    input.focus();
    requestAnimationFrame(() => {
        input.style.opacity = '1';
        input.style.transform = 'scale(1)';
    });
    function closePrompt() {
        input.style.opacity = '0';
        input.style.transform = 'scale(0.95)';
        input.style.pointerEvents = 'none';
        document.removeEventListener('mousedown', handleOutsideClick);
        setTimeout(() => input.remove(), 180);
    }
    input.addEventListener("keydown", async function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const q = input.value.trim();
            if (!q) return;
            closePrompt();
            const apiKey = localStorage.getItem('DeepseekApiKey');
            if (!apiKey || apiKey.trim() === '') {
                showMessage("❌ 请填写 Key");
                return;
            }
            editor.setReadOnly(true);
            startAiGeneration();
            editor.setOptions({
                behavioursEnabled: false,
                wrapBehavioursEnabled: false
            });
            typeTextLikeHuman("// AI 正在生成，请稍候...\n", async () => {
                const tipRow = editor.getCursorPosition().row - 1;
                await askDeepSeekStream(apiKey, q, async (token, done) => {
                    if (token) {
                        const session = editor.session;
                        const lastVisibleRow = editor.renderer.getScrollBottomRow();
                        const lastRow = session.getLength() - 1;
                        editor.selection.moveTo(lastRow, session.getLine(lastRow).length);
                        editor.insert(token);
                        editor.clearSelection();
                        if (cursorPos.row >= lastRow - 1 || lastVisibleRow >= lastRow - 1) {
                            setTimeout(() => editor.scrollToLine(session.getLength(), true, true, () => { }), 0);
                        }
                    }
                    if (done) {
                        const line = editor.session.getLine(tipRow);
                        for (let i = line.length; i >= 0; i--) {
                            await new Promise(resolve => setTimeout(resolve, 20));
                            editor.session.replace({
                                start: { row: tipRow, column: i - 1 },
                                end: { row: tipRow, column: i }
                            }, "");
                        }
                        editor.setOptions({
                            behavioursEnabled: true,
                            wrapBehavioursEnabled: true
                        });
                        editor.setReadOnly(false);
                        stopAiGeneration();
                        formatCode();
                    }
                });
            });
        } else if (e.key === "Escape") {
            closePrompt();
        }
    });
    function handleOutsideClick(e) {
        if (!input.contains(e.target) && editor.container.contains(e.target)) {
            closePrompt();
        }
    }
    document.addEventListener('mousedown', handleOutsideClick);
}

const contextMenu = document.createElement('div');
contextMenu.id = 'Frida-IDE-contextmenu';
document.body.appendChild(contextMenu);

function addMenuItem(label, shortcut, action) {
    const item = document.createElement('div');
    item.style.cssText = `
        display: flex;
        justify-content: space-between;
        padding: 6px 12px;
        cursor: pointer;
    `;
    item.innerHTML = `<span>${label}</span><span style="opacity: 0.5;">${shortcut || ''}</span>`;
    item.addEventListener('mouseover', () => item.style.background = '#3a3f4b');
    item.addEventListener('mouseout', () => item.style.background = '');
    item.addEventListener('click', () => {
        contextMenu.style.display = 'none';
        action();
    });
    contextMenu.appendChild(item);
}

function hideContextMenu(immediate = false) {
    contextMenu.style.opacity = '0';
    contextMenu.style.transform = 'scale(0.93)';
    contextMenu.style.pointerEvents = 'none';
    if (immediate) {
        contextMenu.style.display = 'none';
        return Promise.resolve();
    }
    return new Promise(resolve => {
        setTimeout(() => {
            contextMenu.style.display = 'none';
            resolve();
        }, 100);
    });
}

editor.container.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    await hideContextMenu(false);
    contextMenu.innerHTML = '';
    addMenuItem('运行代码', 'Ctrl+R', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'r' }));
    });
    addMenuItem('格式化代码', 'Shift+Alt+F', formatCode);
    addMenuItem('复制', 'Ctrl+C', () => document.execCommand('copy'));
    addMenuItem('剪切', 'Ctrl+X', () => document.execCommand('cut'));
    addMenuItem('粘贴', 'Ctrl+V', () => document.execCommand('paste'));
    addMenuItem('全选', 'Ctrl+A', () => editor.selectAll());
    addMenuItem('清空代码', '', () => editor.setValue(''));
    addMenuItem('提问 AI', 'Alt+G', () => {
        const selected = editor.getSelectedText();
        showAiPrompt(selected.trim(), 180);
    });
    const menuWidth = 200;
    const menuHeight = contextMenu.childElementCount * 30 + 10;
    const maxLeft = window.innerWidth - menuWidth - 10;
    const maxTop = window.innerHeight - menuHeight - 10;
    const left = Math.min(e.pageX, maxLeft);
    const top = Math.min(e.pageY, maxTop);
    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
    contextMenu.style.display = 'block';
    contextMenu.style.opacity = '0';
    contextMenu.style.transform = 'scale(0.9)';
    requestAnimationFrame(() => {
        contextMenu.style.opacity = '1';
        contextMenu.style.transform = 'scale(1)';
        contextMenu.style.pointerEvents = 'auto';
    });
});

document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
        contextMenu.style.display = 'none';
    }
});

let isMcpWriting = false;

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aiAbortController) {
        e.preventDefault();
        aiAbortController.abort();
        if (isMcpWriting) {
            isMcpWriting = false;
            ipcRenderer.send('frida-stop-ai');
            ipcRenderer.send('write-to-editor-complete', { cancelled: true });
        }
        stopAiGeneration();
        editor.setOptions({ behavioursEnabled: true, wrapBehavioursEnabled: true });
        editor.setReadOnly(false);
        showMessage("已取消");
        return;
    }
    if (e.altKey && e.code === 'KeyG') {
        e.preventDefault();
        const selected = editor.getSelectedText();
        showAiPrompt(selected.trim() ? selected : '');
    }
});

ipcRenderer.on('write-to-editor', (event, { code, replace = true }) => {
    editor.setReadOnly(true);
    startAiGeneration();
    isMcpWriting = true;
    if (replace) editor.setValue('', 1);
    typeTextLikeHuman(code, () => {
        editor.setReadOnly(false);
        stopAiGeneration();
        isMcpWriting = false;
        ipcRenderer.send('write-to-editor-complete', { cancelled: false });
    });
});
