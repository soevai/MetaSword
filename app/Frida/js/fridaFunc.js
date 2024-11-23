const { spawn, exec } = require("child_process");
const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');

const dropZone = document.getElementById('frida-IDE-dropZone');
const maximizeButton = document.getElementById("maximizeButton");
const closeButtons = document.getElementById("closeButton");
const minimizeButton = document.getElementById("minimize-btn");

let isMaximized = false;
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


minimizeButton.addEventListener("click", () => {
    ipcRenderer.send('frida-minimizeWindow');
});

closeButtons.addEventListener("click", () => {
    window.close();
});

function showDropZone() {
    Object.assign(dropZone.style, {
        height: '100vh',
        zIndex: '999',
        visibility: 'visible'
    });
}

function hideDropZone() {
    dropZone.style.visibility = 'hidden';
}

function handleDragEnter(e) {
    e.preventDefault();
    var items = e.dataTransfer.items;
    if (items.length > 0 && items[0].kind === 'file') {
        showDropZone();
    }
}

function handleDragLeave(e) {
    e.preventDefault();
    if (!e.relatedTarget || e.relatedTarget.nodeName === "HTML") {
        hideDropZone();
    }
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDrop(e) {
    e.preventDefault();
    hideDropZone();
    var files = e.dataTransfer.files;
    if (files.length > 0) {
        var file = files[0];
        if (file.name.endsWith('.js')) {
            ScriptPath = file.path;
        } else {
            ExePath = file.path;
        }
        if (file.name.endsWith('.exe')) {
            processExec = true;
            document.getElementsByClassName("frida-IDE-slider")[0].click();
            return;
        }
        var reader = new FileReader();
        reader.onload = function (event) {
            try {
                editor.setValue(event.target.result);
            } catch (error) {
                console.error("Error setting editor value:", error);
            }
        };
        reader.readAsText(file);
    }
}

document.body.addEventListener('dragenter', handleDragEnter);
document.body.addEventListener('dragleave', handleDragLeave);
document.body.addEventListener('dragover', handleDragOver);
document.body.addEventListener('drop', handleDrop);

var fridapath = __dirname;
var toggleButton = document.getElementById('frida-IDE-toggleButton');
var Pidinput = document.querySelector(".frida-IDE-PID");
var processExec = false;
var ExePath = null;
var ScriptPath = null;

Pidinput.addEventListener('input', function () {
    if (this.value.length > 8) {
        this.value = this.value.slice(0, 8);
    }
});

toggleButton.addEventListener('change', function () {
    var filePath = ScriptPath || `${fridapath}/script/main.js`;
    var code = editor.getValue();
    var checked = this.checked;
    var pid = Pidinput.value || 0;

    fs.writeFile(filePath, code, (err) => {
        if (err) {
            console.error("Error writing file:", err);
            return;
        }
        var state = (checked ? 1 : 0) + (processExec ? 2 : 0);
        var command;

        switch (state) {
            case 1: // checked == true, processExec == false
                command = `powershell -Command "Start-Process cmd -ArgumentList '/c title Frida Terminal && ${fridapath}/FridaRun -p ${pid} -s ${filePath}' -Verb RunAs"`;
                break;
            case 3: // checked == true, processExec == true
                command = `powershell -Command "Start-Process cmd -ArgumentList '/c title Frida Terminal && ${fridapath}/FridaRun -f ${ExePath} -s ${filePath}' -Verb RunAs"`;
                break;
            case 0: // checked == false, processExec == false
            case 2: // checked == false, processExec == true
                if (ExePath != null) {
                    var programName = path.basename(ExePath, path.extname(ExePath));
                    command = `powershell -WindowStyle Hidden -Command "Start-Process powershell -ArgumentList '-Command \\"Stop-Process -Name ${programName} -Force\\"' -Verb RunAs -WindowStyle Hidden"`;
                } else {
                    command = `powershell -WindowStyle Hidden -Command "Start-Process powershell -ArgumentList '-Command \\"Stop-Process -Name FridaRun -Force; Stop-Process -Name ${programName} -Force\\"' -Verb RunAs -WindowStyle Hidden"`;
                }
                processExec = false;

                break;
            default:
                return;
        }
        exec(command, (error, stdout, stderr) => {
            if (error) {
                return;
            }
        });

    });
});

var button = document.querySelector('.frida-IDE-search');
button.addEventListener('click', async function () {
    try {
        const fastlistProcess = spawn(`${fridapath}/Fastlist`);
        var processTableBody = document.querySelector('#frida-IDE-processes');
        processTableBody.innerHTML = '';
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
                    addProcessToList(pid, name);
                }
            });
        });
        processListWindow.style.display = 'block';
        centerElement(processListWindow);
    } catch (error) {
        console.error(error);
    }
});

function addProcessToList(pid, name) {
    var processTableBody = document.querySelector('#frida-IDE-processes');
    var newRow = document.createElement('tr');
    newRow.innerHTML = `
        <td><input type="radio" name="process" value="${pid}"></td>
        <td>${pid}</td>
        <td>${name}</td>`;
    processTableBody.appendChild(newRow);
    newRow.addEventListener('click', function (event) {
        var radioButton = newRow.querySelector('input[type="radio"]');
        if (event.target.type !== 'radio') {
            radioButton.checked = true;
        }
        Pidinput.value = radioButton.value;
    });

    var radioButton = newRow.querySelector('input[type="radio"]');
    radioButton.addEventListener('click', function (event) {
        Pidinput.value = radioButton.value;
    });
}


var windowHeader = document.querySelector('.frida-IDE-window-header');
var processListWindow = document.getElementById('frida-IDE-ProcessWindow');

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
centerElement(processListWindow);


function centerElement(elmnt) {
    var mainWindowWidth = window.innerWidth;
    var mainWindowHeight = window.innerHeight;
    var elmntWidth = elmnt.offsetWidth;
    var elmntHeight = elmnt.offsetHeight;
    elmnt.style.top = ((mainWindowHeight - elmntHeight) / 3) + 'px';
    elmnt.style.left = ((mainWindowWidth - elmntWidth) / 2) + 'px';
}

var searchInput = document.getElementById('frida-IDE-processSearch');
var throttleTimeout;
var throttleInterval = 10;
searchInput.addEventListener('input', function () {
    clearTimeout(throttleTimeout);
    throttleTimeout = setTimeout(function () {
        searchProcess();
    }, throttleInterval);
});

function searchProcess() {
    var searchText = searchInput.value.toLowerCase();
    var processRows = document.querySelectorAll('#frida-IDE-processes tr');
    processRows.forEach(function (row) {
        var processName = row.querySelector('td:nth-child(3)').innerText.toLowerCase();
        if (processName.includes(searchText)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

var closeButton = document.querySelector('.frida-IDE-window-closebtn');
closeButton.addEventListener('click', function () {
    var processListWindow = document.getElementById('frida-IDE-ProcessWindow');
    processListWindow.style.display = 'none';
});