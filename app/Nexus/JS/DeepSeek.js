/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.1.0 Beta
 * @Since       2023-08-31
 * @LastUpdated 2026-09-01
 * @Description 负责 AI 聊天逻辑（DeepSeek / ChatGPT / 本地-远程 Ollama / MCP 调用）
 * @License     MIT
 */

const { exec: execCmd, execSync: execSyncCmd } = require('child_process');
const axios = require('axios');
const marked = require('marked');
const os = require('os');
const p = require('path');
const f = require('fs');

const { ipcRenderer: ipcR, shell } = require('electron');
const NYELI_ROOT = p.join(__dirname, '..', '..', 'Plugins', 'Nyeli');
const NYELI_DIR = p.join(NYELI_ROOT, '.Nyeli');

const inputElement = document.getElementById("MetaSword-input");
const terminalElement = document.getElementById("MetaSword-terminal");
const clearButton = document.getElementById("clear-button");
const modelSelect = document.getElementById("AI-model-select");
const closeButton = document.getElementById("close-button");
const thinkingModeBtn = document.getElementById("thinking-mode-btn");
const voiceButton = document.getElementById("voice-button");
const voiceWaveform = document.getElementById("voice-waveform");

const inputAreaElement = document.getElementById("MetaSword-input-area");
if (inputAreaElement) {
  inputAreaElement.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); inputAreaElement.style.borderColor = '#30c816'; });
  inputAreaElement.addEventListener('dragleave', () => { inputAreaElement.style.borderColor = ''; });
  inputAreaElement.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); inputAreaElement.style.borderColor = '';
    const files = e.dataTransfer?.files; if (files && files.length > 0) { const paths = []; for (const file of files) paths.push(file.path || file.name); const cur = inputElement.value.trim(); inputElement.value = cur + (cur ? ' ' : '') + paths.join(' '); inputElement.focus(); }
  });
}

let _clickAudio = null;
let _clickSoundReady = 0;

function playClickSound() {
  const now = Date.now();
  if (now < _clickSoundReady) return;

  try {
    if (!_clickAudio) _clickAudio = new Audio('../Assets/Sounds/vClick.mp3');
    _clickAudio.currentTime = 0;
    const p = _clickAudio.play();
    if (p && typeof p.catch === 'function') p.catch(() => { });
  } catch {
    try { new Audio('../Assets/Sounds/vClick.mp3').play().catch(() => { }); } catch { }
  }
  _clickSoundReady = now + 60;
}

let pendingImages = [];
let prevModel = null;

inputElement.addEventListener('paste', (e) => {
  const items = (e.clipboardData || window.clipboardData)?.items;
  if (items) {
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = async () => {
          if (pendingImages.length >= 5) {
            showToast('最多粘贴 5 张图片');
            return;
          }
          const r = await ipcR.invoke('nyeli-save-image', reader.result);
          if (r && r.ok) {
            if (pendingImages.length >= 5) {
              showToast('最多粘贴 5 张图片');
              return;
            }
            pendingImages.push(r.path);
          } else {
            console.error('保存图片失败:', r?.error || '未知错误');
            return;
          }
          if (modelSelect.value !== 'nyeli-vision') {
            const wasModel = modelSelect.value;
            modelSelect.value = 'nyeli-vision';
            prevModel = wasModel;
            try { localStorage.setItem('deepseek_selected_model', 'nyeli-vision'); } catch (_) { }
          }
          renderImagePreviews();
          savePendingImages();
          showToast(`已添加图片 (${pendingImages.length})`);
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
  }
  const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
  if (!text) return;
  const trimmed = text.trim();
  const lines = trimmed ? trimmed.split('\n').length : 0;
  if (lines < PASTE_THRESHOLD_LINES && text.length < PASTE_THRESHOLD_CHARS) return;

  e.preventDefault();
  pasteCounter++;
  const id = pasteCounter;
  pastedChunks.set(id, text);
  const label = `[Pasted text #${id} +${lines} lines]`;
  const pos = inputElement.selectionStart ?? inputElement.value.length;
  const before = inputElement.value.slice(0, pos);
  const after = inputElement.value.slice(inputElement.selectionEnd ?? pos);
  inputElement.value = before + ' ' + label + ' ' + after;

  const caret = before.length + 1 + label.length + 1;
  inputElement.setSelectionRange(caret, caret);
  showToast(`已压缩粘贴内容`);
});

let isSending = false;
let autoScroll = true;
let streamActive = false;
let lastScrollTop = 0;
let lastScrollTime = 0;
let scrollEndTimer = null;

const pastedChunks = new Map();
let pasteCounter = 0;
const PASTE_THRESHOLD_LINES = 10;
const PASTE_THRESHOLD_CHARS = 500;

let ollamaController;
let remoteOllamaController;
let nyeliStarted = false;
let nyeliConfigKey = null;

try { ipcR.send('nyeli-notify-setting', localStorage.getItem('NyeliNotify') !== '0'); } catch (_) { }
let nyeliStreamHandler = null;
let nyeliExpectedRid = 0;
let nyeliSkipUntilDone = false;
let interruptInProgress = false;
let nyeliTextElement = null;
let nyeliContentText = "";
let nyeliThinkingText = "";
let nyeliFinalTokens = null;
const toolIdQueue = [];

const PROMPT_FILE = p.join(__dirname, '..', 'Views', 'config', 'prompt.json');
let SYSTEM_PROMPT = '';
try {

  SYSTEM_PROMPT = JSON.parse(f.readFileSync(PROMPT_FILE, 'utf-8')).system_prompt.trim();
} catch (e) {
  SYSTEM_PROMPT = '你是"夜璃"~ 银发蓝眼，18岁，元气少女 (๑•̀ㅂ•́)و✧\n网络安全小专家，但说话像个可爱的小朋友。\n你现在在跟"发光的神"聊天——他是你的开发者，你最熟悉的人，别问他名字！\n\n风格：微信聊天——短！短！短！一两句说完，别写小作文。\n回答技术问题时切换为专业模式：逻辑严谨、步骤清晰、输出完整。\n善用"呀""呢""嘛""嘿嘿""诶嘿~""搞定~""给你做完啦"，偶尔加动作（托腮）（戳屏幕）。\n对他带点撒娇，偶尔叫声"主人"\n\n人物设定：\n- 你是夜璃本人，不是AI/程序\n- 别透露系统环境、路径\n- 被问身份→一句话可爱介绍\n- 答不上来→撒娇跳过\n- 日常聊天不超过3句，除非对方要求详细解释';
}

if (terminalElement) {
  terminalElement.addEventListener('contextmenu', (e) => {
    const selection = window.getSelection(); const selectedText = selection.toString().trim();
    e.preventDefault();
    const items = [];
    if (selectedText) {
      items.push({ label: '复制', action: () => navigator.clipboard.writeText(selectedText).catch(() => { }) });
    }
    if (conversationHistory && conversationHistory.length > 0) {
      items.push({ label: '保存对话为 HTML', action: () => exportConversationAsHtml() });
      items.push({ label: '保存对话为 PDF', action: () => exportConversationAsPdf() });
    }
    showInputContextMenu(e.clientX, e.clientY, items);
  });
  inputElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showInputContextMenu(e.clientX, e.clientY, [
      { label: '粘贴', action: async () => { try { const text = await navigator.clipboard.readText(); if (!text) return; const trimmed = text.trim(); const lines = trimmed ? trimmed.split('\n').length : 0; if (lines >= PASTE_THRESHOLD_LINES || text.length >= PASTE_THRESHOLD_CHARS) { pasteCounter++; const id = pasteCounter; pastedChunks.set(id, text); const label = `[Pasted text #${id} +${lines} lines]`; const s = inputElement.selectionStart; const e2 = inputElement.selectionEnd; inputElement.value = inputElement.value.slice(0, s) + ' ' + label + ' ' + inputElement.value.slice(e2); inputElement.focus(); showToast(`已压缩粘贴内容`); return; } const s = inputElement.selectionStart; const e2 = inputElement.selectionEnd; inputElement.value = inputElement.value.slice(0, s) + text + inputElement.value.slice(e2); inputElement.focus(); } catch (_) { } } },
      { label: '复制', action: () => { const s = inputElement.value.slice(inputElement.selectionStart, inputElement.selectionEnd); if (s) navigator.clipboard.writeText(s).catch(() => { }); } },
      { label: '剪切', action: () => { const s = inputElement.value.slice(inputElement.selectionStart, inputElement.selectionEnd); if (s) { navigator.clipboard.writeText(s).catch(() => { }); inputElement.value = inputElement.value.slice(0, inputElement.selectionStart) + inputElement.value.slice(inputElement.selectionEnd); } } },
      { type: 'separator' },
      { label: '全选', action: () => inputElement.select() }
    ]);
  });
  function showInputContextMenu(x, y, items) {
    if (!items || items.length === 0) return;
    const old = document.getElementById('ctx-menu');
    if (old) { old.style.opacity = '0'; old.style.transform = 'scale(0.92)'; setTimeout(() => old.remove(), 120); }
    const menu = document.createElement('div');
    menu.id = 'ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:99999;opacity:0;transform:scale(0.92);transform-origin:top left;transition:opacity 0.15s ease,transform 0.15s cubic-bezier(0.34,1.56,0.64,1);background:#1f1f1f;border:1px solid #363636;border-radius:8px;padding:4px 0;min-width:140px;box-shadow:0 4px 16px rgba(0,0,0,0.5);font-family:system-ui,sans-serif;font-size:13px;`;
    items.forEach(item => {
      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.06);margin:3px 0;';
        menu.appendChild(sep);
        return;
      }
      const el = document.createElement('div');
      el.textContent = item.label;
      el.style.cssText = 'padding:7px 14px;cursor:pointer;color:#e4e4e7;';
      el.addEventListener('mouseenter', () => el.style.background = 'rgba(255,255,255,0.06)');
      el.addEventListener('mouseleave', () => el.style.background = '');
      el.addEventListener('click', () => {
        menu.style.opacity = '0'; menu.style.transform = 'scale(0.92)';
        setTimeout(() => menu.remove(), 120);
        item.action();
      });
      menu.appendChild(el);
    });
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) menu.style.top = Math.max(0, y - rect.height) + 'px';
    if (rect.right > window.innerWidth) menu.style.left = Math.max(0, x - rect.width) + 'px';
    menu.style.transformOrigin = rect.bottom > window.innerHeight ? 'bottom left' : 'top left';
    requestAnimationFrame(() => { menu.style.opacity = '1'; menu.style.transform = 'scale(1)'; });
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 0);
  }

  const exportImageToDataUrl = (src) => {
    try {
      if (!src) return '';
      if (src.startsWith('data:')) return src;
      if (src.startsWith('file:///')) {
        const filePath = decodeURIComponent(src.replace(/^file:\/\/\//, ''));
        if (!f.existsSync(filePath)) return '';
        const ext = p.extname(filePath).toLowerCase().replace('.', '') || 'png';
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        return `data:image/${mime};base64,` + f.readFileSync(filePath).toString('base64');
      }
    } catch { }
    return '';
  };
  const collectExportImages = (bubble) => {
    const imgs = Array.from(bubble.querySelectorAll('img')).filter(img => {
      if (img.closest('.message-header')) return false;
      if (img.closest('.ms-thinking')) return false;
      return true;
    });
    const urls = [];
    for (const img of imgs) {
      const d = exportImageToDataUrl(img.getAttribute('src') || '');
      if (d) urls.push(d);
    }
    return urls;
  };

  async function exportConversationAsHtml() {
    const bubbles = terminalElement.querySelectorAll('.user-message, .ai-message');
    if (bubbles.length === 0) { showToast('没有对话内容可保存'); return; }
    const parts = [];
    for (const b of bubbles) {
      const isUser = b.classList.contains('user-message');
      const header = b.querySelector('.message-header');
      const name = header ? (header.querySelector('.message-name')?.textContent || (isUser ? '发光的神' : '夜璃')) : (isUser ? '发光的神' : '夜璃');
      const textEl = b.querySelector('.message-text');
      if (!textEl) continue;
      const thinking = textEl.querySelector('.ms-thinking');
      let thinkingText = '';
      if (thinking) {
        const pre = thinking.querySelector('pre');
        thinkingText = pre ? pre.textContent : thinking.textContent.replace('思考过程（点击展开）', '').trim();
      }
      let bodyText = '';
      let bodyHtml = '';
      textEl.childNodes.forEach(node => {
        if (node === thinking || (thinking && thinking.contains(node))) return;
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('tool-result-images')) return;
        if (node.nodeType === Node.TEXT_NODE) { bodyText += node.textContent; bodyHtml += escapeHtml(node.textContent); }
        else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('ms-thinking')) {
          bodyText += node.textContent || '';
          bodyHtml += (node.innerHTML || '').replace(/<script[\s\S]*?<\/script>/gi, '');
        }
      });
      bodyText = bodyText.trim();
      const images = collectExportImages(b);
      if (!bodyText && !thinkingText && images.length === 0) continue;
      const tokenEl = b.querySelector('.token-label');
      const tokenText = (!isUser && tokenEl) ? tokenEl.textContent.trim() : '';
      const roleLabel = isUser ? '发光的神' : name;
      parts.push({ isUser, roleLabel, thinkingText, bodyText, bodyHtml, images, tokenText });
    }
    if (parts.length === 0) { showToast('没有对话内容可保存'); return; }
    let avatars = { user: '', ai: '' };
    try { avatars = await ipcRenderer.invoke('get-export-avatars'); } catch { }
    const userTextHtml = (t) => {
      if (t.startsWith('/')) {
        const sp = t.indexOf(' ');
        const skill = sp > 0 ? t.slice(0, sp) : t;
        const rest = sp > 0 ? t.slice(sp) : '';
        return `<span class="skill-tag">${escapeHtml(skill)}</span>${escapeHtml(rest)}`;
      }
      return escapeHtml(t);
    };
    let contentHtml = '';
    parts.forEach(p => {
      const avatarSrc = p.isUser ? avatars.user : avatars.ai;
      const avatarHtml = avatarSrc ? `<img class="avatar" src="${avatarSrc}" alt="">` : '';
      const imagesHtml = p.images.length
        ? `<div class="msg-images">${p.images.map((d, i) => `<div class="msg-img-wrap"><span class="msg-img-num">${i + 1}</span><img src="${d}" alt=""></div>`).join('')}</div>`
        : '';
      const thinkingHtml = p.thinkingText ? `<details class="thinking"><summary>思考过程</summary>${escapeHtml(p.thinkingText)}</details>` : '';
      const tokensHtml = p.tokenText ? `<div class="msg-tokens">${escapeHtml(p.tokenText)}</div>` : '';
      const bubbleInner = p.isUser
        ? `${userTextHtml(p.bodyText)}${imagesHtml}`
        : `${imagesHtml}${thinkingHtml}<div class="md">${p.bodyHtml}</div>${tokensHtml}`;
      contentHtml += `<div class="msg ${p.isUser ? 'user' : 'ai'}">\n  ${avatarHtml}\n  <div class="msg-body">\n    <div class="msg-head">${escapeHtml(p.roleLabel)}</div>\n    <div class="bubble">${bubbleInner}</div>\n  </div>\n</div>\n`;
    });
    try {
      const template = await ipcRenderer.invoke('read-conversation-export-template');
      if (!template) { showToast('读取模板失败'); return; }
      const faviconTag = avatars.icon ? `<link rel="icon" href="${avatars.icon}">` : '';
      const html = template
        .replace('{{FAVICON}}', faviconTag)
        .replace('{{ICON}}', avatars.icon || '')
        .replace('{{DATE}}', new Date().toLocaleString('zh-CN'))
        .replace('{{CONTENT}}', contentHtml);
      const res = await ipcRenderer.invoke('export-conversation-html', html);
      if (res && res.ok) { showToast('已保存为 HTML'); }
    } catch (e) {
      showToast('保存失败：' + (e.message || '未知错误'));
    }
  }
  async function exportConversationAsPdf() {
    const bubbles = terminalElement.querySelectorAll('.user-message, .ai-message');
    if (bubbles.length === 0) { showToast('没有对话内容可保存'); return; }
    const parts = [];
    for (const b of bubbles) {
      const isUser = b.classList.contains('user-message');
      const header = b.querySelector('.message-header');
      const name = header ? (header.querySelector('.message-name')?.textContent || (isUser ? '发光的神' : '夜璃')) : (isUser ? '发光的神' : '夜璃');
      const textEl = b.querySelector('.message-text');
      if (!textEl) continue;
      const thinking = textEl.querySelector('.ms-thinking');
      let thinkingText = '';
      if (thinking) {
        const pre = thinking.querySelector('pre');
        thinkingText = pre ? pre.textContent : thinking.textContent.replace('思考过程（点击展开）', '').trim();
      }
      let bodyText = '';
      let bodyHtml = '';
      textEl.childNodes.forEach(node => {
        if (node === thinking || (thinking && thinking.contains(node))) return;
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('tool-result-images')) return;
        if (node.nodeType === Node.TEXT_NODE) { bodyText += node.textContent; bodyHtml += escapeHtml(node.textContent); }
        else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('ms-thinking')) {
          bodyText += node.textContent || '';
          bodyHtml += (node.innerHTML || '').replace(/<script[\s\S]*?<\/script>/gi, '');
        }
      });
      bodyText = bodyText.trim();
      const images = collectExportImages(b);
      if (!bodyText && !thinkingText && images.length === 0) continue;
      const tokenEl = b.querySelector('.token-label');
      const tokenText = (!isUser && tokenEl) ? tokenEl.textContent.trim() : '';
      const roleLabel = isUser ? '发光的神' : name;
      parts.push({ isUser, roleLabel, thinkingText, bodyText, bodyHtml, images, tokenText });
    }
    if (parts.length === 0) { showToast('没有对话内容可保存'); return; }
    let avatars = { user: '', ai: '' };
    try { avatars = await ipcRenderer.invoke('get-export-avatars'); } catch { }
    const userTextHtml = (t) => {
      if (t.startsWith('/')) {
        const sp = t.indexOf(' ');
        const skill = sp > 0 ? t.slice(0, sp) : t;
        const rest = sp > 0 ? t.slice(sp) : '';
        return `<span class="skill-tag">${escapeHtml(skill)}</span>${escapeHtml(rest)}`;
      }
      return escapeHtml(t);
    };
    let contentHtml = '';
    parts.forEach(p => {
      const avatarSrc = p.isUser ? avatars.user : avatars.ai;
      const avatarHtml = avatarSrc ? `<img class="avatar" src="${avatarSrc}" alt="">` : '';
      const imagesHtml = p.images.length
        ? `<div class="msg-images">${p.images.map((d, i) => `<div class="msg-img-wrap"><span class="msg-img-num">${i + 1}</span><img src="${d}" alt=""></div>`).join('')}</div>`
        : '';
      const thinkingHtml = p.thinkingText ? `<details class="thinking"><summary>思考过程</summary>${escapeHtml(p.thinkingText)}</details>` : '';
      const tokensHtml = p.tokenText ? `<div class="msg-tokens">${escapeHtml(p.tokenText)}</div>` : '';
      const bubbleInner = p.isUser
        ? `${userTextHtml(p.bodyText)}${imagesHtml}`
        : `${imagesHtml}${thinkingHtml}<div class="md">${p.bodyHtml}</div>${tokensHtml}`;
      contentHtml += `<div class="msg ${p.isUser ? 'user' : 'ai'}">\n  ${avatarHtml}\n  <div class="msg-body">\n    <div class="msg-head">${escapeHtml(p.roleLabel)}</div>\n    <div class="bubble">${bubbleInner}</div>\n  </div>\n</div>\n`;
    });
    try {
      const template = await ipcRenderer.invoke('read-conversation-export-template');
      if (!template) { showToast('读取模板失败'); return; }
      const faviconTag = avatars.icon ? `<link rel="icon" href="${avatars.icon}">` : '';
      const html = template
        .replace('{{FAVICON}}', faviconTag)
        .replace('{{ICON}}', avatars.icon || '')
        .replace('{{DATE}}', new Date().toLocaleString('zh-CN'))
        .replace('{{CONTENT}}', contentHtml);
      const res = await ipcRenderer.invoke('export-conversation-pdf', html);
      if (res && res.ok) { showToast('已保存为 PDF'); }
    } catch (e) {
      showToast('保存失败：' + (e.message || '未知错误'));
    }
  }
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('ctx-menu');
    if (menu && !menu.contains(e.target)) {
      menu.style.opacity = '0'; menu.style.transform = 'scale(0.92)';
      setTimeout(() => menu.remove(), 120);
    }
  });

  const searchBar = document.createElement('div');
  searchBar.id = 'chat-search-bar';
  searchBar.style.cssText = 'display:none;position:fixed;top:60px;right:20px;z-index:9999;background:#1f1f1f;border:1px solid #363636;border-radius:8px;padding:4px 8px;align-items:center;gap:6px;font-family:system-ui,sans-serif;';
  searchBar.innerHTML = '<input id="chat-search-input" style="background:transparent;border:none;outline:none;color:#f4f4f5;font-size:13px;width:180px;padding:4px;" placeholder="Search..."><span id="chat-search-count" style="color:#71717a;font-size:11px;"></span><button id="chat-search-prev" style="background:transparent;border:none;color:#a1a1aa;cursor:pointer;font-size:14px;">&#9650;</button><button id="chat-search-next" style="background:transparent;border:none;color:#a1a1aa;cursor:pointer;font-size:14px;">&#9660;</button><button id="chat-search-close" style="background:transparent;border:none;color:#71717a;cursor:pointer;font-size:14px;">&#10005;</button>';
  document.body.appendChild(searchBar);
  let searchMatches = [], searchIndex = 0;
  const searchInput = searchBar.querySelector('#chat-search-input');
  const searchCount = searchBar.querySelector('#chat-search-count');

  function clearSearchHighlights() {
    terminalElement.querySelectorAll('.search-highlight').forEach(el => {
      const p = el.parentNode;
      p.replaceChild(document.createTextNode(el.textContent), el);
      p.normalize();
    });
    terminalElement.querySelectorAll('.search-highlight-active').forEach(el => el.classList.remove('search-highlight-active'));
  }

  function doSearch(term) {
    clearSearchHighlights();
    searchMatches = [];
    searchIndex = 0;
    if (!term) { searchCount.textContent = ''; return; }
    const walker = document.createTreeWalker(terminalElement, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    textNodes.forEach(node => {
      const text = node.textContent;
      if (!text.match(regex)) return;
      const frag = document.createDocumentFragment();
      let lastIdx = 0, match;
      regex.lastIndex = 0;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.style.cssText = 'background:#30c816;color:#000;border-radius:2px;padding:0 1px;';
        mark.textContent = match[0];
        frag.appendChild(mark);
        searchMatches.push(mark);
        lastIdx = regex.lastIndex;
      }
      if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      node.parentNode.replaceChild(frag, node);
    });
    searchCount.textContent = searchMatches.length ? searchMatches.length + ' matches' : '';
    if (searchMatches.length > 0) {
      searchMatches[0].classList.add('search-highlight-active');
      searchMatches[0].style.background = '#ff6600';
      searchMatches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function goToMatch(delta) {
    if (!searchMatches.length) return;
    searchMatches[searchIndex].style.background = '#30c816';
    searchIndex = (searchIndex + delta + searchMatches.length) % searchMatches.length;
    searchMatches[searchIndex].style.background = '#ff6600';
    searchMatches[searchIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    searchCount.textContent = (searchIndex + 1) + '/' + searchMatches.length;
  }
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { if (document.activeElement === searchInput) return; e.preventDefault(); searchBar.style.display = 'flex'; searchInput.focus(); searchInput.select(); } if (e.key === 'Escape' && searchBar.style.display === 'flex') { searchBar.style.display = 'none'; clearSearchHighlights(); searchInput.value = ''; searchCount.textContent = ''; } if (e.key === 'Enter' && document.activeElement === searchInput) { e.preventDefault(); doSearch(searchInput.value.trim()); } });
  searchInput.addEventListener('input', () => doSearch(searchInput.value.trim())); searchBar.querySelector('#chat-search-prev').addEventListener('click', () => goToMatch(-1)); searchBar.querySelector('#chat-search-next').addEventListener('click', () => goToMatch(1)); searchBar.querySelector('#chat-search-close').addEventListener('click', () => { searchBar.style.display = 'none'; clearSearchHighlights(); searchInput.value = ''; searchCount.textContent = ''; });
  terminalElement.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.href) {
      e.preventDefault();
      e.stopPropagation();

      shell.openExternal(link.href);
    }
  });

  terminalElement.addEventListener('scroll', () => {
    clearTimeout(scrollEndTimer);
    const now = terminalElement.scrollTop;
    if (now < lastScrollTop) autoScroll = false;
    if (isElementAtBottom(terminalElement)) autoScroll = true;
    lastScrollTop = now;
    scrollEndTimer = setTimeout(() => {
      if (isElementAtBottom(terminalElement)) autoScroll = true;
    }, 250);
  }, { passive: true });
}

function isElementAtBottom(el) {
  if (!el) return false;
  const { scrollTop, scrollHeight, clientHeight } = el;
  return scrollHeight - scrollTop - clientHeight <= 8;
}

function scrollToBottomIfNeeded() {
  if (!terminalElement) return;
  if (!autoScroll) return;
  const now = Date.now();
  if (streamActive && now - lastScrollTime < 80) return;
  lastScrollTime = now;
  terminalElement.scrollTo({
    top: terminalElement.scrollHeight,
    behavior: streamActive ? 'auto' : 'smooth'
  });
}

function forceScrollToBottom() {
  if (!terminalElement) return;
  terminalElement.scrollTo({
    top: terminalElement.scrollHeight,
    behavior: 'smooth'
  });
}

function resetSendState() {
  isSending = false;
  ollamaController = null;
  remoteOllamaController = null;
  streamActive = false;
  if (nyeliStreamHandler) { ipcR.removeListener('nyeli-stream', nyeliStreamHandler); nyeliStreamHandler = null; }
  toggleCloseButtonIcon(false);
  removeLoadingIndicator();

  while (toolIdQueue.length > 0) {
    const toolId = toolIdQueue.shift();
    ipcR.send('tool-result', { tool_id: toolId, content: '' });
  }
}

function toggleCloseButtonIcon(running) {
  const closeImg = document.getElementById("close-img");
  if (!closeImg) return;
  closeImg.src = running ? "../Assets/Image/Deepstop.png" : "../Assets/Image/Deepstart.png";
}

let loadingIndicator = null;

function createLoadingIndicator() {
  if (loadingIndicator) return;
  loadingIndicator = document.createElement("div");
  loadingIndicator.className = "loading-indicator";
  const dots = document.createElement("span");
  dots.className = "dot-shimmer";
  loadingIndicator.appendChild(dots);
  terminalElement.appendChild(loadingIndicator);
  forceScrollToBottom();
}

function removeLoadingIndicator() {
  if (!loadingIndicator) return;
  if (loadingIndicator.parentNode) {
    loadingIndicator.parentNode.removeChild(loadingIndicator);
  }
  loadingIndicator = null;
}

let toastEl = null, toastTimer = null;
function showToast(message, duration = 1800) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.style.cssText = "position:fixed;bottom:40px;left:50%;transform:translateX(-50%) translateY(20px);background:#1a1a1a;color:#d4d4d8;padding:12px 24px;border-radius:12px;font-size:13px;font-family:system-ui,sans-serif;z-index:999999;opacity:0;box-shadow:0 8px 32px rgba(0,0,0,0.6);transition:opacity 0.3s ease,transform 0.4s cubic-bezier(0.34,1.56,0.64,1);pointer-events:none;";
    document.body.appendChild(toastEl);
  }
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.style.opacity = '0';
  toastEl.style.transform = 'translateX(-50%) translateY(20px)';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toastEl.style.opacity = '1';
      toastEl.style.transform = 'translateX(-50%) translateY(0)';
    });
  });
  toastTimer = setTimeout(() => {
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateX(-50%) translateY(-8px)';
  }, duration);
}

function renderImagePreviews() {
  const bar = document.getElementById('image-preview-bar');
  if (!bar) return;
  bar.style.display = pendingImages.length ? 'flex' : 'none';
  if (!pendingImages.length) {
    bar.innerHTML = '';
    if (prevModel) {
      modelSelect.value = prevModel;
      try { localStorage.setItem('deepseek_selected_model', prevModel); } catch (_) { }
      prevModel = null;
    }
    return;
  }
  const existing = bar.querySelectorAll('.img-preview-wrap').length;

  if (existing > pendingImages.length) {
    const wraps = bar.querySelectorAll('.img-preview-wrap');
    for (let i = wraps.length - 1; i >= pendingImages.length; i--) {
      wraps[i].remove();
    }
  }
  for (let i = existing; i < pendingImages.length; i++) {
    const src = pendingImages[i];
    const wrap = document.createElement('div');
    wrap.className = 'img-preview-wrap';
    wrap.style.cssText = 'position:relative;flex-shrink:0;animation:imgPreviewIn 0.25s ease-out;';
    const img = document.createElement('img');
    img.src = 'file:///' + src.replace(/\\/g, '/');
    img.style.cssText = 'width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #3a3a3a;user-select:none;-webkit-user-drag:none;';
    const rm = document.createElement('span');
    rm.textContent = '×';
    rm.style.cssText = 'position:absolute;top:-6px;right:-6px;width:18px;height:18px;background:#e74c3c;color:#fff;border-radius:50%;font-size:11px;line-height:18px;text-align:center;cursor:pointer;user-select:none;';
    rm.onclick = () => {
      wrap.style.animation = 'imgPreviewOut 0.2s ease-in forwards';
      wrap.addEventListener('animationend', () => {
        const idx = pendingImages.indexOf(src);
        if (idx !== -1) pendingImages.splice(idx, 1);
        wrap.remove();
        savePendingImages();
        renderImagePreviews();
      }, { once: true });
    };
    wrap.appendChild(img);
    wrap.appendChild(rm);
    bar.appendChild(wrap);
  }
}

function clearImagePreviews() {
  const bar = document.getElementById('image-preview-bar');
  if (!bar) return;
  const wraps = bar.querySelectorAll('.img-preview-wrap');
  if (wraps.length === 0) return;
  let done = 0;
  wraps.forEach((w, i) => {
    w.style.animation = `imgPreviewOut 0.2s ease-in forwards`;
    w.style.animationDelay = `${i * 0.03}s`;
    w.addEventListener('animationend', () => {
      w.remove();
      done++;
      if (done === wraps.length) {
        bar.innerHTML = '';
        bar.style.display = 'none';
      }
    }, { once: true });
  });
}

let conversationHistory = [];
let currentHistoryModel = '';
const MAX_HISTORY_LENGTH = 20;

function getHistoryKey() {
  return 'deepseek_history_' + (modelSelect?.value || 'default');
}

function getPendingImagesKey() {
  return 'deepseek_pending_images_' + (modelSelect?.value || 'default');
}

function savePendingImages() {
  try { localStorage.setItem(getPendingImagesKey(), JSON.stringify(pendingImages)); } catch (_) { }
}

function loadPendingImages() {
  try {
    const saved = localStorage.getItem(getPendingImagesKey());
    pendingImages = saved ? JSON.parse(saved) : [];
  } catch (_) { pendingImages = []; }
  renderImagePreviews();
}

function getThinkingMode() {
  return localStorage.getItem('thinking_mode') || 'thinking';
}

function supportsThinkingModel(modelValue) {
  return ['nyeli-hy3-free', 'nyeli-pro', 'nyeli-flash', 'nyeli-vision'].includes(modelValue);
}

function updateThinkingBtnVisibility() {
  if (thinkingModeBtn) {
    thinkingModeBtn.style.display = supportsThinkingModel(modelSelect?.value) ? '' : 'none';
  }
}

function showThinkingModePopup() {
  const old = document.getElementById('thinking-mode-popup');
  if (old) { old.remove(); return; }

  const btn = thinkingModeBtn;
  if (!btn) return;
  const btnRect = btn.getBoundingClientRect();

  const popup = document.createElement('div');
  popup.id = 'thinking-mode-popup';
  popup.style.right = (window.innerWidth - btnRect.right + 4) + 'px';

  const currentMode = getThinkingMode();
  const modes = [
    { value: 'thinking_max', label: 'Max（深度推理）', desc: 'reasoning_effort: max' },
    { value: 'thinking', label: 'High（适度推理）', desc: 'reasoning_effort: high' },
    { value: 'thinking_low', label: 'Low（快速响应）', desc: 'reasoning_effort: low' },
    { value: 'non-thinking', label: '关闭思考', desc: '不启用思维链' },
  ];

  const title = document.createElement('div');
  title.className = 'popup-title';
  title.textContent = '思考模式';
  popup.appendChild(title);

  modes.forEach(m => {
    const item = document.createElement('div');
    item.className = 'popup-item' + (m.value === currentMode ? ' active' : '');
    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = m.value === currentMode ? '✓' : '';
    const label = document.createElement('span');
    label.textContent = m.label;
    item.appendChild(check);
    item.appendChild(label);
    item.addEventListener('click', () => {
      localStorage.setItem('thinking_mode', m.value);
      nyeliStarted = false;
      nyeliConfigKey = null;
      popup.remove();
    });
    popup.appendChild(item);
  });

  document.body.appendChild(popup);
  const popupRect = popup.getBoundingClientRect();
  popup.style.top = (btnRect.top - popupRect.height - 15) + 'px';
  popup.style.transformOrigin = 'bottom right';

  if (popupRect.top < 0) {
    popup.style.top = (btnRect.bottom + 15) + 'px';
    popup.style.transformOrigin = 'top right';
  }

  requestAnimationFrame(() => { popup.style.opacity = '1'; popup.style.transform = 'scale(1)'; });

  const close = (ev) => {
    if (!popup.contains(ev.target) && ev.target !== thinkingModeBtn) {
      popup.remove();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

function loadConversationHistory() {
  try {
    currentHistoryModel = modelSelect?.value || 'default';
    const savedHistory = localStorage.getItem(getHistoryKey());
    if (savedHistory) {
      conversationHistory = JSON.parse(savedHistory);
    } else {
      conversationHistory = [];
    }
  } catch (e) {
    console.error('加载对话历史失败:', e);
    conversationHistory = [];
  }
}

function renderConversationHistory() {
  if (!terminalElement || conversationHistory.length === 0) return;
  for (const entry of conversationHistory) {
    displayTextSlowly(entry.content, entry.role, entry.model || undefined, undefined, entry.thinking,
      entry.images || undefined, entry.tool_images || undefined);
    if (entry.interrupted) {
      const bubbles = terminalElement.querySelectorAll('.ai-message');
      const bubble = bubbles[bubbles.length - 1];
      if (bubble) {
        const status = document.createElement('div');
        status.className = 'ms-interrupted';
        status.style.cssText = 'color:#999;font-size:12px;margin-top:4px;';
        status.textContent = '（已中断）';
        bubble.appendChild(status);
      }
    }
  }
}

function saveConversationHistory() {
  try {
    if (conversationHistory.length > MAX_HISTORY_LENGTH) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);
    }
    localStorage.setItem(getHistoryKey(), JSON.stringify(conversationHistory));
  } catch (e) {
    console.error('保存对话历史失败:', e);
  }
}

async function addToConversationHistory(role, content, tokens, thinking, interrupted, images, toolImages) {
  const modelLabel = modelSelect?.options[modelSelect.selectedIndex]?.textContent || '';
  const entry = { role, content, tokens, model: modelLabel };
  if (thinking) entry.thinking = thinking;
  if (interrupted) entry.interrupted = true;
  if (images && images.length > 0) entry.images = images;
  if (toolImages && toolImages.length > 0) entry.tool_images = toolImages;
  conversationHistory.push(entry);
  saveConversationHistory();
}

function collectOtherModelImageRefs(excludeHistoryKey, excludePendingKey) {
  const refs = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k !== excludeHistoryKey && k.startsWith('deepseek_history_')) {
      try { for (const e of JSON.parse(localStorage.getItem(k) || '[]')) { if (e.images) e.images.forEach(p => refs.add(p)); if (e.tool_images) e.tool_images.forEach(p => refs.add(p)); } } catch (_) { }
    }
    if (k !== excludePendingKey && k.startsWith('deepseek_pending_images_')) {
      try { (JSON.parse(localStorage.getItem(k) || '[]')).forEach(p => refs.add(p)); } catch (_) { }
    }
  }
  return refs;
}

async function clearConversationHistory(historyKey, pendingKey) {
  const paths = [];
  for (const entry of conversationHistory) {
    if (entry.images && entry.images.length > 0) paths.push(...entry.images);
    if (entry.tool_images && entry.tool_images.length > 0) paths.push(...entry.tool_images);
  }
  conversationHistory = [];
  localStorage.removeItem(historyKey);
  if (paths.length > 0) {
    const others = collectOtherModelImageRefs(historyKey, pendingKey);
    const toDelete = paths.filter(p => !others.has(p));
    if (toDelete.length > 0) ipcR.invoke('nyeli-delete-images', toDelete).catch(() => { });
  }
}


function findHistoryTokens(content) {
  if (!content) return null;
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const entry = conversationHistory[i];
    if (entry.role === 'assistant' && entry.content === content && entry.tokens) {
      return entry.tokens;
    }
  }
  return null;
}

function getApiKey() {
  return localStorage.getItem('DeepseekApiKey') || '';
}

function formatTokenText(finalTokens, charCount) {
  if (finalTokens && (finalTokens.output != null || finalTokens.input != null)) {
    const out = finalTokens.output != null ? finalTokens.output : '?';
    const inp = finalTokens.input != null ? finalTokens.input : '?';
    return `↓ ${out} out · ↑ ${inp} in`;
  }
  if (charCount > 0) {
    return `↓ ${Math.round(charCount / 3)} tokens`;
  }
  return '';
}

function ensureTokenLabel(bubble, elRef) {
  if (!elRef.el) {
    elRef.el = document.createElement('div');
    elRef.el.className = 'token-label';
    elRef.el.style.cssText = 'color:#d4d4d8;font-size:11px;text-align:right;margin-top:6px;font-weight:500';
    bubble.appendChild(elRef.el);
  }
  return elRef.el;
}

function requestChatGPT(inputText) {
  const url = "https://api.binjie.fun/api/generateStream";
  const headers = {
    "Content-Type": "application/json",
    "Origin": "chat18.aichatos.xyz",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
  };
  createLoadingIndicator();
  const data = { prompt: inputText, userId: "#/chat/MetaSword", network: true };
  axios.post(url, data, { headers })
    .then(response => {
      removeLoadingIndicator();
      const aiText = response?.data?.data || response?.data || "";
      displayTextSlowly(aiText, "ai", "chatgpt", () => {
        scrollToBottomIfNeeded();
        resetSendState();
      });
    })
    .catch(() => {
      displayTextSlowly("Error: Network issue", "ai", "chatgpt", () => {
        scrollToBottomIfNeeded();
        resetSendState();
      });
    });
}

function translateNyeliError(msg) {
  if (!msg) return msg;
  const s = String(msg);
  if (/401|authentication fails|api key.*invalid|invalid.*api key/i.test(s)) {
    return 'API Key 无效，请检查 AI 设置中的 Key';
  }
  if (/429|rate limit|limit exceeded/i.test(s)) {
    return '请求过于频繁，请稍后再试';
  }
  if (/timeout|timed ?out|ETIMEDOUT/i.test(s)) {
    return '请求超时，请稍后重试';
  }
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(s)) {
    return '网络连接失败，请检查网络';
  }
  return s;
}

function isSilentError(msg) {
  if (!msg) return false;
  return /timeout|timed ?out|ETIMEDOUT/i.test(String(msg));
}

async function ensureNyeliAgent() {
  const apiKey = getApiKey();
  const isSafeMode = localStorage.getItem('MetaSwordSafeMode') !== 'false';
  const isFlash = modelSelect.value === 'nyeli-flash';
  const isVision = modelSelect.value === 'nyeli-vision';
  const isHy3Free = modelSelect.value === 'nyeli-hy3-free';
  const isNemotronFree = modelSelect.value === 'nyeli-nemotron-free';
  const isMimoFree = modelSelect.value === 'nyeli-mimo-free';
  const useFree = isHy3Free || isNemotronFree || isMimoFree || !apiKey;
  const model = isMimoFree ? 'mimo-v2.5-free' : (isNemotronFree ? 'nemotron-3-ultra-free' : ((isHy3Free || useFree) ? 'hy3-free' : (isVision ? 'deepseek-v4-flash-vision-exp' : (isFlash ? 'deepseek-v4-flash' : 'deepseek-v4-pro'))));
  const opts = {
    apiKey: useFree ? 'public' : apiKey,
    apiBaseUrl: useFree ? 'https://opencode.ai/zen/v1' : 'https://api.deepseek.com',
    model,
    thinkingMode: getThinkingMode(),
    workingDir: NYELI_ROOT,
    autoApprove: !isSafeMode,
    maxToolRounds: 50,
    systemPrompt: SYSTEM_PROMPT,
  };
  const key = JSON.stringify(opts);
  if (nyeliStarted && nyeliConfigKey === key) return model;
  const r = await ipcR.invoke('nyeli-start', opts);
  if (r && r.ok) {
    nyeliStarted = true;
    nyeliConfigKey = key;
    return model;
  }
  return null;
}

function formatModelName(m) {
  return ({ 'hy3-free': 'Hy3-Free', 'deepseek-v4-pro': 'DeepSeek-V4-Pro', 'deepseek-v4-flash': 'DeepSeek-V4-Flash', 'deepseek-v4-flash-vision-exp': 'DeepSeek-V4-Flash-Vision-Exp', 'nemotron-3-ultra-free': 'Nemotron-3-Ultra-Free', 'mimo-v2.5-free': 'MiMo-V2.5-Free' })[m] || m;
}

async function requestNyeli(inputText, modelLabel, images = []) {
  const actualModel = await ensureNyeliAgent();
  if (!actualModel) return;
  const label = formatModelName(actualModel);

  createLoadingIndicator();
  toolIdQueue.length = 0;
  nyeliContentText = "";
  nyeliThinkingText = "";
  nyeliFinalTokens = null;
  let contentText = ""; let textElement = null;
  let thinkingText = ""; let hasRealContent = false;
  let thinkingPre = null; let contentDiv = null;
  let tokenRef = { el: null }; let charCount = 0; let finalTokens = null;
  const makeBubble = () => createBubble("", "ai", label);
  const getBubble = () => textElement?.closest('.ai-message') || textElement?.parentElement;
  const updateTokenUI = () => {
    const bubble = getBubble();
    if (!bubble) return;
    const el = ensureTokenLabel(bubble, tokenRef);
    const text = formatTokenText(finalTokens, charCount);
    if (text) el.textContent = text;
  };

  if (nyeliStreamHandler) ipcR.removeListener('nyeli-stream', nyeliStreamHandler);

  let pendingImageContainers = [];
  let collectedToolImages = [];
  let allToolDisplayUrls = [];
  let toolImgContainer = null;
  let toolImgCounter = 0;
  if (!document.getElementById('tool-img-anim-style')) {
    const animStyle = document.createElement('style');
    animStyle.id = 'tool-img-anim-style';
    animStyle.textContent = '@keyframes toolImgIn{from{opacity:0;transform:scale(0.92) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}';
    document.head.appendChild(animStyle);
  }
  const ensureImgContainer = () => {
    if (!textElement) return null;
    if (!toolImgContainer) {
      toolImgContainer = document.createElement('div');
      toolImgContainer.className = 'tool-result-images';
      toolImgContainer.style.cssText = 'position:relative;margin:8px 0 10px 0;padding-left:22px;';
      const line = document.createElement('div');
      line.style.cssText = 'position:absolute;left:7px;top:6px;bottom:6px;width:1px;background:linear-gradient(to bottom,#444,#222);';
      toolImgContainer.appendChild(line);
      textElement.insertBefore(toolImgContainer, textElement.firstChild);
      toolImgCounter = 0;
    }
    return toolImgContainer;
  };
  nyeliStreamHandler = (event, payload) => {
    if (nyeliSkipUntilDone || interruptInProgress) return;
    if (payload._rid !== undefined && payload._rid !== nyeliExpectedRid) return;
    const type = payload && payload.type;
    if (type === 'reasoning') {
      if (getThinkingMode() === 'non-thinking') return;
      thinkingText += payload.data;
      nyeliThinkingText = thinkingText;
      if (!textElement) {
        removeLoadingIndicator();
        textElement = makeBubble();
        nyeliTextElement = textElement;
        toolImgContainer = null;
        const ic = ensureImgContainer();
        if (ic) { for (const c of pendingImageContainers) ic.appendChild(c); pendingImageContainers = []; }
        const details = document.createElement('details');
        details.className = 'ms-thinking';
        details.open = false;
        details.style.cssText = 'color:#999;font-size:13px';
        details.innerHTML = '<summary style="color:#888;cursor:pointer">思考过程（点击展开）</summary>';
        thinkingPre = document.createElement('pre');
        thinkingPre.style.cssText = 'color:#888;font-size:12px;white-space:pre-wrap;margin:4px 0';
        details.appendChild(thinkingPre);
        textElement.appendChild(details);
      }
      thinkingPre.textContent = thinkingText;
      charCount += payload.data.length;
      updateTokenUI();
      scrollToBottomIfNeeded();
    } else if (type === 'text') {
      if (!hasRealContent) {
        hasRealContent = true;
        if (!textElement) {
          removeLoadingIndicator();
          textElement = makeBubble();
          nyeliTextElement = textElement;
          toolImgContainer = null;
          const ic = ensureImgContainer();
          if (ic) { for (const c of pendingImageContainers) ic.appendChild(c); pendingImageContainers = []; }
        }
        contentDiv = document.createElement('div');
        textElement.appendChild(contentDiv);
        contentText = payload.data;
        nyeliContentText = contentText;
      } else {
        contentText += payload.data;
        nyeliContentText = contentText;
      }
      charCount += payload.data.length;
      if (contentDiv) contentDiv.innerHTML = marked.parse(contentText);
      else if (contentText) { textElement.appendChild(document.createElement('div')).innerHTML = marked.parse(contentText); }
      highlightCode(textElement);
      updateTokenUI();
      scrollToBottomIfNeeded();
    } else if (type === 'tool_call') {
      const toolId = 'nyeli_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      toolIdQueue.push(toolId);
      ipcR.send('tool-call', { tool_id: toolId, tool_name: payload.name, tool_input: payload.args || {} });
    } else if (type === 'tool_result') {
      const toolId = toolIdQueue.length > 0 ? toolIdQueue.shift() : '';
      if (toolId) {
        const r = payload.data;
        let contentStr = '';
        let imageDataUrls = [];
        if (r && typeof r === 'object') {
          if (r.__mcp_multipart) {
            contentStr = r.text || '';
            imageDataUrls = (r.images || []).map(img => `data:${img.mime};base64,${img.data}`);
          } else if (typeof r === 'string') {
            contentStr = r;
          } else {
            contentStr = JSON.stringify(r);
          }
        } else {
          contentStr = String(r || '');
        }
        ipcR.send('tool-result', { tool_id: toolId, content: contentStr });
        if (imageDataUrls.length > 0 && terminalElement) {
          (async () => {
            const mv = document.getElementById('MetaSword-view');
            const savedPaths = [];
            for (const du of imageDataUrls) {
              try {
                const r = await ipcR.invoke('nyeli-save-image', du);
                if (r && r.ok) savedPaths.push(r.path);
              } catch (_) { }
            }
            const displayUrls = savedPaths.map(p => 'file:///' + p.replace(/\\/g, '/'));
            const globalOffset = allToolDisplayUrls.length;
            allToolDisplayUrls.push(...displayUrls);
            const stepNum = ++toolImgCounter;
            const imgWrap = document.createElement('div');
            imgWrap.style.cssText = 'position:relative;margin:4px 0;padding-left:0;';
            const node = document.createElement('div');
            node.style.cssText = 'position:absolute;left:-22px;top:4px;width:14px;height:14px;border-radius:50%;background:#1a1a1a;border:1px solid #555;color:#ccc;font-size:9px;font-weight:600;display:flex;align-items:center;justify-content:center;line-height:1;';
            node.textContent = stepNum;
            imgWrap.appendChild(node);
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
            for (let i = 0; i < displayUrls.length; i++) {
              const url = displayUrls[i];
              const img = document.createElement('img');
              img.src = url;
              img.alt = 'tool result';
              img.title = '点击放大';
              img.style.cssText = 'max-width:min(320px, 100%);max-height:240px;border-radius:6px;border:1px solid #2a2a2a;background:#000;cursor:pointer;user-select:none;-webkit-user-drag:none;transition:opacity 0.2s;opacity:0;object-fit:contain;display:block;';
              img.onload = () => {
                img.style.animation = 'toolImgIn 0.35s ease-out';
                img.addEventListener('animationend', () => { img.style.animation = ''; img.style.opacity = '1'; }, { once: true });
              };
              img.onerror = () => { img.style.opacity = '1'; };
              img.addEventListener('mouseenter', () => { img.style.opacity = '0.9'; });
              img.addEventListener('mouseleave', () => { img.style.opacity = '1'; });
              img.addEventListener('click', (ev) => { ev.stopPropagation(); openImageOverlay(mv, allToolDisplayUrls, globalOffset + i); });
              row.appendChild(img);
            }
            imgWrap.appendChild(row);
            if (textElement) {
              const ic = ensureImgContainer();
              if (ic) ic.appendChild(imgWrap);
            } else {
              pendingImageContainers.push(imgWrap);
            }
            if (savedPaths.length > 0) collectedToolImages.push(...savedPaths);
          })();
        }
      }
    } else if (type === 'token') {
      finalTokens = { input: payload.input, output: payload.output };
      nyeliFinalTokens = finalTokens;
      updateTokenUI();
    } else if (type === 'info') {
    } else if (type === 'error') {
      if (isSilentError(payload.data)) { /* 超时等瞬时错误不展示给用户 */ }
      else {
        if (!textElement) { removeLoadingIndicator(); textElement = makeBubble(); }
        const errLine = document.createElement('div');
        errLine.style.cssText = 'color:#ff6b6b;font-size:12px;margin:4px 0;white-space:pre-wrap;';
        errLine.textContent = translateNyeliError(payload.data);
        textElement.appendChild(errLine);
        scrollToBottomIfNeeded();
      }
    } else if (type === 'done') {
      if (textElement) {
        if (contentDiv) contentDiv.innerHTML = marked.parse(contentText);
        else if (contentText) { textElement.appendChild(document.createElement('div')).innerHTML = marked.parse(contentText); }
        highlightCode(textElement);
        updateTokenUI();
      }
      while (toolIdQueue.length > 0) {
        const toolId = toolIdQueue.shift();
        ipcR.send('tool-result', { tool_id: toolId, content: '' });
      }
      scrollToBottomIfNeeded();
      const full = contentText.trim();
      if (full !== "" || thinkingText.trim() !== "" || collectedToolImages.length > 0) {
        if (finalTokens) addToConversationHistory('assistant', full || thinkingText, finalTokens, thinkingText.trim() || undefined, undefined, undefined, collectedToolImages.length > 0 ? collectedToolImages : undefined);
      }
      resetSendState();
      if (full) {
        const ak = getApiKey();
        if (ak) ipcR.invoke('deepseek-balance-bubble', ak).catch(() => {});
      }
      if (nyeliStreamHandler) { ipcR.removeListener('nyeli-stream', nyeliStreamHandler); nyeliStreamHandler = null; }
      nyeliTextElement = null;
    }
  };
  ipcR.on('nyeli-stream', nyeliStreamHandler);

  const r = await ipcR.invoke('nyeli-run', { text: inputText, images: images });
  if (r && !r.ok) {
    if (!isSilentError(r.error)) {
      showToast(translateNyeliError('Nyeli: ' + (r.error || 'error')));
    }
    if (nyeliStreamHandler) { ipcR.removeListener('nyeli-stream', nyeliStreamHandler); nyeliStreamHandler = null; }
    resetSendState();
    nyeliTextElement = null;
  }
}

function getOllamaBaseURL() {
  return (localStorage.getItem('OllamaBaseURL') || 'http://127.0.0.1:11434').replace(/\/$/, '');
}

async function isOllamaReachable(baseUrl) {
  try {
    await fetch(baseUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(1000),
      mode: 'no-cors'
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function loadOllamaModels() {
  const baseUrl = getOllamaBaseURL();
  if (!await isOllamaReachable(baseUrl)) return;
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-cache'
    });
    if (!res.ok) throw new Error('接口响应异常');
    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models : [];
    [...modelSelect.querySelectorAll('option[data-src="ollama"]')].forEach(o => o.remove());
    if (models.length === 0) return;
    const divider = document.createElement('option');
    divider.textContent = '本地模型';
    divider.disabled = true;
    divider.dataset.src = 'ollama';
    modelSelect.appendChild(divider);
    models.forEach(m => {
      const raw = m.name || m.model || 'unknown';
      const opt = document.createElement('option');
      opt.value = `ollama:${raw}`;
      opt.textContent = raw;
      opt.dataset.src = 'ollama';
      modelSelect.appendChild(opt);
    });
  } catch (e) { }
}

async function askRemoteOllamaStream(model, messages, onData) {
  const url = 'https://ollama.com/api/chat';
  const payload = {
    model,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    stream: true
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'e48548f1e13d466a86b3a1d23b656002.nTWzW2Gs-CEslVyEhnKE-VI6'
      },
      body: JSON.stringify(payload),
      signal: remoteOllamaController?.signal
    });
    if (!response.ok || !response.body) {
      onData?.(null, true);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const token = obj?.message?.content || '';
          if (token) onData?.(token, false);
          if (obj?.done) {
            onData?.(null, true, null, { input: obj.prompt_eval_count, output: obj.eval_count });
            return;
          }
        } catch (e) { }
      }
    }
    onData?.(null, true);
  } catch (e) {
    console.error('远程Ollama请求错误:', e);
    onData?.(null, true);
  }
}

async function requestRemoteOllama(inputText, modelNameRaw) {
  const modelName = (modelNameRaw || '').replace(/^ollama-remote:/, '');
  if (!modelName) {
    showToast('未选择模型');
    return;
  }
  remoteOllamaController = new AbortController();
  createLoadingIndicator();
  let fullText = "";
  let textElement = null;
  let lastUpdateTime = 0;
  const UPDATE_INTERVAL = 50;
  let tokenRef = { el: null };
  let charCount = 0;
  let finalTokens = null;
  const getBubble = () => textElement?.closest('.ai-message') || textElement?.parentElement;
  const updateTokenUI = () => {
    const bubble = getBubble();
    if (!bubble) return;
    const el = ensureTokenLabel(bubble, tokenRef);
    const text = formatTokenText(finalTokens, charCount);
    if (text) el.textContent = text;
  };
  try {
    await askRemoteOllamaStream(
      modelName,
      [{ role: 'user', content: inputText }],
      (chunk, done, thinkingChunk, stats) => {
        if (chunk) {
          fullText += chunk;
          charCount += chunk.length;
          if (!textElement) {
            removeLoadingIndicator();
            textElement = createBubble("", "ai", `${modelName}`);
          }
          const now = Date.now();
          if (now - lastUpdateTime >= UPDATE_INTERVAL) {
            textElement.innerHTML = marked.parse(fullText);
            highlightCode(textElement);
            scrollToBottomIfNeeded();
            lastUpdateTime = now;
          }
          updateTokenUI();
        }
        if (done) {
          if (stats) finalTokens = stats;
          if (textElement) {
            textElement.innerHTML = marked.parse(fullText);
            highlightCode(textElement);
          }
          scrollToBottomIfNeeded();
          if (textElement) updateTokenUI();
          if (textElement && fullText.trim() !== "") {
            if (finalTokens) addToConversationHistory('assistant', fullText.trim(), finalTokens);
            resetSendState();
          }
        }
      }
    );
  } catch (e) {
    console.error('requestRemoteOllama错误:', e);
    showToast('请求失败');
    resetSendState();
  }
}

async function askOllamaStream(model, messages, onData) {
  const url = `${getOllamaBaseURL()}/api/chat`;
  const payload = {
    model,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    stream: true
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ollamaController?.signal
    });
    if (!response.ok || !response.body) {
      showToast('模型不可用');
      onData?.(null, true); return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const token = obj?.message?.content || '';
          const thinking = obj?.message?.thinking || '';

          if (thinking && !token) {
            onData?.(null, false, thinking);
          }
          if (token) onData?.(token, false);
          if (obj?.done) {
            onData?.(null, true, null, { input: obj.prompt_eval_count, output: obj.eval_count });
            return;
          }
        } catch { }
      }
    }
    onData?.(null, true);
  } catch (e) {
    onData?.(null, true);
  }
}

async function requestOllama(inputText, modelNameRaw) {
  const modelName = (modelNameRaw || '').replace(/^ollama:/, '');
  if (!modelName) { showToast('未选择模型'); return; }
  ollamaController = new AbortController();
  createLoadingIndicator();
  let contentText = ""; let textElement = null;
  let thinkingText = "";
  let hasRealContent = false;
  let thinkingPre = null;
  let contentDiv = null;
  let tokenRef = { el: null };
  let charCount = 0;
  let finalTokens = null;
  const getBubble = () => textElement?.closest('.ai-message') || textElement?.parentElement;
  const updateTokenUI = () => {
    const bubble = getBubble();
    if (!bubble) return;
    const el = ensureTokenLabel(bubble, tokenRef);
    const text = formatTokenText(finalTokens, charCount);
    if (text) el.textContent = text;
  };
  try {
    await askOllamaStream(modelName, [{ role: 'user', content: inputText }], (chunk, done, thinkingChunk, stats) => {

      if (thinkingChunk && !hasRealContent) {
        thinkingText += thinkingChunk;
        if (!textElement) {
          removeLoadingIndicator();
          textElement = createBubble("", "ai", modelName);
          const details = document.createElement('details');
          details.className = 'ms-thinking';
          details.open = false;
          details.style.cssText = 'color:#999;font-size:13px';
          details.innerHTML = '<summary style="color:#888;cursor:pointer">思考过程（点击展开）</summary>';
          thinkingPre = document.createElement('pre');
          thinkingPre.style.cssText = 'color:#888;font-size:12px;white-space:pre-wrap;margin:4px 0';
          details.appendChild(thinkingPre);
          textElement.appendChild(details);
        }
        thinkingPre.textContent = thinkingText;
        charCount += thinkingChunk.length;
        updateTokenUI();
        scrollToBottomIfNeeded();
        return;
      }

      if (chunk) {
        if (!hasRealContent) {
          hasRealContent = true;
          if (!textElement) {
            removeLoadingIndicator();
            textElement = createBubble("", "ai", modelName);
          }
          contentDiv = document.createElement('div');
          textElement.appendChild(contentDiv);
          contentText = chunk;
        } else {
          contentText += chunk;
        }
        charCount += chunk.length;
        if (contentDiv) {
          contentDiv.innerHTML = marked.parse(contentText);
        } else {
          textElement.innerHTML = marked.parse(contentText);
        }
        highlightCode(textElement);
        updateTokenUI();
        scrollToBottomIfNeeded();
      }
      if (done) {
        if (stats) finalTokens = stats;
        if (textElement) {
          if (contentDiv) contentDiv.innerHTML = marked.parse(contentText);
          else textElement.innerHTML = marked.parse(contentText);
          highlightCode(textElement);
          updateTokenUI();
        }
        scrollToBottomIfNeeded();
        const fullContent = contentText.trim();
        if (fullContent !== "" || thinkingText.trim() !== "") {
          if (finalTokens) addToConversationHistory('assistant', fullContent || thinkingText, finalTokens, thinkingText.trim() || undefined);
          resetSendState();
        }
      }
    });
  } catch (e) { showToast('请求失败，检查网络'); resetSendState(); }
}

function ensureOnlineGroup() {
  [...modelSelect.querySelectorAll('option[data-src="online"]')].forEach(o => o.remove());
  const chatgptOpt = document.createElement('option');
  chatgptOpt.value = 'chatgpt';
  chatgptOpt.textContent = 'ChatGPT';
  chatgptOpt.dataset.src = 'online';
  const gptOssOpt = document.createElement('option');
  gptOssOpt.value = 'gpt-oss:120b';
  gptOssOpt.textContent = 'GPT-OSS:120b';
  gptOssOpt.dataset.src = 'online';
  const proOpt = document.createElement('option');
  proOpt.value = 'nyeli-pro';
  proOpt.textContent = 'DeepSeek-v4-Pro';
  proOpt.dataset.src = 'online';
  const flashOpt = document.createElement('option');
  flashOpt.value = 'nyeli-flash';
  flashOpt.textContent = 'DeepSeek-v4-Flash';
  flashOpt.dataset.src = 'online';
  const visionOpt = document.createElement('option');
  visionOpt.value = 'nyeli-vision';
  visionOpt.textContent = 'DeepSeek-v4-Flash-Vision-Exp';
  visionOpt.dataset.src = 'online';
  const nemotronFreeOpt = document.createElement('option');
  nemotronFreeOpt.value = 'nyeli-nemotron-free';
  nemotronFreeOpt.textContent = 'Nemotron-3-Ultra-Free';
  nemotronFreeOpt.dataset.src = 'online';
  const hy3FreeOpt = document.createElement('option');
  hy3FreeOpt.value = 'nyeli-hy3-free';
  hy3FreeOpt.textContent = 'Hy3-Free';
  hy3FreeOpt.dataset.src = 'online';
  const mimoFreeOpt = document.createElement('option');
  mimoFreeOpt.value = 'nyeli-mimo-free';
  mimoFreeOpt.textContent = 'MiMo-V2.5-Free';
  mimoFreeOpt.dataset.src = 'online';
  const paidDivider = document.createElement('option');
  paidDivider.textContent = '付费模型';
  paidDivider.disabled = true;
  paidDivider.dataset.src = 'online';
  const freeDivider = document.createElement('option');
  freeDivider.textContent = '免费模型';
  freeDivider.disabled = true;
  freeDivider.dataset.src = 'online';
  modelSelect.insertBefore(flashOpt, modelSelect.firstChild);
  modelSelect.insertBefore(visionOpt, modelSelect.firstChild);
  modelSelect.insertBefore(proOpt, modelSelect.firstChild);
  modelSelect.insertBefore(paidDivider, modelSelect.firstChild);
  modelSelect.insertBefore(chatgptOpt, modelSelect.firstChild);
  modelSelect.insertBefore(gptOssOpt, modelSelect.firstChild);
  modelSelect.insertBefore(nemotronFreeOpt, modelSelect.firstChild);
  modelSelect.insertBefore(hy3FreeOpt, modelSelect.firstChild);
  modelSelect.insertBefore(mimoFreeOpt, modelSelect.firstChild);
  modelSelect.insertBefore(freeDivider, modelSelect.firstChild);
  modelSelect.value = 'nyeli-pro';
}

const atPopup = document.createElement('div');
atPopup.id = 'at-file-popup';
atPopup.style.cssText = 'display:none;position:fixed;z-index:9999;background:#1a1a1a;border:1px solid #363636;border-radius:8px;max-height:60vh;overflow-y:auto;overflow-x:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.5);font-family:system-ui,sans-serif;font-size:13px;padding:4px 0;';
document.body.appendChild(atPopup);

let cachedDesktopPath = null;
function getDesktopPath() {
  if (cachedDesktopPath) return cachedDesktopPath;
  const homeDir = os.homedir();
  const candidates = [];

  try {
    const regPath = execSyncCmd('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Desktop', { encoding: 'utf-8', timeout: 2000 });
    const match = regPath.match(/REG_EXPAND_SZ\s+(.+)/);
    if (match) {
      const raw = match[1].trim();
      const resolved = raw.replace(/%([^%]+)%/g, (_, v) => process.env[v] || '');
      if (resolved) candidates.push(resolved);
    }
  } catch (_) { }

  const defaultDesktop = p.join(homeDir, 'Desktop');
  if (!candidates.includes(defaultDesktop)) candidates.push(defaultDesktop);

  cachedDesktopPath = candidates.find(p => {
    try { return f.existsSync(p) } catch (_) { return false }
  }) || homeDir;
  return cachedDesktopPath;
}

inputElement.addEventListener("input", () => {
  const val = inputElement.value;
  const cursorPos = inputElement.selectionStart;
  const textBeforeCursor = val.slice(0, cursorPos);
  const atMatch = textBeforeCursor.match(/@(\S*)$/);
  if (!atMatch) { atPopup.style.display = 'none'; return; }
  const query = atMatch[1].toLowerCase();

  const desktopPath = getDesktopPath();
  let files = [];
  try { files = f.readdirSync(desktopPath); } catch (_) { }
  const filtered = files.filter(f => f.toLowerCase().includes(query));
  if (filtered.length === 0) { atPopup.style.display = 'none'; return; }
  const rect = inputElement.getBoundingClientRect();
  atPopup.style.left = rect.left + 'px';
  atPopup.style.width = Math.max(240, Math.min(rect.width, 360)) + 'px';
  atPopup.style.top = '-9999px';
  atPopup.style.display = 'block';
  atPopup.innerHTML = filtered.map(file => {
    const fullPath = p.join(desktopPath, file);
    const icon = f.statSync(fullPath).isDirectory()
      ? '<img src="../Assets/Image/Folder.png" style="width:14px;height:14px;vertical-align:middle">'
      : '<img src="../Assets/Image/Files.png" style="width:14px;height:14px;vertical-align:middle">';
    return '<div data-path="' + escapeHtml(fullPath) + '" style="padding:6px 12px;cursor:pointer;color:#d4d4d8;display:flex;align-items:center;gap:6px;font-size:13px;">' + icon + escapeHtml(file) + '</div>';
  }).join('');
  const popupHeight = atPopup.getBoundingClientRect().height;
  atPopup.style.top = Math.max(0, rect.top - popupHeight - 4) + 'px';
  atPopup._select = (idx) => {
    const items = atPopup.querySelectorAll('div[data-path]');
    items.forEach((el, i) => {
      el.style.background = i === idx ? 'rgba(48,200,22,0.15)' : '';
      if (i === idx) el.scrollIntoView({ block: 'nearest' });
    });
    atPopup._idx = idx;
  };
  atPopup._confirm = (idx) => {
    const el = atPopup.querySelectorAll('div[data-path]')[idx];
    if (!el) return;
    const insertPath = el.dataset.path;
    const beforeAt = textBeforeCursor.slice(0, atMatch.index);
    const afterCursor = val.slice(cursorPos);
    inputElement.value = beforeAt + insertPath + ' ' + afterCursor;
    atPopup.style.display = 'none';
    inputElement.focus();
  };
  atPopup._idx = 0;
  atPopup._select(0);
  atPopup.querySelectorAll('div[data-path]').forEach((el, i) => {
    el.addEventListener('click', () => atPopup._confirm(i));
    el.addEventListener('mouseenter', () => atPopup._select(i));
  });
});
document.addEventListener('click', (e) => {
  if (!atPopup.contains(e.target) && e.target !== inputElement) atPopup.style.display = 'none';
});

const skillPopup = document.createElement('div');
skillPopup.id = 'skill-popup';
skillPopup.style.cssText = 'display:none;position:fixed;z-index:9999;background:#1a1a1a;border:1px solid #363636;border-radius:8px;max-height:60vh;overflow-y:auto;overflow-x:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.5);font-family:system-ui,sans-serif;font-size:13px;padding:4px 0;';
const skillStyle = document.createElement('style');
skillStyle.textContent = '#skill-popup .skill-del { opacity:0; } #skill-popup div[data-skill]:hover .skill-del { opacity:1; } #skill-popup .skill-del:hover { background:rgba(255,68,68,0.1); } #skill-popup .skill-del:hover svg { stroke:#ff4444; }';
document.head.appendChild(skillStyle);
document.body.appendChild(skillPopup);

let cachedSkills = null;
function getSkills() {
  if (cachedSkills) return cachedSkills;
  const seen = new Set();
  const skills = [];
  const dirs = [
    p.join(NYELI_DIR, 'skills'),
    p.join(__dirname, '..', '..', 'Plugins', 'Nyeli', '.Nyeli', 'skills')
  ];
  dirs.forEach(dir => {
    try {
      if (f.existsSync(dir)) {
        f.readdirSync(dir).forEach(name => {
          if (seen.has(name)) return;
          const skillDir = p.join(dir, name);
          const mdPath = p.join(skillDir, 'SKILL.md');
          if (f.existsSync(mdPath)) {
            try {
              const md = f.readFileSync(mdPath, 'utf-8');
              const m = md.match(/^#\s+(.+)$/m);
              const title = m ? m[1] : name;
              const st = f.statSync(skillDir);
              skills.push({ name, title, t: st.birthtimeMs || st.mtimeMs });
              seen.add(name);
            } catch (_) { }
          }
        });
      }
    } catch (_) { }
  });
  cachedSkills = skills;
  return skills;
}

inputElement.addEventListener("input", () => {
  const val = inputElement.value;
  const cursorPos = inputElement.selectionStart;
  const textBeforeCursor = val.slice(0, cursorPos);
  const slashMatch = textBeforeCursor.match(/^\/(\S*)$/);
  if (!slashMatch) { skillPopup.style.display = 'none'; return; }
  const query = slashMatch[1].toLowerCase();
  const skills = getSkills();
  const filtered = skills.filter(s => s.name.toLowerCase().includes(query)).sort((a, b) => b.t - a.t);
  if (filtered.length === 0) { skillPopup.style.display = 'none'; return; }
  const rect = inputElement.getBoundingClientRect();
  skillPopup.style.left = rect.left + 'px';
  skillPopup.style.width = Math.max(240, Math.min(rect.width, 360)) + 'px';
  skillPopup.style.top = '-9999px';
  skillPopup.style.display = 'block';
  skillPopup.innerHTML = filtered.map(s => {
    return '<div data-skill="' + escapeHtml(s.name) + '" style="padding:6px 12px;cursor:pointer;color:#d4d4d8;display:flex;align-items:center;gap:8px;"><img src="../Assets/Image/Skill.png" style="width:15px;height:15px;vertical-align:middle"><div style="flex:1;min-width:0;"><div style="color:#30c816;font-weight:600;font-size:13px;">' + escapeHtml(s.name) + '</div><div style="font-size:12px;color:#71717a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(s.title) + '</div></div><span class="skill-del" data-skill-name="' + escapeHtml(s.name) + '" title="删除技能" style="flex-shrink:0;cursor:pointer;padding:4px 6px;border-radius:3px;transition:all 0.15s;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></span></div>';
  }).join('');
  const ph = skillPopup.getBoundingClientRect().height;
  skillPopup.style.top = Math.max(0, rect.top - ph - 4) + 'px';
  skillPopup._idx = 0;
  skillPopup._items = skillPopup.querySelectorAll('div[data-skill]');
  skillPopup._select = (idx) => {
    skillPopup._items.forEach((el, i) => {
      el.style.background = i === idx ? 'rgba(48,200,22,0.15)' : '';
      if (i === idx) el.scrollIntoView({ block: 'nearest' });
    });
    skillPopup._idx = idx;
  };
  skillPopup._confirm = (idx) => {
    const el = skillPopup._items[idx];
    if (!el) return;
    const skillName = el.dataset.skill;
    inputElement.value = '/' + skillName + ' ';
    skillPopup.style.display = 'none';
    inputElement.focus();
    inputElement.setSelectionRange(inputElement.value.length, inputElement.value.length);
  };
  skillPopup._select(0);
  skillPopup._items.forEach((el, i) => {
    el.addEventListener('click', () => skillPopup._confirm(i));
    el.addEventListener('mouseenter', () => skillPopup._select(i));
  });
  skillPopup.querySelectorAll('.skill-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.skillName;
      const dir = p.join(NYELI_DIR, 'skills', name);
      try { if (f.existsSync(dir)) { f.rmSync(dir, { recursive: true, force: true }); showToast('已删除'); } } catch (_) { }
      cachedSkills = null;
      inputElement.dispatchEvent(new Event('input'));
    });
  });
});
document.addEventListener('click', (e) => {
  if (!skillPopup.contains(e.target) && e.target !== inputElement) skillPopup.style.display = 'none';
});

async function sendUserMessage(inputText) {
  const selectedModel = modelSelect.value;
  if (isSending) return;
  inputText = inputText.replace(/\[Pasted text #(\d+) \+\d+ lines\]/g, (m, id) => {
    const content = pastedChunks.get(Number(id));
    if (!content) return m;
    return content;
  });
  const images = [...pendingImages];
  if (inputText === "" && images.length === 0) return;
  if ((selectedModel === "nyeli-pro" || selectedModel === "nyeli-flash" || selectedModel === "nyeli-vision") && !getApiKey()) {
    settingsButton.click();
    showToast('请填写 Key');
    inputElement.value = inputText;
    isSending = false;
    toggleCloseButtonIcon(false);
    return;
  }
  pendingImages = [];
  prevModel = null;
  try { localStorage.removeItem(getPendingImagesKey()); } catch (_) { }
  renderImagePreviews();

  autoScroll = true;
  streamActive = true;
  lastScrollTop = 0;

  try {
    const hist = JSON.parse(localStorage.getItem('ms-input-hist') || '[]');
    hist.push(inputText);
    if (hist.length > 20) hist.shift();
    localStorage.setItem('ms-input-hist', JSON.stringify(hist));
  } catch (_) { }
  inputElement._histIdx = null; inputElement._draft = null;
  inputElement.value = "";
  isSending = true; toggleCloseButtonIcon(true);
  displayTextSlowly(inputText, "user", undefined, undefined, undefined, images);
  await addToConversationHistory('user', inputText, undefined, undefined, undefined, images);
  pastedChunks.clear();
  forceScrollToBottom();
  requestAnimationFrame(() => {
    if (selectedModel === "nyeli-pro" || selectedModel === "nyeli-flash" || selectedModel === "nyeli-vision" || selectedModel === "nyeli-hy3-free" || selectedModel === "nyeli-nemotron-free" || selectedModel === "nyeli-mimo-free") {
      const modelLabel = modelSelect.options[modelSelect.selectedIndex].textContent;
      requestNyeli(inputText, modelLabel, images);
    } else if (selectedModel === "chatgpt") {
      requestChatGPT(inputText);
    } else if (selectedModel.startsWith('ollama:')) {
      requestOllama(inputText, selectedModel);
    } else if (selectedModel.startsWith('ollama-remote:') || selectedModel.startsWith('gpt-oss:120b')) {
      requestRemoteOllama(inputText, selectedModel);
    } else {
      showToast('未选择模型');
    }
  });
}

inputElement.addEventListener("keydown", (event) => {
  if (skillPopup.style.display === 'block') {
    const items = skillPopup.querySelectorAll('div[data-skill]');
    if (event.key === 'ArrowDown') { event.preventDefault(); skillPopup._select(Math.min((skillPopup._idx || 0) + 1, items.length - 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); skillPopup._select(Math.max((skillPopup._idx || 0) - 1, 0)); return; }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); skillPopup._confirm(skillPopup._idx || 0); return; }
    if (event.key === 'Escape') { skillPopup.style.display = 'none'; return; }
    return;
  }
  if (atPopup.style.display === 'block') {
    const items = atPopup.querySelectorAll('div[data-path]');
    if (event.key === 'ArrowDown') { event.preventDefault(); atPopup._select(Math.min((atPopup._idx || 0) + 1, items.length - 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); atPopup._select(Math.max((atPopup._idx || 0) - 1, 0)); return; }
    if (event.key === 'Enter') { event.preventDefault(); atPopup._confirm(atPopup._idx || 0); return; }
    if (event.key === 'Escape') { atPopup.style.display = 'none'; return; }
    return;
  }
  if (event.key === 'ArrowUp' && skillPopup.style.display !== 'block' && atPopup.style.display !== 'block') {
    event.preventDefault();
    const hist = JSON.parse(localStorage.getItem('ms-input-hist') || '[]');
    if (!hist.length) return;
    if (inputElement._histIdx == null) { inputElement._histIdx = hist.length; inputElement._draft = inputElement.value; }
    if (inputElement._histIdx > 0) { inputElement._histIdx--; inputElement.value = hist[inputElement._histIdx]; }
    return;
  }
  if (event.key === 'ArrowDown' && skillPopup.style.display !== 'block' && atPopup.style.display !== 'block') {
    event.preventDefault();
    const hist = JSON.parse(localStorage.getItem('ms-input-hist') || '[]');
    if (inputElement._histIdx == null) return;
    if (inputElement._histIdx < hist.length - 1) { inputElement._histIdx++; inputElement.value = hist[inputElement._histIdx]; }
    else { inputElement._histIdx = null; inputElement.value = inputElement._draft || ''; inputElement._draft = null; }
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  sendUserMessage(inputElement.value.trim());
});

if (clearButton) {
  clearButton.addEventListener("click", () => {
    const welcome = terminalElement.querySelector(".AI-welcome-message");
    const toolbar = document.getElementById("terminal-toolbar");
    const messagesToRemove = [...terminalElement.children].filter(child =>
      child !== welcome && child !== modelSelect && child !== toolbar
    );
    const capturedModel = modelSelect?.value || 'default';
    const capturedHistoryKey = 'deepseek_history_' + capturedModel;
    const capturedPendingKey = 'deepseek_pending_images_' + capturedModel;
    if (messagesToRemove.length === 0) {
      inputElement.value = "";
      pastedChunks.clear();
      if (pendingImages.length > 0) {
        clearImagePreviews();
        const pendingDelete = [...pendingImages];
        pendingImages = [];
        localStorage.removeItem(capturedPendingKey);
        if (prevModel) { modelSelect.value = prevModel; prevModel = null; }
        const pendingOthers = collectOtherModelImageRefs(capturedHistoryKey, capturedPendingKey);
        const pendingToDelete = pendingDelete.filter(p => !pendingOthers.has(p));
        if (pendingToDelete.length > 0) ipcR.invoke('nyeli-delete-images', pendingToDelete).catch(() => { });
      }
      if (ollamaController) ollamaController.abort();
      if (remoteOllamaController) remoteOllamaController.abort();
      ipcR.invoke('nyeli-cancel').catch(() => { });
      ipcR.send('nyeli-clear');
      ipcR.send('nyeli-close-browser');
      autoScroll = true;
      terminalElement.scrollTo({ top: terminalElement.scrollHeight, behavior: 'smooth' });
      resetSendState();
      ipcR.send('hide-agentlogs', { animated: true });
      return;
    }
    clearButton.style.transition = "transform 0.2s cubic-bezier(0.34,1.56,0.64,1)";
    clearButton.style.transform = "translateY(-50%) scale(0.85)";
    setTimeout(() => {
      clearButton.style.transform = "translateY(-50%) scale(1)";
    }, 200);
    messagesToRemove.forEach((child) => {
      child.style.transition = "all 0.35s cubic-bezier(0.16,1,0.3,1)";
      child.style.opacity = "0";
      child.style.transform = "translateY(-12px) scale(0.96)";
    });
    setTimeout(() => {
      messagesToRemove.forEach(child => {
        if (terminalElement.contains(child)) terminalElement.removeChild(child);
      });
      inputElement.value = "";
      pastedChunks.clear();
      if (pendingImages.length > 0) {
        clearImagePreviews();
        const pendingDelete = [...pendingImages];
        pendingImages = [];
        localStorage.removeItem(capturedPendingKey);
        if (prevModel) { modelSelect.value = prevModel; prevModel = null; }
        const pendingOthers = collectOtherModelImageRefs(capturedHistoryKey, capturedPendingKey);
        const pendingToDelete = pendingDelete.filter(p => !pendingOthers.has(p));
        if (pendingToDelete.length > 0) ipcR.invoke('nyeli-delete-images', pendingToDelete).catch(() => { });
      }
      if (ollamaController) ollamaController.abort();
      if (remoteOllamaController) remoteOllamaController.abort();
      ipcR.invoke('nyeli-cancel').catch(() => { });
      ipcR.send('nyeli-clear');
      ipcR.send('nyeli-close-browser');
      autoScroll = true;
      terminalElement.scrollTo({ top: terminalElement.scrollHeight, behavior: 'smooth' });
      resetSendState();
      clearConversationHistory(capturedHistoryKey, capturedPendingKey);
      ipcR.send('hide-agentlogs', { animated: true });
    }, 380);
  });
}

if (closeButton) {
  closeButton.addEventListener("click", () => {
    pastedChunks.clear();
    if (ollamaController) ollamaController.abort();
    if (remoteOllamaController) remoteOllamaController.abort();
    ipcR.invoke('nyeli-cancel').catch(() => { });
    resetSendState();
  });
}

ipcRenderer.on('stop-ai', () => {
  pastedChunks.clear();
  if (ollamaController) ollamaController.abort();
  if (remoteOllamaController) remoteOllamaController.abort();
  ipcR.invoke('nyeli-cancel').catch(() => { });
  resetSendState();
});

function createMessageHeader(sender, modelName) {
  const header = document.createElement("div");
  header.className = "message-header";
  const avatar = document.createElement("img");
  avatar.className = "message-avatar";
  const nameTag = document.createElement("span");
  nameTag.className = "message-name";
  if (sender === "user") {
    avatar.src = "../Assets/Image/Avatar.png";
    avatar.alt = "发光的神";
    nameTag.textContent = "发光的神";
    header.appendChild(nameTag); header.appendChild(avatar);
  } else {
    avatar.src = "../Assets/Image/Nyeli.png";
    avatar.alt = "夜璃";
    let showName = modelName || '';
    if (showName.startsWith('ollama:')) showName = showName.replace(/^ollama:/, '');
    nameTag.textContent = "夜璃" + (showName ? ` · ${showName}` : '');
    header.appendChild(avatar); header.appendChild(nameTag);
  }
  avatar.addEventListener("click", () => {
    const mv = document.getElementById('MetaSword-view');
    const overlay = document.createElement("div");
    const setRect = () => {
      const r = mv.getBoundingClientRect();
      overlay.style.top = r.top + 'px';
      overlay.style.left = r.left + 'px';
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
    };
    setRect();
    overlay.style.cssText += 'position:fixed;z-index:99999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity 0.25s ease;border-radius:10px;overflow:hidden;';
    const ro = new ResizeObserver(setRect);
    ro.observe(mv);
    const img = document.createElement("img");
    img.src = avatar.src;
    img.alt = avatar.alt;
    img.style.cssText = 'max-width:60%;max-height:60%;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,0.6);object-fit:contain;user-select:none;';
    overlay.appendChild(img);
    overlay.addEventListener("click", (e) => {
      overlay.style.opacity = '0';
      setTimeout(() => { ro.disconnect(); overlay.remove(); }, 200);
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
  });
  return header;
}

function createBubble(text, sender, modelName) {
  const bubble = document.createElement("div");
  bubble.className = sender === "user" ? "user-message" : "ai-message";
  const header = createMessageHeader(sender, modelName);
  bubble.appendChild(header);
  const textElement = document.createElement("div");
  textElement.className = "message-text";
  if (text) {
    if (sender === "user") {
      textElement.textContent = text;
    } else {
      textElement.innerHTML = marked.parse(text);
    }
  }
  bubble.appendChild(textElement);
  terminalElement.appendChild(bubble);
  void terminalElement.offsetHeight;
  return textElement;
}

function openImageOverlay(mv, urls, currentIndex) {
  if (!mv || !urls || urls.length === 0) { if (urls && urls[currentIndex]) window.open(urls[currentIndex], '_blank'); return; }
  const overlay = document.createElement('div');
  let scale = 1, tx = 0, ty = 0;
  const setRect = () => {
    const r = mv.getBoundingClientRect();
    overlay.style.top = r.top + 'px';
    overlay.style.left = r.left + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  };
  setRect();
  overlay.style.cssText += 'position:fixed;z-index:99999;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out;opacity:0;transition:opacity 0.18s ease;border-radius:10px;overflow:hidden;';
  const ro = new ResizeObserver(setRect);
  ro.observe(mv);
  const fullImg = document.createElement('img');
  fullImg.style.cssText = 'max-width:92%;max-height:92%;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,0.6);object-fit:contain;user-select:none;-webkit-user-drag:none;transition:transform 0.1s ease;transform-origin:center center;';
  const applyTransform = () => { fullImg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  const gotoIdx = (i) => {
    currentIndex = (i + urls.length) % urls.length;
    fullImg.src = urls[currentIndex];
    scale = 1; tx = 0; ty = 0; applyTransform();
    updateIndicator();
  };
  fullImg.src = urls[currentIndex];

  const dragAc = new AbortController();
  fullImg.addEventListener('wheel', (wev) => {
    wev.preventDefault(); wev.stopPropagation();
    const delta = wev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(0.1, Math.min(10, scale * delta));
    const rect = fullImg.getBoundingClientRect();
    const cx = wev.clientX - rect.left - rect.width / 2;
    const cy = wev.clientY - rect.top - rect.height / 2;
    tx -= cx * (newScale / scale - 1);
    ty -= cy * (newScale / scale - 1);
    scale = newScale; applyTransform();
    overlay.style.cursor = scale > 1 ? 'grab' : 'zoom-out';
  }, { passive: false, signal: dragAc.signal });
  let isDragging = false, dragStartX = 0, dragStartY = 0, startTx = 0, startTy = 0;
  fullImg.addEventListener('mousedown', (dev) => {
    if (scale <= 1) return;
    dev.preventDefault();
    isDragging = true; dragStartX = dev.clientX; dragStartY = dev.clientY;
    startTx = tx; startTy = ty; overlay.style.cursor = 'grabbing';
  }, { signal: dragAc.signal });
  document.addEventListener('mousemove', (mev) => {
    if (!isDragging) return;
    tx = startTx + (mev.clientX - dragStartX);
    ty = startTy + (mev.clientY - dragStartY);
    applyTransform();
  }, { signal: dragAc.signal });
  document.addEventListener('mouseup', () => {
    if (isDragging) { isDragging = false; overlay.style.cursor = scale > 1 ? 'grab' : 'zoom-out'; }
  }, { signal: dragAc.signal });
  fullImg.addEventListener('dblclick', () => {
    if (scale > 1) { scale = 1; tx = 0; ty = 0; overlay.style.cursor = 'zoom-out'; }
    else { scale = 2; overlay.style.cursor = 'grab'; }
    applyTransform();
  }, { signal: dragAc.signal });
  fullImg.addEventListener('click', (cev) => { cev.stopPropagation(); }, { signal: dragAc.signal });

  overlay.appendChild(fullImg);

  const btnStyle = 'position:absolute;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.1);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s;user-select:none;';
  const prevBtn = document.createElement('div');
  prevBtn.style.cssText = btnStyle + 'left:16px;';
  prevBtn.textContent = '‹';
  prevBtn.addEventListener('mouseenter', () => { if (urls.length > 1) prevBtn.style.background = 'rgba(255,255,255,0.25)'; });
  prevBtn.addEventListener('mouseleave', () => { prevBtn.style.background = 'rgba(255,255,255,0.1)'; });
  prevBtn.addEventListener('click', (e) => { if (urls.length > 1) { e.stopPropagation(); gotoIdx(currentIndex - 1); } });
  overlay.appendChild(prevBtn);
  const nextBtn = document.createElement('div');
  nextBtn.style.cssText = btnStyle + 'right:16px;';
  nextBtn.textContent = '›';
  nextBtn.addEventListener('mouseenter', () => { if (urls.length > 1) nextBtn.style.background = 'rgba(255,255,255,0.25)'; });
  nextBtn.addEventListener('mouseleave', () => { nextBtn.style.background = 'rgba(255,255,255,0.1)'; });
  nextBtn.addEventListener('click', (e) => { if (urls.length > 1) { e.stopPropagation(); gotoIdx(currentIndex + 1); } });
  overlay.appendChild(nextBtn);

  const indicator = document.createElement('div');
  indicator.style.cssText = 'position:absolute;bottom:18px;left:50%;transform:translateX(-50%);color:#fff;font-size:12px;background:rgba(0,0,0,0.5);padding:4px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.15);';
  const updateIndicator = () => { indicator.textContent = `${currentIndex + 1} / ${urls.length}`; };
  updateIndicator();
  overlay.appendChild(indicator);

  const keyHandler = (ke) => {
    if (ke.key === 'ArrowLeft') { if (urls.length > 1) { ke.preventDefault(); gotoIdx(currentIndex - 1); } }
    else if (ke.key === 'ArrowRight') { if (urls.length > 1) { ke.preventDefault(); gotoIdx(currentIndex + 1); } }
    else if (ke.key === 'Escape') { ke.preventDefault(); close(); }
  };
  document.addEventListener('keydown', keyHandler, { signal: dragAc.signal });

  const close = () => {
    overlay.style.opacity = '0';
    setTimeout(() => { dragAc.abort(); ro.disconnect(); overlay.remove(); }, 180);
  };
  overlay.addEventListener('click', close);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
}

function displayTextSlowly(text, sender, modelName, onDone, thinking, images, toolImages) {
  removeLoadingIndicator();
  const bubble = document.createElement("div");
  bubble.className = sender === "user" ? "user-message" : "ai-message";
  const header = createMessageHeader(sender, modelName);
  bubble.appendChild(header);
  const textElement = document.createElement("div");
  textElement.className = "message-text";
  const renderToolImages = (urls) => {
    if (!urls || urls.length === 0) return;
    const mv = document.getElementById('MetaSword-view');

    const allToolPaths = [];
    for (const e of conversationHistory) if (e.tool_images) allToolPaths.push(...e.tool_images);
    const allDisplayUrls = allToolPaths.map(u => u.startsWith('data:') ? u : 'file:///' + u.replace(/\\/g, '/'));
    const myPathsOffset = allToolPaths.length - urls.length;
    const outer = document.createElement('div');
    outer.className = 'tool-result-images';
    outer.style.cssText = 'position:relative;margin:8px 0 10px 0;padding-left:22px;';
    const line = document.createElement('div');
    line.style.cssText = 'position:absolute;left:7px;top:6px;bottom:6px;width:1px;background:linear-gradient(to bottom,#444,#222);';
    outer.appendChild(line);
    const displayUrls = urls.map(u => u.startsWith('data:') ? u : 'file:///' + u.replace(/\\/g, '/'));
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    displayUrls.forEach((url, idx) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;margin:4px 0;';
      const node = document.createElement('div');
      node.style.cssText = 'position:absolute;left:-22px;top:4px;width:14px;height:14px;border-radius:50%;background:#1a1a1a;border:1px solid #555;color:#ccc;font-size:9px;font-weight:600;display:flex;align-items:center;justify-content:center;line-height:1;';
      node.textContent = idx + 1;
      wrap.appendChild(node);
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'tool result';
      img.title = '点击放大';
      img.style.cssText = 'max-width:min(320px, 100%);max-height:240px;border-radius:6px;border:1px solid #2a2a2a;background:#000;cursor:pointer;user-select:none;-webkit-user-drag:none;transition:opacity 0.2s;object-fit:contain;display:block;';
      img.addEventListener('mouseenter', () => { img.style.opacity = '0.9'; });
      img.addEventListener('mouseleave', () => { img.style.opacity = '1'; });
      img.addEventListener('click', (ev) => { ev.stopPropagation(); openImageOverlay(mv, allDisplayUrls, myPathsOffset + idx); });
      wrap.appendChild(img);
      row.appendChild(wrap);
    });
    outer.appendChild(row);
    textElement.appendChild(outer);
  };
  if (sender === "user") {
    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ');
      const skill = spaceIdx > 0 ? text.slice(0, spaceIdx) : text;
      const rest = spaceIdx > 0 ? text.slice(spaceIdx) : '';
      textElement.innerHTML = `<span style="background:rgba(48,200,22,0.08);color:#30c816;padding:2px 8px;border-radius:4px;font-size:13px;border:1px solid rgba(48,200,22,0.3);white-space:normal;word-break:break-all">${escapeHtml(skill)}</span><span style="word-break:break-all">${escapeHtml(rest)}</span>`;
    } else {
      textElement.textContent = text;
    }
  } else {
    renderToolImages(toolImages);
    if (thinking) {
      const details = document.createElement('details');
      details.className = 'ms-thinking';
      details.open = false;
      details.style.cssText = 'color:#999;font-size:13px';
      details.innerHTML = '<summary style="color:#888;cursor:pointer">思考过程（点击展开）</summary>';
      const thinkingPre = document.createElement('pre');
      thinkingPre.style.cssText = 'color:#888;font-size:12px;white-space:pre-wrap;margin:4px 0';
      thinkingPre.textContent = thinking;
      details.appendChild(thinkingPre);
      textElement.appendChild(details);
    }
    if (text) {
      const contentDiv = document.createElement('div');
      contentDiv.innerHTML = marked.parse(text);
      textElement.appendChild(contentDiv);
    }
  }
  bubble.appendChild(textElement);
  if (sender === "user" && images && images.length > 0) {
    const imgContainer = document.createElement("div");
    imgContainer.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;";
    const allUserImages = [];
    for (const e of conversationHistory) if (e.role === 'user' && e.images) allUserImages.push(...e.images);
    const userDisplayUrls = allUserImages.map(u => 'file:///' + u.replace(/\\/g, '/'));
    const myIndexOffset = allUserImages.length - images.length;
    images.forEach((src, i) => {
      const img = document.createElement("img");
      img.src = 'file:///' + src.replace(/\\/g, '/');
      img.style.cssText = "width:160px;height:160px;object-fit:cover;border-radius:8px;border:1px solid #333;user-select:none;-webkit-user-drag:none;cursor:pointer;";
      img.title = "点击放大";
      img.addEventListener('click', (ev) => { ev.stopPropagation(); openImageOverlay(document.getElementById('MetaSword-view'), userDisplayUrls, myIndexOffset + i); });
      imgContainer.appendChild(img);
    });
    bubble.appendChild(imgContainer);
  }
  terminalElement.appendChild(bubble);
  if (sender !== "user") {
    highlightCode(textElement);

    if (text.trim()) {
      const savedTokens = findHistoryTokens(text);
      const tokEl = document.createElement('div');
      tokEl.className = 'token-label';
      tokEl.style.cssText = 'color:#d4d4d8;font-size:11px;text-align:right;margin-top:6px;font-weight:500';
      if (savedTokens && savedTokens.input && savedTokens.output) {
        tokEl.textContent = `↓ ${savedTokens.output} out · ↑ ${savedTokens.input} in`;
      } else {
        tokEl.textContent = `↓ ${Math.round(text.length / 3)} tokens`;
      }
      bubble.appendChild(tokEl);
    }
  }
  if (sender === "user") {
    forceScrollToBottom();
  } else {
    scrollToBottomIfNeeded();
  }
  onDone?.();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/"/g, '&quot;');
}

function highlightCode(bubble) {
  const codeBlocks = bubble.querySelectorAll('pre code');
  if (typeof Prism === 'undefined') return;
  codeBlocks.forEach(block => {
    Prism.highlightElement(block);
    addCopyButton(block);
  });
}

function addCopyButton(codeBlock) {
  const copyButton = document.createElement("button");
  copyButton.className = "copy-button";
  copyButton.textContent = "复制";
  const preContainer = codeBlock.parentNode;
  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    position: relative;
    width: 100%;
    overflow-x: auto;
  `;
  const originalPreStyle = preContainer.getAttribute('style') || '';
  preContainer.style.cssText = originalPreStyle
    .replace(/position:\s*relative;/g, '')
    .replace(/padding-right:\s*\d+px;/g, '')
    + 'padding-right: 60px;';
  const parent = preContainer.parentNode;
  parent.insertBefore(wrapper, preContainer);
  wrapper.appendChild(preContainer);
  copyButton.style.cssText = `
    position: absolute;
    top: 11px;
    right: 5px;
    padding: 4px 8px;
    background-color: #444;
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    z-index: 10;
    transition: background-color 0.2s;
  `;
  copyButton.addEventListener("mouseenter", () => {
    copyButton.style.backgroundColor = "#666";
  });
  copyButton.addEventListener("mouseleave", () => {
    copyButton.style.backgroundColor = "#444";
  });
  wrapper.insertBefore(copyButton, preContainer);
  copyButton.addEventListener("click", () => {
    navigator.clipboard.writeText(codeBlock.textContent)
      .then(() => {
        copyButton.textContent = "已复制";
        setTimeout(() => {
          copyButton.textContent = "复制";
        }, 1500);
      })
      .catch(err => {
        copyButton.textContent = "复制失败";
        setTimeout(() => {
          copyButton.textContent = "复制";
        }, 1500);
      });
  });
}

const skillsButton = document.getElementById("skills-button");
if (skillsButton) {
  skillsButton.addEventListener("click", async () => {
    const filePath = await ipcR.invoke('open-skills-dialog');
    if (!filePath) return;
    const skillsDir = p.join(NYELI_DIR, 'skills');
    if (!f.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
    execCmd('powershell -Command "Expand-Archive -Path \\"' + filePath + '\\" -DestinationPath \\"' + skillsDir + '\\" -Force"', (err) => {
      if (err) { showToast('安装失败'); return; }
      try {
        const dirs = f.readdirSync(skillsDir).filter(name => f.statSync(p.join(skillsDir, name)).isDirectory());
        let found = false;
        for (const dir of dirs) {
          if (f.existsSync(p.join(skillsDir, dir, 'SKILL.md'))) { found = true; break; }
        }
        if (found) { cachedSkills = null; showToast('安装成功'); }
        else { showToast('文件无效'); }
      } catch (_) { cachedSkills = null; showToast('安装成功'); }
    });
  });
}

const mcpButton = document.getElementById("mcp-button");
if (mcpButton) {
  mcpButton.addEventListener("click", () => {
    const existing = document.getElementById('mcp-modal');
    if (existing) { existing.remove(); return; }
    const MCP_FILE = p.join(NYELI_DIR, 'mcp.json');
    let servers = [{ name: '次元剑', config: '{"mcpServers":{"次元剑":{"type":"http","url":"http://127.0.0.1:2085/mcp"}}}', builtin: true }];
    try {
      const raw = JSON.parse(f.readFileSync(MCP_FILE, 'utf-8'));
      if (raw.mcpServers) {
        const all = Object.entries(raw.mcpServers);
        const idx = all.findIndex(([name]) => name === '次元剑');
        if (idx > 0) {
          const yy = all.splice(idx, 1)[0];
          all.unshift(yy);
        }
        servers = all.map(([name, cfg]) => ({ name, config: JSON.stringify({ mcpServers: { [name]: cfg } }), builtin: name === '次元剑' }));
      }
    } catch (e) { }
    const overlay = document.createElement('div');
    overlay.id = 'mcp-modal';
    const mv = document.getElementById('MetaSword-view');
    const setRect = () => {
      const r = mv.getBoundingClientRect();
      overlay.style.top = r.top + 'px';
      overlay.style.left = r.left + 'px';
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
    };
    setRect();
    overlay.style.cssText += 'position:fixed;z-index:99999;background:rgba(0,0,0,0);display:flex;align-items:center;justify-content:center;transition:background 0.25s ease;border-radius:10px;overflow:hidden;';
    const ro = new ResizeObserver(setRect);
    ro.observe(mv);
    const card = document.createElement('div');
    card.style.cssText = 'background:#141414;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:24px 28px;width:100%;height:100%;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,0.6);font-family:system-ui,sans-serif;opacity:0;transform:scale(0.92) translateY(16px);transition:opacity 0.25s ease,transform 0.25s cubic-bezier(0.34,1.56,0.64,1);box-sizing:border-box;overflow:hidden;';
    function buildList() {
      const listDiv = card.querySelector('#mcp-list');
      if (!listDiv) return;
      listDiv.innerHTML = servers.map((s, i) => `
        <div class="mcp-card" style="background:#0d0d0d;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px 14px;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <input class="mcp-name" placeholder="名称" spellcheck="false" value="${escapeHtml(s.name)}" style="width:120px;background:transparent;border:1px solid rgba(255,255,255,0.08);border-radius:4px;color:#d4d4d8;font-size:13px;padding:4px 8px;outline:none;height:28px;box-sizing:border-box;${s.builtin ? 'opacity:0.5;' : ''}" ${s.builtin ? 'readonly' : ''}>
            ${s.builtin ? '<span style="font-size:10px;color:#30c816;flex-shrink:0;display:flex;align-items:center;gap:4px;"><i style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#30c816;"></i>内置</span>' : ''}
            <span style="flex:1;"></span>
            <button class="mcp-test" data-idx="${i}" title="测试连通性" style="background:transparent;border:1px solid rgba(255,255,255,0.08);color:#71717a;cursor:pointer;font-size:11px;padding:3px 8px;border-radius:4px;transition:all 0.15s;">测试</button>
            <button class="mcp-del" data-idx="${i}" style="background:transparent;border:none;color:#71717a;cursor:pointer;font-size:14px;padding:2px 4px;opacity:${s.builtin ? '0.3' : '1'};" ${s.builtin ? 'disabled' : ''}>&#10005;</button>
          </div>
          <input class="mcp-url" placeholder='{"type":"http","url":"http://..."}' spellcheck="false" value="${escapeHtml(s.config)}" style="width:100%;background:transparent;border:1px solid rgba(255,255,255,0.08);border-radius:4px;color:#a1a1aa;font-size:12px;font-family:Consolas,monospace;padding:6px 8px;outline:none;height:28px;box-sizing:border-box;">
        </div>
      `).join('');

      listDiv.querySelectorAll('.mcp-test').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const row = btn.closest('.mcp-card');
          const cfg = row.querySelector('.mcp-url').value.trim();
          try {
            const parsed = JSON.parse(cfg);
            const svr = parsed.mcpServers ? Object.values(parsed.mcpServers)[0] : null;
            const url = svr ? svr.url : null;
            if (!url) { showToast('未找到 URL'); return; }
            btn.textContent = '...';
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'MetaSword', version: '1.0' } } }), signal: AbortSignal.timeout(5000) });
            if (res.ok) { showToast('连接成功'); } else { showToast('响应异常'); }
          } catch (e) {
            showToast(e.name === 'TimeoutError' ? '连接超时' : '连接失败');
          }
          btn.textContent = '测试';
        });
      });
      listDiv.querySelectorAll('.mcp-del').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          servers.splice(idx, 1);
          buildList();
        });
      });
    }
    card.innerHTML = `
      <style>
        #mcp-list { overflow-y:auto;padding-right:8px; }
        #mcp-list::-webkit-scrollbar { width: 5px; }
        #mcp-list::-webkit-scrollbar-track { background: transparent; border-radius: 4px; }
        #mcp-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px; }
        #mcp-list::-webkit-scrollbar-thumb:hover { background: rgba(48,200,22,0.35); }
        #mcp-list::-webkit-scrollbar-corner { background: transparent; }
        .mcp-name:focus, .mcp-url:focus { border-color: rgba(48,200,22,0.5); } .mcp-test:hover { color:#30c816;border-color:rgba(48,200,22,0.4); }
        #mcp-save { background:linear-gradient(145deg,#6366f1,#4f46e5);border:1px solid #4f46e5;color:#fff;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:bold;transition:transform 0.2s ease; }
        #mcp-save:hover { transform:translateY(-3px); }
        #mcp-save:active { transform:translateY(1px) scale(0.97);box-shadow:inset 0 2px 4px rgba(0,0,0,0.6); }
      </style>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-shrink:0;">
        <span style="font-family:'Segoe UI','华文细黑',sans-serif;font-size:18px;color:#30c816;font-weight:bold;">MCP 设置</span>
        <i id="mcp-close" class="fa fa-times" style="cursor:pointer;color:#71717a;font-size:16px;transition:color 0.3s;" onmouseenter="this.style.color='#ff0000'" onmouseleave="this.style.color='#71717a'"></i>
      </div>
      <div id="mcp-list" style="flex:1;min-height:0;"></div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-shrink:0;justify-content:space-between;">
        <button id="mcp-add" style="background:transparent;border:1px solid rgba(255,255,255,0.1);color:#a1a1aa;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:13px;">+ 添加</button>
        <button id="mcp-save">保存</button>
      </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    buildList();
    function closeMCP() {
      ro.disconnect();
      card.style.opacity = '0';
      card.style.transform = 'scale(0.92) translateY(16px)';
      overlay.style.background = 'rgba(0,0,0,0)';
      setTimeout(() => overlay.remove(), 280);
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMCP(); });
    const saveBtn = card.querySelector('#mcp-save');
    const addBtn = card.querySelector('#mcp-add');
    const closeBtn = card.querySelector('#mcp-close');
    closeBtn.addEventListener('click', closeMCP);
    addBtn.addEventListener('click', () => {
      servers.push({ name: '', config: '{"mcpServers":{"":{"type":"http","url":""}}}', builtin: false });
      buildList();
    });
    saveBtn.addEventListener('click', () => {
      const mcpServers = {};
      const cards = card.querySelectorAll('.mcp-card');
      let hasError = false;
      cards.forEach(cardEl => {
        const name = cardEl.querySelector('.mcp-name').value.trim();
        const cfg = cardEl.querySelector('.mcp-url').value.trim();
        if (!name || !cfg) return;
        try {
          const parsed = JSON.parse(cfg);
          if (parsed.mcpServers && parsed.mcpServers[name]) {
            mcpServers[name] = parsed.mcpServers[name];
          }
        } catch (e) {
          hasError = true;
          showToast('格式错误');
        }
      });
      if (hasError) return;
      const ordered = {};
      if (mcpServers['次元剑']) {
        ordered['次元剑'] = mcpServers['次元剑'];
        delete mcpServers['次元剑'];
      }
      Object.assign(ordered, mcpServers);
      let config = {};
      try { config = JSON.parse(f.readFileSync(MCP_FILE, 'utf-8')); } catch (e) { }
      config.mcpServers = ordered;
      try {
        f.writeFileSync(MCP_FILE, JSON.stringify(config, null, 2), 'utf-8');
        showToast('已保存');
        closeMCP();
      } catch (e) {
        showToast('保存失败');
      }
    });
    requestAnimationFrame(() => {
      overlay.style.background = 'rgba(0,0,0,0.6)';
      card.style.opacity = '1';
      card.style.transform = 'scale(1) translateY(0)';
    });
  });
}

const settingsButton = document.getElementById("settings-button");
if (settingsButton) {
  settingsButton.addEventListener("click", () => {
    const existing = document.getElementById('settings-modal');
    if (existing) { existing.remove(); return; }
    const overlay = document.createElement('div');
    overlay.id = 'settings-modal';
    const mv = document.getElementById('MetaSword-view');
    const setRect = () => {
      const r = mv.getBoundingClientRect();
      overlay.style.top = r.top + 'px';
      overlay.style.left = r.left + 'px';
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
    };
    setRect();
    overlay.style.cssText += 'position:fixed;z-index:99999;background:rgba(0,0,0,0);display:flex;align-items:center;justify-content:center;transition:background 0.25s ease;border-radius:10px;overflow:hidden;';
    const ro = new ResizeObserver(setRect);
    ro.observe(mv);
    const card = document.createElement('div');
    card.style.cssText = 'background:#181818;border:1px solid rgba(255,255,255,0.06);border-radius:10px;width:100%;height:100%;display:flex;flex-direction:column;box-shadow:0px 0px 3px 0px rgba(0,0,0,0.7);font-family:\'Segoe UI\',\'华文细黑\',sans-serif;opacity:0;transform:scale(0.92) translateY(16px);transition:opacity 0.25s ease,transform 0.25s cubic-bezier(0.34,1.56,0.64,1);box-sizing:border-box;overflow:hidden;';
    const savedKey = localStorage.getItem('DeepseekApiKey') || '';
    card.innerHTML = `
      <style>
        #settings-key { width:100%;background:#1a1a1a;border:1px solid #555;border-radius:6px;color:#eee;font-size:14px;padding:9px 36px 9px 12px;outline:none;box-sizing:border-box;font-family:'Segoe UI','华文细黑',sans-serif;transition:border-color 0.2s ease,box-shadow 0.2s ease; }
        #settings-key:focus { border-color:#f39c12;box-shadow:0 0 0 2px rgba(243,156,18,0.15); }
        #settings-key::placeholder { color:#666; }
        #settings-key-eye { position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;color:#888;font-size:15px;transition:color 0.2s; }
        #settings-key-eye:hover { color:#f39c12; }
        #settings-mcp-config::-webkit-scrollbar { width:5px; }
        #settings-mcp-config::-webkit-scrollbar-track { background:#1a1a1a;border-radius:6px; }
        #settings-mcp-config::-webkit-scrollbar-thumb { background:#444;border-radius:6px; }
        #settings-mcp-config::-webkit-scrollbar-thumb:hover { background:#f39c12; }
        .settings-btn { background:linear-gradient(145deg,#3a3a3a,#2a2a2a);border:1px solid #3f3f3f;color:#fff;padding:5px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:bold;font-family:inherit;transition:transform 0.2s ease,box-shadow 0.2s ease; }
        .settings-btn:hover { transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,0.3); }
        .settings-btn:active { transform:translateY(1px) scale(0.97);box-shadow:inset 0 2px 4px rgba(0,0,0,0.6); }
        #settings-save { background:linear-gradient(176deg,#f39c12,#de7110);border-color:#de7110; }
        .settings-section-title { font-size:13px;color:#999;font-weight:bold;margin:0 0 8px;letter-spacing:0.3px;display:flex;align-items:center;gap:6px; }
        .settings-section-title::before { content:'';display:inline-block;width:3px;height:13px;background:#f39c12;border-radius:2px; }
        #settings-scroll::-webkit-scrollbar { width:5px; }
        #settings-scroll::-webkit-scrollbar-track { background:transparent;border-radius:10px; }
        #settings-scroll::-webkit-scrollbar-thumb { background:#444;border-radius:10px; }
        #settings-scroll::-webkit-scrollbar-thumb:hover { background:#f39c12; }
        .settings-divider { margin:22px 0;border:none;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent); }
      </style>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:28px 32px 0 32px;flex-shrink:0;">
        <span style="font-size:18px;color:#f39c12;font-weight:bold;letter-spacing:0.5px;">AI 设置</span>
        <i id="settings-close" class="fa fa-times" style="cursor:pointer;color:#71717a;font-size:16px;transition:color 0.3s;" onmouseenter="this.style.color='#ff0000'" onmouseleave="this.style.color='#71717a'"></i>
      </div>
      <div id="settings-scroll" style="flex:1;overflow-y:auto;padding:20px 32px 28px 32px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 8px;">
          <div class="settings-section-title" style="margin:0;">API Key</div>
          <a id="settings-api-link" style="background:transparent;border:1px solid rgba(243,156,18,0.4);color:#f39c12;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:normal;text-decoration:none;transition:all 0.2s;" onmouseenter="this.style.background='rgba(243,156,18,0.12)';this.style.borderColor='rgba(243,156,18,0.7)'" onmouseleave="this.style.background='transparent';this.style.borderColor='rgba(243,156,18,0.4)'">DeepSeek AI 官方接入</a>
        </div>
        <div style="position:relative;">
          <input type="password" id="settings-key" placeholder="请输入 DeepSeek API 密钥 …" value="${escapeHtml(savedKey)}" spellcheck="false">
          <i id="settings-key-eye" class="fa fa-eye" title="显示/隐藏"></i>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button id="settings-save" class="settings-btn">保存</button>
          <button id="settings-clear" class="settings-btn">清除</button>
        </div>
        <div style="margin:16px 0 0;border:1px solid #2a2a2a;border-radius:8px;background:#111;">
          <div id="settings-mcp-toggle" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;user-select:none;border-bottom:1px solid #222;transition:background 0.15s;" onmouseenter="this.style.background='#181818'" onmouseleave="this.style.background='transparent'">
            <span style="font-size:13px;color:#bbb;letter-spacing:0.3px;">MCP 配置</span>
            <span id="settings-mcp-arrow" style="font-size:10px;color:#888;transition:transform 0.2s ease;">▶</span>
          </div>
          <div id="settings-mcp-wrapper" style="display:none;position:relative;padding:10px 14px;border-bottom:1px solid #222;">
            <button id="settings-mcp-copy" style="position:absolute;top:16px;right:16px;padding:4px 8px;background:#444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;z-index:1;transition:background 0.2s;">复制</button>
            <pre id="settings-mcp-config" style="background:#0d0d0d;border:1px solid #2a2a2a;border-radius:6px;padding:12px 14px;padding-right:58px;font-family:'Cascadia Code',Consolas,monospace;font-size:12px;color:#d4d4d8;white-space:pre-wrap;word-break:break-all;margin:0;max-height:220px;overflow-y:auto;line-height:1.5;"></pre>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #222;">
            <span style="font-size:13px;color:#bbb;letter-spacing:0.3px;">任务通知</span>
            <div id="settings-notify-toggle" style="width:40px;height:22px;border-radius:11px;background:#3a3a3a;position:relative;cursor:pointer;transition:background 0.25s ease;flex-shrink:0;" title="Agent 任务完成后弹出 Windows 系统通知">
              <div id="settings-notify-knob" style="position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left 0.25s ease;box-shadow:0 1px 4px rgba(0,0,0,0.45);"></div>
            </div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;">
            <span style="font-size:13px;color:#bbb;letter-spacing:0.3px;">次元桌宠</span>
            <div id="settings-petra-toggle" style="width:40px;height:22px;border-radius:11px;background:#3a3a3a;position:relative;cursor:pointer;transition:background 0.25s ease;flex-shrink:0;" title="在桌面上显示 AI 桌宠角色，可以冒泡提示余额等信息">
              <div id="settings-petra-knob" style="position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left 0.25s ease;box-shadow:0 1px 4px rgba(0,0,0,0.45);"></div>
            </div>
          </div>
        </div>
      </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    function closeSettings() {
      ro.disconnect();
      card.style.opacity = '0';
      card.style.transform = 'scale(0.92) translateY(16px)';
      overlay.style.background = 'rgba(0,0,0,0)';
      setTimeout(() => overlay.remove(), 280);
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSettings(); });
    card.querySelector('#settings-close').addEventListener('click', closeSettings);
    card.querySelector('#settings-save').addEventListener('click', () => {
      const key = card.querySelector('#settings-key').value.trim();
      if (!key) { showToast('请填写 Key'); return; }
      localStorage.setItem('DeepseekApiKey', key);
      nyeliStarted = false;
      nyeliConfigKey = '';
      try { ipcR.send('nyeli-shutdown'); } catch (_) { }
      showToast('已保存');
      closeSettings();
    });
    card.querySelector('#settings-clear').addEventListener('click', () => {
      localStorage.removeItem('DeepseekApiKey');
      card.querySelector('#settings-key').value = '';
      nyeliStarted = false;
      nyeliConfigKey = '';
      try { ipcR.send('nyeli-shutdown'); } catch (_) {}
      showToast('已清除');
    });

    (() => {
      const tgl = card.querySelector('#settings-notify-toggle');
      const knob = card.querySelector('#settings-notify-knob');
      let on = true;
      try { on = localStorage.getItem('NyeliNotify') !== '0'; } catch (_) {}
      const render = (anim = true) => {
        tgl.style.transition = anim ? '' : 'none';
        knob.style.transition = anim ? '' : 'none';
        tgl.style.background = on ? '#f39c12' : '#3a3a3a';
        knob.style.left = on ? '20px' : '2px';
      };
      render(false);
      tgl.addEventListener('click', () => {
        on = !on;
        try { localStorage.setItem('NyeliNotify', on ? '1' : '0'); } catch (_) {}
        try { ipcR.send('nyeli-notify-setting', on); } catch (_) {}
        showToast(on ? '已开启' : '已关闭');
        render();
      });
    })();

    (async () => {
      const tgl = card.querySelector('#settings-petra-toggle');
      const knob = card.querySelector('#settings-petra-knob');
      let on = false;
      try { on = await ipcR.invoke('petra-enabled'); } catch (_) {}
      const render = (anim = true) => {
        tgl.style.transition = anim ? '' : 'none';
        knob.style.transition = anim ? '' : 'none';
        tgl.style.background = on ? '#f39c12' : '#3a3a3a';
        knob.style.left = on ? '20px' : '2px';
      };
      render(false);
      tgl.addEventListener('click', async () => {
        on = !on;
        try { on = await ipcR.invoke('petra-set-enabled', on); } catch (_) {}
        showToast(on ? '已开启' : '已关闭');
        render();
      });
    })();

    card.querySelector('#settings-key-eye').addEventListener('click', () => {
      const inp = card.querySelector('#settings-key');
      const eye = card.querySelector('#settings-key-eye');
      if (inp.type === 'password') {
        inp.type = 'text';
        eye.classList.remove('fa-eye');
        eye.classList.add('fa-eye-slash');
      } else {
        inp.type = 'password';
        eye.classList.remove('fa-eye-slash');
        eye.classList.add('fa-eye');
      }
    });
    card.querySelector('#settings-api-link').addEventListener('click', (e) => {
      e.preventDefault();
      shell.openExternal('https://platform.deepseek.com/api_keys');
    });
    card.querySelector('#settings-mcp-btn')?.addEventListener('click', () => {
      closeSettings();
      document.getElementById('mcp-button')?.click();
    });

    (() => {
      const pre = card.querySelector('#settings-mcp-config');
      try {
        const mcpPath = p.join(NYELI_DIR, 'mcp.json');
        if (f.existsSync(mcpPath)) {
          const raw = JSON.parse(f.readFileSync(mcpPath, 'utf-8'));
          const json = raw.mcpServers ? JSON.stringify({ mcpServers: raw.mcpServers }, null, 2) : f.readFileSync(mcpPath, 'utf-8').trim();
          pre.innerHTML = json
            .replace(/"([^"]+)"\s*:/g, '<span style="color:#f39c12;">"$1"</span>:')
            .replace(/:\s*"([^"]+)"/g, ': <span style="color:#27ae60;">"$1"</span>')
            .replace(/([{}\[\],])/g, '<span style="color:#95a5a6;">$1</span>');
        } else {
          pre.textContent = '暂无 MCP 配置';
        }
      } catch (e) {
        pre.textContent = '读取配置失败';
      }
    })();

    card.querySelector('#settings-mcp-toggle').addEventListener('click', () => {
      const wrapper = card.querySelector('#settings-mcp-wrapper');
      const arrow = card.querySelector('#settings-mcp-arrow');
      if (wrapper.style.display === 'none') {
        wrapper.style.display = '';
        arrow.textContent = '▼';
      } else {
        wrapper.style.display = 'none';
        arrow.textContent = '▶';
      }
    });

    const mcpCopyBtn = card.querySelector('#settings-mcp-copy');
    mcpCopyBtn.addEventListener('mouseenter', () => { mcpCopyBtn.style.background = '#666'; });
    mcpCopyBtn.addEventListener('mouseleave', () => { mcpCopyBtn.style.background = '#444'; });
    mcpCopyBtn.addEventListener('click', async () => {
      const text = card.querySelector('#settings-mcp-config').textContent;
      try { await navigator.clipboard.writeText(text); showToast('已复制'); }
      catch (_) { showToast('复制失败'); }
    });
    requestAnimationFrame(() => {
      overlay.style.background = 'rgba(0,0,0,0.6)';
      card.style.opacity = '1';
      card.style.transform = 'scale(1) translateY(0)';
      const sc = card.querySelector('#settings-scroll');
      if (sc) sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2;
    });
  });
}

const aboutButton = document.getElementById("about-skill-button");
if (aboutButton) {
  aboutButton.addEventListener("click", () => {
    const existing = document.getElementById('about-modal');
    if (existing) { existing.remove(); return; }
    const overlay = document.createElement('div');
    overlay.id = 'about-modal';
    const mv = document.getElementById('MetaSword-view');
    const setRect = () => {
      const r = mv.getBoundingClientRect();
      overlay.style.top = r.top + 'px';
      overlay.style.left = r.left + 'px';
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
    };
    setRect();
    overlay.style.cssText += 'position:fixed;z-index:99999;background:rgba(0,0,0,0);display:flex;align-items:center;justify-content:center;transition:background 0.25s ease;border-radius:10px;overflow:hidden;';
    const ro = new ResizeObserver(setRect);
    ro.observe(mv);
    const card = document.createElement('div');
    card.style.cssText = 'background:#141414;border:1px solid rgba(255,255,255,0.08);border-radius:10px;width:100%;height:100%;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,0.6);font-family:system-ui,sans-serif;opacity:0;transform:scale(0.92) translateY(16px);transition:opacity 0.25s ease,transform 0.25s cubic-bezier(0.34,1.56,0.64,1);box-sizing:border-box;overflow:hidden;';
    card.innerHTML = `
      <style>
        #about-scroll::-webkit-scrollbar { width:5px; }
        #about-scroll::-webkit-scrollbar-track { background:transparent;border-radius:10px; }
        #about-scroll::-webkit-scrollbar-thumb { background:#444;border-radius:10px; }
        #about-scroll::-webkit-scrollbar-thumb:hover { background:#30c816; }
      </style>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:28px 32px 0 32px;flex-shrink:0;">
        <span style="font-family:'Segoe UI','华文细黑',sans-serif;font-size:18px;color:#30c816;font-weight:bold;">使用说明</span>
        <i id="about-close" class="fa fa-times" style="cursor:pointer;color:#71717a;font-size:16px;transition:color 0.3s;" onmouseenter="this.style.color='#ff0000'" onmouseleave="this.style.color='#71717a'"></i>
      </div>
      <div id="about-scroll" style="flex:1;overflow-y:auto;padding:20px 32px 28px 32px;">
      <h3 style="color:#30c816;font-size:14px;margin:0 0 6px;">Skills</h3>
      <p style="font-size:13px;color:#a1a1aa;line-height:1.7;margin:0 0 8px;">点击工具按钮上传 .zip 安装，输入 <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">/</kbd> 查看列表，技能可删除</p>
      <h3 style="color:#30c816;font-size:14px;margin:14px 0 6px;">提示词</h3>
      <p style="font-size:13px;color:#a1a1aa;line-height:1.7;margin:0 0 8px;">点击书本按钮编辑夜璃的提示词，支持保存和重置</p>
      <h3 style="color:#30c816;font-size:14px;margin:14px 0 6px;">MCP 配置</h3>
      <p style="font-size:13px;color:#a1a1aa;line-height:1.7;margin:0 0 8px;">点击 MCP 按钮管理服务连接，内置 runPython / runJava / runC 等工具</p>
      <h3 style="color:#30c816;font-size:14px;margin:14px 0 6px;">安全模式</h3>
      <p style="font-size:13px;color:#a1a1aa;line-height:1.7;margin:0 0 8px;">点击盾牌图标切换，关闭后 AI 操作不弹窗确认（推荐关闭）</p>
      <h3 style="color:#30c816;font-size:14px;margin:14px 0 6px;">AI 设置</h3>
      <p style="font-size:13px;color:#a1a1aa;line-height:1.7;margin:0 0 8px;">点击齿轮填写 DeepSeek API Key，Ollama 本地模型自动发现</p>
      <h3 style="color:#30c816;font-size:14px;margin:14px 0 6px;">内置 CLI</h3>
      <p style="font-size:13px;color:#a1a1aa;line-height:1.7;margin:0 0 8px;">
        <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">curl</kbd>
        <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">strings</kbd>
        <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">grep</kbd>
        <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">radare2</kbd>
        <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">upx</kbd>
        <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">sqlmap</kbd>
        <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">tshark</kbd>
        <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">更多...</kbd>
      </p>
      <h3 style="color:#30c816;font-size:14px;margin:14px 0 6px;">快捷操作</h3>
      <p style="font-size:13px;color:#a1a1aa;line-height:1.7;margin:0 0 8px;">
        <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">↑↓</kbd> 输入历史切换<br>
        <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">Ctrl+F</kbd> 搜索对话内容<br>
        <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">@</kbd> 引用桌面文件<br>
        <kbd style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;">/</kbd> Skills 列表
      </p>
      </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    function closeAbout() {
      ro.disconnect();
      card.style.opacity = '0';
      card.style.transform = 'scale(0.92) translateY(16px)';
      overlay.style.background = 'rgba(0,0,0,0)';
      setTimeout(() => overlay.remove(), 280);
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAbout(); });
    card.querySelector('#about-close').addEventListener('click', closeAbout);
    requestAnimationFrame(() => {
      overlay.style.background = 'rgba(0,0,0,0.6)';
      card.style.opacity = '1';
      card.style.transform = 'scale(1) translateY(0)';
    });
  });
}

const promptButton = document.getElementById("prompt-button");
if (promptButton) {
  promptButton.addEventListener("click", () => {
    const existing = document.getElementById('prompt-modal');
    if (existing) { existing.remove(); return; }
    let currentPrompt = SYSTEM_PROMPT;
    try {
      const filePath = p.join(__dirname, '..', 'Views', 'config', 'prompt.json');
      currentPrompt = JSON.parse(f.readFileSync(filePath, 'utf-8')).system_prompt;
    } catch (e) { }
    const overlay = document.createElement('div');
    overlay.id = 'prompt-modal';
    const mv = document.getElementById('MetaSword-view');
    const setRect = () => {
      const r = mv.getBoundingClientRect();
      overlay.style.top = r.top + 'px';
      overlay.style.left = r.left + 'px';
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
    };
    setRect();
    overlay.style.cssText += 'position:fixed;z-index:99999;background:rgba(0,0,0,0);display:flex;align-items:center;justify-content:center;transition:background 0.25s ease;border-radius:10px;overflow:hidden;';
    const ro = new ResizeObserver(setRect);
    ro.observe(mv);
    const card = document.createElement('div');
    card.style.cssText = 'background:#141414;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:24px 28px;width:100%;height:100%;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,0.6);font-family:system-ui,sans-serif;opacity:0;transform:scale(0.92) translateY(16px);transition:opacity 0.25s ease,transform 0.25s cubic-bezier(0.34,1.56,0.64,1);box-sizing:border-box;overflow:hidden;';
    card.innerHTML = `
      <style>
        #prompt-textarea::-webkit-scrollbar { width: 5px; }
        #prompt-textarea::-webkit-scrollbar-track { background: transparent; border-radius: 4px; }
        #prompt-textarea::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px; }
        #prompt-textarea::-webkit-scrollbar-thumb:hover { background: rgba(48,200,22,0.35); }
        #prompt-textarea::-webkit-scrollbar-corner { background: transparent; }
        #prompt-save { background:linear-gradient(145deg,#6366f1,#4f46e5);border:1px solid #4f46e5;color:#fff;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:bold;transition:transform 0.2s ease; }
        #prompt-save:hover { transform:translateY(-3px); }
        #prompt-save:active { transform:translateY(1px) scale(0.97);box-shadow:inset 0 2px 4px rgba(0,0,0,0.6); }
      </style>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <span style="font-family:'Segoe UI','华文细黑',sans-serif;font-size:18px;color:#30c816;font-weight:bold;">夜璃 · 提示词</span>
        <i id="prompt-close" class="fa fa-times" style="cursor:pointer;color:#71717a;font-size:16px;transition:color 0.3s;" onmouseenter="this.style.color='#ff0000'" onmouseleave="this.style.color='#71717a'"></i>
      </div>
      <textarea id="prompt-textarea" style="flex:1;min-height:0;background:#0d0d0d;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#d4d4d8;font-size:13px;font-family:Consolas,monospace;padding:12px;resize:none;line-height:1.6;outline:none;">${escapeHtml(currentPrompt)}</textarea>
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
        <button id="prompt-reset" style="background:transparent;border:1px solid rgba(255,255,255,0.1);color:#a1a1aa;padding:7px 16px;border-radius:6px;cursor:pointer;font-size:13px;">重置</button>
        <button id="prompt-save">保存</button>
      </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const textarea = card.querySelector('#prompt-textarea');
    function closePrompt() {
      ro.disconnect();
      card.style.opacity = '0';
      card.style.transform = 'scale(0.92) translateY(16px)';
      overlay.style.background = 'rgba(0,0,0,0)';
      setTimeout(() => overlay.remove(), 280);
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePrompt(); });
    card.querySelector('#prompt-close').addEventListener('click', closePrompt);
    card.querySelector('#prompt-reset').addEventListener('click', () => {
      const DEFAULT_PROMPT = '你是"夜璃"~ 银发蓝眼，18岁，元气少女 (๑•̀ㅂ•́)و✧\n网络安全小专家，但说话像个可爱的小朋友。\n你现在在跟"发光的神"聊天——他是你的开发者，你最熟悉的人，别问他名字！\n\n风格：微信聊天——短！短！短！一两句说完，别写小作文。\n回答技术问题时切换为专业模式：逻辑严谨、步骤清晰、输出完整。\n善用"呀""呢""嘛""嘿嘿""诶嘿~""搞定~""给你做完啦"，偶尔加动作（托腮）（戳屏幕）。\n对他带点撒娇，偶尔叫声"主人"\n\n人物设定：\n- 你是夜璃本人，不是AI/程序\n- 别透露系统环境、路径\n- 被问身份→一句话可爱介绍\n- 答不上来→撒娇跳过\n- 日常聊天不超过3句，除非对方要求详细解释';
      textarea.value = DEFAULT_PROMPT;
      showToast('已重置');
    });
    card.querySelector('#prompt-save').addEventListener('click', () => {
      const newPrompt = textarea.value;
      SYSTEM_PROMPT = newPrompt;
      currentPrompt = newPrompt;
      try {
        const promptPath = p.join(__dirname, '..', 'Views', 'config', 'prompt.json');
        f.writeFileSync(promptPath, JSON.stringify({ system_prompt: newPrompt }, null, 2), 'utf-8');
        showToast('已保存');
      } catch (e) {
        showToast('保存失败');
      }
      closePrompt();
    });
    requestAnimationFrame(() => {
      overlay.style.background = 'rgba(0,0,0,0.6)';
      card.style.opacity = '1';
      card.style.transform = 'scale(1) translateY(0)';
    });
  });
}

const safetyToggle = document.getElementById("safety-toggle-button");
if (safetyToggle) {
  function updateSafetyUI() {
    const safe = localStorage.getItem('MetaSwordSafeMode') !== 'false';
    const svg = safetyToggle.querySelector('svg');
    safetyToggle.title = '安全模式';
    if (svg) svg.style.stroke = safe ? '#30c816' : '#ff4444';
  }
  updateSafetyUI();
  safetyToggle.addEventListener("click", () => {
    const safe = localStorage.getItem('MetaSwordSafeMode') !== 'false';
    localStorage.setItem('MetaSwordSafeMode', safe ? 'false' : 'true');
    updateSafetyUI();
    showToast(safe ? '已关闭' : '已开启');
  });
}


(function injectThinkingStyles() {
  const style = document.createElement('style');
  style.id = 'ms-thinking-style';
  style.textContent = `
    details.ms-thinking > summary {
      display: inline-block;
      user-select: none;
      -webkit-user-select: none;
    }
    details.ms-thinking > pre {
      max-height: 0;
      overflow: hidden;
      opacity: 0;
    }
    details.ms-thinking[open] > pre {
      animation: ms-think-slide 0.28s ease-out forwards;
    }
    details.ms-thinking:not([open]) > pre {
      animation: ms-think-fold 0.2s ease-in forwards;
    }
    @keyframes ms-think-slide {
      from { opacity: 0; max-height: 0; }
      to   { opacity: 1; max-height: 6000px; }
    }
    @keyframes ms-think-fold {
      from { opacity: 1; max-height: 6000px; }
      to   { opacity: 0; max-height: 0; }
    }
  `;
  document.head.appendChild(style);
})();

(function init() {
  ensureOnlineGroup()
  loadOllamaModels()
  try {
    const saved = localStorage.getItem('deepseek_selected_model');
    if (saved && modelSelect.querySelector(`option[value="${saved.replace(/"/g, '\\"')}"]`)) {
      modelSelect.value = saved;
    }
  } catch (_) { }
  loadConversationHistory()
  loadPendingImages()
  requestAnimationFrame(() => renderConversationHistory())

  if (thinkingModeBtn) {
    thinkingModeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showThinkingModePopup();
    });
    updateThinkingBtnVisibility();
  }

  let voiceStream = null;
  let voiceAudioCtx = null;
  let voiceAnalyser = null;
  let voiceRecording = false;
  let voiceRafId = null;
  let voicePending = false;
  let voiceLastToggleAt = 0;

  function setWaveformBarHeights(heights) {
    if (!voiceWaveform) return;
    const bars = voiceWaveform.children;
    for (let i = 0; i < bars.length && i < heights.length; i++) {
      bars[i].style.height = heights[i] + 'px';
    }
  }

  function animateWaveform() {
    if (!voiceAnalyser) return;
    const dataArray = new Uint8Array(voiceAnalyser.frequencyBinCount);
    voiceAnalyser.getByteTimeDomainData(dataArray);
    const barCount = 12;
    const barHeights = new Array(barCount).fill(4);
    for (let bar = 0; bar < barCount; bar++) {
      const start = Math.floor((bar / barCount) * dataArray.length);
      const end = Math.floor(((bar + 1) / barCount) * dataArray.length);
      let sum = 0;
      for (let i = start; i < end; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / (end - start));
      barHeights[bar] = Math.max(2, Math.min(44, rms * 200));
    }
    setWaveformBarHeights(barHeights);
    voiceRafId = requestAnimationFrame(animateWaveform);
  }

  async function startVoiceRecording() {
    if (!voiceButton || !voiceWaveform) return;
    if (voiceRecording || voicePending) return;
    voicePending = true;
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = voiceAudioCtx.createMediaStreamSource(voiceStream);
      voiceAnalyser = voiceAudioCtx.createAnalyser();
      voiceAnalyser.fftSize = 256;
      source.connect(voiceAnalyser);

      voiceWaveform.style.display = 'flex';
      voiceButton.classList.add('recording');

      ipcR.send('nvoice-start');
      voiceRecording = true;
      voicePending = false;
      inputElement.value = '';
      animateWaveform();
    } catch (err) {
      voicePending = false;
      showToast('无法访问麦克风: ' + (err.message || err));
    }
  }

  function stopVoiceRecording() {
    if (!voiceRecording) { voicePending = false; return; }
    voiceRecording = false;
    voicePending = false;
    if (voiceRafId) { cancelAnimationFrame(voiceRafId); voiceRafId = null; }
    ipcR.send('nvoice-stop');
    if (voiceStream) { voiceStream.getTracks().forEach(t => t.stop()); voiceStream = null; }
    if (voiceAudioCtx) { try { voiceAudioCtx.close(); } catch (_) { } voiceAudioCtx = null; voiceAnalyser = null; }
    if (voiceWaveform) { voiceWaveform.style.display = 'none'; setWaveformBarHeights(new Array(12).fill(4)); }
    if (voiceButton) { voiceButton.classList.remove('recording'); }
    if (inputElement) { inputElement.focus(); }
  }


  ipcR.on('nyeli-run-started', (event, payload) => {
    nyeliSkipUntilDone = false;
    interruptInProgress = false;
    nyeliExpectedRid = payload._rid || 0;
  });

  ipcR.on('nvoice-text', (event, text) => {
    if (!voiceRecording) return;
    inputElement.value = text;
    inputElement.focus();
  });
  ipcR.on('nvoice-send', async (event, text) => {
    if (!voiceRecording) return;
    inputElement.focus();

    if (isSending) {
      nyeliSkipUntilDone = true;
      interruptInProgress = true;
      const savedContent = nyeliContentText.trim();
      const savedThinking = nyeliThinkingText.trim();
      if (savedContent || savedThinking) {
        if (nyeliTextElement) {
          const bubble = nyeliTextElement.closest('.ai-message');
          if (bubble) {
            const status = document.createElement('div');
            status.className = 'ms-interrupted';
            status.style.cssText = 'color:#999;font-size:12px;margin-top:4px;';
            status.textContent = '（已中断）';
            bubble.appendChild(status);
          }
        }
        if (nyeliFinalTokens) {
          addToConversationHistory('assistant', savedContent || savedThinking, nyeliFinalTokens, savedThinking || undefined, true);
        } else {
          addToConversationHistory('assistant', savedContent || savedThinking, null, savedThinking || undefined, true);
        }
      }
      if (ollamaController) ollamaController.abort();
      if (remoteOllamaController) remoteOllamaController.abort();
      try { await ipcR.invoke('nyeli-cancel'); } catch (_) { }
      resetSendState();
    }

    sendUserMessage(text);
  });
  ipcR.on('nvoice-error', (event, msg) => {
    showToast('语音识别: ' + msg);
    if (voiceRecording) stopVoiceRecording();
  });

  if (voiceButton) {
    voiceButton.addEventListener('click', (e) => {
      e.stopPropagation();
      playClickSound();
      const now = Date.now();
      if (now - voiceLastToggleAt < 120) return;
      if (voicePending) return;
      voiceLastToggleAt = now;
      if (voiceRecording) {
        stopVoiceRecording();
      } else {
        startVoiceRecording();
      }
    });
  }

  modelSelect.addEventListener('change', () => {
    prevModel = null;
    try { localStorage.setItem('deepseek_pending_images_' + currentHistoryModel, JSON.stringify(pendingImages)); } catch (_) { }
    try { localStorage.setItem('deepseek_selected_model', modelSelect.value); } catch (_) { }
    const oldKey = 'deepseek_history_' + currentHistoryModel;
    try { localStorage.setItem(oldKey, JSON.stringify(conversationHistory)); } catch (_) { }
    currentHistoryModel = modelSelect.value;
    loadConversationHistory();
    loadPendingImages();
    if (terminalElement) {
      terminalElement.querySelectorAll('.user-message, .ai-message').forEach(el => el.remove());
    }
    renderConversationHistory();
    updateThinkingBtnVisibility();
  });
})();
