/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.0.6
 * @Since       2023-08-31
 * @LastUpdated 2025-08-01
 * @Description Electron 主进程入口
 * @License     MIT
 */

const { app, Menu, BrowserWindow, globalShortcut, ipcMain, screen, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

let windows = { logo: null, main: null, frida: null, control: null, error: null };
let isToggling = false, originalBounds;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  try { process.exit(0); } catch { }
} else {
  app.on('second-instance', (event, argv, workingDirectory) => {
    if (windows.main && !windows.main.isDestroyed()) {
      if (windows.main.isMinimized()) windows.main.restore();
      if (!windows.main.isVisible()) windows.main.show();
      windows.main.focus();
    } else {
      try { createMainWindow?.(); } catch { }
    }
    if (windows.frida && !windows.frida.isDestroyed()) {
      if (windows.frida.isMinimized()) windows.frida.restore();
      windows.frida.show();
      windows.frida.focus();
    }
  });
}

const viewsPath = path.join(__dirname, "..", '/Nexus/Views');
const commonWebPreferences = {
  contextIsolation: false,
  nodeIntegration: true,
  webviewTag: true,
  devTools: true
};

const createWindow = (name, options, filePath) => {
  windows[name] = new BrowserWindow({ ...options, webPreferences: commonWebPreferences });

  if (options.minWidth && options.minHeight) {
    windows[name].setMinimumSize(options.minWidth, options.minHeight);
  }

  windows[name].loadFile(path.resolve(__dirname, filePath));
  windows[name].on('closed', () => (windows[name] = null));
};

const createMainWindow = () => {
  createWindow('main', {
    width: 550,
    height: 345,
    minWidth: 550,
    minHeight: 345,
    maxWidth: 810,
    maxHeight: 500,
    frame: false,
    resizable: true,
    transparent: true,
  }, path.join(viewsPath, 'Home.html'));

  globalShortcut.register('Ctrl+P', () => windows.main?.webContents?.openDevTools());
};

const createTransparentWindow = () => {
  const { width, height } = screen.getPrimaryDisplay().size;
  createWindow('logo', {
    width,
    height,
    frame: false,
    resizable: false,
    transparent: true,
    skipTaskbar: true,
    fullscreen: true,
    alwaysOnTop: true
  }, path.join(viewsPath, 'Logo.html'));

  windows.logo?.setIgnoreMouseEvents(true);
  // globalShortcut.register('Ctrl+I', () => windows.logo?.webContents?.openDevTools());
};

const createFridaIDEWindow = () => {
  createWindow('frida', {
    width: 700,
    height: 800,
    frame: false,
    resizable: true,
    transparent: true,
    minWidth: 550,
    minHeight: 345
  }, path.join(viewsPath, 'Frida.html'));

  Menu.setApplicationMenu(null);
  // globalShortcut.register('Ctrl+U', () => windows.frida?.webContents?.openDevTools());
};

const createControlWindow = () => {
  createWindow('control', {
    width: 551,
    height: 343,
    frame: false,
    resizable: false,
    transparent: true
  }, path.join(viewsPath, 'ControL.html'));

  Menu.setApplicationMenu(null);
  // globalShortcut.register('Ctrl+O', () => windows.control?.webContents?.openDevTools());
};

const toggleMainWindowVisibility = () => {
  if (isToggling) return;
  isToggling = true;

  if (windows.main && !windows.main.isDestroyed()) {
    windows.main.isVisible() ? windows.main.hide() : windows.main.show();
  } else {
    createMainWindow();
  }
  setTimeout(() => (isToggling = false), 300);
};

const registerIpcHandlers = () => {
  const ipcEvents = [
    ['createMainWindow', createMainWindow],
    ['createFridaIDEWindow', createFridaIDEWindow],
    ['createControlWindow', createControlWindow],
    ['minimize-mainwindow', () => windows.main?.minimize()],
    ['close-mainwindow', () => app.quit()],
    ['close-transparent', () => windows.logo?.close()],
    ['frida-minimizeWindow', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) win.minimize();
    }],
    ['frida-maximizeWindow', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) {
        originalBounds = win.getBounds();
        win.maximize();
      }
    }],
    ['frida-unmaximizeWindow', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed() && originalBounds) {
        win.setBounds(originalBounds);
      }
    }],
  ];

  ipcEvents.forEach(([event, handler]) => ipcMain.on(event, handler));
  let isFileDialogOpen = false;
  ipcMain.on('open-file-window', async (event) => {
    if (isFileDialogOpen) return;
    isFileDialogOpen = true;
    try {
      const desktopPath = app.getPath('desktop');
      const result = await dialog.showOpenDialog({
        title: '选择可执行程序',
        defaultPath: desktopPath,
        properties: ['openFile'],
        filters: [{ name: '可执行程序', extensions: ['exe'] }]
      });

      const selectedPath = (!result.canceled && result.filePaths.length > 0)
        ? result.filePaths[0]
        : null;

      event.sender.send('file-selected', selectedPath);
    } finally {
      isFileDialogOpen = false;
    }
  });
};

const loadToolsList = () => {
  const filePath = path.join(__dirname, '..', 'Nexus', 'Views', 'config.xml');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) { console.error(err); return; }
    xml2js.parseString(data, (err, result) => {
      if (err) { console.error(err); return; }
      try {
        const settings = result?.config?.settings?.[0]?.tag || [];
        const animationStartTag = settings.find(tag => tag.$?.name === 'AnimationStart');
        if (animationStartTag) {
          const animationStatus = String(animationStartTag.$.value || '').trim().toLowerCase();
          animationStatus === 'enabled' ? createTransparentWindow() : createMainWindow();
        } else {
          createMainWindow();
        }
      } catch (e) {
        console.error(e);
        createMainWindow();
      }
    });
  });
};

const createErrorDialog = () => {
  if (windows.error && !windows.error.isDestroyed()) {
    windows.error.focus();
    return;
  }
  createWindow('error', {
    width: 350,
    height: 280,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false
  }, path.join(viewsPath, 'Dialog.html'));
  // globalShortcut.register('Ctrl+E', () => windows.error?.webContents?.openDevTools());
};

ipcMain.handle('ErrorDialog', () => createErrorDialog());

app.whenReady().then(() => {
  loadToolsList();
  registerIpcHandlers();
  globalShortcut.register('F1', toggleMainWindowVisibility);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createTransparentWindow();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
