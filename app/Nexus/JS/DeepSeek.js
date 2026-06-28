/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.0.9
 * @Since       2023-08-31
 * @LastUpdated 2026-06-28
 * @Description 负责 AI 聊天逻辑（DeepSeek / ChatGPT / 本地-远程 Ollama / MCP 调用）
 * @License     MIT
 */

const { spawn: spawnCmd, exec: execCmd, execSync: execSyncCmd } = require('child_process');
const axios = require('axios');
const marked = require('marked');
const os = require('os');
const p = require('path');
const f = require('fs');

const { ipcRenderer: ipcR, shell } = require('electron');
const CLAUDE_EXE = p.join(__dirname, '..', '..', 'Plugins', 'claude', 'claude.exe');
const CLAUDE_DIR = p.dirname(CLAUDE_EXE);
let claudeProcess = null;

const inputElement = document.getElementById("MetaSword-input");
const terminalElement = document.getElementById("MetaSword-terminal");
const clearButton = document.getElementById("clear-button");
const modelSelect = document.getElementById("AI-model-select");
const closeButton = document.getElementById("close-button");

const inputAreaElement = document.getElementById("MetaSword-input-area");
if (inputAreaElement) {
  inputAreaElement.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); inputAreaElement.style.borderColor = '#30c816'; });
  inputAreaElement.addEventListener('dragleave', () => { inputAreaElement.style.borderColor = ''; });
  inputAreaElement.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); inputAreaElement.style.borderColor = '';
    const files = e.dataTransfer?.files; if (files && files.length > 0) { const paths = []; for (const file of files) paths.push(file.path || file.name); const cur = inputElement.value.trim(); inputElement.value = cur + (cur ? ' ' : '') + paths.join(' '); inputElement.focus(); }
  });
}

let isSending = false;
let autoScroll = true;
let streamActive = false;
let lastScrollTop = 0;
let lastScrollTime = 0;
let scrollEndTimer = null;

let ollamaController;
let remoteOllamaController;

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
    if (!selectedText) return;
    e.preventDefault();
    showInputContextMenu(e.clientX, e.clientY, [{ label: '复制', action: () => navigator.clipboard.writeText(selectedText).catch(() => { }) }]);
  });
  inputElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showInputContextMenu(e.clientX, e.clientY, [
      { label: '粘贴', action: async () => { try { const text = await navigator.clipboard.readText(); const s = inputElement.selectionStart; const e2 = inputElement.selectionEnd; inputElement.value = inputElement.value.slice(0, s) + text + inputElement.value.slice(e2); inputElement.focus(); } catch (_) { } } },
      { label: '复制', action: () => { const s = inputElement.value.slice(inputElement.selectionStart, inputElement.selectionEnd); if (s) navigator.clipboard.writeText(s).catch(() => { }); } },
      { label: '剪切', action: () => { const s = inputElement.value.slice(inputElement.selectionStart, inputElement.selectionEnd); if (s) { navigator.clipboard.writeText(s).catch(() => { }); inputElement.value = inputElement.value.slice(0, inputElement.selectionStart) + inputElement.value.slice(inputElement.selectionEnd); } } },
      { type: 'separator' },
      { label: '全选', action: () => inputElement.select() }
    ]);
  });
  function showInputContextMenu(x, y, items) {
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
  toggleCloseButtonIcon(false);
  removeLoadingIndicator();
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
  toastEl.style.opacity = '1';
  toastEl.style.transform = 'translateX(-50%) translateY(0)';
  toastTimer = setTimeout(() => {
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translateX(-50%) translateY(-8px)';
  }, duration);
}

let conversationHistory = [];
let currentHistoryModel = '';
const MAX_HISTORY_LENGTH = 20;

function getHistoryKey() {
  return 'deepseek_history_' + (modelSelect?.value || 'default');
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
    displayTextSlowly(entry.content, entry.role, entry.model || undefined);
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

function addToConversationHistory(role, content, tokens) {

  if (role === 'user' && content.includes('继续执行刚才的操作')) return;
  const modelLabel = modelSelect?.options[modelSelect.selectedIndex]?.textContent || '';
  conversationHistory.push({ role, content, tokens, model: modelLabel });
  saveConversationHistory();
}

function clearConversationHistory() {
  conversationHistory = [];
  localStorage.removeItem(getHistoryKey());
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

function getClaudeApiKey() {
  return localStorage.getItem('ClaudeApiKey') || localStorage.getItem('DeepseekApiKey') || '';
}

function buildFullPrompt() {
  let p = SYSTEM_PROMPT;
  try {
    const skills = getSkills();
    if (skills.length) p += '\n\nSkills: ' + skills.map(s => '/' + s.name).join(', ');
  } catch (_) {}
  return p;
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
    elRef.el.style.cssText = 'color:#d4d4d8;font-size:11px;text-align:right;margin-top:6px;font-weight:500';
    bubble.appendChild(elRef.el);
  }
  return elRef.el;
}

function requestClaude(inputText, modelLabel) {
  const apiKey = getClaudeApiKey();
  if (!apiKey) {
    showToast('请填写 Key');
    return;
  }

  createLoadingIndicator();
  let fullText = ''; let textElement = null;
  let claudeCharCount = 0;
  let claudeTokenRef = { el: null };
  let claudeFinalTokens = null;
  const getClaudeBubble = () => textElement?.closest('.ai-message') || textElement?.parentElement;
  const updateClaudeTokenUI = () => {
    const bubble = getClaudeBubble();
    if (!bubble) return;
    const el = ensureTokenLabel(bubble, claudeTokenRef);
    const text = formatTokenText(claudeFinalTokens, claudeCharCount);
    if (text) el.textContent = text;
  };

  const env = { ...process.env };
  env.HOME = CLAUDE_DIR;
  env.USERPROFILE = CLAUDE_DIR;
  env.ANTHROPIC_AUTH_TOKEN = apiKey;
  env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
  env.ANTHROPIC_MODEL = (modelSelect.value === 'claude-flash') ? 'deepseek-v4-flash' : 'deepseek-v4-pro';

  const isSafeMode = localStorage.getItem('MetaSwordSafeMode') !== 'false';
  const args = [
    '-p', inputText,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools', 'Edit,Write,PowerShell,Read,Grep,WebFetch,WebSearch',
    '--mcp-config', p.join(CLAUDE_DIR, '.claude.json'),
    '--system-prompt', buildFullPrompt(),
    '--continue',
  ];
  if (!isSafeMode) args.push('--permission-mode', 'bypassPermissions');
  if (modelSelect.value !== 'claude-flash') args.push('--effort', 'max');

  claudeProcess = spawnCmd(CLAUDE_EXE, args, {
    cwd: CLAUDE_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buffer = '';
  const pendingTools = {};

  claudeProcess.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event;
      try { event = JSON.parse(trimmed); }
      catch (e) { continue; }

      const outerType = event.type;

      if (outerType === 'stream_event') {
        const inner = event.event || {};
        const idx = inner.index != null ? inner.index : -1;

        if (inner.type === 'content_block_start') {
          const block = inner.content_block || {};
          if (block.type === 'tool_use') {
            pendingTools[idx] = { name: block.name || '?', id: block.id || '', inputJson: '' };
          }
        } else if (inner.type === 'content_block_delta') {
          const delta = inner.delta || {};
          if (delta.type === 'text_delta') {
            fullText += delta.text || '';
            claudeCharCount += (delta.text || '').length;
            if (!textElement) { removeLoadingIndicator(); textElement = createBubble('', 'ai', modelLabel); }
            textElement.innerHTML = marked.parse(fullText);
            highlightCode(textElement);
            updateClaudeTokenUI();
            scrollToBottomIfNeeded();
          } else if (delta.type === 'input_json_delta' && pendingTools[idx]) {
            pendingTools[idx].inputJson += delta.partial_json || '';
          }
        } else if (inner.type === 'content_block_stop') {
          if (pendingTools[idx]) {
            const tool = pendingTools[idx];
            delete pendingTools[idx];
            let toolInput = {};
            try { toolInput = tool.inputJson ? JSON.parse(tool.inputJson) : {}; }
            catch (e) { }
            ipcR.send('tool-call', {
              tool_name: tool.name,
              tool_input: toolInput,
              tool_id: tool.id
            });
            pendingTools[tool.id] = tool;
          }
        } else if (inner.type === 'message_start') {
          const usage = inner.message?.usage;
          if (usage?.input_tokens) {
            claudeFinalTokens = claudeFinalTokens || {};
            claudeFinalTokens.input = usage.input_tokens;
          }
        } else if (inner.type === 'message_delta') {
          const usage = inner.usage;
          if (usage?.output_tokens) {
            claudeFinalTokens = claudeFinalTokens || {};
            claudeFinalTokens.output = usage.output_tokens;
          }
        }
      } else if (outerType === 'assistant') {
        const msg = event.message || {};
        for (const block of (msg.content || [])) {
          if (block.type === 'tool_result') {
            let content = block.content || '';
            if (Array.isArray(content)) content = content.map(c => c.text || '').join('\n');
            ipcR.send('tool-result', {
              tool_id: block.tool_use_id || '',
              content: String(content)
            });
          }
        }
      } else if (outerType === 'result') {

        const denials = event.permission_denials;
        if (denials && denials.length > 0) {
          if (textElement && fullText.trim()) {
            textElement.innerHTML = marked.parse(fullText);
            highlightCode(textElement);
          }
          scrollToBottomIfNeeded();
          const isSafe = localStorage.getItem('MetaSwordSafeMode') !== 'false';
          if (isSafe) {
            showPermPopup(denials, () => rerunWithBypass(inputText, modelLabel));
          } else {
            resetSendState(); claudeProcess = null;
          }
          return;
        }
        if (event.subtype === 'error') {
          if (!textElement) textElement = createBubble('', 'ai', modelLabel);
          textElement.innerHTML = marked.parse('**Error**: ' + (event.errors || ['Unknown']).join('; '));
        } else {
          if (textElement && fullText.trim()) {
            addToConversationHistory('assistant', fullText, claudeFinalTokens);
          }
        }
      }
    }
  });

  claudeProcess.on('close', (code) => {
    if (textElement && fullText.trim() && code === 0) {
      textElement.innerHTML = marked.parse(fullText);
      highlightCode(textElement);
    }
    updateClaudeTokenUI();
    scrollToBottomIfNeeded();
    resetSendState();
    claudeProcess = null;
  });

  claudeProcess.stderr.on('data', (data) => {
    const text = data.toString('utf-8').trim();
    if (text && !text.includes('no stdin data')) {
      console.log('[claude stderr]', text.slice(0, 200));
    }
  });

  claudeProcess.on('error', (err) => {
    if (!textElement) textElement = createBubble('', 'ai', modelLabel);
    textElement.innerHTML = marked.parse('**Error**: Failed to start Claude: ' + err.message);
    resetSendState();
    claudeProcess = null;
  });
}

function showPermPopup(denials, onAllow) {

  ipcR.removeAllListeners('perm-response');
  ipcR.once('perm-response', (event, data) => {
    if (data.action === 'allow') { ipcR.send('clear-tool-log'); onAllow(); } else resetSendState();
  });

  ipcR.send('perm-request', {
    denials: denials.map(d => ({ tool_name: d.tool_name, tool_input: d.tool_input }))
  });
}

function rerunWithBypass(inputText, modelLabel) {
  const apiKey = getClaudeApiKey();
  if (!apiKey) { resetSendState(); return; }
  const lastAi = terminalElement.querySelector('.ai-message:last-of-type');
  if (lastAi) lastAi.remove();
  removeLoadingIndicator();
  isSending = true; toggleCloseButtonIcon(true);
  createLoadingIndicator();
  let fullText = ''; let textElement = null;
  let retryCharCount = 0;
  let retryTokenRef = { el: null };
  let retryFinalTokens = null;
  const getRetryBubble = () => textElement?.closest('.ai-message') || textElement?.parentElement;
  const updateRetryTokenUI = () => {
    const bubble = getRetryBubble();
    if (!bubble) return;
    const el = ensureTokenLabel(bubble, retryTokenRef);
    const text = formatTokenText(retryFinalTokens, retryCharCount);
    if (text) el.textContent = text;
  };

  const retryPrompt = '继续执行刚才的操作（已批准权限）';

  const env = { ...process.env };
  env.HOME = CLAUDE_DIR; env.USERPROFILE = CLAUDE_DIR;
  env.ANTHROPIC_AUTH_TOKEN = apiKey;
  env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
  env.ANTHROPIC_MODEL = (modelSelect.value === 'claude-flash') ? 'deepseek-v4-flash' : 'deepseek-v4-pro';

  const args = [
    '-p', retryPrompt,
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', 'Edit,Write,PowerShell,Read,Grep,WebFetch,WebSearch',
    '--mcp-config', p.join(CLAUDE_DIR, '.claude.json'),
    '--system-prompt', buildFullPrompt(), '--continue',
    '--permission-mode', 'bypassPermissions',
  ];
  if (modelSelect.value !== 'claude-flash') args.push('--effort', 'max');

  const cp = spawnCmd(CLAUDE_EXE, args, { cwd: CLAUDE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  claudeProcess = cp;
  let buffer = ''; const pendingTools = {};

  cp.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim(); if (!t) continue;
      let e; try { e = JSON.parse(t); } catch (_) { continue; }
      if (e.type === 'stream_event') {
        const i = e.event || {}; const idx = i.index != null ? i.index : -1;
        if (i.type === 'content_block_start' && i.content_block?.type === 'tool_use') {
          pendingTools[idx] = { name: i.content_block.name || '?', id: i.content_block.id || '', inputJson: '' };
        } else if (i.type === 'content_block_delta' && i.delta?.type === 'text_delta') {
          fullText += i.delta.text || '';
          if (!textElement) { removeLoadingIndicator(); textElement = createBubble('', 'ai', modelLabel); }
          textElement.innerHTML = marked.parse(fullText); highlightCode(textElement); scrollToBottomIfNeeded();
          retryCharCount += (i.delta.text || '').length;
          updateRetryTokenUI();
        } else if (i.type === 'content_block_delta' && i.delta?.type === 'input_json_delta' && pendingTools[idx]) {
          pendingTools[idx].inputJson += i.delta.partial_json || '';
        } else if (i.type === 'content_block_stop' && pendingTools[idx]) {
          const tool = pendingTools[idx]; delete pendingTools[idx];
          let ti = {}; try { ti = tool.inputJson ? JSON.parse(tool.inputJson) : {}; } catch (_) { }
          ipcR.send('tool-call', { tool_name: tool.name, tool_input: ti, tool_id: tool.id });
          pendingTools[tool.id] = tool;
        } else if (i.type === 'message_start') {
          const usage = i.message?.usage;
          if (usage?.input_tokens) { retryFinalTokens = retryFinalTokens || {}; retryFinalTokens.input = usage.input_tokens; }
        } else if (i.type === 'message_delta') {
          const usage = i.usage;
          if (usage?.output_tokens) { retryFinalTokens = retryFinalTokens || {}; retryFinalTokens.output = usage.output_tokens; }
        }
      } else if (e.type === 'assistant') {
        for (const b of (e.message?.content || [])) {
          if (b.type === 'tool_result') {
            let c = b.content || '';
            if (Array.isArray(c)) c = c.map(x => x.text || '').join('\n');
            ipcR.send('tool-result', { tool_id: b.tool_use_id || '', content: String(c) });
          }
        }
      } else if (e.type === 'result') {
        if (e.subtype === 'error') {
          if (!textElement) textElement = createBubble('', 'ai', modelLabel);
          textElement.innerHTML = marked.parse('**Error**: ' + (e.errors || ['Unknown']).join('; '));
        } else if (textElement && fullText.trim()) {
          addToConversationHistory('assistant', fullText, retryFinalTokens);
        }
      }
    }
  });
  cp.on('close', (code) => {
    if (textElement && fullText.trim() && code === 0) { textElement.innerHTML = marked.parse(fullText); highlightCode(textElement); }
    updateRetryTokenUI();
    scrollToBottomIfNeeded(); resetSendState(); claudeProcess = null;
  });
  cp.stderr.on('data', (d) => { const x = d.toString('utf-8').trim(); if (x && !x.includes('no stdin')) console.log('[retry stderr]', x.slice(0, 200)); });
  cp.on('error', (err) => { if (!textElement) textElement = createBubble('', 'ai', modelLabel); textElement.innerHTML = marked.parse('**Error**: ' + err.message); resetSendState(); claudeProcess = null; });
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
  let claudeFullText = "";
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
          claudeFullText += chunk;
          charCount += chunk.length;
          if (!textElement) {
            removeLoadingIndicator();
            textElement = createBubble("", "ai", `${modelName}`);
          }
          const now = Date.now();
          if (now - lastUpdateTime >= UPDATE_INTERVAL) {
            textElement.innerHTML = marked.parse(claudeFullText);
            highlightCode(textElement);
            scrollToBottomIfNeeded();
            lastUpdateTime = now;
          }
          updateTokenUI();
        }
        if (done) {
          if (stats) finalTokens = stats;
          if (textElement) {
            textElement.innerHTML = marked.parse(claudeFullText);
            highlightCode(textElement);
          }
          scrollToBottomIfNeeded();
          if (textElement) updateTokenUI();
          if (textElement && claudeFullText.trim() !== "") {
            if (finalTokens) addToConversationHistory('assistant', claudeFullText.trim(), finalTokens);
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
          if (finalTokens) addToConversationHistory('assistant', fullContent || thinkingText, finalTokens);
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
  modelSelect.insertBefore(chatgptOpt, modelSelect.firstChild);
  modelSelect.insertBefore(gptOssOpt, modelSelect.firstChild);
  const claudeOpt = document.createElement('option');
  claudeOpt.value = 'claude';
  claudeOpt.textContent = 'DeepSeek-v4-Pro';
  claudeOpt.dataset.src = 'online';
  const claudeFlashOpt = document.createElement('option');
  claudeFlashOpt.value = 'claude-flash';
  claudeFlashOpt.textContent = 'DeepSeek-v4-Flash';
  claudeFlashOpt.dataset.src = 'online';
  modelSelect.insertBefore(claudeFlashOpt, modelSelect.firstChild);
  modelSelect.insertBefore(claudeOpt, modelSelect.firstChild);
  modelSelect.value = 'claude';
}

const atPopup = document.createElement('div');
atPopup.id = 'at-file-popup';
atPopup.style.cssText = 'display:none;position:fixed;z-index:9999;background:#1a1a1a;border:1px solid #363636;border-radius:8px;max-height:60vh;overflow-y:auto;overflow-x:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.5);font-family:system-ui,sans-serif;font-size:13px;padding:4px 0;';
document.body.appendChild(atPopup);

let cachedDesktopPath = null;
function getDesktopPath() {
  if (cachedDesktopPath) return cachedDesktopPath;
  const homeDir = os.homedir();
  const candidates = [p.join(homeDir, 'Desktop'), p.join(homeDir, 'Desktop')];
  try {
    const regPath = execSyncCmd('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Desktop', { encoding: 'utf-8', timeout: 2000 });
    const match = regPath.match(/REG_EXPAND_SZ\s+(.+)/);
    if (match) {
      const raw = match[1].trim();
      const resolved = raw.replace(/%([^%]+)%/g, (_, v) => process.env[v] || '');
      if (resolved && f.existsSync(resolved)) candidates.unshift(resolved);
    }
  } catch (_) { }
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
  atPopup.style.width = rect.width + 'px';
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
  const dirs = [p.join(CLAUDE_DIR, '.claude', 'skills')];
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
              skills.push({ name, title });
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
  const filtered = skills.filter(s => s.name.toLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name));
  if (filtered.length === 0) { skillPopup.style.display = 'none'; return; }
  const rect = inputElement.getBoundingClientRect();
  skillPopup.style.left = rect.left + 'px';
  skillPopup.style.width = rect.width + 'px';
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
    inputElement.value = '/' + el.dataset.skill + ' ';
    skillPopup.style.display = 'none';
    inputElement.focus();
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
      const dir = p.join(CLAUDE_DIR, '.claude', 'skills', name);
      try { if (f.existsSync(dir)) { f.rmSync(dir, { recursive: true, force: true }); showToast('已删除'); } } catch (_) {}
      cachedSkills = null;
      inputElement.dispatchEvent(new Event('input'));
    });
  });
});
document.addEventListener('click', (e) => {
  if (!skillPopup.contains(e.target) && e.target !== inputElement) skillPopup.style.display = 'none';
});

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
  const selectedModel = modelSelect.value;
  if (isSending) return;
  const inputText = inputElement.value.trim();
  if (inputText === "") return;

  if ((selectedModel === "claude" || selectedModel === "claude-flash") && !getClaudeApiKey()) {
    showToast('请填写 Key');
    return;
  }
  autoScroll = true;
  streamActive = true;
  lastScrollTop = 0;

  try {
    const hist = JSON.parse(localStorage.getItem('ms-input-hist') || '[]');
    hist.push(inputText);
    if (hist.length > 20) hist.shift();
    localStorage.setItem('ms-input-hist', JSON.stringify(hist));
  } catch (_) {}
  inputElement._histIdx = null; inputElement._draft = null;
  inputElement.value = "";
  isSending = true; toggleCloseButtonIcon(true);
  displayTextSlowly(inputText, "user");
  addToConversationHistory('user', inputText);
  forceScrollToBottom();
  requestAnimationFrame(() => {
    if (selectedModel === "claude" || selectedModel === "claude-flash") {
      const modelLabel = modelSelect.options[modelSelect.selectedIndex].textContent;
      requestClaude(inputText, modelLabel);
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
});

if (clearButton) {
  clearButton.addEventListener("click", () => {
    const welcome = terminalElement.querySelector(".AI-welcome-message");
    const toolbar = document.getElementById("terminal-toolbar");
    const messagesToRemove = [...terminalElement.children].filter(child =>
      child !== welcome && child !== modelSelect && child !== toolbar
    );
    if (messagesToRemove.length === 0) {
      inputElement.value = "";
      if (ollamaController) ollamaController.abort();
      if (remoteOllamaController) remoteOllamaController.abort();
      if (claudeProcess) { claudeProcess.kill(); claudeProcess = null; }
      autoScroll = true;
      terminalElement.scrollTo({ top: terminalElement.scrollHeight, behavior: 'smooth' });
      resetSendState();
      ipcR.send('hide-tool-panel');
      try {


        const dir = p.join(CLAUDE_DIR, '.claude', 'projects', CLAUDE_DIR.replace(/^([A-Z]):/i, '$1-').replace(/\\/g, '-'));
        if (f.existsSync(dir)) { try { f.rmSync(dir, { recursive: true, force: true }) } catch (_) { } }

        const telemetryDir = p.join(CLAUDE_DIR, '.claude', 'telemetry');
        if (f.existsSync(telemetryDir)) { try { f.rmSync(telemetryDir, { recursive: true, force: true }) } catch (_) { } }

        const backupDir = p.join(CLAUDE_DIR, '.claude', 'backups');
        if (f.existsSync(backupDir)) { try { f.rmSync(backupDir, { recursive: true, force: true }) } catch (_) { } }

        const cacheDir = p.join(CLAUDE_DIR, 'Cache');
        if (f.existsSync(cacheDir)) { try { f.readdirSync(cacheDir).forEach(fn => f.rmSync(p.join(cacheDir, fn), { recursive: true, force: true })); } catch (_) { } }
      } catch (_) { }
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
      if (ollamaController) ollamaController.abort();
      if (remoteOllamaController) remoteOllamaController.abort();
      if (claudeProcess) { claudeProcess.kill(); claudeProcess = null; }
      autoScroll = true;
      terminalElement.scrollTo({ top: terminalElement.scrollHeight, behavior: 'smooth' });
      resetSendState();
      clearConversationHistory();
      ipcR.send('hide-tool-panel');
      try {

        const dir = p.join(CLAUDE_DIR, '.claude', 'projects', CLAUDE_DIR.replace(/^([A-Z]):/i, '$1-').replace(/\\/g, '-'));
        if (f.existsSync(dir)) { try { f.rmSync(dir, { recursive: true, force: true }) } catch (_) { } }

        const telemetryDir = p.join(CLAUDE_DIR, '.claude', 'telemetry');
        if (f.existsSync(telemetryDir)) { try { f.rmSync(telemetryDir, { recursive: true, force: true }) } catch (_) { } }

        const backupDir = p.join(CLAUDE_DIR, '.claude', 'backups');
        if (f.existsSync(backupDir)) { try { f.rmSync(backupDir, { recursive: true, force: true }) } catch (_) { } }

        const cacheDir = p.join(CLAUDE_DIR, 'Cache');
        if (f.existsSync(cacheDir)) { try { f.readdirSync(cacheDir).forEach(fn => f.rmSync(p.join(cacheDir, fn), { recursive: true, force: true })); } catch (_) { } }
      } catch (_) { }
    }, 380);
  });
}

if (closeButton) {
  closeButton.addEventListener("click", () => {
    if (ollamaController) ollamaController.abort();
    if (remoteOllamaController) remoteOllamaController.abort();
    if (claudeProcess) { claudeProcess.kill(); claudeProcess = null; }
    resetSendState();
  });
}

ipcRenderer.on('stop-ai', () => {
  if (ollamaController) ollamaController.abort();
  if (remoteOllamaController) remoteOllamaController.abort();
  if (claudeProcess) { claudeProcess.kill(); claudeProcess = null; }
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

function displayTextSlowly(text, sender, modelName, onDone) {
  removeLoadingIndicator();
  const bubble = document.createElement("div");
  bubble.className = sender === "user" ? "user-message" : "ai-message";
  const header = createMessageHeader(sender, modelName);
  bubble.appendChild(header);
  const textElement = document.createElement("div");
  textElement.className = "message-text";
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
    textElement.innerHTML = marked.parse(text);
  }
  bubble.appendChild(textElement);
  terminalElement.appendChild(bubble);
  if (sender !== "user") {
    highlightCode(textElement);

    if (text.trim()) {
      const savedTokens = findHistoryTokens(text);
      const tokEl = document.createElement('div');
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
    const skillsDir = p.join(CLAUDE_DIR, '.claude', 'skills');
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
    const MCP_FILE = p.join(CLAUDE_DIR, '.claude.json');
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
      try { config = JSON.parse(f.readFileSync(MCP_FILE, 'utf-8')); } catch (e) {}
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
        .settings-btn { background:linear-gradient(145deg,#3a3a3a,#2a2a2a);border:1px solid #3f3f3f;color:#fff;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:bold;font-family:inherit;transition:transform 0.2s ease,box-shadow 0.2s ease; }
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
        <hr class="settings-divider">
        <div class="settings-section-title" id="settings-mcp-toggle" style="margin:0 0 8px;cursor:pointer;user-select:none;">MCP 配置 <span id="settings-mcp-arrow" style="font-size:10px;color:#888;transition:transform 0.2s ease;">▶</span></div>
        <div id="settings-mcp-wrapper" style="display:none;position:relative;">
          <button id="settings-mcp-copy" style="position:absolute;top:8px;right:8px;padding:4px 8px;background:#444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;z-index:1;transition:background 0.2s;">复制</button>
          <pre id="settings-mcp-config" style="background:#0d0d0d;border:1px solid #2a2a2a;border-radius:6px;padding:12px 14px;padding-right:58px;font-family:'Cascadia Code',Consolas,monospace;font-size:12px;color:#d4d4d8;white-space:pre-wrap;word-break:break-all;margin:0;max-height:220px;overflow-y:auto;line-height:1.5;"></pre>
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
      showToast('已保存');
      closeSettings();
    });
    card.querySelector('#settings-clear').addEventListener('click', () => {
      localStorage.removeItem('DeepseekApiKey');
      card.querySelector('#settings-key').value = '';
      showToast('已清除');
    });
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


        const mcpPath = p.join(CLAUDE_DIR, '.claude.json');
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
    details.ms-thinking[open] > pre {
      animation: ms-think-slide 0.28s ease-out;
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
  loadConversationHistory()
  requestAnimationFrame(() => renderConversationHistory())

  modelSelect.addEventListener('change', () => {
    const oldKey = 'deepseek_history_' + currentHistoryModel;
    try { localStorage.setItem(oldKey, JSON.stringify(conversationHistory)); } catch (_) { }
    currentHistoryModel = modelSelect.value;
    loadConversationHistory();
    if (terminalElement) {
      terminalElement.querySelectorAll('.user-message, .ai-message').forEach(el => el.remove());
    }
    renderConversationHistory();
  });

  const warmClaude = () => {
    try {
      const warmProcess = spawnCmd(CLAUDE_EXE, ['--version'], { cwd: CLAUDE_DIR, stdio: 'ignore' })
      setTimeout(() => { try { warmProcess.kill() } catch (_) { } }, 3000)
    } catch (_) { }
  };
  setTimeout(warmClaude, 8000);
})();
