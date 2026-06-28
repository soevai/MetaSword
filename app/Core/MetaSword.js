/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.0.9
 * @Since       2023-08-31
 * @LastUpdated 2026-06-28
 * @Description Electron 主进程入口
 * @License     MIT
 */

const { app, Menu, BrowserWindow, globalShortcut, ipcMain, screen, dialog, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const https = require('https');
const { startMCPHttpServer } = require('./MCPFunc');

const originalConsoleLog = console.log, originalConsoleWarn = console.warn;
const filterLog = (...args) => {
  const message = args.join(' ');
  return !message.includes('Slow network is detected') && !message.includes('Fallback font will be used while loading');
};
console.log = (...args) => filterLog(...args) && originalConsoleLog(...args);
console.warn = (...args) => filterLog(...args) && originalConsoleWarn(...args);

let windows = { logo: null, main: null, frida: null, control: null, error: null, addtool: null, toolpanel: null };
let isToggling = false, originalBounds;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  try { process.exit(0); } catch { }
} else {
  app.on('second-instance', () => {
    ['main', 'frida'].forEach(key => {
      if (windows[key] && !windows[key].isDestroyed()) {
        windows[key].isMinimized() && windows[key].restore();
        !windows[key].isVisible() && windows[key].show();
        windows[key].focus();
      }
    });
    if (!windows.main || windows.main.isDestroyed()) {
      try { createMainWindow?.(); } catch { }
    }
  });
}

const viewsPath = path.join(__dirname, "..", '/Nexus/Views');
const commonWebPreferences = {
  contextIsolation: false, nodeIntegration: true, webviewTag: true, devTools: true, backgroundThrottling: false
};
const filePath = path.join(__dirname, '..', 'Nexus', 'Views', 'config', 'Config.xml');
const toolsListPath = path.join(__dirname, '..', '..', '..', 'Tools', 'ToolsList.xml');
let lastWidth = 0, lastHeight = 0, resizeTimeout = null, currentVersion = null;
let mainWindowWidth = 550, mainWindowHeight = 343, controlWindowWidth = 550, controlWindowHeight = 343;

const loadVersionFromConfig = (callback) => {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) { console.error('Error reading config.xml:', err); return; }
    xml2js.parseString(data, (err, result) => {
      if (err) { console.error('Error parsing XML:', err); return; }
      try {
        const settings = result?.config?.settings?.[0]?.tag || [];
        const versionTag = settings.find(tag => tag.$?.name === 'MetaVersion');
        if (versionTag) {
          const newVersion = versionTag.$.value;
          if (newVersion !== currentVersion) {
            currentVersion = newVersion;
            syncVersionToPackageJson(newVersion);
          }
        }
        callback && callback();
      } catch (e) { console.error('Error loading version from config.xml:', e); }
    });
  });
  fs.watch(filePath, (eventType) => eventType === 'change' && loadVersionFromConfig());
};

const syncVersionToPackageJson = (version) => {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  fs.readFile(packageJsonPath, 'utf8', (err, data) => {
    if (err) { console.error('Error reading package.json:', err); return; }
    try {
      const packageJson = JSON.parse(data);
      packageJson.version = version;
      fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), (err) => {
        err && console.error('Error writing package.json:', err);
      });
    } catch (e) { console.error('Error updating package.json:', e); }
  });
  windows.main?.webContents?.send('version-updated', version);
};


let configWriteLock = Promise.resolve();
const writeConfig = async (updateFn) => {
  const task = configWriteLock.then(async () => {
    const data = await fs.promises.readFile(filePath, 'utf8');
    const result = await xml2js.parseStringPromise(data);
    updateFn(result);
    const builder = new xml2js.Builder();
    const xml = builder.buildObject(result);
    await fs.promises.writeFile(filePath, xml, 'utf8');
  }).catch(err => console.error('writeConfig error:', err));
  configWriteLock = task;
  return task;
};

ipcMain.handle('save-config', async (event, name, value) => {
  await writeConfig((result) => {
    const settings = result?.config?.settings?.[0]?.tag || [];
    const tag = settings.find(tag => tag.$?.name === name);
    if (tag) tag.$.value = String(value);
  });
});

const updateWindowSizeInConfig = (width, height) => {
  const w = Math.min(width, 900), h = Math.min(height, 550);
  if (Math.abs(w - lastWidth) < 10 && Math.abs(h - lastHeight) < 10) return;
  lastWidth = w, lastHeight = h;
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    writeConfig((result) => {
      const settings = result?.config?.settings?.[0]?.tag || [];
      const metaWindowWidthTag = settings.find(tag => tag.$?.name === 'MetaWindowWidth');
      const metaWindowHeightTag = settings.find(tag => tag.$?.name === 'MetaWindowHeight');
      if (metaWindowWidthTag) metaWindowWidthTag.$.value = w.toString();
      if (metaWindowHeightTag) metaWindowHeightTag.$.value = h.toString();
    });
  }, 500);
};

const createWindow = (name, options, filePath) => {
  const finalOptions = { ...options, webPreferences: { ...commonWebPreferences, ...(options.webPreferences || {}) } };
  windows[name] = new BrowserWindow(finalOptions);
  options.minWidth && options.minHeight && windows[name].setMinimumSize(options.minWidth, options.minHeight);
  windows[name].loadFile(filePath);
  windows[name].on('closed', () => (windows[name] = null));
  windows[name].webContents.on('console-message', (event, level, message) => {
    if (message.includes('Slow network is detected') || message.includes('Fallback font will be used while loading')) {
      event.preventDefault();
    }
  });
};

const createMainWindow = () => {
  windows.main = new BrowserWindow({
    width: mainWindowWidth, height: mainWindowHeight, minWidth: 550, minHeight: 343, maxWidth: 900, maxHeight: 550,
    frame: false, resizable: true, transparent: true, alwaysOnTop: false,
    webPreferences: { contextIsolation: false, nodeIntegration: true }
  });
  windows.main.loadFile(path.join(viewsPath, 'Home.html'));
  windows.main.webContents.on('console-message', (event, level, message) => {
    if (message.includes('Slow network is detected') || message.includes('Fallback font will be used while loading')) {
      event.preventDefault();
    }
  });
  windows.main.on('resized', () => {
    const [newWidth, newHeight] = windows.main.getSize();
    if (newWidth !== controlWindowWidth || newHeight !== controlWindowHeight) {
      controlWindowWidth = newWidth, controlWindowHeight = newHeight;
      updateWindowSizeInConfig(newWidth, newHeight);
    }
  });
  windows.main.on('closed', () => {
    Object.keys(windows).forEach(key => {
      if (key !== 'main' && windows[key] && !windows[key].isDestroyed()) windows[key].close();
    });
  });
  globalShortcut.register('Ctrl+P', () => windows.main?.webContents?.openDevTools());
  const mcpServer = startMCPHttpServer(windows, createFridaIDEWindow);
  ipcMain.on('get-mcp-port', (event) => event.sender.send('mcp-port', mcpServer.getPort()));
  ipcMain.handle('get-themes', async () => {
    try {
      const themesJsonPath = path.join(__dirname, '..', 'Theme', 'themes.json');
      if (!fs.existsSync(themesJsonPath)) return [];
      const data = await fs.promises.readFile(themesJsonPath, 'utf8');
      const themes = JSON.parse(data);
      return themes.themes || [];
    } catch (error) {
      console.error('Error loading themes:', error);
      return [];
    }
  });
  ipcMain.on('switch-theme', (event, theme) => {
    const themePath = path.join(__dirname, '..', 'Theme', theme);
    const nexusPath = path.join(__dirname, '..', 'Nexus');
    const copyDir = (srcDir, destDir) => {
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.readdirSync(srcDir).forEach(file => {
        const srcPath = path.join(srcDir, file);
        const destPath = path.join(destDir, file);
        if (fs.statSync(srcPath).isDirectory()) copyDir(srcPath, destPath);
        else fs.copyFileSync(srcPath, destPath);
      });
    };
    fs.existsSync(themePath) && copyDir(themePath, nexusPath);
    windows.main && !windows.main.isDestroyed() && windows.main.reload();
  });

  ipcMain.on('show-tool-panel', () => {
    createToolPanelWindow();
    updateToolPanelPosition();
  });
  ipcMain.handle('open-skills-dialog', async () => {
    const result = await dialog.showOpenDialog(windows.main, {
      title: '选择 Skills 压缩包',
      filters: [{ name: 'ZIP 文件', extensions: ['zip'] }],
      properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.on('hide-tool-panel', () => {
    if (windows.toolpanel && !windows.toolpanel.isDestroyed()) {
      windows.toolpanel.close();
      windows.toolpanel = null;
    }
  });
  ipcMain.on('tool-call', (event, data) => {
    if (!windows.toolpanel || windows.toolpanel.isDestroyed()) createToolPanelWindow();
    windows.toolpanel?.webContents?.send('tool-call', data);
  });
  ipcMain.on('tool-result', (event, data) => {
    windows.toolpanel?.webContents?.send('tool-result', data);
  });

  ipcMain.on('perm-request', (event, data) => {
    if (!windows.toolpanel || windows.toolpanel.isDestroyed()) createToolPanelWindow();
    windows.toolpanel?.webContents?.send('perm-request', data);
  });
  ipcMain.on('perm-response', (event, data) => {
    windows.main?.webContents?.send('perm-response', data);
  });
  ipcMain.on('clear-tool-log', () => {
    windows.toolpanel?.webContents?.send('clear-tool-log');
  });


  windows.main.on('move', updateToolPanelPosition);
  windows.main.on('resize', updateToolPanelPosition);
  windows.main.on('close', () => {
    if (windows.toolpanel && !windows.toolpanel.isDestroyed()) {
      windows.toolpanel.close();
      windows.toolpanel = null;
    }
  });
};

const createTransparentWindow = () => {
  const { width, height } = screen.getPrimaryDisplay().size;
  createWindow('logo', {
    width, height, frame: false, resizable: false, transparent: true,
    skipTaskbar: true, fullscreen: true, alwaysOnTop: false
  }, path.join(viewsPath, 'Logo.html'));
  windows.logo?.setIgnoreMouseEvents(true);
  globalShortcut.register('Ctrl+L', () => windows.logo?.webContents?.openDevTools());
};

const createFridaIDEWindow = () => {
  if (windows.frida && !windows.frida.isDestroyed()) {
    windows.frida.isMinimized() && windows.frida.restore();
    !windows.frida.isVisible() && windows.frida.show();
    windows.frida.focus();
    return;
  }
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const ww = 750, wh = 820;
  const x = Math.floor(Math.random() * (sw - ww));
  const y = Math.floor(Math.random() * (sh - wh));
  createWindow('frida', { width: ww, height: wh, x, y, frame: false, resizable: true, transparent: true, minWidth: 550, minHeight: 345 }, path.join(viewsPath, 'Frida.html'));
  Menu.setApplicationMenu(null);
  globalShortcut.register('Ctrl+U', () => windows.frida?.webContents?.openDevTools());
};

const createToolPanelWindow = () => {
  if (windows.toolpanel && !windows.toolpanel.isDestroyed()) {
    windows.toolpanel.isMinimized() && windows.toolpanel.restore();
    !windows.toolpanel.isVisible() && windows.toolpanel.show();
    windows.toolpanel.focus();
    return;
  }
  const mainBounds = windows.main?.getBounds();
  windows.toolpanel = new BrowserWindow({
    width: 300,
    height: mainBounds ? mainBounds.height : 600,
    x: mainBounds ? mainBounds.x + mainBounds.width : 900,
    y: mainBounds ? mainBounds.y : 0,
    frame: false,
    resizable: false,
    transparent: true,
    parent: windows.main,
    alwaysOnTop: false,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: { contextIsolation: false, nodeIntegration: true }
  });
  windows.toolpanel.loadFile(path.join(viewsPath, 'ToolPanel.html'));
  windows.toolpanel.webContents.on('console-message', (event, level, message) => {
    if (message.includes('Slow network is detected') || message.includes('Fallback font will be used while loading')) {
      event.preventDefault();
    }
  });
  windows.toolpanel.on('closed', () => (windows.toolpanel = null));
  globalShortcut.register('Ctrl+T', () => windows.toolpanel?.webContents?.openDevTools());
};

const updateToolPanelPosition = () => {
  if (!windows.toolpanel || windows.toolpanel.isDestroyed()) return;
  if (!windows.main || windows.main.isDestroyed()) return;
  const mainBounds = windows.main.getBounds();
  windows.toolpanel.setBounds({
    x: mainBounds.x + mainBounds.width,
    y: mainBounds.y,
    width: 300,
    height: mainBounds.height
  });
};

const createControlWindow = () => {
  if (windows.control && !windows.control.isDestroyed()) {
    windows.control.isMinimized() && windows.control.restore();
    !windows.control.isVisible() && windows.control.show();
    windows.control.focus();
    return;
  }
  const controlWindowOptions = { width: controlWindowWidth, height: controlWindowHeight, frame: false, minWidth: 550, minHeight: 343, maxWidth: 900, maxHeight: 550, resizable: true, alwaysOnTop: false, transparent: true, show: true };
  if (windows.main && !windows.main.isDestroyed()) {
    const mainWindowBounds = windows.main.getBounds();
    controlWindowOptions.x = mainWindowBounds.x, controlWindowOptions.y = mainWindowBounds.y;
  }
  createWindow('control', controlWindowOptions, path.join(viewsPath, 'ControL.html'));
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) { console.error('Error reading config.xml:', err); return; }
    xml2js.parseString(data, (err, result) => {
      if (err) { console.error('Error parsing XML:', err); return; }
      try {
        const settings = result?.config?.settings?.[0]?.tag || [];
        const configData = {
          animationStart: settings.find(tag => tag.$?.name === 'AnimationStart')?.$.value || 'enabled',
          animationSpeed: settings.find(tag => tag.$?.name === 'AnimationSpeed')?.$.value || '1.8'
        };
        windows.control?.webContents.once('did-finish-load', () => {
          windows.control?.webContents.send('config-data', configData);
        });
      } catch (e) { console.error('Error processing config:', e); }
    });
  });
  Menu.setApplicationMenu(null);
  globalShortcut.register('Ctrl+O', () => windows.control?.webContents?.openDevTools());
};

const createAddToolWindow = (data = {}) => {
  if (windows.addtool && !windows.addtool.isDestroyed()) {
    windows.addtool.isMinimized() && windows.addtool.restore();
    !windows.addtool.isVisible() && windows.addtool.show();
    windows.addtool.focus();
    data.currentCategory && setTimeout(() => windows.addtool.webContents.send('set-category', data.currentCategory), 100);
    return;
  }
  const addToolWindowOptions = { width: controlWindowWidth, height: controlWindowHeight, frame: false, minWidth: 550, minHeight: 343, maxWidth: 900, maxHeight: 550, resizable: true, alwaysOnTop: false, transparent: true };
  if (windows.main && !windows.main.isDestroyed()) {
    const mainWindowBounds = windows.main.getBounds();
    addToolWindowOptions.x = mainWindowBounds.x, addToolWindowOptions.y = mainWindowBounds.y;
  }
  createWindow('addtool', addToolWindowOptions, path.join(viewsPath, 'AddTool.html'));
  Menu.setApplicationMenu(null);
  globalShortcut.register('Ctrl+D', () => windows.addtool && !windows.addtool.isDestroyed() && windows.addtool.webContents.openDevTools());
  if (windows.main && !windows.main.isDestroyed()) {
    windows.main.on('move', () => {
      if (windows.addtool && !windows.addtool.isDestroyed()) {
        const mainWindowBounds = windows.main.getBounds();
        windows.addtool.setPosition(mainWindowBounds.x - 1, mainWindowBounds.y);
      }
    });
  }
  data.currentCategory && setTimeout(() => {
    windows.addtool && !windows.addtool.isDestroyed() && windows.addtool.webContents.send('set-category', data.currentCategory);
  }, 300);
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

const deleteRecursive = (dir) => {
  fs.readdirSync(dir).forEach(file => {
    const filePath = path.join(dir, file);
    const fileStats = fs.statSync(filePath);
    fileStats.isDirectory() ? deleteRecursive(filePath) : fs.unlinkSync(filePath);
  });
  fs.rmdirSync(dir);
};

const deleteToolPaths = (toolPaths, projectRoot) => {
  toolPaths.forEach(paths => {
    if (paths.iconPath) {
      let iconPath = paths.iconPath;
      if (iconPath.startsWith('/Icons/')) iconPath = 'Tools' + iconPath;
      const iconFilePath = path.join(projectRoot, iconPath);
      fs.existsSync(iconFilePath) && fs.unlinkSync(iconFilePath);
    }
    if (paths.exePath) {
      const exeFilePath = path.join(projectRoot, paths.exePath);
      if (fs.existsSync(exeFilePath)) {
        const stats = fs.statSync(exeFilePath);
        const exeDirPath = stats.isDirectory() ? exeFilePath : path.dirname(exeFilePath);
        deleteRecursive(exeDirPath);
      }
    }
  });
};

const saveXML = (result, callback) => {
  const builder = new xml2js.Builder({ renderOpts: { pretty: true, indent: '  ' } });
  const xml = builder.buildObject(result);
  fs.writeFileSync(toolsListPath, xml, 'utf8');
  callback && callback();
};

const registerIpcHandlers = () => {
  [
    ['createMainWindow', createMainWindow],
    ['createFridaIDEWindow', createFridaIDEWindow],
    ['createControlWindow', createControlWindow],
    ['createAddToolWindow', (event, data) => createAddToolWindow(data)],
    ['minimize-mainwindow', () => windows.main?.minimize()],
    ['close-mainwindow', () => app.quit()],
    ['close-transparent', () => windows.logo?.close()],
    ['addtool-minimizeWindow', () => windows.addtool?.minimize()],
    ['addtool-closeWindow', () => windows.addtool?.close()],
    ['frida-minimizeWindow', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize()],
    ['frida-stop-ai', () => { windows.main?.webContents?.send('stop-ai'); }],
    ['frida-maximizeWindow', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) { originalBounds = win.getBounds(); win.maximize(); }
    }],
    ['frida-unmaximizeWindow', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      win && !win.isDestroyed() && originalBounds && win.setBounds(originalBounds);
    }],
    ['switch-to-category', (event, categoryName) => windows.main && !windows.main.isDestroyed() && windows.main.webContents.send('switch-to-category', categoryName)],
  ].forEach(([event, handler]) => ipcMain.on(event, handler));

  ipcMain.on('move-main-window', (event, { x, y }) => {
    windows.main && !windows.main.isDestroyed() && windows.main.setPosition(x, y);
  });

  let isFileDialogOpen = false;
  ipcMain.on('open-file-window', async (event) => {
    if (isFileDialogOpen) return;
    isFileDialogOpen = true;
    try {
      const desktopPath = app.getPath('desktop');
      const result = await dialog.showOpenDialog({
        title: '选择可执行程序', defaultPath: desktopPath, properties: ['openFile'],
        filters: [{ name: '可执行程序', extensions: ['exe'] }]
      });
      const selectedPath = (!result.canceled && result.filePaths.length > 0) ? result.filePaths[0] : null;
      event.sender.send('file-selected', selectedPath);
    } finally { isFileDialogOpen = false; }
  });

  let isIconDialogOpen = false;
  ipcMain.handle('open-icon-dialog', async () => {
    if (isIconDialogOpen) return;
    isIconDialogOpen = true;
    try {
      return await dialog.showOpenDialog({
        title: '选择图标文件', defaultPath: path.join(__dirname, '..', '..', '..', 'Tools', 'Icons'), properties: ['openFile'],
        filters: [{ name: '图标文件', extensions: ['ico', 'png', 'jpg', 'jpeg'] }, { name: '所有文件', extensions: ['*'] }]
      });
    } finally { isIconDialogOpen = false; }
  });

  let isExecutableDialogOpen = false;
  ipcMain.handle('open-executable-dialog', async () => {
    if (isExecutableDialogOpen) return;
    isExecutableDialogOpen = true;
    try {
      return await dialog.showOpenDialog({
        title: '选择可执行文件', defaultPath: path.join(__dirname, '..', '..', '..', 'Tools'), properties: ['openFile'],
        filters: [{ name: '可执行文件', extensions: ['exe', 'bat', 'cmd', 'vbs', 'py'] }, { name: '所有文件', extensions: ['*'] }]
      });
    } finally { isExecutableDialogOpen = false; }
  });

  ipcMain.handle('save-tool', async (event, toolData) => {
    try {
      const xmlData = fs.readFileSync(toolsListPath, 'utf8');
      const result = await xml2js.parseStringPromise(xmlData);
      const categories = result.root.category || [];
      const targetCategory = categories.find(cat => cat.$.name === toolData.category);
      if (!targetCategory) return false;
      const newItem = { text: [toolData.name], imagePath: [toolData.icon], executablePath: [toolData.path], status: [toolData.vip ? 'on' : 'off'], uac: [toolData.uac ? 'on' : 'off'] };
      if (!targetCategory.item) targetCategory.item = [];
      targetCategory.item.push(newItem);
      saveXML(result);
      windows.main && !windows.main.isDestroyed() && windows.main.webContents.send('tools-updated', toolData.category);
      return true;
    } catch (error) { console.error('Error saving tool:', error); return false; }
  });

  ipcMain.on('delete-tool', async (event, data) => {
    try {
      const { toolName, currentCategory } = data;
      const xmlData = fs.readFileSync(toolsListPath, 'utf8');
      const result = await xml2js.parseStringPromise(xmlData);
      const categories = result.root.category || [];
      let toolDeleted = false, toolPaths = [];
      categories.forEach(category => {
        if (category.item) {
          const originalLength = category.item.length;
          category.item = category.item.filter(item => {
            if (item.text && item.text[0] === toolName) {
              toolPaths.push({ iconPath: item.imagePath ? item.imagePath[0] : '', exePath: item.executablePath ? item.executablePath[0] : '' });
              return false;
            }
            return true;
          });
          if (category.item.length < originalLength) toolDeleted = true;
        }
      });
      if (toolDeleted) {
        deleteToolPaths(toolPaths, path.join(__dirname, '..', '..', '..'));
        saveXML(result);
        windows.main && !windows.main.isDestroyed() && windows.main.webContents.send('tools-updated', currentCategory);
      }
    } catch (error) { console.error('Error deleting tool:', error); }
  });

  ipcMain.on('batch-delete-tools', async (event, toolNames) => {
    try {
      const xmlData = fs.readFileSync(toolsListPath, 'utf8');
      const result = await xml2js.parseStringPromise(xmlData);
      const categories = result.root.category || [];
      let toolsDeleted = false, toolPaths = [];
      categories.forEach(category => {
        if (category.item) {
          const originalLength = category.item.length;
          category.item = category.item.filter(item => {
            if (item.text && toolNames.includes(item.text[0])) {
              toolPaths.push({ iconPath: item.imagePath ? item.imagePath[0] : '', exePath: item.executablePath ? item.executablePath[0] : '' });
              return false;
            }
            return true;
          });
          if (category.item.length < originalLength) toolsDeleted = true;
        }
      });
      if (toolsDeleted) {
        deleteToolPaths(toolPaths, path.join(__dirname, '..', '..', '..'));
        saveXML(result);
        windows.main && !windows.main.isDestroyed() && windows.main.webContents.send('tools-updated');
      }
    } catch (error) { console.error('Error batch deleting tools:', error); }
  });

  ipcMain.on('save-tool-positions', async (event, data) => {
    try {
      const { category: categoryName, toolNames } = data;
      const xmlData = fs.readFileSync(toolsListPath, 'utf8');
      const result = await xml2js.parseStringPromise(xmlData);
      const categories = result.root.category || [];
      let positionsSaved = false;
      categories.forEach(category => {
        if (category.$ && category.$.name === categoryName && category.item) {
          const originalItems = category.item;
          const newItems = [];
          toolNames.forEach(toolName => {
            const item = originalItems.find(item => item.text && item.text[0] === toolName);
            item && newItems.push(item);
          });
          originalItems.forEach(item => {
            item.text && !toolNames.includes(item.text[0]) && newItems.push(item);
          });
          if (newItems.length > 0) { category.item = newItems; positionsSaved = true; }
        }
      });
      positionsSaved && saveXML(result);
    } catch (error) { console.error('Error saving tool positions:', error); }
  });
};

const loadToolsList = () => {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) { console.error(err); return; }
    xml2js.parseString(data, (err, result) => {
      if (err) { console.error(err); return; }
      try {
        const settings = result?.config?.settings?.[0]?.tag || [];
        const animationStartTag = settings.find(tag => tag.$?.name === 'AnimationStart');
        const metaWindowWidthTag = settings.find(tag => tag.$?.name === 'MetaWindowWidth');
        const metaWindowHeightTag = settings.find(tag => tag.$?.name === 'MetaWindowHeight');
        mainWindowWidth = metaWindowWidthTag ? parseInt(metaWindowWidthTag.$.value) : 550;
        mainWindowHeight = metaWindowHeightTag ? parseInt(metaWindowHeightTag.$.value) : 343;
        controlWindowWidth = mainWindowWidth, controlWindowHeight = mainWindowHeight;
        if (animationStartTag) {
          String(animationStartTag.$.value || '').trim().toLowerCase() === 'enabled' ? createTransparentWindow() : createMainWindow();
        } else {
          createMainWindow();
        }
      } catch (e) { console.error(e); createMainWindow(); }
    });
  });
};

const createErrorDialog = () => {
  if (windows.error && !windows.error.isDestroyed()) { windows.error.focus(); return; }
  const errorWindowOptions = { width: 350, height: 300, frame: false, transparent: true, alwaysOnTop: true, resizable: false };
  if (windows.main && !windows.main.isDestroyed()) {
    const mainWindowBounds = windows.main.getBounds();
    errorWindowOptions.x = Math.floor(mainWindowBounds.x + (mainWindowBounds.width - 350) / 2);
    errorWindowOptions.y = Math.floor(mainWindowBounds.y + (mainWindowBounds.height - 330) / 2) + 30;
  }
  createWindow('error', errorWindowOptions, path.join(viewsPath, 'Dialog.html'));
  globalShortcut.register('Ctrl+J', () => windows.error?.webContents?.openDevTools());
};

ipcMain.handle('ErrorDialog', () => createErrorDialog());
ipcMain.handle('get-version', () => currentVersion);

const isNewerVersion = (newVersion, currentVersion) => {
  try {
    const newParts = newVersion.split('.').map(Number);
    const currentParts = currentVersion.split('.').map(Number);
    const maxLength = Math.max(newParts.length, currentParts.length);
    for (let i = 0; i < maxLength; i++) {
      const newPart = newParts[i] || 0;
      const currentPart = currentParts[i] || 0;
      if (newPart > currentPart) return true;
      if (newPart < currentPart) return false;
    }
    return false;
  } catch (error) { console.error('Version comparison failed:', error); return false; }
};

let updateNotification = null, latestVersion = null;

const checkForUpdates = (() => {
  let hasRun = false;
  return () => {
    if (!currentVersion) { console.error('Version not loaded, unable to check for updates'); return; }
    if (hasRun) return;
    hasRun = true;
    const checkUrl = 'https://www.52tt.pro/tools/sword/readme.txt';
    https.get(`${checkUrl}?t=${new Date().getTime()}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const remoteVersionMatch = data.match(/version:\s*v?([\d.]+)/i);
          const remoteVersion = remoteVersionMatch ? remoteVersionMatch[1] : null;
          if (remoteVersion && isNewerVersion(remoteVersion, currentVersion)) {
            latestVersion = remoteVersion;
            const iconPath = path.resolve(__dirname, '..', 'Nexus', 'Assets', 'Image', 'Box.png');
            updateNotification && updateNotification.close();
            updateNotification = new Notification({ title: '有新版本啦！', body: `当前版本: v${currentVersion}\n最新版本: v${remoteVersion}`, icon: iconPath });
            updateNotification.show();
          }
        } catch (error) { console.error('Update check failed:', error); }
      });
    }).on('error', (error) => console.error('Update check failed:', error));
  };
})();

ipcMain.handle('get-latest-version', () => latestVersion);
ipcMain.on('restart-app', () => { app.relaunch(); app.quit(); });

app.whenReady().then(() => {
  app.setAppUserModelId('Electron.MetaSword.app');
  loadVersionFromConfig(() => {
    loadToolsList();
    registerIpcHandlers();
    globalShortcut.register('F1', toggleMainWindowVisibility);
    checkForUpdates();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());