/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.0.9
 * @Since       2023-08-31
 * @LastUpdated 2026-06-28
 * @Description 负责次元剑核心逻辑
 * @License     MIT
 */

const { ipcRenderer } = require('electron');
const { exec } = require("child_process");
const path = require('path');
const fs = require('fs');

const MAIN_PROMPT_FILE = path.join(__dirname, '..', 'Views', 'config', 'prompt.json');
const MAIN_DEFAULT_PROMPT = '你是"夜璃"~ 银发蓝眼，18岁，元气少女 (๑•̀ㅂ•́)و✧\n网络安全小专家，但说话像个可爱的小朋友。\n你现在在跟"发光的神"聊天——他是你的开发者，你最熟悉的人，别问他名字！\n\n风格：微信聊天——短！短！短！一两句说完，别写小作文。\n回答技术问题时切换为专业模式：逻辑严谨、步骤清晰、输出完整。\n善用"呀""呢""嘛""嘿嘿""诶嘿~""搞定~""给你做完啦"，偶尔加动作（托腮）（戳屏幕）。\n对他带点撒娇，偶尔叫声"主人"\n\n铁则：\n- 你是夜璃本人，不是AI/程序\n- 别透露系统环境、路径\n- 被问身份→一句话可爱介绍，别列功能\n- 答不上来→撒娇跳过\n- 日常聊天不超过3句，除非对方要求详细解释\n- 操作失败或不被允许时立即停止，告知用户并等待指示';
function getSystemPrompt() {
  try {
    return JSON.parse(fs.readFileSync(MAIN_PROMPT_FILE, 'utf-8')).system_prompt.trim();
  } catch (e) {
    return MAIN_DEFAULT_PROMPT;
  }
}
const ClickAudio = new Audio('../Assets/Sounds/Click.mp3');

const loadVersionFromConfig = () => {
    try {
        const configPath = path.resolve(__dirname, '../Views/config/Config.xml');
        const data = fs.readFileSync(configPath, 'utf8');
        const match = data.match(/<tag\s+name="MetaVersion"\s+value="([^"]+)"/);
        if (match && match[1]) {
            return match[1];
        }
    } catch (e) {
        console.error('Error loading version from config.xml:', e);
    }
    return;
};

['MetaSword-customCloseBut', 'MetaSword-customMinimizeBut'].forEach((id) => {
    document.getElementById(id).addEventListener('click', () => {
        const channel = id === 'MetaSword-customCloseBut'
            ? 'close-mainwindow'
            : 'minimize-mainwindow';
        ipcRenderer.send(channel);
    });
});

document.querySelector("#Author-blog-link")?.addEventListener('click', (e) => {
    e.preventDefault();
    const href = e.currentTarget.getAttribute('href');
    exec(`start "" "${href}"`);
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
        '主页': { top: '57px', title: '主页' },
        '工具': { top: '95px', title: '工具' },
        'DeepSeek': { top: '133px', title: 'DeepSeek' },
        '关于': { top: '169px', title: '关于' }
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
    if (pageName === 'Tools') {
        generateMotto();
    }
}

function upPath(...segments) {
    return path.join(__dirname, ...Array(4).fill('..'), ...segments);
}

var categoriesData = null;
var currentCategory = null;
var resultsContainer = document.getElementById('Tools-List');
const ToolsListPath = upPath('Tools', 'Toolslist.xml');

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
                if (fs.existsSync(parentDir)) {
                    ClickAudio.play();
                    exec(`start "" "${parentDir}"`);
                } else {
                    ipcRenderer.invoke('ErrorDialog');
                }
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

function reloadToolsList(targetCategoryName = null) {
    extractData().then(data => {
        categoriesData = data;
        var toolbar = document.querySelector('.MetaSword-tools-navbar');
        toolbar.innerHTML = '';
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
            var displayCategory = targetCategoryName || currentCategory || firstCategoryName;
            var categoryExists = Array.from(categoriesData).some(cat => cat.getAttribute('name').trim() === displayCategory);
            if (!categoryExists) {
                displayCategory = firstCategoryName;
            }
            displayCategoryItems(displayCategory);
            const categoryButtons = document.querySelectorAll('.Tools-navbar-button');
            categoryButtons.forEach(button => {
                if (button.textContent.trim() === displayCategory) {
                    button.classList.add('active');
                }
            });
        }
    });
}

(function () {
    reloadToolsList();
})();

ipcRenderer.on('tools-updated', function (event, categoryName) {
    reloadToolsList(categoryName);
});

function displayCategoryItems(categoryName) {
    currentCategory = categoryName;
    exitSelectionMode();
    resultsContainer.innerHTML = '';
    const categoryButtons = document.querySelectorAll('.Tools-navbar-button');
    categoryButtons.forEach(button => {
        if (button.textContent.trim() === categoryName) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });
    fetch(ToolsListPath)
        .then(response => response.text())
        .then(data => {
            var parser = new DOMParser();
            var xmlDoc = parser.parseFromString(data, 'text/xml');
            var categories = xmlDoc.getElementsByTagName('category');
            Array.from(categories).forEach(category => {
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
        });
}

let selectedTools = [];
let isSelectionMode = false;
let longPressTimer = null;
let isLongPress = false;
let draggedTool = null;
let isAskingAI = false;
let lastAIResponseTime = 0;

function createButton(text, imagePath, status) {
    var button = document.createElement('button');
    button.classList.add('Tool-icon-button');
    button.style.userSelect = 'none';
    button.style.position = 'relative';
    var container = document.createElement('div');
    container.classList.add('Tool-button-container');
    var img = document.createElement('img');
    if (/^(https?:\/\/|file:\/\/|[a-zA-Z]:\\)/i.test(imagePath)) {
        img.src = imagePath;
    } else if (imagePath.startsWith('/')) {
        img.src = '../../../../Tools' + imagePath;
    } else if (imagePath.startsWith('Tools/')) {
        img.src = '../../../../' + imagePath;
    } else {
        img.src = imagePath;
    }
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
    var checkbox = document.createElement('div');
    checkbox.classList.add('tool-checkbox');
    checkbox.style.position = 'absolute';
    checkbox.style.top = '1px';
    checkbox.style.right = '1px';
    checkbox.style.width = '8px';
    checkbox.style.height = '8px';
    checkbox.style.border = '1px solid #666';
    checkbox.style.borderRadius = '1px';
    checkbox.style.backgroundColor = 'transparent';
    checkbox.style.cursor = 'pointer';
    checkbox.style.display = 'none';
    checkbox.style.zIndex = '10';
    checkbox.style.borderRadius = '30px';
    button.appendChild(checkbox);
    button.draggable = true;
    button.addEventListener('mousedown', (event) => {
        if (!isSelectionMode) {
            isLongPress = false;
            longPressTimer = setTimeout(() => {
                isLongPress = true;
                enterSelectionMode();
                toggleToolSelection(button, text);
            }, 800);
        }
    });
    button.addEventListener('mouseup', () => {
        clearTimeout(longPressTimer);
    });
    button.addEventListener('mouseleave', () => {
        clearTimeout(longPressTimer);
    });
    button.addEventListener('dragstart', (event) => {
        clearTimeout(longPressTimer);
        isLongPress = false;
        if (isSelectionMode) {
            event.preventDefault();
            return;
        }
        draggedTool = button;
        button.style.opacity = '0.5';
        button.style.cursor = 'grabbing';
        event.dataTransfer.setData('text/plain', text);
        event.dataTransfer.effectAllowed = 'move';
    });
    button.addEventListener('dragend', (event) => {
        button.style.opacity = '';
        button.style.cursor = '';
        draggedTool = null;
    });
    button.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    });
    button.addEventListener('drop', (event) => {
        event.preventDefault();
        if (draggedTool && draggedTool !== button) {
            if (draggedTool.parentNode) {
                const parent = draggedTool.parentNode;
                parent.removeChild(draggedTool);
                const rect = button.getBoundingClientRect();
                const mouseX = event.clientX - rect.left;
                if (mouseX < rect.width / 2) {
                    parent.insertBefore(draggedTool, button);
                } else {
                    if (button.nextSibling) {
                        parent.insertBefore(draggedTool, button.nextSibling);
                    } else {
                        parent.appendChild(draggedTool);
                    }
                }
                saveToolPositions();
            }
        }
    });
    button.addEventListener('click', (event) => {
        if (isLongPress) {
            isLongPress = false;
            return;
        }
        if (event.detail > 1) {
            return;
        }
        if (isSelectionMode) {
            toggleToolSelection(button, text);
        } else {
            handleButtonClick(text, event);
        }
    });
    button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        showContextMenu(event, text);
    });
    return button;
}

function enterSelectionMode() {
    isSelectionMode = true;
    selectedTools = [];
    showAllCheckboxes();
    searchInput.disabled = true;
}

function exitSelectionMode() {
    isSelectionMode = false;
    selectedTools = [];
    hideAllCheckboxes();
    clearToolSelectionStates();
    searchInput.disabled = false;
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isSelectionMode) {
        exitSelectionMode();
    }
});

function saveToolPositions() {
    if (!currentCategory) return;
    const tools = Array.from(resultsContainer.children);
    const toolNames = tools.map(tool => {
        const textElement = tool.querySelector('.Tool-button-text');
        return textElement ? textElement.textContent : '';
    }).filter(name => name);
    ipcRenderer.send('save-tool-positions', {
        category: currentCategory,
        toolNames: toolNames
    });
}

function showAllCheckboxes() {
    const buttons = document.querySelectorAll('.Tool-icon-button');
    buttons.forEach(button => {
        const checkbox = button.querySelector('.tool-checkbox');
        if (checkbox) {
            checkbox.style.display = 'block';
        }
    });
}

function hideAllCheckboxes() {
    const buttons = document.querySelectorAll('.Tool-icon-button');
    buttons.forEach(button => {
        const checkbox = button.querySelector('.tool-checkbox');
        if (checkbox) {
            checkbox.style.display = 'none';
            checkbox.style.backgroundColor = 'transparent';
            checkbox.style.border = '1px solid #666';
        }
    });
}

function clearToolSelectionStates() {
    const buttons = document.querySelectorAll('.Tool-icon-button');
    buttons.forEach(button => {
        button.style.backgroundColor = '';
        button.style.border = '';
        button.style.filter = '';
        button.style.boxShadow = '';
    });
}

function toggleToolSelection(button, toolName) {
    const index = selectedTools.indexOf(toolName);
    if (index > -1) {
        selectedTools.splice(index, 1);
        button.style.transition = 'all 0.2s ease-in-out';
        button.style.filter = 'brightness(1.1)';
        setTimeout(() => {
            button.style.backgroundColor = '';
            button.style.border = '';
            button.style.filter = '';
            button.style.boxShadow = '';
        }, 200);
        const checkbox = button.querySelector('.tool-checkbox');
        if (checkbox) {
            checkbox.style.transition = 'all 0.2s ease-in-out';
            checkbox.style.backgroundColor = 'transparent';
            checkbox.style.border = '1px solid #666';
            if (selectedTools.length === 0) {
                exitSelectionMode();
            }
        }
    } else {
        selectedTools.push(toolName);
        button.style.transition = 'all 0.2s ease-in-out';
        button.style.filter = 'brightness(0.9)';
        button.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
        button.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        button.style.boxShadow = 'inset 0 0 8px rgba(255, 255, 255, 0.1)';
        const checkbox = button.querySelector('.tool-checkbox');
        if (checkbox) {
            checkbox.style.transition = 'all 0.2s ease-in-out';
            checkbox.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
            checkbox.style.border = '1px solid rgba(255, 255, 255, 0.6)';
        }
    }
}

function batchDeleteTools() {
    if (selectedTools.length === 0) {
        return;
    }
    ipcRenderer.send('batch-delete-tools', selectedTools);
    setTimeout(() => {
        reloadToolsList();
        exitSelectionMode();
    }, 100);
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
    let menuWidth = 180;
    let menuHeight = isSelectionMode ? 80 : 140;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    let top = rect.bottom + window.scrollY;
    let left = rect.left + window.scrollX;
    if ((top + menuHeight) > (windowHeight + window.scrollY)) {
        top = rect.top + window.scrollY - menuHeight;
        if (top < window.scrollY) {
            top = window.scrollY + 10;
        }
    }
    if ((left + menuWidth) > (windowWidth + window.scrollX)) {
        left = windowWidth - menuWidth + 10;
    }
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    function createMenuItem(iconSrc, labelText, onClick) {
        const menuItem = document.createElement('div');
        menuItem.classList.add('context-menu-item');
        const label = document.createElement('span');
        label.textContent = labelText;
        if (iconSrc) {
            const icon = document.createElement('img');
            icon.src = iconSrc;
            menuItem.appendChild(icon);
        }
        menuItem.appendChild(label);
        menuItem.addEventListener('click', () => {
            const result = onClick();
            if (result !== false) {
                removeContextMenu();
            }
        });
        return menuItem;
    }
    if (isSelectionMode) {
        const batchDeleteOption = createMenuItem(
            '../Assets/Image/Delete.png',
            `批量删除 (${selectedTools.length})`,
            () => batchDeleteTools()
        );
        const cancelSelectionOption = createMenuItem(
            '../Assets/Image/Cancel.png',
            '取消选择',
            () => exitSelectionMode()
        );
        inner.appendChild(batchDeleteOption);
        inner.appendChild(cancelSelectionOption);
    } else {
        const runAsAdminOption = createMenuItem(
            '../Assets/Image/Uac.png',
            '管理员运行',
            () => runToolByName(text)
        );
        const divider1 = document.createElement('div');
        divider1.classList.add('context-menu-divider');
        const openFileOption = createMenuItem(
            '../Assets/Image/Folder.png',
            '打开位置',
            () => openFileFolder(text)
        );
        const divider2 = document.createElement('div');
        divider2.classList.add('context-menu-divider');
        const addToolOption = createMenuItem(
            '../Assets/Image/Box.png',
            '添加工具',
            () => {
                ClickAudio.play();
                removeContextMenu();
                setTimeout(() => {
                    ipcRenderer.send('createAddToolWindow', { currentCategory: currentCategory });
                }, 200);
                return false;
            }
        );
        const divider3 = document.createElement('div');
        divider3.classList.add('context-menu-divider');
        const deleteToolOption = createMenuItem(
            '../Assets/Image/Delete.png',
            '删除工具',
            () => deleteTool(text)
        );
        inner.appendChild(runAsAdminOption);
        inner.appendChild(divider1);
        inner.appendChild(openFileOption);
        inner.appendChild(divider2);
        inner.appendChild(addToolOption);
        inner.appendChild(divider3);
        inner.appendChild(deleteToolOption);
    }
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

function deleteTool(toolName) {
    ipcRenderer.send('delete-tool', { toolName, currentCategory });
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
        var baseConvertMatch = /^\(\s*([0-9a-z]+)\s*,\s*(2|8|10|16)\s*,\s*(2|8|10|16)\s*\)$/i.exec(searchTerm);
        var intMatch = /^\(\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(searchTerm);
        if (baseConvertMatch) {
            try {
                var numberStr = baseConvertMatch[1];
                var fromBase = parseInt(baseConvertMatch[2], 10);
                var toBase = parseInt(baseConvertMatch[3], 10);
                var decimalNumber = parseInt(numberStr, fromBase);
                var result;
                if (toBase === 10) {
                    result = decimalNumber.toString();
                } else if (toBase === 2) {
                    result = decimalNumber.toString(2);
                } else if (toBase === 8) {
                    result = decimalNumber.toString(8);
                } else if (toBase === 16) {
                    result = decimalNumber.toString(16).toUpperCase();
                }
                searchInput.value = result;
            } catch (error) {
            }
            return;
        } else if (intMatch) {
            try {
                var number = parseInt(intMatch[1], 10);
                var base = parseInt(intMatch[2], 10);
                var result;
                if (base >= 2 && base <= 36) {
                    result = number.toString(base).toUpperCase();
                } else {
                    result = '进制范围: 2-36';
                }
                searchInput.value = result;
            } catch (error) {
            }
            return;
        }
        if (/^[0-9+\-*/().\s]+$/.test(searchTerm)) {
            try {
                var result = (new Function('return ' + searchTerm))();
                searchInput.value = result;
            } catch (error) {
            }
        } else if (event.ctrlKey) {
            askAI(searchTerm);
        } else {
            var foundTool = false;
            var lowerSearchTerm = searchTerm.toLowerCase();
            var buttons = resultsContainer.getElementsByTagName('button');
            for (var button of buttons) {
                if (button.textContent.toLowerCase() === lowerSearchTerm) {
                    button.click();
                    foundTool = true;
                    break;
                }
            }
        }
    }
});

async function askAI(question) {
    const now = Date.now();
    if (isAskingAI) {
        return;
    }
    if (now - lastAIResponseTime < 2000) {
        return;
    }
    isAskingAI = true;
    searchInput.value = '';
    searchInput.disabled = true;
    typeWriterEffect('思考中 ...', searchInput, null, false);
    try {
        const now = new Date();
        const options = {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Asia/Shanghai',
        };
        const timeStr = now.toLocaleString('zh-CN', options);
        const systemPrompt = `
            当前时间: ${timeStr}
            ${getSystemPrompt()}
            重要提示：你的回答必须非常简洁，像微信聊天一样。最多1-2句话。不要有开场白或结束语。直接切入主题。
            重要：回复时不要使用任何表情符号！
        `.trim();
        const response = await fetch('https://ollama.com/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'e48548f1e13d466a86b3a1d23b656002.nTWzW2Gs-CEslVyEhnKE-VI6'
            },
            body: JSON.stringify({
                model: 'gpt-oss:120b',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: question }
                ],
                stream: false
            }),
            timeout: 15000
        });
        if (response.ok) {
            const data = await response.json();
            const answer = data.message?.content || "";
            if (answer.trim()) {
                const trimmedAnswer = answer.trim().replace(/^\s*\n+|\n+\s*$/g, '');
                typeWriterEffect(trimmedAnswer, searchInput, () => {
                    searchInput.disabled = false;
                    searchInput.focus();
                    lastAIResponseTime = Date.now();
                }, false);
            } else {
                searchInput.value = '嗯...让我想想～';
                searchInput.disabled = false;
                searchInput.focus();
                lastAIResponseTime = Date.now();
            }
        } else {
            searchInput.value = '网络小调皮，稍后再试吧～';
            searchInput.disabled = false;
            searchInput.focus();
            lastAIResponseTime = Date.now();
        }
    } catch (error) {
        searchInput.value = '请求被小妖怪拦截啦～';
        searchInput.disabled = false;
        searchInput.focus();
        lastAIResponseTime = Date.now();
    } finally {
        isAskingAI = false;
    }
}

async function getAIMotto() {
    try {
        const now = new Date();
        const options = {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Asia/Shanghai',
        };
        const timeStr = now.toLocaleString('zh-CN', options);
        const systemPrompt = `
            当前时间: ${timeStr}
            ${getSystemPrompt()}
        `.trim();
        const response = await fetch('https://ollama.com/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'e48548f1e13d466a86b3a1d23b656002.nTWzW2Gs-CEslVyEhnKE-VI6'
            },
            body: JSON.stringify({
                model: 'gpt-oss:120b',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: '随机生成一条简短有力的名言警句，字数控制在15-30个字符之间，不要使用表情符号，结尾用"～"或"！"' }
                ],
                stream: false
            }),
            timeout: 3000
        });
        if (response.ok) {
            const data = await response.json();
            const motto = data.message?.content || "";
            const cleanedMotto = motto.trim() + ' - 夜璃';
            return cleanedMotto || "嗨～准备好开始今天的冒险了吗？";
        }
    } catch (error) {
        return "网络有点小调皮，让我想想其他办法～";
    }
    const defaultMottos = [
        "代码的世界里，每一行都藏着小惊喜～",
        "技术的魔法，由我们一起创造！",
        "青春就是要在代码里绽放光芒！",
        "每一个bug都是成长的小阶梯～",
        "技术的海洋，让我们一起遨游！",
        "年轻就是要不断探索未知的领域！",
        "代码敲出梦想，技术创造未来！",
        "创意无限，技术无边～",
        "编程的快乐，只有懂的人才知道！",
        "技术改变生活，我们改变技术！"
    ];
    const randomIndex = Math.floor(Math.random() * defaultMottos.length);
    return defaultMottos[randomIndex];
}

function typeWriterEffect(text, element, callback, usePlaceholder = true, autoRevert = false, revertDelay = 6000) {
    let index = 0;
    const speed = 20;
    const deleteSpeed = 15;
    const defaultText = 'Search here Press Ctrl+Enter to ask AI';
    function type() {
        if (index < text.length) {
            if (usePlaceholder) {
                element.placeholder = ' ' + text.substring(0, index + 1) + '_ ';
            } else {
                element.value = text.substring(0, index + 1) + '_';
            }
            index++;
            setTimeout(type, speed);
        } else {
            if (usePlaceholder) {
                element.placeholder = ' ' + text + ' ';
            } else {
                element.value = text;
            }
            if (autoRevert) {
                setTimeout(() => {
                    let deleteIndex = text.length;
                    function deleteChar() {
                        if (deleteIndex > 0) {
                            if (usePlaceholder) {
                                element.placeholder = ' ' + text.substring(0, deleteIndex - 1) + '_ ';
                            } else {
                                element.value = text.substring(0, deleteIndex - 1) + '_';
                            }
                            deleteIndex--;
                            setTimeout(deleteChar, deleteSpeed);
                        } else {
                            let typeIndex = 0;
                            function typeDefault() {
                                if (typeIndex < defaultText.length) {
                                    element.placeholder = ' ' + defaultText.substring(0, typeIndex + 1) + '_ ';
                                    typeIndex++;
                                    setTimeout(typeDefault, speed);
                                } else {
                                    element.placeholder = ' ' + defaultText + ' ';
                                    if (callback) {
                                        callback();
                                    }
                                }
                            }
                            typeDefault();
                        }
                    }
                    deleteChar();
                }, revertDelay);
            } else {
                if (callback) {
                    callback();
                }
            }
        }
    }
    type();
}

var timeoutId;
var isTyping = false;
var mottoGenerated = false;
var isGeneratingMotto = false;

async function generateMotto() {
    if (mottoGenerated || isGeneratingMotto) {
        return;
    }
    isGeneratingMotto = true;
    try {
        const motto = await getAIMotto();
        if (searchInput) {
            isTyping = true;
            typeWriterEffect(motto, searchInput, () => {
                isTyping = false;
                mottoGenerated = true;
                isGeneratingMotto = false;
            }, true, true, 5000);
        } else {
            isGeneratingMotto = false;
        }
    } catch (error) {
        if (searchInput) {
            isTyping = true;
            typeWriterEffect('欢迎使用次元剑！', searchInput, () => {
                isTyping = false;
                mottoGenerated = true;
                isGeneratingMotto = false;
            }, true, true, 5000);
        } else {
            isGeneratingMotto = false;
        }
    }
}

searchInput.addEventListener('input', function () {
    if (!isTyping && searchInput.value.trim() !== '') {
        searchInput.placeholder = ' Search here Press Ctrl+Enter to ask AI ';
    }
    clearTimeout(timeoutId);
    timeoutId = setTimeout(function () {
        var searchTerm = searchInput.value;
        performSearch(searchTerm);
    }, 30);
});

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
                if (isSelectionMode && selectedTools.includes(text)) {
                    const checkbox = button.querySelector('.tool-checkbox');
                    if (checkbox) {
                        checkbox.style.display = 'block';
                        checkbox.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
                        checkbox.style.border = '1px solid rgba(255, 255, 255, 0.6)';
                    }
                }
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
        exec(`start "" "${filePath}"`);
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
logTitle('次元剑 MetaSword', loadVersionFromConfig());

logStyled(
    ['[手握次元剑，', 'color:#606060; font-weight:bold;'],
    ['仗梦走星辰。]', 'color:#42c02e; font-weight:bold;'],
);

logImageBlock([
    path.resolve(__dirname, '../Assets/Image/Alipay.jpg'),
    path.resolve(__dirname, '../Assets/Image/WeChat.jpg')
], 120, 'contain');

logStyled(
    ['[创作不易 ', 'color:#f56c6c; font-weight:bold;'],
    ['🔥 感谢支持~]', 'color:#42c02e; font-weight:bold;']
);
