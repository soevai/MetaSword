const { app, Menu, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

let logoWindow, mainWindow, fridaIDEWindow, controlWindow;
let isToggling = false;

// 常用的 WebPreferences 配置
const commonWebPreferences = {
    contextIsolation: false,
    nodeIntegration: true,
    webviewTag: true,
    devTools: true,
};

// 创建窗口通用方法
const createWindow = ({ width, height, frame = true, resizable = true, transparent = false,
    alwaysOnTop = false, fullscreen = false, skipTaskbar = false, minWidth, minHeight }) => {
    const window = new BrowserWindow({
        width, height, frame, resizable, transparent, alwaysOnTop, fullscreen, skipTaskbar,
        webPreferences: commonWebPreferences,
    });
    if (minWidth && minHeight) window.setMinimumSize(minWidth, minHeight);
    window.on('closed', () => {
        if (window === logoWindow) logoWindow = null;
        if (window === mainWindow) mainWindow = null;
        if (window === fridaIDEWindow) fridaIDEWindow = null;
        if (window === controlWindow) controlWindow = null;
    });
    return window;
};

// 创建透明的 logo 窗口
const createTransparentWindow = () => {
    const { width, height } = screen.getPrimaryDisplay().size;
    logoWindow = createWindow({
        width, height, frame: false,
        resizable: false, transparent: true,
        skipTaskbar: true, fullscreen: true,
        alwaysOnTop: false
    });
    logoWindow.loadFile(path.resolve(__dirname, 'logo.html'));
    logoWindow.setIgnoreMouseEvents(true);
};

// 创建主应用窗口
const createMainWindow = () => {
    mainWindow = createWindow({
        width: 550, height: 343, frame: false,
        resizable: false, transparent: true,
        alwaysOnTop: false
    });
    mainWindow.loadFile(path.resolve(__dirname, 'index.html'));
    globalShortcut.register('Ctrl+P', () => mainWindow.webContents.openDevTools());
};

// 创建 Frida IDE 窗口
const createFridaIDEWindow = () => {
    fridaIDEWindow = createWindow({
        width: 730, height: 800,
        transparent: true,
        frame: false, resizable: true,
    });
    fridaIDEWindow.loadFile(path.resolve(__dirname, 'Frida', 'index.html'));
    fridaIDEWindow.setMinimumSize(480, 320);
    Menu.setApplicationMenu(null);
    // globalShortcut.register('Ctrl+L', () => fridaIDEWindow.webContents.openDevTools());
};

// 创建 控制面板 窗口
const createControlWindow = () => {
    controlWindow = createWindow({
        width: 550, height: 343, frame: false, resizable: false,
        transparent: true,
    });
    controlWindow.loadFile(path.resolve(__dirname, 'config', 'index.html'));
    Menu.setApplicationMenu(null);
    // globalShortcut.register('Ctrl+K', () => controlWindow.webContents.openDevTools());
};

// 注册 IPC 事件
let originalBounds;
const registerIpcHandlers = () => {
    ipcMain.on('close-transparent', () => { logoWindow.close(); });
    ipcMain.on('createMainWindow', createMainWindow);
    ipcMain.on('createFridaIDEWindow', createFridaIDEWindow);
    ipcMain.on('createControlWindow', createControlWindow);
    ipcMain.on('frida-minimizeWindow', () => { fridaIDEWindow.minimize(); });
    ipcMain.on('minimize-mainwindow', () => { mainWindow.minimize(); });
    ipcMain.on('close-mainwindow', app.quit);

    ipcMain.on('frida-maximizeWindow', () => {
        originalBounds = fridaIDEWindow.getBounds();
        fridaIDEWindow.maximize();
    });
    ipcMain.on('frida-unmaximizeWindow', () => {
        fridaIDEWindow.setBounds(originalBounds);
    });
};

// 切换主窗口显示隐藏
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

// 加载配置文件工具列表
const loadToolsList = async () => {
    const ToolsListPath = path.join(__dirname, 'config', 'config.xml');
    try {
        const data = await fs.promises.readFile(ToolsListPath, 'utf8');
        const result = await xml2js.parseStringPromise(data);

        const settings = result.config.settings[0].tag;
        const animationTag = settings.find(tag => tag.$.name === 'AnimationStart');
       
        const animationStatus = animationTag ? animationTag.$.value.trim().toLowerCase() : 'disabled';
        if (animationStatus === 'enabled') {
            createTransparentWindow();
        } else if (animationStatus === 'disabled') {
            createMainWindow();
        } else {
            console.warn(`Unknown status: ${animationStatus}`);
        }
    } catch (err) {
        console.error('XML error:', err);
    }
};


app.whenReady().then(() => {
    loadToolsList();
    registerIpcHandlers();
    globalShortcut.register('F1', toggleMainWindowVisibility);
});

// 处理应用事件
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// 应用激活创建透明窗口
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createTransparentWindow();
});

// 应用退出注销全局快捷键
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});