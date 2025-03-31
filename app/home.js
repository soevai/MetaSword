const { app, Menu, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

let windows = { logo: null, main: null, frida: null, control: null, error: null };
let isToggling = false, originalBounds;

const commonWebPreferences = {
    contextIsolation: false,
    nodeIntegration: true,
    webviewTag: true,
    devTools: true,
};

const createWindow = (name, options, filePath) => {
    windows[name] = new BrowserWindow({ ...options, webPreferences: commonWebPreferences });
    if (options.minWidth && options.minHeight) windows[name].setMinimumSize(options.minWidth, options.minHeight);
    windows[name].loadFile(path.resolve(__dirname, filePath));
    windows[name].on('closed', () => (windows[name] = null));
};

const createTransparentWindow = () => {
    const { width, height } = screen.getPrimaryDisplay().size;
    createWindow('logo', { width, height, frame: false, resizable: false, transparent: true, skipTaskbar: true, fullscreen: true, alwaysOnTop: true }, 'logo.html');
    windows.logo.setIgnoreMouseEvents(true);
};

const createMainWindow = () => {
    createWindow('main', { width: 550, height: 343, frame: false, resizable: false, transparent: true, alwaysOnTop: false }, 'index.html');
    globalShortcut.register('Ctrl+P', () => windows.main.webContents.openDevTools());
};

const createFridaIDEWindow = () => {
    createWindow('frida', { width: 680, height: 800, frame: false, resizable: true, transparent: true, minWidth: 480, minHeight: 320 }, 'Frida/index.html');
    Menu.setApplicationMenu(null);
    // globalShortcut.register('Ctrl+L', () => windows.frida.webContents.openDevTools());
};

const createControlWindow = () => {
    createWindow('control', { width: 550, height: 343, frame: false, resizable: false, transparent: true }, 'config/index.html');
    Menu.setApplicationMenu(null);
    // globalShortcut.register('Ctrl+T', () => windows.control.webContents.openDevTools());
};

const toggleMainWindowVisibility = () => {
    if (isToggling) return;
    console.log(1)
    isToggling = true;
    windows.main ? (windows.main.isVisible() ? windows.main.hide() : windows.main.show()) : createMainWindow();
    setTimeout(() => (isToggling = false), 300);
};

const registerIpcHandlers = () => {
    ipcMain.on('close-transparent', () => windows.logo?.close());
    ipcMain.on('createMainWindow', createMainWindow);
    ipcMain.on('createFridaIDEWindow', createFridaIDEWindow);
    ipcMain.on('createControlWindow', createControlWindow);
    ipcMain.on('minimize-mainwindow', () => windows.main?.minimize());
    ipcMain.on('close-mainwindow', app.quit);
    ipcMain.on('frida-minimizeWindow', () => windows.frida?.minimize());
    ipcMain.on('frida-maximizeWindow', () => { originalBounds = windows.frida.getBounds(); windows.frida.maximize(); });
    ipcMain.on('frida-unmaximizeWindow', () => windows.frida.setBounds(originalBounds));
};

const loadToolsList = async () => {
    try {
        const data = await fs.promises.readFile(path.join(__dirname, 'config', 'config.xml'), 'utf8');
        const result = await xml2js.parseStringPromise(data);
        const animationStatus = result.config.settings[0].tag.find(tag => tag.$.name === 'AnimationStart')?.$.value.trim().toLowerCase();
        animationStatus === 'enabled' ? createTransparentWindow() : createMainWindow();
    } catch (err) {
        console.error('XML error:', err);
    }
};

const createErrorDialog = async (title, message) => {
    if (windows.error) return windows.error.focus();
    createWindow('error', { width: 300, height: 170, frame: false, transparent: true, alwaysOnTop: true, resizable: false }, 'dialog.html');
    // globalShortcut.register('Ctrl+O', () => windows.error.webContents.openDevTools());
};

ipcMain.handle('error-dialog', (event, title, message) => createErrorDialog(title, message));

app.whenReady().then(() => {
    loadToolsList();
    registerIpcHandlers();
    globalShortcut.register('F1', toggleMainWindowVisibility);
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createTransparentWindow());
app.on('will-quit', () => globalShortcut.unregisterAll());