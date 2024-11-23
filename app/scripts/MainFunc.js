/*
    @Author: 发光的神（VoxShadow）
    @Date: 2023/08/31 ~ 2024/11/21
    @Version: 1.0.4
*/

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
        'ChatGPT': { top: '143px', title: 'ChatGPT' },
        '关于': { top: '179px', title: '关于' }
    };

    var iconStyle = iconStyles[icon];
    if (iconStyle) {
        online.style.top = iconStyle.top;
        toptitle.textContent = iconStyle.title;
    }
}

function showPage(pageName) {

    var pages = ['homePage', 'toolsPage', 'ChatGPTPage', 'aboutPage'];
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

const path = require('path');
const { exec } = require('child_process');
var searchInput = document.getElementById('search');

searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        var searchTerm = searchInput.value.toLowerCase();
        var buttons = resultsContainer.getElementsByTagName('button');
        for (var button of buttons) {
            if (button.textContent.toLowerCase() === searchTerm) {
                button.click();
                break;
            }
        }
    }
});

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
                const { ipcRenderer } = require('electron');
                var categoryName = this.textContent;
                if (categoryName.includes('Frida IDE')) {
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
    })
}


function displayCategoryItems(categoryName) {
    resultsContainer.innerHTML = '';

    Array.from(categoriesData).forEach(category => {
        var name = category.getAttribute('name');
        if (name === categoryName) {
            var items = category.getElementsByTagName('item');

            Array.from(items).forEach((item, index) => {
                var text = item.getElementsByTagName('text')[0].textContent;
                var imagePath = item.getElementsByTagName('imagePath')[0].textContent;

                var button = createButton(text, imagePath);
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

function createButton(text, imagePath) {

    var button = document.createElement('button');
    button.classList.add('toolsbutton');
    button.style.userSelect = 'none';

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
    button.addEventListener('click', (event) => {
        handleButtonClick(text, event);
    });
    return button;
}

var timeoutId;
function initSearch() {
    searchInput.addEventListener('input', function () {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            var searchTerm = this.value;
            performSearch(searchTerm);
        }, 40);
    });
}

function performSearch(searchTerm) {
    initSearch();
    resultsContainer.innerHTML = '';
    Array.from(categoriesData).forEach(category => {
        var items = category.getElementsByTagName('item');

        Array.from(items).forEach(item => {
            var text = item.getElementsByTagName('text')[0].textContent;
            var imagePath = item.getElementsByTagName('imagePath')[0].textContent;

            if (text.toLowerCase().includes(searchTerm.toLowerCase())) {
                var button = createButton(text, imagePath);
                resultsContainer.appendChild(button);
                button.style.opacity = 1;
            }
        });
    });
}
showtoolbar();

var audio = new Audio('./public/audio/click.mp3');
function handleButtonClick(buttonName) {
    fetch(ToolsListPath)
        .then(response => response.text())
        .then(data => {
            var parser = new DOMParser();
            var xmlDoc = parser.parseFromString(data, 'text/xml');
            var items = xmlDoc.getElementsByTagName('item');
            var selectedItem = Array.from(items).find(item => item.getElementsByTagName('text')[0].textContent === buttonName);

            if (selectedItem) {
                audio.play();
                var executablePathText = selectedItem.getElementsByTagName('executablePath')[0].textContent;
                var isAbsolutePath = /^[a-zA-Z]:\\/.test(executablePathText);
                var executablePath = isAbsolutePath ?
                    executablePathText : path.join(__dirname, '..', '..', executablePathText);
                runCommandAsAdmin(executablePath);
            }
        })
}

var fs = require('fs');
function runCommandAsAdmin(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error('File or directory not found');
        return;
    }

    var stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
        openToolsFilesDirectory(filePath);
        return;
    }

    var command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "& {Start-Process '${filePath}' -Verb RunAs}"`;
    exec(command, (error) => {
        if (error) {
            console.error(`Error executing command: ${error.message}`);
        }
    });
}

function openToolsFilesDirectory(currentDirectory) {
    exec(`start "" "${currentDirectory}"`, (error) => {
        if (error) {
            console.error(error);
        }
    });
}