const { app, Menu, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

let logoWindow, mainWindow, fridaIDEWindow;
let isToggling = false;

// 常用的 WebPreferences 配置
const commonWebPreferences = {
    contextIsolation: false,
    nodeIntegration: true,
    webviewTag: true,
    devTools: true,
};

// 创建窗口的通用方法
const createWindow = ({ width, height, frame, resizable, transparent, 
    alwaysOnTop, fullscreen, skipTaskbar, minWidth, minHeight }) => {
    const window = new BrowserWindow({
        width, height, frame, resizable, transparent, 
        alwaysOnTop, fullscreen, skipTaskbar,
        webPreferences: commonWebPreferences,
    });
    if (minWidth && minHeight) window.setMinimumSize(minWidth, minHeight);
    window.on('closed', () => {
        if (window === logoWindow) logoWindow = null;
        if (window === mainWindow) mainWindow = null;
        if (window === fridaIDEWindow) fridaIDEWindow = null;
    });
    return window;
};

// 创建透明的 logo 窗口
const createTransparentWindow = () => {
    const { width, height } = screen.getPrimaryDisplay().size;
    logoWindow = createWindow({
        width, height, frame: false, resizable: false, transparent: true,
        skipTaskbar: false, fullscreen: true, alwaysOnTop: false
    });
    logoWindow.loadFile(path.resolve(__dirname, 'logo.html'));
    logoWindow.setIgnoreMouseEvents(true);
};

// 创建主应用窗口
const createMainWindow = () => {
    mainWindow = createWindow({
        width: 550, height: 343, frame: false, resizable: false, transparent: true,
        alwaysOnTop: false, minWidth: 480, minHeight: 320
    });
    mainWindow.loadFile(path.resolve(__dirname, 'index.html'));
    globalShortcut.register('Ctrl+P', () => mainWindow.webContents.openDevTools());
};

// 创建 Frida IDE 窗口
const createFridaIDEWindow = () => {
    fridaIDEWindow = createWindow({
        width: 750, height: 800, frame: true, resizable: true,
    });
    fridaIDEWindow.loadFile(path.resolve(__dirname, 'Frida', 'index.html'));
    fridaIDEWindow.setMinimumSize(480, 320);
    Menu.setApplicationMenu(null);
};

// 注册 IPC 事件处理函数
const registerIpcHandlers = () => {
    ipcMain.on('close-transparent', () => { logoWindow.close(); });
    ipcMain.on('createMainWindow', createMainWindow);
    ipcMain.on('createFridaIDEWindow', createFridaIDEWindow);
    ipcMain.on('close-app', app.quit);
    ipcMain.on('minimize-window', () => {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow) focusedWindow.minimize();
    });
};

// 切换主窗口的显示和隐藏
const toggleMainWindowVisibility = () => {
    if (isToggling) return;
    isToggling = true;

    if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } else {
        createMainWindow();
    }

    setTimeout(() => { isToggling = false; }, 300);
};

// 读取和解析 XML 文件
const loadToolsList = async () => {
    const ToolsListPath = path.join(__dirname, '..', '..', 'Tools', 'Toolslist.xml');
    try {
        const data = await fs.promises.readFile(ToolsListPath, 'utf8');
        const result = await xml2js.parseStringPromise(data);
        const tagsContent = result.root.tags[0]?._?.trim().toLowerCase();
        if (tagsContent !== 'close') {
            createTransparentWindow();
        } else {
            createMainWindow();
        }
    } catch (err) {
        console.error('XML error.', err);
    }
};

// 处理应用事件
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(() => {
    loadToolsList();
    registerIpcHandlers();
    globalShortcut.register('F1', toggleMainWindowVisibility);
});

// 在应用激活时创建透明窗口
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createTransparentWindow();
});

// 应用退出时注销全局快捷键
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
