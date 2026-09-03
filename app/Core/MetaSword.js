/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.1.0 Beta
 * @Since       2023-08-31
 * @LastUpdated 2026-09-01
 * @Description Electron 主进程入口（MetaSword）
 * @License     MIT
 */

const { app, Menu, Tray, BrowserWindow, globalShortcut, ipcMain, screen, dialog, Notification, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xml2js = require('xml2js');
const https = require('https');
const { startMCPHttpServer } = require('./MCPFunc');
const { initNyeliBridge } = require('./NyeliBridge');
const { initNvoiceBridge } = require('./NvoiceBridge');
const { initPetraBridge, syncPetraWithTheme, syncPetraOnStartup, recordCurrentTheme, stopPetraSync } = require('./PetraFunc');
const { exec, execSync } = require('child_process');

const originalConsoleLog = console.log, originalConsoleWarn = console.warn;
const filterLog = (...args) => {
  const message = args.join(' ');
  return !message.includes('Slow network is detected') && !message.includes('Fallback font will be used while loading');
};
console.log = (...args) => filterLog(...args) && originalConsoleLog(...args);
console.warn = (...args) => filterLog(...args) && originalConsoleWarn(...args);

let windows = { logo: null, main: null, frida: null, control: null, error: null, addtool: null, agentlogs: null };
let isToggling = false, originalBounds;
let tray = null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  try { process.exit(0); } catch { }
} else {
  app.on('second-instance', () => {
    ['main', 'frida'].forEach(key => {
      if (windows[key] && !windows[key].isDestroyed()) {
        if (windows[key].isMinimized()) {
          windows[key].restore();
        } else if (!windows[key].isVisible()) {
          windows[key].show();
          if (windows[key].webContents && !windows[key].webContents.isDestroyed()) windows[key].webContents.send('window-restored');
        }
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

const DEFAULT_CONFIG_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<config>
  <settings>
    <tag name="MetaVersion" value="1.1.0 Beta"/>
    <tag name="MetaWindowWidth" value="550"/>
    <tag name="MetaWindowHeight" value="343"/>
    <tag name="AnimationStart" value="disabled"/>
    <tag name="AnimationSpeed" value="1.8"/>
    <tag name="AlwaysOnTop" value="disabled"/>
  </settings>
</config>`;

const ensureConfigFile = async () => {
  try {
    let data = '';
    try {
      data = await fs.promises.readFile(filePath, 'utf8');
    } catch (e) {
      data = '';
    }
    if (!data || !data.trim()) {
      await fs.promises.writeFile(filePath, DEFAULT_CONFIG_XML, 'utf8');
    }
  } catch (e) {
    console.error('ensureConfigFile error:', e);
  }
};

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

ipcMain.on('set-main-always-on-top', (event, enabled) => {
  try {
    windows.main?.setAlwaysOnTop(!!enabled);
    applyTopmostToAuxWindows(!!enabled);
  } catch (_) { }
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
  if (AUX_FLOAT_WINDOWS.includes(name) && windows.main?.isAlwaysOnTop()) windows[name].setAlwaysOnTop(true);
  windows[name].on('closed', () => (windows[name] = null));
  windows[name].on('restore', () => {
    windows[name] && !windows[name].isDestroyed() && windows[name].webContents.send('window-restored');
  });
  windows[name].webContents.on('console-message', (event, level, message) => {
    if (message.includes('Slow network is detected') || message.includes('Fallback font will be used while loading')) {
      event.preventDefault();
    }
  });
};

const applyMainWindowAlwaysOnTop = () => {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) return;
    xml2js.parseString(data, (err, result) => {
      if (err) return;
      try {
        const settings = result?.config?.settings?.[0]?.tag || [];
        const enabled = settings.find(tag => tag.$?.name === 'AlwaysOnTop')?.$.value === 'enabled';
        windows.main?.setAlwaysOnTop(enabled);
        applyTopmostToAuxWindows(enabled);
      } catch (e) { console.error('applyMainWindowAlwaysOnTop error:', e); }
    });
  });
};


const AUX_FLOAT_WINDOWS = ['control', 'addtool', 'frida', 'agentlogs'];
const applyTopmostToAuxWindows = (enabled) => {
  AUX_FLOAT_WINDOWS.forEach((name) => {
    const win = windows[name];
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(enabled);
  });
};

const createMainWindow = () => {
  windows.main = new BrowserWindow({
    width: mainWindowWidth, height: mainWindowHeight, minWidth: 550, minHeight: 343, maxWidth: 900, maxHeight: 550,
    frame: false, resizable: true, transparent: true, alwaysOnTop: false,
    webPreferences: { contextIsolation: false, nodeIntegration: true, backgroundThrottling: false }
  });
  windows.main.loadFile(path.join(viewsPath, 'Home.html'));
  applyMainWindowAlwaysOnTop();
  windows.main.webContents.on('did-finish-load', () => {
    if (pendingUpdateSound) {
      pendingUpdateSound = false;
      try { windows.main?.webContents?.send('app-update-sound'); } catch (_) { }
    }
  });
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
    updateAgentLogsPosition();
  });
  windows.main.on('closed', () => {
    Object.keys(windows).forEach(key => {
      if (key !== 'main' && windows[key] && !windows[key].isDestroyed()) windows[key].close();
    });
  });
  globalShortcut.register('Ctrl+P', () => windows.main?.webContents?.openDevTools());
  const mcpServer = startMCPHttpServer(windows, createFridaIDEWindow);
  ipcMain.on('get-mcp-port', (event) => event.sender.send('mcp-port', mcpServer.getPort()));
  ipcMain.on('nyeli-close-browser', () => { try { mcpServer.closeBrowser(); } catch { } });
  ipcMain.handle('read-conversation-export-template', async () => {
    const templatePath = path.join(__dirname, '..', 'Nexus', 'Views', 'Export.html');
    try { return await fs.promises.readFile(templatePath, 'utf-8'); } catch { return null; }
  });
  ipcMain.handle('get-export-avatars', async () => {
    const userPath = path.join(__dirname, '..', 'Nexus', 'Assets', 'Image', 'Avatar.png');
    const aiPath = path.join(__dirname, '..', 'Nexus', 'Assets', 'Image', 'Nyeli.png');
    const iconPath = path.join(__dirname, '..', 'Nexus', 'Assets', 'Image', 'icon.ico');
    try {
      const [userBuf, aiBuf, iconBuf] = await Promise.all([
        fs.promises.readFile(userPath),
        fs.promises.readFile(aiPath),
        fs.promises.readFile(iconPath).catch(() => null),
      ]);
      const MAX_SIZE = 256;
      const compress = (buf) => {
        let img = nativeImage.createFromBuffer(buf);
        const size = img.getSize();
        if (size.width > MAX_SIZE || size.height > MAX_SIZE) {
          const ratio = Math.min(MAX_SIZE / size.width, MAX_SIZE / size.height);
          img = img.resize({ width: Math.round(size.width * ratio), height: Math.round(size.height * ratio) });
        }
        return 'data:image/jpeg;base64,' + img.toJPEG(85).toString('base64');
      };
      return {
        user: compress(userBuf),
        ai: compress(aiBuf),
        icon: iconBuf ? 'data:image/x-icon;base64,' + iconBuf.toString('base64') : '',
      };
    } catch { return { user: '', ai: '', icon: '' }; }
  });
  ipcMain.handle('export-conversation-html', async (event, html) => {
    try {
      const result = await dialog.showSaveDialog(windows.agentlogs || windows.main, {
        title: '保存对话记录',
        defaultPath: `MetaSword-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fs.promises.writeFile(result.filePath, html, 'utf-8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('export-conversation-pdf', async (event, html) => {
    try {
      const result = await dialog.showSaveDialog(windows.agentlogs || windows.main, {
        title: '保存对话记录为 PDF',
        defaultPath: `MetaSword-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      const win = new BrowserWindow({
        show: false,
        width: 860,
        height: 600,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await win.webContents.insertCSS('@page { margin: 0; } *, *::before, *::after { animation: none !important; transition: none !important; opacity: 1 !important; transform: none !important; }');
      await new Promise(r => setTimeout(r, 300));
      const pdfBuf = await win.webContents.printToPDF({
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        pageSize: 'A4',
      });
      win.close();
      await fs.promises.writeFile(result.filePath, pdfBuf);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('export-agent-logs', async (event, logs) => {
    try {
      const result = await dialog.showSaveDialog(windows.agentlogs || windows.main, {
        title: '导出 Agent Logs',
        defaultPath: `agent-logs-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fs.promises.writeFile(result.filePath, JSON.stringify(logs, null, 2), 'utf-8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
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

    recordCurrentTheme(theme);
    syncPetraWithTheme(theme);
  });

  ipcMain.handle('open-skills-dialog', async () => {
    const result = await dialog.showOpenDialog(windows.main, {
      title: '选择 Skills 压缩包',
      filters: [{ name: 'ZIP 文件', extensions: ['zip'] }],
      properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.on('hide-agentlogs', (event, opts) => {
    if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
      if (opts && opts.animated) {
        windows.agentlogs.webContents.send('close-agentlogs');
        setTimeout(() => {
          if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
            windows.agentlogs.close();
            windows.agentlogs = null;
          }
        }, 220);
      } else {
        windows.agentlogs.close();
        windows.agentlogs = null;
      }
    }
  });
  ipcMain.on('tool-call', (event, data) => {
    if (!windows.agentlogs || windows.agentlogs.isDestroyed()) createAgentLogsWindow();
    windows.agentlogs?.webContents?.send('tool-call', data);
  });
  ipcMain.on('tool-result', (event, data) => {
    windows.agentlogs?.webContents?.send('tool-result', data);
  });

  ipcMain.on('perm-request', (event, data) => {
    if (!windows.agentlogs || windows.agentlogs.isDestroyed()) createAgentLogsWindow();
    windows.agentlogs?.webContents?.send('perm-request', data);
  });
  ipcMain.on('perm-response', (event, data) => {
    windows.main?.webContents?.send('perm-response', data);
  });
  ipcMain.on('clear-tool-log', () => {
    windows.agentlogs?.webContents?.send('clear-tool-log');
  });


  windows.main.on('move', updateAgentLogsPosition);
  windows.main.on('resize', updateAgentLogsPosition);
  windows.main.on('close', () => {
    if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
      windows.agentlogs.close();
      windows.agentlogs = null;
    }
  });
};

const showMainWindow = () => {
  if (!windows.main || windows.main.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (windows.main.isMinimized()) {
    windows.main.restore();
  } else if (!windows.main.isVisible()) {
    windows.main.show();
    windows.main.webContents.send('window-restored');
  }
  windows.main.focus();
  if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
    windows.agentlogs.show();
    windows.agentlogs.webContents.send('window-restored');
  }
};

const quitApp = () => {
  const main = windows.main;
  if (main && !main.isDestroyed() && main.isVisible() && !main.isMinimized()) {
    main.webContents.send('play-close-anim');
    setTimeout(() => app.quit(), 220);
  } else {
    app.quit();
  }
};

const createTray = () => {
  if (tray) return;
  const iconPath = path.join(__dirname, '..', 'Nexus', 'Assets', 'Image', 'icon.ico');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty icon');
  } catch (err) {
    console.error('Tray icon load failed:', err);
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip('次元剑');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: quitApp }
  ]));
  tray.on('click', showMainWindow);
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

const createAgentLogsWindow = () => {
  if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
    windows.agentlogs.isMinimized() && windows.agentlogs.restore();
    !windows.agentlogs.isVisible() && windows.agentlogs.show();
    windows.agentlogs.focus();
    return;
  }
  const mainPos = windows.main?.getPosition();
  const mainSize = windows.main?.getSize();
  windows.agentlogs = new BrowserWindow({
    width: 300,
    height: mainSize ? mainSize[1] : 600,
    x: mainPos && mainSize ? mainPos[0] + mainSize[0] : 900,
    y: mainPos ? mainPos[1] : 0,
    frame: false,
    resizable: false,
    transparent: true,
    parent: windows.main,
    alwaysOnTop: false,
    skipTaskbar: true,
    webPreferences: { contextIsolation: false, nodeIntegration: true }
  });
  windows.agentlogs.loadFile(path.join(viewsPath, 'AgentLogs.html'));
  windows.main?.isAlwaysOnTop() && windows.agentlogs.setAlwaysOnTop(true);
  windows.agentlogs.webContents.on('console-message', (event, level, message) => {
    if (message.includes('Slow network is detected') || message.includes('Fallback font will be used while loading')) {
      event.preventDefault();
    }
  });
  windows.agentlogs.on('ready-to-show', () => updateAgentLogsPosition());
  windows.agentlogs.on('closed', () => (windows.agentlogs = null));
  globalShortcut.register('Ctrl+T', () => windows.agentlogs?.webContents?.openDevTools());
};

const updateAgentLogsPosition = () => {
  if (!windows.agentlogs || windows.agentlogs.isDestroyed()) return;
  if (!windows.main || windows.main.isDestroyed()) return;
  const mainPos = windows.main.getPosition();
  const mainSize = windows.main.getSize();
  windows.agentlogs.setBounds({
    x: mainPos[0] + mainSize[0],
    y: mainPos[1],
    width: 300,
    height: mainSize[1]
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
    const [liveWidth, liveHeight] = windows.main.getSize();
    controlWindowOptions.width = liveWidth, controlWindowOptions.height = liveHeight;
    controlWindowWidth = liveWidth, controlWindowHeight = liveHeight;
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
          animationSpeed: settings.find(tag => tag.$?.name === 'AnimationSpeed')?.$.value || '1.8',
          alwaysOnTop: settings.find(tag => tag.$?.name === 'AlwaysOnTop')?.$.value || 'disabled'
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
    const [liveWidth, liveHeight] = windows.main.getSize();
    addToolWindowOptions.width = liveWidth, addToolWindowOptions.height = liveHeight;
    controlWindowWidth = liveWidth, controlWindowHeight = liveHeight;
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
    if (windows.main.isVisible()) {
      windows.main.webContents.send('play-close-anim');
      if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
        windows.agentlogs.webContents.send('close-agentlogs');
      }
      setTimeout(() => {
        windows.main.hide();
        if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
          windows.agentlogs.hide();
        }
      }, 220);
    } else {
      windows.main.show();
      windows.main.webContents.send('window-restored');
      if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
        windows.agentlogs.show();
        windows.agentlogs.webContents.send('window-restored');
      }
    }
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
    ['minimize-mainwindow', () => {
      windows.main?.webContents?.send('play-close-anim');
      if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
        windows.agentlogs.webContents.send('close-agentlogs');
      }
      setTimeout(() => {
        windows.main?.hide();
        if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
          windows.agentlogs.hide();
        }
      }, 220);
    }],
    ['close-mainwindow', () => {
      windows.main?.webContents?.send('play-close-anim');
      if (windows.agentlogs && !windows.agentlogs.isDestroyed()) {
        windows.agentlogs.webContents.send('close-agentlogs');
      }
      setTimeout(() => app.quit(), 400);
    }],
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
    const clean = (v) => v.split('.').map(s => parseInt(s, 10) || 0);
    const newParts = clean(newVersion);
    const currentParts = clean(currentVersion);
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
let pendingUpdateSound = false;

const playUpdateSound = () => {
  try {
    const w = windows.main;
    if (w && !w.isDestroyed() && !w.webContents.isLoading()) {
      w.webContents.send('app-update-sound');
    } else {
      pendingUpdateSound = true;
    }
  } catch (_) { }
};

const checkForUpdates = (() => {
  let hasRun = false;
  return () => {
    if (!currentVersion) { console.error('Version not loaded, unable to check for updates'); return; }
    if (hasRun) return;
    hasRun = true;
    const checkUrl = 'https://www.52tt.pro/tools/sword/update/readme.txt';
    https.get(`${checkUrl}?t=${new Date().getTime()}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const remoteVersionMatch = data.match(/version:\s*v?([\d.]+)/i);
          const remoteVersion = remoteVersionMatch ? remoteVersionMatch[1] : null;
          if (remoteVersion && isNewerVersion(remoteVersion, currentVersion)) {
            latestVersion = remoteVersion;
            const iconPath = path.resolve(__dirname, '..', 'Nexus', 'Assets', 'Image', 'icon.ico');
            updateNotification && updateNotification.close();
            updateNotification = new Notification({ title: '有新版本啦！', body: `当前版本: v${currentVersion}\n最新版本: v${remoteVersion}`, icon: iconPath, silent: true });
            updateNotification.show();
            playUpdateSound();
          }
        } catch (error) { console.error('Update check failed:', error); }
      });
    }).on('error', (error) => console.error('Update check failed:', error));
  };
})();

ipcMain.handle('get-latest-version', () => latestVersion);
ipcMain.on('restart-app', () => {
  try {
    app.relaunch({ args: process.argv.slice(1).concat(['--relaunch']) });
    app.exit(0);
  } catch {
    app.quit();
  }
});

const APP_ROOT = path.join(__dirname, '..');
const MANIFEST_URL = 'https://www.52tt.pro/tools/sword/update/manifest.json';

function md5File(p) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(p);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

function fetchUrlText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, res => {
      if (res.statusCode !== 200) { file.close(); try { fs.unlinkSync(dest); } catch { } reject(new Error('HTTP ' + res.statusCode)); return; }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', err => { file.close(); try { fs.unlinkSync(dest); } catch { } reject(err); });
    file.on('error', err => { try { fs.unlinkSync(dest); } catch { } reject(err); });
  });
}

ipcMain.handle('check-update', async () => {
  try {
    const manifestText = await fetchUrlText(MANIFEST_URL + '?t=' + Date.now());
    let manifest;
    try { manifest = JSON.parse(manifestText); } catch { return { ok: false }; }
    if (!manifest || !Array.isArray(manifest.files)) return { ok: false };
    for (const f of manifest.files) {
      if (typeof f.p !== 'string' || typeof f.md5 !== 'string') continue;
      if (f.p.startsWith('..')) continue;
      const localPath = path.join(APP_ROOT, f.p);
      if (!localPath.startsWith(APP_ROOT)) continue;
      let localMd5 = null;
      if (fs.existsSync(localPath)) localMd5 = await md5File(localPath);
      if (localMd5 !== f.md5) return { ok: true, needUpdate: true, version: manifest.version };
    }
    const removed = Array.isArray(manifest.removed) ? manifest.removed.filter(p => {
      const lp = path.join(APP_ROOT, p);
      return lp.startsWith(APP_ROOT) && fs.existsSync(lp);
    }) : [];
    if (removed.length > 0) return { ok: true, needUpdate: true, version: manifest.version };
    return { ok: true, needUpdate: false, version: manifest.version };
  } catch { return { ok: false }; }
});

ipcMain.handle('perform-update', async (event) => {
  try {
    const manifestText = await fetchUrlText(MANIFEST_URL + '?t=' + Date.now());
    let manifest;
    try { manifest = JSON.parse(manifestText); } catch { return { ok: false, error: 'manifest 解析失败' }; }
    if (!manifest || !Array.isArray(manifest.files)) return { ok: false, error: 'manifest 格式错误' };
    const base = (manifest.base || 'https://www.52tt.pro/tools/sword/update/app').replace(/\/$/, '');
    const files = manifest.files;
    const sender = event.sender;

    const toDownload = [];
    for (const f of files) {
      if (typeof f.p !== 'string' || typeof f.md5 !== 'string') continue;
      if (f.p.startsWith('..') || f.p.includes('..\\') || f.p.includes('../')) continue;
      const localPath = path.join(APP_ROOT, f.p);
      if (!localPath.startsWith(APP_ROOT)) continue;
      let localMd5 = null;
      if (fs.existsSync(localPath)) localMd5 = await md5File(localPath);
      if (localMd5 !== f.md5) toDownload.push(f);
    }

    const removed = Array.isArray(manifest.removed) ? manifest.removed : [];
    if (toDownload.length === 0 && removed.length === 0) {
      if (manifest.version) {
        await writeConfig((result) => {
          const settings = result?.config?.settings?.[0]?.tag || [];
          const tag = settings.find(t => t.$?.name === 'MetaVersion');
          if (tag) tag.$.value = String(manifest.version);
        });
        latestVersion = null;
      }
      return { ok: true, needRestart: false, downloaded: 0, version: manifest.version };
    }

    const total = toDownload.length;
    const totalAll = total + removed.length;
    let doneCount = 0, pending = 0;
    const failed = [];

    for (let i = 0; i < total; i++) {
      const f = toDownload[i];
      const localPath = path.join(APP_ROOT, f.p);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      const tmpPath = localPath + '.update.tmp';
      let ok = false, lastErr = '';
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const remoteUrl = base + '/' + f.p.split('/').map(s => encodeURIComponent(s)).join('/') + '?t=' + Date.now();
          await downloadToFile(remoteUrl, tmpPath);
          const got = await md5File(tmpPath);
          if (got === f.md5) ok = true;
          else { lastErr = 'md5 校验失败'; try { fs.unlinkSync(tmpPath); } catch { } }
        } catch (e) { lastErr = e.message; try { fs.unlinkSync(tmpPath); } catch { } }
      }
      if (!ok) { failed.push({ p: f.p, reason: lastErr }); doneCount++; if (sender && !sender.isDestroyed()) sender.send('update-progress', { done: doneCount, total: totalAll, file: f.p, action: 'skip' }); continue; }
      try {
        fs.copyFileSync(tmpPath, localPath);
      } catch (e) {
        const pendingDir = path.join(APP_ROOT, '.pending_update');
        try {
          fs.mkdirSync(pendingDir, { recursive: true });
          const pendingPath = path.join(pendingDir, f.p);
          fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
          try { fs.renameSync(tmpPath, pendingPath); } catch { fs.copyFileSync(tmpPath, pendingPath); }
          try { fs.unlinkSync(tmpPath); } catch { }
          pending++;
          doneCount++;
          if (sender && !sender.isDestroyed()) sender.send('update-progress', { done: doneCount, total: totalAll, file: f.p });
          continue;
        } catch {
          try { fs.unlinkSync(tmpPath); } catch { }
        }
        failed.push({ p: f.p, reason: '写入失败: ' + e.message + '（文件可能正被占用）' });
        doneCount++;
        if (sender && !sender.isDestroyed()) sender.send('update-progress', { done: doneCount, total: totalAll, file: f.p, action: 'skip' });
        continue;
      }
      try { fs.unlinkSync(tmpPath); } catch { }
      doneCount++;
      if (sender && !sender.isDestroyed()) sender.send('update-progress', { done: doneCount, total: totalAll, file: f.p });
    }

    let actualRemoved = 0;
    for (const p of removed) {
      if (typeof p !== 'string' || p.startsWith('..') || p.includes('../') || p.includes('..\\')) continue;
      const localPath = path.join(APP_ROOT, p);
      if (!localPath.startsWith(APP_ROOT)) continue;
      try {
        if (fs.existsSync(localPath)) { fs.unlinkSync(localPath); actualRemoved++; }
        let dir = path.dirname(localPath);
        while (dir.length > APP_ROOT.length) {
          try {
            const entries = fs.readdirSync(dir);
            if (entries.length === 0) fs.rmdirSync(dir); else break;
          } catch { break; }
          dir = path.dirname(dir);
        }
      } catch (e) { }
      doneCount++;
      if (sender && !sender.isDestroyed()) sender.send('update-progress', { done: doneCount, total: totalAll, file: p, action: 'delete' });
    }

    if (manifest.version) {
      await writeConfig((result) => {
        const settings = result?.config?.settings?.[0]?.tag || [];
        const tag = settings.find(t => t.$?.name === 'MetaVersion');
        if (tag) tag.$.value = String(manifest.version);
      });
    }
    latestVersion = null;
    const successCount = total - failed.length - pending;
    if (failed.length === 0) {
      return { ok: true, needRestart: total > 0 || actualRemoved > 0, downloaded: successCount, pending, removed: actualRemoved, version: manifest.version };
    }
    const hasProgress = total > 0 || actualRemoved > 0;
    const result = { ok: true, needRestart: hasProgress, partial: true, downloaded: successCount, pending, failed: failed.length, removed: actualRemoved, version: manifest.version };
    return result;
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});


const ensureStartMenuShortcut = () => {
  try {
    const AUMID = 'MetaSword.App';
    const programsDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const shortcutPath = path.join(programsDir, '次元剑.lnk');
    const currentExePath = process.execPath;

    if (fs.existsSync(shortcutPath)) {
      try {
        const checkScript = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${shortcutPath.replace(/'/g, "''")}'); Write-Output $s.TargetPath`;
        const existingTarget = execSync(`powershell -NoProfile -Command "${checkScript}"`, { encoding: 'utf8', windowsHide: true }).trim();
        if (existingTarget.toLowerCase() === currentExePath.toLowerCase()) return;
      } catch (_) { }
    }
    if (!fs.existsSync(programsDir)) fs.mkdirSync(programsDir, { recursive: true });
    const iconIcoPath = path.join(__dirname, '..', 'Nexus', 'Assets', 'Image', 'icon.ico');
    const iconUri = 'file:///' + encodeURI(iconIcoPath.replace(/\\/g, '/'));

    const setPropScript = [
      `Add-Type -TypeDefinition @'`,
      `using System;`,
      `using System.Runtime.InteropServices;`,
      `public class LnkAUMID {`,
      `  [DllImport("shell32.dll",CharSet=CharSet.Unicode)]`,
      `  static extern int SHGetPropertyStoreFromParsingName(string p,IntPtr b,int f,ref Guid g,out IntPtr s);`,
      `  [StructLayout(LayoutKind.Sequential)] struct PV { public ushort vt;ushort r1;ushort r2;ushort r3;public IntPtr p; }`,
      `  [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]`,
      `  interface IPropStore { void GetCount(out uint c);void GetAt(uint i,out PK pk);void GetValue(ref PK pk,out PV pv);void SetValue(ref PK pk,ref PV pv);void Commit(); }`,
      `  [StructLayout(LayoutKind.Sequential)] struct PK { public Guid f;public uint i; }`,
      `  public static void Set(string lnk,string id) {`,
      `    var k=new PK{f=new Guid("{9F4C2855-9F79-4B39-A8D0-E1E2B7A8B7A8}"),i=5};`,
      `    var g=new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");`,
      `    IntPtr sp;SHGetPropertyStoreFromParsingName(lnk,IntPtr.Zero,0,ref g,out sp);`,
      `    IPropStore ps=(IPropStore)Marshal.GetObjectForIUnknown(sp);`,
      `    PV pv=new PV{vt=31};pv.p=Marshal.StringToCoTaskMemUni(id);`,
      `    ps.SetValue(ref k,ref pv);ps.Commit();Marshal.FreeCoTaskMem(pv.p);`,
      `  }`,
      `}`,
      `'@`,
      `$ws = New-Object -ComObject WScript.Shell`,
      `$lnk = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')`,
      `$lnk.TargetPath = '${process.execPath.replace(/'/g, "''")}'`,
      `$lnk.WorkingDirectory = '${path.dirname(process.execPath).replace(/'/g, "''")}'`,
      `$lnk.IconLocation = '${iconIcoPath.replace(/'/g, "''")}'`,
      `$lnk.Save()`,
      `[LnkAUMID]::Set('${shortcutPath.replace(/'/g, "''")}','${AUMID}')`,
      `& reg add "HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}" /v DisplayName /t REG_SZ /d "次元剑" /f`,
      `& reg add "HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}" /v IconUri /t REG_SZ /d "${iconUri}" /f`,
    ].join('\n');

    const tmpFile = path.join(app.getPath('temp'), 'ms_setup_shortcut.ps1');
    fs.writeFileSync(tmpFile, setPropScript, 'utf8');
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, { windowsHide: true }, (err) => {
      try { fs.unlinkSync(tmpFile); } catch (_) { }
      if (err) console.error('[Shortcut] setup failed:', err.message);
    });
  } catch (e) { }
};

(function applyPendingUpdates() {
  try {
    const pendingDir = path.join(__dirname, '..', '.pending_update');
    if (!fs.existsSync(pendingDir)) return;
    function walk(dir, base = '') {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = base ? base + '/' + entry.name : entry.name;
        if (entry.isDirectory()) walk(full, rel);
        else {
          const target = path.join(__dirname, '..', rel);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          try { fs.copyFileSync(full, target); } catch (e) { console.error('[PendingUpdate] copy failed:', rel, e.message); }
        }
      }
    }
    walk(pendingDir);
    try { fs.rmSync(pendingDir, { recursive: true, force: true }); } catch { }
  } catch { }
})();

app.whenReady().then(async () => {
  app.setAppUserModelId('MetaSword.App');
  ensureStartMenuShortcut();
  await ensureConfigFile();
  loadVersionFromConfig(() => {
    loadToolsList();
    registerIpcHandlers();
    initNyeliBridge(windows, createAgentLogsWindow, updateAgentLogsPosition);
    initNvoiceBridge(windows);
    initPetraBridge();
    syncPetraOnStartup();
    createTray();
    globalShortcut.register('F1', toggleMainWindowVisibility);
    setTimeout(checkForUpdates, 5000);
  });
});

app.on('before-quit', () => {
  stopPetraSync();
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());