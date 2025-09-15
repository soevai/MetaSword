/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.0.6
 * @Since       2023-08-31
 * @LastUpdated 2025-08-01
 * @Description 负责 Frida IDE 核心逻辑
 * @License     MIT
 */

const { spawn, execFile, exec } = require("child_process");
const { ipcRenderer } = require('electron');
const path = require("path");
const fs = require("fs");

const FridatoggleButton = document.getElementById("Frida-IDE-toggleButton");
var Fridapath = path.join(__dirname, '..', '..', '/Plugins/Frida');
var FridaPidinput = document.querySelector(".Frida-IDE-PID");
FridaPidinput.addEventListener('input', function () {
    if (this.value.length > 8) {
        this.value = this.value.slice(0, 8);
    }
});

let isMaximized = false;
const maximizeButton = document.getElementById("maximizeButton");
maximizeButton.addEventListener("click", () => {
    isMaximized = !isMaximized;
    if (isMaximized) {
        ipcRenderer.send('frida-maximizeWindow');
        document.body.style.backgroundColor = "#22262e";
    } else {
        ipcRenderer.send('frida-unmaximizeWindow');
        document.body.style.backgroundColor = "";
    }
});


const minimizeButton = document.getElementById("minimize-btn");
minimizeButton.addEventListener("click", () => {
    ipcRenderer.send('frida-minimizeWindow');
});


const closeButtons = document.getElementById("closeButton");
closeButtons.addEventListener("click", () => {
    window.close();
});


const dropZone = document.getElementById('Frida-IDE-dropZone');
function showDropZone() {
    Object.assign(dropZone.style, {
        height: '100vh',
        zIndex: '999',
        visibility: 'visible'
    });
    dropZone.classList.add('show');

}

function hideDropZone() {
    dropZone.classList.remove('show');
    dropZone.style.visibility = "hidden";
}

function handleDragEnter(e) {
    e.preventDefault();
    var items = e.dataTransfer.items;
    if (items.length > 0 && items[0].kind === 'file') {
        showDropZone();
    }
}
document.body.addEventListener('dragenter', handleDragEnter);

function handleDragLeave(e) {
    e.preventDefault();
    if (!e.relatedTarget || e.relatedTarget.nodeName === "HTML") {
        hideDropZone();
    }
}
document.body.addEventListener('dragleave', handleDragLeave);

function handleDragOver(e) {
    e.preventDefault();
}
document.body.addEventListener('dragover', handleDragOver);


var ExePath = null;
var ScriptPath = null;

function handleDrop(e) {
    e.preventDefault();
    hideDropZone();

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const fileName = file.name.toLowerCase();
    const filePath = file.path;

    if (fileName.endsWith('.js')) {
        ScriptPath = filePath;
    } else {
        ExePath = filePath;
    }

    if (fileName.endsWith('.exe')) {
        window.CurrentSelectedProcess = {
            pid: ExePath,
            platform: 'Windows',
            mode: 'Spawn'
        };

        if (FridatoggleButton) {
            FridatoggleButton.checked = true;
            FridatoggleButton.dispatchEvent(new Event("change"));
        }
        return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
        try {
            editor.setValue(event.target.result || '');
        } catch (error) {
            console.error("error", error);
        }
    };
    reader.readAsText(file);
}
document.body.addEventListener('drop', handleDrop);


var throttleTimeout;
var FridasearchInput = document.getElementById('Frida-IDE-processSearch');
FridasearchInput.addEventListener('input', function () {
    clearTimeout(throttleTimeout);
    throttleTimeout = setTimeout(function () {
        searchProcess();
    }, 10);
});


function searchProcess() {
    setTimeout(() => {
        var searchText = FridasearchInput.value.toLowerCase();
        const activeTab = document.querySelector('.Frida-IDE-tab.active')?.dataset?.tab || 'windows';
        const tableId = activeTab === 'android' ? '#Frida-IDE-processes-android' : '#Frida-IDE-processes';
        var processRows = document.querySelectorAll(`${tableId} tr`);

        processRows.forEach(function (row) {
            var cell = row.querySelector('td:nth-child(3)');
            var processName = cell ? cell.innerText.toLowerCase() : '';
            row.style.display = processName.includes(searchText) ? '' : 'none';
        });
    }, 30);
}

function hiddenFridaProcessWindow() {
    var processListWindow = document.getElementById('Frida-IDE-ProcessWindow');
    if (processListWindow) processListWindow.style.display = 'none';

    var modeSelector = document.getElementById('Frida-IDE-modeSelector');
    if (modeSelector) modeSelector.style.display = 'none';
}

var FridacloseButton = document.querySelector('.Frida-IDE-window-closebtn');
FridacloseButton.addEventListener('click', function () {
    hiddenFridaProcessWindow();
});


function clearOutputContent() {
    const Fridacontent = document.getElementById('Frida-IDE-output-content');
    if (Fridacontent) Fridacontent.innerHTML = '';
    outputBuffer.length = 0;
    logLines.length = 0;
}

function showOutputPanel(panel) {
    requestAnimationFrame(() => {
        panel.style.transform = 'translateY(0%)';
    });
}


function centerElement(elmnt) {
    const mainWindowWidth = window.innerWidth;
    const mainWindowHeight = window.innerHeight;
    const elmntWidth = elmnt.offsetWidth;
    const elmntHeight = elmnt.offsetHeight;

    elmnt.style.top = ((mainWindowHeight - elmntHeight) / 3) + 'px';
    elmnt.style.left = ((mainWindowWidth - elmntWidth) / 2) + 'px';

    if (elmntHeight > mainWindowHeight) {
        elmnt.style.height = mainWindowHeight + 'px';
    }
}


var windowHeader = document.querySelector('.Frida-IDE-window-header');
var processListWindow = document.getElementById('Frida-IDE-ProcessWindow');
windowHeader.addEventListener('mousedown', function (e) {
    e.preventDefault();
    var pos1 = e.clientX - processListWindow.offsetLeft;
    var pos2 = e.clientY - processListWindow.offsetTop;

    function elementDrag(e) {
        e.preventDefault();
        var newLeft = e.clientX - pos1;
        var newTop = e.clientY - pos2;

        var mainWindowWidth = window.innerWidth;
        var mainWindowHeight = window.innerHeight;
        var elmntWidth = processListWindow.offsetWidth;
        var elmntHeight = processListWindow.offsetHeight;

        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft + elmntWidth > mainWindowWidth) newLeft = mainWindowWidth - elmntWidth;
        if (newTop + elmntHeight > mainWindowHeight) newTop = mainWindowHeight - elmntHeight;

        processListWindow.style.left = newLeft + "px";
        processListWindow.style.top = newTop + "px";
    }

    function closeDragElement() {
        document.removeEventListener('mousemove', elementDrag);
        document.removeEventListener('mouseup', closeDragElement);
    }

    document.addEventListener('mousemove', elementDrag);
    document.addEventListener('mouseup', closeDragElement);
});



var searchbutton = document.querySelector('.Frida-IDE-search');
searchbutton.addEventListener('click', async function () {
    try {
        const windowsTab = document.querySelector('[data-tab="windows"]');
        if (windowsTab) {
            windowsTab.classList.add('active');
            const windowsContent = document.getElementById('tab-windows');
            windowsContent.classList.add('active');
        }

        const androidTab = document.querySelector('[data-tab="android"]');
        if (androidTab) {
            androidTab.classList.remove('active');
            const androidContent = document.getElementById('tab-android');
            if (androidContent) androidContent.classList.remove('active');
        }

        loadWindowsProcessList();
        processListWindow.style.display = 'block';
        centerElement(processListWindow);
    } catch (error) {
        console.error(error);
    }
});


function getAndroidDeviceId() {
    return new Promise((resolve, reject) => {
        const adb = spawn(`${Fridapath}/exten/adb`, ['devices']);
        let output = '';

        adb.stdout.on('data', d => output += d.toString());
        adb.on('close', () => {
            const devices = output
                .split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('List') && l.endsWith('\tdevice'))
                .map(l => l.split('\t')[0]);

            if (devices.length === 1) return resolve(devices[0]);
        });
    });
}

let outputBuffer = [];
let flushTimeout = null;
const logLines = [];

function bufferOutput(line, type = null, withTime = true) {
    outputBuffer.push({ line, type, withTime });
    if (!flushTimeout) {
        flushTimeout = setTimeout(flushBufferedOutput, 100);
    }
}


function flushBufferedOutput() {
    const Fridaout = document.getElementById('Frida-IDE-output-content');
    if (!Fridaout || !Fridaout.isConnected || outputBuffer.length === 0) return;

    const now = new Date();
    const tagStyles = {
        'Started': 'color:#7FC363;font-weight:bold;',
        'Done': 'color:#7FC363;font-weight:bold;',
        'Error': 'color:#ff4c4c;font-weight:bold;',
        'Warning': 'color:#FFD700;font-weight:bold;',
    };

    const htmlLines = outputBuffer.map(({ line, type, withTime }) => {
        const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
        const timestamp = withTime ? `<span style="color:#888;">[${timeStr}]</span> ` : '';

        const html = line.replace(/\[([^\]]+)\]/g, (match, rawTag) => {
            const safeTag = rawTag.replace(/ /g, '&nbsp;');
            const tagName = rawTag.trim();
            if (type && tagStyles[type]) {
                return `<span style="${tagStyles[type]}">[${safeTag}]</span>`;
            }
            const matchedStyle = Object.entries(tagStyles).find(([key]) => tagName.endsWith(key));
            if (matchedStyle) {
                return `<span style="${matchedStyle[1]}">[${safeTag}]</span>`;
            }
            return `[${safeTag}]`;
        });

        return timestamp + html;
    });

    logLines.push(...htmlLines);

    Fridaout.innerHTML = logLines.join('<br>') + '<br>';
    Fridaout.scrollTop = Fridaout.scrollHeight;

    outputBuffer = [];
    flushTimeout = null;
}

const FridamodeSelect = document.getElementById('Frida-IDE-modeSelect');
const FridanameInput = document.getElementById('Frida-IDE-processSearch');

FridamodeSelect.addEventListener('change', () => {
    const mode = FridamodeSelect.value.trim();
    const packageName = FridanameInput.value.trim();
    if (mode === 'Spawn') {
        document.querySelectorAll('input[name="process"]').forEach(r => r.checked = false);

        if (!packageName) {
            FridamodeSelect.value = 'Attach';
            showMessage('⚠️ 请填写完整包名');
            return;
        }

        window.CurrentSelectedProcess = {
            pid: packageName,
            platform: 'Android',
            mode: 'Spawn'
        };
    } else {
        window.CurrentSelectedProcess.mode = 'Attach';
    }
});

FridanameInput.addEventListener('input', () => {
    const empty = !FridanameInput.value.trim();
    if (empty) {
        if (FridamodeSelect.value === 'Spawn') {
            FridamodeSelect.value = 'Attach';
            window.CurrentSelectedProcess.mode = 'Attach';
        }
        FridaPidinput.value = '0';
    }
});


function createOutputPanel() {
    let existing = document.getElementById('Frida-IDE-output-panel');
    if (existing) {
        const maxHeight = window.innerHeight * 0.8;
        const restoredHeight = Math.min(400, maxHeight);
        existing.style.height = `${restoredHeight}px`;
        clearOutputContent();
        showOutputPanel(existing);
        return existing;
    }

    const panel = document.createElement('div');
    panel.id = 'Frida-IDE-output-panel';
    const initialHeight = Math.min(400, window.innerHeight * 0.8);
    panel.style.height = `${initialHeight}px`;
    panel.style.transform = 'translateY(100%)';
    panel.style.transition = 'transform 0.3s ease';

    const dragBar = document.createElement('div');
    dragBar.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 5px;
        cursor: ns-resize;
        background: transparent;
    `;
    panel.appendChild(dragBar);

    const content = document.createElement('div');
    content.id = 'Frida-IDE-output-content';
    content.contentEditable = false;
    content.spellcheck = false;
    panel.appendChild(content);

    const contextMenu = document.createElement('div');
    contextMenu.id = 'Frida-IDE-output-context-menu';
    const copyAll = document.createElement('div');
    copyAll.textContent = '复制全部';
    copyAll.style.cssText = 'padding: 6px 16px; cursor: pointer;';
    copyAll.onclick = () => {
        navigator.clipboard.writeText(content.innerText);
        const range = document.createRange();
        range.selectNodeContents(content);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        contextMenu.style.display = 'none';
    };

    const clearAll = document.createElement('div');
    clearAll.textContent = '清空输出';
    clearAll.style.cssText = 'padding: 6px 16px; cursor: pointer;';
    clearAll.onclick = () => {
        clearOutputContent();
        contextMenu.style.display = 'none';
    };

    contextMenu.appendChild(copyAll);
    contextMenu.appendChild(clearAll);
    document.body.appendChild(contextMenu);
    content.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        const menuWidth = 120;
        const menuHeight = 80;
        const margin = 10;

        let posX = e.clientX;
        let posY = e.clientY;

        if (posX + menuWidth > window.innerWidth - margin) {
            posX = window.innerWidth - menuWidth - margin;
        }
        if (posY + menuHeight > window.innerHeight - margin) {
            posY = window.innerHeight - menuHeight - margin;
        }

        contextMenu.style.transition = 'none';
        contextMenu.style.display = 'block';
        contextMenu.style.opacity = '0';
        contextMenu.style.transform = 'scale(0.8)';
        contextMenu.offsetHeight;

        contextMenu.style.top = `${posY}px`;
        contextMenu.style.left = `${posX}px`;

        requestAnimationFrame(() => {
            contextMenu.style.transition = 'opacity 150ms ease, transform 150ms ease';
            contextMenu.style.opacity = '1';
            contextMenu.style.transform = 'scale(1)';
        });
    });

    document.addEventListener('click', () => {
        contextMenu.style.opacity = '0';
        contextMenu.style.transform = 'scale(0.95)';
        setTimeout(() => {
            contextMenu.style.display = 'none';
        }, 150);
    });

    const stopBtn = document.createElement('button');
    stopBtn.textContent = '▼';
    stopBtn.style.cssText = `
        position: absolute;
        top: 5px;
        right: 20px;
        background: rgb(51, 51, 51);
        color: rgb(204, 204, 204);
        border: 1px solid rgb(117 132 189 / 49%);
        padding: 2px 6px;
        font-size: 12px;
        cursor: pointer;
        border-radius: 3px;
    `;
    stopBtn.onclick = () => {
        panel.style.transform = 'translateY(100%)';
        setTimeout(() => {
            panel.remove();
            clearOutputContent();
        }, 300);

        try {
            if (FridatoggleButton && FridatoggleButton.checked) {
                FridatoggleButton.checked = false;
                FridatoggleButton.dispatchEvent(new Event("change"));
            }
        } catch (e) { }
    };
    panel.appendChild(stopBtn);

    let isDragging = false;
    dragBar.addEventListener('mousedown', (e) => {
        isDragging = true;
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const maxHeight = window.innerHeight * 0.8;
            const newHeight = window.innerHeight - e.clientY;

            if (newHeight < 80) {
                panel.style.transform = 'translateY(100%)';
                setTimeout(() => {
                    clearOutputContent();
                }, 300);
                isDragging = false;
                return;
            }
            panel.style.height = `${Math.min(newHeight, maxHeight)}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        document.body.style.cursor = '';
    });

    window.addEventListener('resize', () => {
        const maxHeight = window.innerHeight * 0.8;
        const current = parseInt(panel.style.height, 10);
        panel.style.height = `${Math.min(current, maxHeight)}px`;
    });


    panel.style.opacity = '0';
    panel.style.willChange = 'transform, opacity';
    panel.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    document.body.appendChild(panel);
    panel.offsetHeight;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            panel.style.transform = 'translateY(0)';
            panel.style.opacity = '1';
        });
    });

    showOutputPanel(panel);
    return panel;
}


const iconv = require("iconv-lite");
FridatoggleButton.addEventListener("change", async function () {
    const checked = this.checked;
    if (checked) {
        hiddenFridaProcessWindow();

        const filePath = ScriptPath || `${Fridapath}/Script/Demo.js`;
        const code = editor.getValue();
        fs.writeFile(filePath, code, async (err) => {
            if (err) {
                showMessage("❌ 保存失败");
                return;
            }

            const { platform = 'Windows', mode = 'Attach', pid = 0 } = window.CurrentSelectedProcess || {};
            const isAndroid = platform === 'Android';
            const isSpawn = mode === 'Spawn';
            let fridaArgs;

            if (isAndroid) {
                const AndroidDeviceId = await getAndroidDeviceId();
                fridaArgs = isSpawn
                    ? ['-D', AndroidDeviceId, '-f', pid, '-s', filePath]
                    : ['-D', AndroidDeviceId, '-p', pid, '-s', filePath];
            } else {
                fridaArgs = isSpawn
                    ? ['-f', pid, '-s', filePath]
                    : ['-p', pid, '-s', filePath];
            }

            createOutputPanel();
            const batPath = path.join(Fridapath, "exten", "FridaRun");
            window.FridaProc = spawn(batPath, fridaArgs, {
                cwd: path.dirname(batPath),
            });

            bufferOutput(`[🚀Hook ${platform}.${mode}]`, 'Started');

            let stdoutBuffer = '';
            window.FridaProc.stdout.on("data", (data) => {
                const text = iconv.decode(data, "gbk");
                stdoutBuffer += text;
                const lines = stdoutBuffer.split(/\r?\n/);
                stdoutBuffer = lines.pop();
                for (let line of lines) {
                    if (line.trim()) bufferOutput(line);
                }
            });

            window.FridaProc.stdout.on("end", () => {
                if (stdoutBuffer.trim()) bufferOutput(stdoutBuffer.trim());
                stdoutBuffer = '';
            });

            window.FridaProc.stderr.on("data", (data) => {
                const errorText = iconv.decode(data, "gbk");
                const lines = errorText.split(/\r?\n/);
                for (let line of lines) {
                    const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
                    if (cleanLine.trim()) {
                        FridatoggleButton.checked = false;
                        bufferOutput(`[Error] ${cleanLine}`, 'error');
                    }
                }
            });

            window.FridaProc.on("error", (err) => {
                bufferOutput(`[Error] ${err.message}`, 'error');
            });

            window.FridaProc.on("close", () => {
                bufferOutput(`[✓ Done]`, 'Done');
            });
        });

    } else {
        try {
            [ExePath, UacExePath].forEach(p => {
                if (p) execFile("taskkill", ["/F", "/IM", path.basename(p)], () => { });
            });

            if (window.FridaProc?.kill && !window.FridaProc.killed) {
                window.FridaProc.kill("SIGKILL");
                window.FridaProc = null;
            }
        } catch (e) { }
    }
});


let lastSaveTimestamp = 0;
let lastRunTimestamp = 0;

document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const currentTime = Date.now();
        if (currentTime - lastSaveTimestamp < 1000) return;
        lastSaveTimestamp = currentTime;

        const filePath = ScriptPath || `${Fridapath}/Script/Demo.js`;
        const code = editor.getValue();

        fs.writeFile(filePath, code, (err) => {
            if (err) {
                showMessage("❌ 保存失败");
            } else {
                showMessage("✅ 代码已保存", [
                    {
                        label: "打开位置",
                        onClick: () => {
                            exec(`start "" "${path.dirname(filePath)}"`);
                        }
                    }
                ]);
                editor?.focus?.();
            }
        });
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        const currentTime = Date.now();
        if (currentTime - lastRunTimestamp < 1000) return;
        lastRunTimestamp = currentTime;

        if (FridatoggleButton) {
            if (FridatoggleButton.checked) {
                const toggleOffThenWait = () => new Promise((resolve) => {
                    FridatoggleButton.checked = false;
                    FridatoggleButton.dispatchEvent(new Event("change"));
                    setTimeout(resolve, 500);
                });

                toggleOffThenWait().then(() => {
                    FridatoggleButton.checked = true;
                    FridatoggleButton.dispatchEvent(new Event("change"));
                });
            } else {
                FridatoggleButton.checked = true;
                FridatoggleButton.dispatchEvent(new Event("change"));
            }
        }
    }
});


function addProcessesToList(processes, processTableBody) {
    if (!Array.isArray(processes)) {
        processes = [processes];
    }

    const FridaactiveTab = document.querySelector('.Frida-IDE-tab.active');
    const currentPlatform = FridaactiveTab?.dataset.tab;
    const platformLabel = currentPlatform === 'android' ? 'Android' : 'Windows';
    window.CurrentSelectedProcess = window.CurrentSelectedProcess || {
        pid: 0,
        platform: 'Windows',
        mode: 'Attach'
    };

    processes.forEach(({ pid, name }) => {
        const newRow = document.createElement('tr');
        newRow.classList.add('Frida-IDE-process-row');
        newRow.innerHTML = `
            <td><input type="radio" name="process" value="${pid}"></td>
            <td>${pid}</td>
            <td>${name}</td>
        `;
        processTableBody.appendChild(newRow);
        const radioButton = newRow.querySelector('input[type="radio"]');

        const updateSelection = () => {
            FridaPidinput.value = radioButton.value;
            window.CurrentSelectedProcess = {
                pid,
                platform: platformLabel,
                mode: 'Attach'
            };
            const modeSelect = document.getElementById('Frida-IDE-modeSelect');
            if (modeSelect) modeSelect.value = 'Attach';
        };

        newRow.addEventListener('click', function (event) {
            if (event.target.type !== 'radio') {
                radioButton.checked = true;
            }
            updateSelection();
        });
        radioButton.addEventListener('click', updateSelection);
    });
}


let currentMsgBox = null;
function showMessage(text, actions = []) {
    if (currentMsgBox) {
        currentMsgBox.remove();
        currentMsgBox = null;
    }

    const msgBox = document.createElement("div");
    currentMsgBox = msgBox;

    msgBox.className = "frida-msg-box";
    msgBox.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translate(-50%, 30px);
        opacity: 0;
        background: #1e1e1e;
        color: #eee;
        padding: 10px 14px;
        border: 1px solid #444;
        border-radius: 6px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        font-size: 14px;
        display: flex;
        gap: 12px;
        align-items: center;
        z-index: 9999;
        transition: transform 300ms ease, opacity 300ms ease;
    `;

    const messageSpan = document.createElement("span");
    messageSpan.textContent = text;
    msgBox.appendChild(messageSpan);

    for (const { label, onClick } of actions) {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.style.cssText = `
            margin-left: 10px;
            padding: 3px 8px;
            background: #3a3f4b;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
        btn.onclick = () => {
            onClick();
            dismiss();
        };
        msgBox.appendChild(btn);
    }

    document.body.appendChild(msgBox);
    void msgBox.offsetHeight;
    requestAnimationFrame(() => {
        msgBox.style.transform = "translate(-50%, 0)";
        msgBox.style.opacity = "1";
    });

    function dismiss() {
        msgBox.style.transform = "translate(-50%, 30px)";
        msgBox.style.opacity = "0";
        setTimeout(() => {
            msgBox.remove();
            if (currentMsgBox === msgBox) currentMsgBox = null;
        }, 300);
    }
    setTimeout(dismiss, 2500);
}


var FridaAndroidBut = document.querySelector('.Frida-IDE-android');
FridaAndroidBut.addEventListener('click', async function () {
    const fastlistProcess = spawn(`${Fridapath}/exten/adb`, ['devices']);
    let output = '';
    fastlistProcess.stdout.on('data', (data) => {
        output += data.toString();
    });

    fastlistProcess.on('close', async () => {
        const lines = output.split('\n').slice(1);
        const devices = lines
            .map(line => line.trim())
            .filter(line => line.endsWith('\tdevice'));

        if (devices.length > 0) {
            showMessage("✅ 模拟器已连接");
            await pushFridaScript();
        } else {
            showMessage("❌ 未检测到模拟器");
        }
    });
});

async function pushFridaScript() {
    try {
        const pushCmd = `"${Fridapath}\\exten\\adb" push "${Fridapath}\\exten\\MS64" "/data/local/tmp/MS64"`;
        const chmodCmd = `"${Fridapath}\\exten\\adb" shell su -c 'chmod 777 \"/data/local/tmp/MS64\"'`;
        const runCmd = `"${Fridapath}\\exten\\adb" shell su -c "sh -c 'nohup /data/local/tmp/MS64 > /dev/null 2>&1 &'"`;

        const cmds = [pushCmd, chmodCmd, runCmd];
        for (const cmd of cmds) {
            await runCmdFunction(cmd);
        }
    } catch (error) {
        showMessage("❌ 推送失败");
    }
}

function runCmdFunction(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`error: ${stderr}`));
            } else {
                resolve({ output: stdout });
            }
        });
    });
}

const FridaWindowtabs = document.querySelectorAll('.Frida-IDE-tab');
const Fridacontents = document.querySelectorAll('.Frida-IDE-tabcontent');
const FridamodeSelector = document.getElementById('Frida-IDE-modeSelector');

FridaWindowtabs.forEach(tab => {
    tab.addEventListener('click', async () => {
        FridaWindowtabs.forEach(t => t.classList.remove('active'));
        Fridacontents.forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab)?.classList.add('active');

        const isAndroid = tab.dataset.tab === 'android';
        if (isAndroid) {
            await loadAndroidProcessList();
        } else {
            loadWindowsProcessList();
        }

        searchProcess();
        if (FridamodeSelector) FridamodeSelector.style.display = isAndroid ? 'block' : 'none';
    });
});


async function loadAndroidProcessList() {
    const processTableBody = document.querySelector('#Frida-IDE-processes-android');
    processTableBody.innerHTML = '';
    const psCmd = `"${Fridapath}\\exten\\adb" shell ps -A`;

    try {
        const result = await runCmdFunction(psCmd);
        const lines = result.output.split('\n');

        var processes = lines.slice(1).map((line) => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 9) {
                const pid = parts[1];
                const name = parts.slice(8).join(' ');
                return { pid, name };
            }
        }).filter(process => process);

        addProcessesToList(processes, processTableBody);
        processListWindow.style.display = 'block';

    } catch (err) {
        showMessage("❌ 模拟器未连接");
    }
}

async function loadWindowsProcessList() {
    const fastlistProcess = spawn(`${Fridapath}/exten/Fastlist`);
    const processTableBody = document.querySelector('#Frida-IDE-processes');
    processTableBody.innerHTML = '';

    try {
        fastlistProcess.stdout.on('data', (data) => {
            var lines = data.toString().split('\n');
            lines.forEach(line => {
                var parts = line.trim().split(/\s+/);
                if (parts.length >= 3) {
                    var pid = parts[0];
                    var name = parts.slice(2).join(' ');
                    if (name.toLowerCase().endsWith('.exe')) {
                        name = name.slice(0, -4);
                    }
                    addProcessesToList({ pid, name }, processTableBody);
                }
            });
        });
        processListWindow.style.display = 'block';
    } catch (error) {
        showMessage("❌ 进程获取失败");
    }
}

var UacExePath = null;
document.querySelector('.Frida-IDE-logo')?.addEventListener('click', () => {
    ipcRenderer.send('open-file-window');
});

ipcRenderer.on('file-selected', (event, filePath) => {
    if (filePath) {
        const fileName = filePath.toLowerCase();
        UacExePath = fileName;
        if (fileName.endsWith('.exe')) {
            window.CurrentSelectedProcess = {
                pid: filePath,
                platform: 'Windows',
                mode: 'Spawn'
            };
        }

        if (FridatoggleButton) {
            FridatoggleButton.checked = true;
            FridatoggleButton.dispatchEvent(new Event("change"));
        }
    }
});
