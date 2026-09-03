/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.1.0 Beta
 * @Since       2026-08-01
 * @LastUpdated 2026-09-01
 * @Description Petra 桌宠插件进程管理（PetraFunc）
 * @License     MIT
 */

const { spawn, execFile, spawnSync } = require('child_process');
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const PETRA_BUBBLE_PORT = 19527;
const PLUGIN_DIR = path.join(__dirname, '..', 'Plugins', 'Petra');
const PETRA_EXE = path.join(PLUGIN_DIR, 'petra.exe');
const CURRENT_THEME_FILE = path.join(__dirname, '..', 'Theme', 'current.json');

let _enabled = null;

function getEnabled() {
  if (_enabled !== null) return _enabled;
  try {
    const { app } = require('electron');
    _enabled = fs.existsSync(path.join(app.getPath('userData'), 'petra-enabled'));
  } catch { _enabled = false; }
  return _enabled;
}

function setEnabled(on) {
  _enabled = !!on;
  try {
    const { app } = require('electron');
    const p = path.join(app.getPath('userData'), 'petra-enabled');
    if (on) fs.writeFileSync(p, '1'); else try { fs.unlinkSync(p); } catch { }
  } catch { }
}

function exeExists() {
  try { return fs.existsSync(PETRA_EXE); } catch { return false; }
}

function petraRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq petra.exe', '/NH'], (err, stdout) => {
      if (err) return resolve(false);
      resolve(String(stdout).toLowerCase().includes('petra.exe'));
    });
  });
}

let petraSpawnLock = false;
let petraLastSpawnAt = 0;
let petraChild = null;

async function startPetra() {
  if (petraSpawnLock || Date.now() - petraLastSpawnAt < 2000) return true;
  if (await petraRunning()) return true;
  if (!exeExists()) {
    console.warn('[Petra] 未找到桌宠程序:', PETRA_EXE);
    return false;
  }
  petraSpawnLock = true;
  try {
    const child = spawn(PETRA_EXE, [], {
      cwd: PLUGIN_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    petraChild = child;
    petraLastSpawnAt = Date.now();
    console.log('[Petra] 桌宠已启动, pid =', child.pid);
    return true;
  } catch (e) {
    console.warn('[Petra] 启动失败:', e.message);
    return false;
  } finally {
    petraSpawnLock = false;
  }
}

function killTrackedChild() {
  try {
    if (petraChild && petraChild.exitCode === null && !petraChild.killed) {
      petraChild.kill();
      return true;
    }
  } catch { }
  return false;
}

function taskkillAsync() {
  try {
    execFile('taskkill', ['/IM', 'petra.exe', '/F', '/T'], { windowsHide: true }, () => { });
  } catch { }
}

function stopPetra() {
  petraLastSpawnAt = 0;
  killTrackedChild();
  taskkillAsync();
}

function stopPetraSync() {
  if (!petraLastSpawnAt) return;
  petraLastSpawnAt = 0;
  if (killTrackedChild()) {
    taskkillAsync();
  } else {
    try {
      spawnSync('taskkill', ['/IM', 'petra.exe', '/F', '/T'], { windowsHide: true });
    } catch { }
  }
}

async function syncPetraWithTheme(themeId) {
  if (!getEnabled()) return;
  await startPetra();
}

async function syncPetraOnStartup() {
  if (getEnabled()) {
    try {
      const data = JSON.parse(fs.readFileSync(CURRENT_THEME_FILE, 'utf8'));
      if (data && data.id) await startPetra();
    } catch {
      await startPetra();
    }
  }
}

function recordCurrentTheme(themeId) {
  try {
    fs.writeFileSync(CURRENT_THEME_FILE, JSON.stringify({ id: themeId }, null, 2));
  } catch (e) {
    console.warn('[Petra] 记录主题失败:', e.message);
  }
}

function sendBubbleToPetra(text, ms) {
  const body = JSON.stringify({ text, ms: ms || 4000 });
  const req = http.request({
    hostname: '127.0.0.1',
    port: PETRA_BUBBLE_PORT,
    path: '/',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 2000,
  });
  req.on('error', () => { });
  req.on('timeout', () => req.destroy());
  req.write(body);
  req.end();
}

function queryDeepSeekBalance(apiKey) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/user/balance',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function initPetraBridge() {
  ipcMain.handle('petra-status', () => petraRunning());
  ipcMain.handle('petra-enabled', () => getEnabled());
  ipcMain.handle('petra-set-enabled', async (_, on) => {
    setEnabled(!!on);
    if (on) startPetra(); else stopPetra();
    return getEnabled();
  });
  ipcMain.on('petra-start', () => startPetra());
  ipcMain.on('petra-stop', () => stopPetra());
  ipcMain.on('petra-bubble', (_, text, ms) => sendBubbleToPetra(text, ms));
  ipcMain.handle('deepseek-balance-bubble', async (_, apiKey) => {
    if (!apiKey) return;
    const bal = await queryDeepSeekBalance(apiKey);
    if (!bal || !bal.is_available) return;
    const info = (bal.balance_infos || [])[0];
    if (!info) return;
    const total = parseFloat(info.total_balance || '0');
    const sym = info.currency === 'CNY' ? '¥' : info.currency === 'USD' ? '$' : '';
    sendBubbleToPetra(`DeepSeek 余额：${sym}${total.toFixed(2)}`, 5000);
  });
}

module.exports = {
  stopPetraSync,
  syncPetraWithTheme,
  syncPetraOnStartup,
  recordCurrentTheme,
  initPetraBridge,
};
