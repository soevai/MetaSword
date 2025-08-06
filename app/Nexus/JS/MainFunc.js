/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.0.6
 * @Since       2023-08-31
 * @LastUpdated 2025-08-01
 * @Description 负责次元剑核心逻辑
 * @License     MIT
 */

const { ipcRenderer } = require('electron');
const { exec } = require("child_process");
const path = require('path');
const fs = require('fs');


['MetaSword-customCloseBut', 'MetaSword-customMinimizeBut'].forEach((id, i) => {
    document.getElementById(id).addEventListener('click', () => {
        ipcRenderer.send(i === 0 ? 'close-mainwindow' : 'minimize-mainwindow');
    });
});

document.querySelector("#Author-blog-link")?.addEventListener('click', (e) => {
    e.preventDefault();
    exec(`start "" "${e.currentTarget.getAttribute('href')}"`);
});


var statusIndicator = document.querySelector('.MetaSword-status-indicator');
var menuContainer = document.querySelector('.MetaSword-menu-container');
var leftSidebar = document.querySelector(".MetaSword-left-sidebar");
var headerTitle = document.querySelector(".MetaSword-header-title");

function setContainerStyle(width, menuOpacity, addExpandedClass) {
    menuContainer.style.width = width;
    leftSidebar.style.opacity = menuOpacity;
    if (addExpandedClass) {
        statusIndicator.classList.add('expanded');
    } else {
        statusIndicator.classList.remove('expanded');
    }
}

function expandContainer() {
    setContainerStyle('10px', 1, true);
}
function collapseContainer() {
    setContainerStyle('7px', 0, false);
}
function resetTitle() {
    headerTitle.textContent = "次元剑";
}

function MouseOverTitle(title) {
    const iconStyles = {
        '主页': { top: '67px', title: '主页' },
        '工具': { top: '105px', title: '工具' },
        'DeepSeek': { top: '143px', title: 'DeepSeek' },
        '关于': { top: '179px', title: '关于' }
    };

    const { top, title: newTitle } = iconStyles[title] || {};
    if (top && newTitle) {
        statusIndicator.style.top = top;
        headerTitle.textContent = newTitle;
    }
}

function showPage(pageName) {
    const pageNames = ['HomePage', 'ToolsPage', 'DeepSeekPage', 'AboutPage'];
    const toolsNavbar = document.querySelector('.MetaSword-tools-navbar');
    const selectedPage = document.getElementById(pageName + 'Page');

    pageNames.forEach(page => {
        const pageElement = document.getElementById(page);
        if (pageElement) {
            pageElement.style.opacity = '0';
            pageElement.style.display = 'none';
        }
    });

    if (selectedPage) {
        selectedPage.style.display = 'block';
        setTimeout(() => selectedPage.style.opacity = '1', 0);
    }

    if (toolsNavbar) {
        if (pageName === 'Tools') {
            toolsNavbar.style.display = 'block';
            setTimeout(() => toolsNavbar.style.opacity = '1', 0);
        } else {
            toolsNavbar.style.display = 'none';
            toolsNavbar.style.opacity = '0';
        }
    }
}

function upPath(...segments) {
    return path.join(__dirname, ...Array(4).fill('..'), ...segments);
}

var categoriesData = null;
var resultsContainer = document.getElementById('Tools-List');
const ToolsListPath = upPath('Tools', 'Toolslist.xml');
var ClickAudio = new Audio('../Assets/Sounds/Click.mp3');

function openFileFolder(buttonName) {
    fetch(ToolsListPath)
        .then(res => res.text())
        .then(data => {
            let xmlDoc = new DOMParser().parseFromString(data, 'text/xml');
            let item = Array.from(xmlDoc.getElementsByTagName('item'))
                .find(el => el.getElementsByTagName('text')[0].textContent === buttonName);

            if (!item) return;
            ClickAudio.play();

            let exePath = item.getElementsByTagName('executablePath')[0].textContent;
            exePath = /^[a-zA-Z]:\\/.test(exePath) ? exePath : upPath(exePath);
            if (!fs.existsSync(exePath)) {
                let parentDir = path.dirname(exePath);
                exec(`start "" "${parentDir}"`);
                return;
            }

            let targetPath = fs.statSync(exePath).isDirectory() ? exePath : path.dirname(exePath);
            exec(`start "" "${targetPath}"`);
        });
}

function extractData() {
    return fetch(ToolsListPath)
        .then(response => response.text())
        .then(data => {
            var parser = new DOMParser();
            var xmlDoc = parser.parseFromString(data, 'text/xml');
            return xmlDoc.getElementsByTagName('category');
        });
}

(function () {
    extractData().then(data => {
        categoriesData = data;
        var toolbar = document.querySelector('.MetaSword-tools-navbar');

        Array.from(categoriesData).forEach(category => {
            var categoryName = category.getAttribute('name').trim();
            var button = document.createElement('button');
            button.classList.add('Tools-navbar-button');
            button.textContent = categoryName;

            button.addEventListener('click', function () {
                var categoryName = this.textContent;
                if (categoryName.includes('FridaIDE')) {
                    ClickAudio.play();
                    ipcRenderer.send('createFridaIDEWindow');
                    return false;
                }
                if (categoryName.includes('☼')) {
                    ClickAudio.play();
                    ipcRenderer.send('createControlWindow');
                    return false;
                }
                document.getElementById('Tools-List').scrollTop = 0;
                displayCategoryItems(categoryName);
            });
            toolbar.appendChild(button);
        });

        if (categoriesData.length > 0) {
            var firstCategoryName = categoriesData[0].getAttribute('name').trim();
            displayCategoryItems(firstCategoryName);
        }
    });
})();

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

                button.style.opacity = 0;
                setTimeout(() => {
                    button.style.opacity = 1;
                    button.style.transform = 'translatey(0)';
                }, index * 23);
                resultsContainer.appendChild(button);
            });
        }
    });
}

function createButton(text, imagePath, status) {
    var button = document.createElement('button');
    button.classList.add('Tool-icon-button');
    button.style.userSelect = 'none';
    button.style.position = 'relative';

    var container = document.createElement('div');
    container.classList.add('Tool-button-container');

    var img = document.createElement('img');
    img.src = path.dirname(ToolsListPath) + imagePath;
    img.alt = text;
    img.width = 30;
    img.height = 30;
    img.draggable = false;

    var buttonText = document.createElement('span');
    buttonText.textContent = text;
    buttonText.classList.add('Tool-button-text');

    container.appendChild(img);
    container.appendChild(buttonText);
    button.appendChild(container);

    function up(n, targetPath) {
        return '../'.repeat(n) + targetPath;
    }

    if (status === 'on') {
        var smallIcon = document.createElement('img');
        smallIcon.src = up(4, 'Tools/Icons/vip.png');
        smallIcon.classList.add('vip-icon');
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

    const existingMenu = document.getElementById('custom-context-menu');
    if (existingMenu) existingMenu.remove();

    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();

    const menu = document.createElement('div');
    menu.id = 'custom-context-menu';
    menu.classList.add('context-menu');

    const inner = document.createElement('div');
    inner.classList.add('context-menu-inner');

    const menuWidth = 180;
    const menuHeight = 80;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let top = rect.bottom + window.scrollY;
    let left = rect.left + window.scrollX;

    if ((top + menuHeight) > (windowHeight + window.scrollY)) {
        top = rect.top + window.scrollY - menuHeight;
    }

    if ((left + menuWidth) > (windowWidth + window.scrollX)) {
        left = windowWidth - menuWidth + 10;
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    function createMenuItem(iconSrc, labelText, onClick) {
        const menuItem = document.createElement('div');
        menuItem.classList.add('context-menu-item');

        const icon = document.createElement('img');
        icon.src = iconSrc;

        const label = document.createElement('span');
        label.textContent = labelText;

        menuItem.appendChild(icon);
        menuItem.appendChild(label);
        menuItem.addEventListener('click', () => {
            onClick();
            removeContextMenu();
        });

        return menuItem;
    }

    const openFileOption = createMenuItem(
        '../Assets/Image/Folder.png',
        '打开位置',
        () => openFileFolder(text)
    );

    const divider = document.createElement('div');
    divider.classList.add('context-menu-divider');

    const runAsAdminOption = createMenuItem(
        '../Assets/Image/Uac.png',
        '管理员运行',
        () => runToolByName(text)
    );

    inner.appendChild(openFileOption);
    inner.appendChild(divider);
    inner.appendChild(runAsAdminOption);
    menu.appendChild(inner);
    document.body.appendChild(menu);

    setTimeout(() => {
        menu.classList.add('Menu-show');
    }, 10);

    document.addEventListener('click', removeContextMenu, { once: true });
    document.querySelector('.Tools-grid')?.addEventListener('scroll', removeContextMenu, { once: true });
}


function runToolByName(buttonName, forceUAC = true) {
    fetch(ToolsListPath)
        .then(response => response.text())
        .then(data => {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(data, 'text/xml');
            const items = xmlDoc.getElementsByTagName('item');

            const selectedItem = Array.from(items).find(item => {
                return item.getElementsByTagName('text')[0].textContent === buttonName;
            });

            if (selectedItem) {
                const executablePathText = selectedItem.getElementsByTagName('executablePath')[0].textContent;
                const isAbsolutePath = /^[a-zA-Z]:\\/.test(executablePathText);
                const executablePath = isAbsolutePath ? executablePathText : upPath(executablePathText);
                runCommandAsAdmin(executablePath, forceUAC);
            }
        });
}

function removeContextMenu() {
    let menu = document.getElementById('custom-context-menu');
    if (menu) {
        menu.classList.remove('Menu-show');
        menu.classList.add('hide');
        setTimeout(() => {
            menu.remove();
        }, 200);
    }
}

var searchInput = document.getElementById('Tools-search');
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
            }
            return;
        }

        if (/^[0-9+\-*/().\s]+$/.test(searchTerm)) {
            try {
                var result = eval(searchTerm);
                searchInput.value = result;
            } catch (error) {
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
                var executablePath = isAbsolutePath ? executablePathText : upPath(executablePathText);
                var uacNode = selectedItem.getElementsByTagName('uac')[0];
                var requiresUAC = uacNode && uacNode.textContent.trim().toLowerCase() === 'on';
                runCommandAsAdmin(executablePath, requiresUAC);
            }
        });
}

function runCommandAsAdmin(filePath, requiresUAC) {
    if (!fs.existsSync(filePath)) {
        ipcRenderer.invoke('ErrorDialog');
        return;
    }
    ClickAudio.play();
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
        exec(`start "" "${filePath}"`, () => { });
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
    exec(command, () => { });
}

// 次元剑风格终端提示
const log = (type) => console[type].bind(console);
const logTitle = (title, version) => log('log')(
    `%c ${title} %c v${version} `,
    'padding:2px 1px; border-radius:3px 0 0 3px; color:#fff; background:#606060; font-weight:bold;',
    'padding:2px 1px; border-radius:0 3px 3px 0; color:#fff; background:#42c02e; font-weight:bold;'
);

function logStyled(...segments) {
    const texts = segments.map(([txt]) => `%c${txt}`).join('');
    const styles = segments.map(([, style]) => style);
    log('log')(texts, ...styles);
}

function logImageBlock(imagePaths, size = 100, mode = 'contain') {
    const texts = [], styles = [];

    imagePaths.filter(fs.existsSync).forEach((imgPath) => {
        const ext = path.extname(imgPath).toLowerCase();
        const mime = ext === '.png' ? 'png' : ext === '.ico' ? 'x-icon' : 'jpeg';
        const base64 = fs.readFileSync(imgPath).toString('base64');
        texts.push('%c ');
        styles.push(`font-size:1px; padding:${size}px ${size}px; background:url(data:image/${mime};base64,${base64}) no-repeat center / ${mode}; color:transparent;`);
    });

    if (texts.length) console.log(texts.join(''), ...styles);
}

logStyled(
    ['                                                                               ', 'color:#bfbfbf; font-weight:bold; font-size:12px;'],
    ['███╗   ███╗███████╗████████╗ █████╗ ███████╗██╗    ██╗ ██████╗ ██████╗ ██████╗ ', 'color:#ff4d4f; font-weight:bold; font-size:12px;'],
    ['████╗ ████║██╔════╝╚══██╔══╝██╔══██╗██╔════╝██║    ██║██╔═══██╗██╔══██╗██╔══██╗', 'color:#faad14; font-weight:bold; font-size:12px;'],
    ['██╔████╔██║█████╗     ██║   ███████║███████╗██║ █╗ ██║██║   ██║██████╔╝██║  ██║', 'color:#52c41a; font-weight:bold; font-size:12px;'],
    ['██║╚██╔╝██║██╔══╝     ██║   ██╔══██║╚════██║██║███╗██║██║   ██║██╔══██╗██║  ██║', 'color:#13c2c2; font-weight:bold; font-size:12px;'],
    ['██║ ╚═╝ ██║███████╗   ██║   ██║  ██║███████║╚███╔███╔╝╚██████╔╝██║  ██║██████╔╝', 'color:#1890ff; font-weight:bold; font-size:12px;'],
    ['╚═╝     ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝ ', 'color:#722ed1; font-weight:bold; font-size:12px;'],
    ['                                                                               ', 'color:#bfbfbf; font-weight:bold; font-size:12px;']
);

logImageBlock([path.resolve(__dirname, '../Assets/Image/icon.ico')], 33, 'cover');
logTitle('次元剑 MetaSword', '1.0.6');

logStyled(
    ['[像花一样对称，', 'color:#606060; font-weight:bold;'],
    ['像光一样次元。]', 'color:#42c02e; font-weight:bold;'],
);

logImageBlock([
    path.resolve(__dirname, '../Assets/Image/Alipay.jpg'),
    path.resolve(__dirname, '../Assets/Image/WeChat.jpg')
], 120, 'contain');

logStyled(
    ['[创作不易 ', 'color:#f56c6c; font-weight:bold;'],
    ['🔥 感谢支持~]', 'color:#42c02e; font-weight:bold;']
);