/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.1.0 Beta
 * @Since       2026-08-01
 * @LastUpdated 2026-09-01
 * @Description Nyeli Agent 桥接模块（NyeliBridge）
 * @License     MIT
 */

const { ipcMain, app, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const NYELI_EMBED_PATH = path.join(__dirname, '..', 'Plugins', 'Nyeli', 'dist', 'embed.js');
const NYELI_EMBED_URL = pathToFileURL(NYELI_EMBED_PATH).href;
const NYELI_SKILLS_PATH = path.join(__dirname, '..', 'Plugins', 'Nyeli', '.Nyeli', 'skills');

let agent = null;
let loader = null;
let currentRunId = 0;
let runLock = Promise.resolve();
let emitRunId = 0;

function loadEmbed() {
  if (!loader) {
    loader = import(NYELI_EMBED_URL).then((m) => m.createEmbeddedAgent).catch((e) => {
      loader = null;
      throw e;
    });
  }
  return loader;
}

function initNyeliBridge(windows, createAgentLogsWindow, updateAgentLogsPosition) {
  let agentNotify = null;
  let agentNotifyEnabled = true;

  const NYELI_ICON_PATH = path.resolve(__dirname, '..', 'Nexus', 'Assets', 'Image', 'Nyeli-notify.png');
  ipcMain.on('nyeli-notify-setting', (_e, v) => { agentNotifyEnabled = !!v; });

  const playTaskSound = () => {
    try {
      const w = windows && windows.main;
      if (w && !w.isDestroyed()) w.webContents.send('nyeli-task-sound');
    } catch (_) { }
  };

  const notifyAgentDone = (ok, body) => {
    try {
      if (!agentNotifyEnabled) return;
      if (!Notification.isSupported()) return;
      try { agentNotify && agentNotify.close(); } catch (_) { }
      agentNotify = new Notification({
        title: ok ? 'Nyeli ✦ 任务完成' : 'Nyeli ✦ 任务失败',
        body,
        icon: NYELI_ICON_PATH,
        silent: true,
      });
      agentNotify.on('click', () => {
        try {
          const w = windows && windows.main;
          if (w && !w.isDestroyed()) {
            if (w.isMinimized()) w.restore();
            w.show();
            w.focus();
          }
        } catch (_) { }
      });
      agentNotify.show();
      playTaskSound();
    } catch (_) { }
  };

  ipcMain.handle('nyeli-start', async (event, opts = {}) => {
    console.log('[DBG] nyeli-start opts.model=', opts.model, 'apiBaseUrl=', opts.apiBaseUrl);
    try {
      const createEmbeddedAgent = await loadEmbed();
      if (agent) {
        try { agent.shutdown(); } catch (_) { }
        agent = null;
      }
      const sender = event.sender;
      const emit = (payload) => {
        if (sender && !sender.isDestroyed()) sender.send('nyeli-stream', { ...payload, _rid: emitRunId });
      };

      const onPermissionRequest = !opts.autoApprove ? (toolName, args) => {
        return new Promise((resolve) => {
          const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          const handler = (ev, response) => {
            if (response && response.requestId === requestId) {
              ipcMain.removeListener('perm-response', handler);
              resolve(response.action === 'allow');
            }
          };
          ipcMain.on('perm-response', handler);
          if (!windows.agentlogs || windows.agentlogs.isDestroyed()) {
            createAgentLogsWindow();
            updateAgentLogsPosition();
          }
          windows.agentlogs?.webContents?.send('perm-request', {
          requestId,
          denials: [{ tool_name: toolName, tool_input: args }]
        });
        try {
          if (agentNotifyEnabled && Notification.isSupported()) {
            const permNotify = new Notification({
              title: 'Nyeli ✦ 需要权限',
              body: `${toolName} 请求执行，请前往 Agent Logs 窗口确认`,
              icon: NYELI_ICON_PATH,
              silent: true,
            });
            permNotify.on('click', () => {
              try {
                const w = windows && windows.agentlogs;
                if (w && !w.isDestroyed()) {
                  if (w.isMinimized()) w.restore();
                  w.show();
                  w.focus();
                }
              } catch (_) { }
            });
            permNotify.show();
            playTaskSound();
          }
        } catch (_) { }
        setTimeout(() => {
            ipcMain.removeListener('perm-response', handler);
            resolve(false);
          }, 120000);
        });
      } : undefined;

      const onQuestionRequest = (questions, timeoutMs) => {
        return new Promise((resolve) => {
          const requestId = `q_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          const handler = (ev, response) => {
            if (response && response.requestId === requestId) {
              ipcMain.removeListener('question-response', handler);
              resolve(response.answers || null);
            }
          };
          ipcMain.on('question-response', handler);
          if (!windows.agentlogs || windows.agentlogs.isDestroyed()) {
            createAgentLogsWindow();
            updateAgentLogsPosition();
          }
          windows.agentlogs?.webContents?.send('question-request', {
            requestId,
            questions,
          });
          const t = timeoutMs || 120000;
          setTimeout(() => {
            ipcMain.removeListener('question-response', handler);
            resolve(null);
          }, t);
        });
      };

      agent = await createEmbeddedAgent(
        {
          apiKey: opts.apiKey || 'public',
          apiBaseUrl: opts.apiBaseUrl || 'https://opencode.ai/zen/v1',
          model: opts.model || 'hy3-free',
          summaryModel: opts.summaryModel || 'hy3-free',
          thinkingMode: opts.thinkingMode || 'thinking_max',
          maxToolRounds: opts.maxToolRounds || 50,
          workingDir: opts.workingDir || process.cwd(),
          autoApprove: opts.autoApprove !== false,
          systemPrompt: opts.systemPrompt || '',
          skillsPaths: [NYELI_SKILLS_PATH],
          onPermissionRequest,
          onQuestionRequest,
        },
        {
          onText: (t) => emit({ type: 'text', data: t }),
          onReasoning: (t) => emit({ type: 'reasoning', data: t }),
          onToolCall: (name, args) => emit({ type: 'tool_call', name, args }),
          onToolResult: (r) => {
            emit({ type: 'tool_result', data: r });
          },
          onTokenUsage: (input, output) => emit({ type: 'token', input, output }),
          onError: (m) => emit({ type: 'error', data: m }),
          onInfo: (m) => emit({ type: 'info', data: m }),
          onMaxTurns: (messages) => emit({ type: 'max_turns', data: messages }),
        }
      );
      return { ok: true };
    } catch (e) {
      console.error('[NyeliBridge] start failed:', e && e.stack ? e.stack : e);
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });

  ipcMain.handle('nyeli-run', async (event, input) => {
    const inputText = typeof input === 'string' ? input : (input?.text || '');
    const images = typeof input === 'string' ? [] : (input?.images || []);
    console.log('[DBG] nyeli-run input=', String(inputText || '').slice(0, 80), 'agent=', !!agent, 'images=', images.length);
    if (!agent) return { ok: false, error: 'agent not started' };

    let resolveLock;
    const nextLock = new Promise(r => { resolveLock = r; });
    const prevLock = runLock;
    runLock = nextLock;
    await prevLock;

    const myRunId = ++currentRunId;
    emitRunId = myRunId;
    const startedAt = Date.now();
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('nyeli-run-started', { _rid: myRunId });
    }

    try {
      const result = await agent.run(inputText, images);

      if (myRunId === currentRunId && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('nyeli-stream', { type: 'done', _rid: myRunId, stopReason: result.stopReason, turns: result.numTurns });
      }
      resolveLock();
      if (myRunId === currentRunId) {
        if (result.stopReason === 'end_turn' || result.stopReason === 'max_turns') {
          const dur = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          const snippet = (inputText || '（图片输入）').replace(/\s+/g, ' ').trim().slice(0, 40) || '（图片输入）';
          notifyAgentDone(true, `${snippet}\n用时 ${dur} 秒 · ${result.numTurns || 0} 轮`);
        } else if (result.stopReason === 'error') {
          notifyAgentDone(false, '运行出错，详情见 Agent Logs');
        }
      }
      return { ok: true, stopReason: result.stopReason, numTurns: result.numTurns };
    } catch (e) {
      console.error('[NyeliBridge] run failed:', e);
      if (myRunId === currentRunId && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('nyeli-stream', { type: 'done', _rid: myRunId, stopReason: 'error' });
      }
      resolveLock();
      if (myRunId === currentRunId) {
        notifyAgentDone(false, String((e && e.message) || e).slice(0, 80));
      }
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });

  ipcMain.handle('nyeli-save-image', async (event, base64) => {
    try {
      const commaIdx = base64.indexOf(',');
      if (commaIdx === -1) return { ok: false, error: '无效的图片数据' };
      const imagesDir = path.join(app.getPath('userData'), 'images');
      if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
      const buf = Buffer.from(base64.substring(commaIdx + 1), 'base64');
      const img = nativeImage.createFromBuffer(buf);
      const size = img.getSize();
      if (size.width === 0 || size.height === 0) return { ok: false, error: '无效的图片数据' };
      const MAX = 2048;
      let compressed;
      if (size.width > MAX || size.height > MAX) {
        const ratio = Math.min(MAX / size.width, MAX / size.height);
        compressed = img.resize({ width: Math.round(size.width * ratio), height: Math.round(size.height * ratio), quality: 'good' });
      } else {
        compressed = img;
      }
      const jpegBuf = compressed.toJPEG(85);
      const name = crypto.randomBytes(8).toString('hex') + '.jpg';
      const filePath = path.join(imagesDir, name);
      await fs.promises.writeFile(filePath, jpegBuf);
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('nyeli-delete-images', async (event, paths) => {
    try {
      await Promise.all(paths.map(p => fs.promises.unlink(p).catch(() => { })));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('nyeli-cancel', async () => {
    currentRunId++;
    if (agent) {
      try { agent.cancel(); } catch (_) { }
      await runLock;
      try { agent.clearHistory(); } catch (_) { }
    }
    return { ok: true };
  });

  ipcMain.on('nyeli-clear', async () => {
    await runLock;
    if (agent) { try { agent.clearHistory(); } catch (_) { } }
  });

  ipcMain.on('nyeli-shutdown', () => {
    if (agent) { try { agent.shutdown(); } catch (_) { } }
    agent = null;
  });
}

module.exports = { initNyeliBridge };