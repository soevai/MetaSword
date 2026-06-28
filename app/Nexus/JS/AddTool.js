/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.0.9
 * @Since       2023-08-31
 * @LastUpdated 2026-06-28
 * @Description 添加工具对话框逻辑
 * @License     MIT
 */

const { ipcRenderer } = require('electron');
const path = require('path');

const closeBtn = document.getElementById('close-btn');
const cancelBtn = document.getElementById('cancel-btn');
const saveBtn = document.getElementById('save-btn');
const browseIconBtn = document.getElementById('browse-icon-btn');
const browsePathBtn = document.getElementById('browse-path-btn');

const toolNameInput = document.getElementById('tool-name');
const toolCategorySelect = document.getElementById('tool-category');
const toolIconInput = document.getElementById('tool-icon');
const toolPathInput = document.getElementById('tool-path');
const toolVipCheckbox = document.getElementById('tool-vip');
const toolUacCheckbox = document.getElementById('tool-uac');

document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
});

ipcRenderer.on('set-category', (event, categoryName) => {
    if (toolCategorySelect && categoryName) {
        for (let i = 0; i < toolCategorySelect.options.length; i++) {
            if (toolCategorySelect.options[i].value === categoryName) {
                toolCategorySelect.selectedIndex = i;
                break;
            }
        }
    }
});

const closeWindow = () => ipcRenderer.send('addtool-closeWindow');
closeBtn.addEventListener('click', closeWindow);
cancelBtn.addEventListener('click', closeWindow);

const formatPath = (selectedPath, prefix) => {
    const appRoot = path.join(__dirname, '..', '..', '..', '..');
    const toolsDir = path.join(appRoot, 'Tools');
    const normalizedToolsDir = path.normalize(toolsDir).toLowerCase();
    const normalizedSelectedPath = path.normalize(selectedPath).toLowerCase();
    const isInToolsDir = normalizedSelectedPath.includes(normalizedToolsDir);
    
    if (isInToolsDir) {
        const relativePath = path.relative(toolsDir, selectedPath);
        return prefix + relativePath.replace(/\\/g, '/');
    }
    return selectedPath.replace(/\\/g, '/');
};

browseIconBtn.addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('open-icon-dialog');
    if (result && !result.canceled && result.filePaths.length > 0) {
        toolIconInput.value = formatPath(result.filePaths[0], '/');
    }
});

browsePathBtn.addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('open-executable-dialog');
    if (result && !result.canceled && result.filePaths.length > 0) {
        toolPathInput.value = formatPath(result.filePaths[0], '/Tools/');
    }
});

saveBtn.addEventListener('click', async () => {
    const toolData = {
        name: toolNameInput.value.trim(),
        category: toolCategorySelect.value,
        icon: toolIconInput.value.trim(),
        path: toolPathInput.value.trim(),
        vip: toolVipCheckbox.checked,
        uac: toolUacCheckbox.checked
    };

    if (!validateToolData(toolData)) return;

    const success = await ipcRenderer.invoke('save-tool', toolData);
    if (success) closeWindow();
});

function validateToolData(data) {
    const check = (condition, input) => {
        if (condition) {
            input.focus();
            scrollToCard(input);
            return false;
        }
        return true;
    };
    if (!check(!data.name, toolNameInput)) return false;
    if (!check(data.name.length > 50, toolNameInput)) return false;
    if (!check(!data.icon, toolIconInput)) return false;
    if (!check(!data.path, toolPathInput)) return false;
    return true;
}

function scrollToCard(inputElement) {
    const card = inputElement.closest('.setting-card');
    const panel = document.querySelector('.settings-panel');
    if (card && panel) {
        const cardLeft = card.offsetLeft;
        const panelWidth = panel.offsetWidth;
        const scrollLeft = cardLeft - (panelWidth / 2) + (card.offsetWidth / 2);
        panel.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
}

const style = document.createElement('style');
style.textContent = `
    @keyframes fadeInScale {
        from { opacity: 0; transform: translateX(-50%) scale(0.9); }
        to { opacity: 1; transform: translateX(-50%) scale(1); }
    }
`;
document.head.appendChild(style);

document.addEventListener("DOMContentLoaded", function () {
    const settingsPanel = document.querySelector(".settings-panel");
    const settingCards = document.querySelectorAll(".setting-card");
    let isHoveringCard = false;

    settingsPanel?.addEventListener("wheel", function (event) {
        if (!isHoveringCard) {
            event.preventDefault();
            settingsPanel.scrollLeft += event.deltaY * 2;
        }
    }, { passive: false });

    settingCards.forEach(card => {
        card.addEventListener("mouseover", function () {
            isHoveringCard = true;
            card.classList.add("active");
        });

        card.addEventListener("mouseout", function (event) {
            if (!card.contains(event.relatedTarget)) {
                isHoveringCard = false;
                card.classList.remove("active");
            }
        });

        card.addEventListener("wheel", function (event) {
            event.stopPropagation();
        }, { passive: true });
    });
});
