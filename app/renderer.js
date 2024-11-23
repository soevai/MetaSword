const {shell, ipcRenderer } = require('electron');

document.getElementById('MetaSword-customCloseBut').addEventListener('click', () => {
    ipcRenderer.send('close-mainwindow');
});

document.getElementById('MetaSword-customMinimizeBut').addEventListener('click', () => {
    ipcRenderer.send('minimize-mainwindow');
});


let aHref = document.querySelector("#Blogurl");
aHref.onclick = (e) => {
    e.preventDefault();
    let href = aHref.getAttribute("href");
    shell.openExternal(href);
}
