/*
    @Author: 发光的神（VoxShadow）
    @Date: 2023/8/31 ~ 2025/3/22
    @Version: 1.0.5
*/

const { exec } = require("child_process");
const fs = require('fs');
const path = require('path');

var container = document.querySelector('.MetaSword-container');
var leftMenu = document.querySelector(".MetaSword-left-Menu");
var online = document.querySelector('.MetaSword-online');
var toptitle = document.querySelector(".MetaSword-title");

function setContainerStyle(width, menuOpacity, addExpandedClass) {
    container.style.width = width;
    leftMenu.style.opacity = menuOpacity;
    if (addExpandedClass) {
        online.classList.add('expanded');
    } else {
        online.classList.remove('expanded');
    }
}

function expandContainer() {
    setContainerStyle('10px', 1, true);
}

function collapseContainer() {
    setContainerStyle('7px', 0, false);
}

function resetColor() {
    toptitle.textContent = "次元剑";
}

function checkMouseOver(icon) {
    var iconStyles = {
        '主页': { top: '67px', title: '主页' },
        '工具': { top: '105px', title: '工具' },
        'DeepSeek': { top: '143px', title: 'DeepSeek' },
        '关于': { top: '179px', title: '关于' }
    };

    var iconStyle = iconStyles[icon];
    if (iconStyle) {
        online.style.top = iconStyle.top;
        toptitle.textContent = iconStyle.title;
    }
}

function showPage(pageName) {
    var pages = ['homePage', 'toolsPage', 'DeepSeekPage', 'aboutPage'];
    for (var i = 0; i < pages.length; i++) {
        var pageElement = document.getElementById(pages[i]);
        if (pageElement) {
            pageElement.style.opacity = '0';
            pageElement.style.display = 'none';
        }
    }

    var selectedPage = document.getElementById(pageName + 'Page');
    if (selectedPage) {
        selectedPage.style.display = 'block';
        setTimeout(function () {
            selectedPage.style.opacity = '1';
        }, 0);

        var toolsbar = document.querySelector('.MetaSword-toolsView');
        if (pageName === 'tools') {
            toolsbar.style.display = 'block';
            setTimeout(function () {
                toolsbar.style.opacity = '1';
            }, 0);
        } else {
            toolsbar.style.display = 'none';
            toolsbar.style.opacity = '0';
        }
    }
}

var resultsContainer = document.getElementById('results');
var ToolsListPath = path.join(__dirname, '..', '..', './Tools/Toolslist.xml');
var categoriesData = null;

function extractData() {
    return fetch(ToolsListPath)
        .then(response => response.text())
        .then(data => {
            var parser = new DOMParser();
            var xmlDoc = parser.parseFromString(data, 'text/xml');
            return xmlDoc.getElementsByTagName('category');
        });
}

function showtoolbar() {
    extractData().then(data => {
        categoriesData = data;
        var toolbar = document.querySelector('.MetaSword-toolsView');

        Array.from(categoriesData).forEach(category => {
            var categoryName = category.getAttribute('name').trim();
            var button = document.createElement('button');
            button.classList.add('toolbar-button');
            button.textContent = categoryName;

            button.addEventListener('click', function () {
                var categoryName = this.textContent;
                if (categoryName.includes('FridaIDE')) {
                    audio.play();
                    ipcRenderer.send('createFridaIDEWindow');
                    return false;
                }
                if (categoryName.includes('☼')) {
                    audio.play();
                    ipcRenderer.send('createControlWindow');
                    return false;
                }
                document.getElementById('results').scrollTop = 0;
                displayCategoryItems(categoryName);
            });
            toolbar.appendChild(button);
        });

        if (categoriesData.length > 0) {
            var firstCategoryName = categoriesData[0].getAttribute('name').trim();
            displayCategoryItems(firstCategoryName);
        }
    });
}

showtoolbar();


function displayCategoryItems(categoryName) {
    resultsContainer.innerHTML = '';
    Array.from(categoriesData).forEach(category => {
        var name = category.getAttribute('name');
        if (name === categoryName) {
            var items = category.getElementsByTagName('item');

            Array.from(items).forEach((item, index) => {
                var text = item.getElementsByTagName('text')[0].textContent;
                var imagePath = item.getElementsByTagName('imagePath')[0].textContent;
                var statusElement = item.getElementsByTagName('status')[0];
                var status = statusElement ? statusElement.textContent : '';

                var button = createButton(text, imagePath, status);
                button.style.transition = 'opacity 0.s ease, transform 0.1s ease';
                button.style.transform = 'translatex(-50px)';
                // button.style.transform = 'translatey(-50px)';
                button.style.opacity = 0;
                setTimeout(() => {
                    button.style.opacity = 1;
                    button.style.transform = 'translatey(0)';
                }, index * 25);
                resultsContainer.appendChild(button);
            });
        }
    });
}


function createButton(text, imagePath, status) {
    var button = document.createElement('button');
    button.classList.add('toolsbutton');
    button.style.userSelect = 'none';
    button.style.position = 'relative';

    var container = document.createElement('div');
    container.classList.add('button-container');

    var img = document.createElement('img');
    img.src = path.dirname(ToolsListPath) + imagePath;
    img.alt = text;
    img.width = 30;
    img.height = 30;
    img.draggable = false;

    var buttonText = document.createElement('span');
    buttonText.textContent = text;
    buttonText.classList.add('button-text');

    container.appendChild(img);
    container.appendChild(buttonText);
    button.appendChild(container);

    if (status === 'on') {
        var smallIcon = document.createElement('img');
        smallIcon.src = '../../Tools/icons/vip.png';
        smallIcon.classList.add('small-icon');
        button.appendChild(smallIcon);
    }


    button.addEventListener('click', (event) => {
        handleButtonClick(text, event);
    });

    button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        showContextMenu(event, text);
    });

    return button;
}


function showContextMenu(event, text) {
    event.preventDefault();

    let existingMenu = document.getElementById('custom-context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const menu = document.createElement('div');

    menu.id = 'custom-context-menu';
    menu.classList.add('context-menu');

    menu.style.top = `${rect.bottom + window.scrollY}px`;
    menu.style.left = `${rect.left + window.scrollX}px`;

    var openFileOption = document.createElement('div');
    openFileOption.classList.add('context-menu-item');
    
    var textSpan = document.createElement('span');
    textSpan.textContent = '🗃️ 打开位置';
    textSpan.style.userSelect = 'none';
    openFileOption.appendChild(textSpan);

    openFileOption.addEventListener('click', () => {
        openFileFolder(text);
        removeContextMenu();
    });

    menu.appendChild(openFileOption);
    document.body.appendChild(menu);

    setTimeout(() => {
        menu.classList.add('show');
    }, 10);

    document.addEventListener('click', removeContextMenu, { once: true });
    document.querySelector('.grid-container')?.addEventListener('scroll', removeContextMenu, { once: true });
}

function removeContextMenu() {
    let menu = document.getElementById('custom-context-menu');
    if (menu) {
        menu.classList.remove('show');
        menu.classList.add('hide');
        setTimeout(() => {
            menu.remove();
        }, 200);
    }
}

var audio = new Audio('./public/audio/click.mp3');

function openFileFolder(buttonName) {
    fetch(ToolsListPath)
        .then(res => res.text())
        .then(data => {
            let xmlDoc = new DOMParser().parseFromString(data, 'text/xml');
            let item = Array.from(xmlDoc.getElementsByTagName('item'))
                .find(el => el.getElementsByTagName('text')[0].textContent === buttonName);

            if (!item) return;
            audio.play();

            let exePath = item.getElementsByTagName('executablePath')[0].textContent;
            exePath = /^[a-zA-Z]:\\/.test(exePath) ? exePath : path.join(__dirname, '..', '..', exePath);

            if (!fs.existsSync(exePath)) {
                let parentDir = path.dirname(exePath);
                exec(`start "" "${parentDir}"`);
                return;
            }

            let targetPath = fs.statSync(exePath).isDirectory() ? exePath : path.dirname(exePath);
            exec(`start "" "${targetPath}"`);
        });
}

var searchInput = document.getElementById('search');
searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        var searchTerm = searchInput.value.trim();
        var intMatch = /^\(\s*(\d+)\s*,\s*(2|8|16)\s*\)$/i.exec(searchTerm);
        if (intMatch) {
            try {
                var number = parseInt(intMatch[1], 10);
                var base = parseInt(intMatch[2], 10);
                var result;

                if (base === 2) {
                    result = number.toString(2);
                } else if (base === 8) {
                    result = number.toString(8);
                } else if (base === 16) {
                    result = number.toString(16).toUpperCase();
                }

                searchInput.value = result;
            } catch (error) {
                console.error("Error converting number:", error);
            }
            return;
        }

        if (/^[0-9+\-*/().\s]+$/.test(searchTerm)) {
            try {
                var result = eval(searchTerm);
                searchInput.value = result;
            } catch (error) {
                console.error("Error evaluating expression:", error);
            }
        } else {
            searchTerm = searchTerm.toLowerCase();
            var buttons = resultsContainer.getElementsByTagName('button');
            for (var button of buttons) {
                if (button.textContent.toLowerCase() === searchTerm) {
                    button.click();
                    break;
                }
            }
        }
    }
});


var timeoutId;
(function initSearch() {
    searchInput.addEventListener('input', function () {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(function () {
            var searchTerm = searchInput.value;
            performSearch(searchTerm);
        }, 30);
    });
})();

function performSearch(searchTerm) {
    resultsContainer.innerHTML = '';
    Array.from(categoriesData).forEach(category => {
        var items = category.getElementsByTagName('item');
        Array.from(items).forEach(item => {
            var text = item.getElementsByTagName('text')[0].textContent;
            var imagePath = item.getElementsByTagName('imagePath')[0].textContent;
            var statusElement = item.getElementsByTagName('status')[0];
            var status = statusElement ? statusElement.textContent : '';

            if (text.toLowerCase().includes(searchTerm.toLowerCase())) {
                var button = createButton(text, imagePath, status);
                resultsContainer.appendChild(button);
                button.style.opacity = 1;
            }
        });
    });
}


function handleButtonClick(buttonName) {
    fetch(ToolsListPath)
        .then(response => response.text())
        .then(data => {
            var parser = new DOMParser();
            var xmlDoc = parser.parseFromString(data, 'text/xml');
            var items = xmlDoc.getElementsByTagName('item');
            var selectedItem = Array.from(items).find(item => item.getElementsByTagName('text')[0].textContent === buttonName);
            if (selectedItem) {
                var executablePathText = selectedItem.getElementsByTagName('executablePath')[0].textContent;
                var isAbsolutePath = /^[a-zA-Z]:\\/.test(executablePathText);
                var executablePath = isAbsolutePath ?
                    executablePathText : path.join(__dirname, '..', '..', executablePathText);

                var uacNode = selectedItem.getElementsByTagName('uac')[0];
                var requiresUAC = uacNode && uacNode.textContent.trim().toLowerCase() === 'on';

                runCommandAsAdmin(executablePath, requiresUAC);
            }
        });
}

function runCommandAsAdmin(filePath, requiresUAC) {
    if (!fs.existsSync(filePath)) {
        ipcRenderer.invoke('error-dialog');
        return;
    }
    audio.play();

    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
        exec(`start "" "${filePath}"`, (error) => {
            if (error) {
                console.error('Open file error:', error);
            }
        });
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    let command;

    if (ext === '.vbs') {
        command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process wscript -ArgumentList '${filePath}' -WindowStyle Normal"`;
    } else {
        if (requiresUAC) {
            command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "& {Start-Process '${filePath}' -Verb RunAs}"`;
        } else {
            command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "& {Start-Process '${filePath}'}"`;
        }
    }

    exec(command, (error) => {
        if (error) {
            console.error(`Error command: ${error.message}`);
        }
    });
}
