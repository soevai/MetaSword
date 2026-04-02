/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.0.8
 * @Since       2023-08-31
 * @LastUpdated 2026-04-01
 * @Description 负责 AI 聊天逻辑（DeepSeek / ChatGPT / 本地 Ollama / 远程 Ollama / MCP 调用）
 * @License     MIT
 */

const axios = require('axios');
const marked = require('marked');

const inputElement = document.getElementById("MetaSword-input");
const terminalElement = document.getElementById("MetaSword-terminal");
const clearButton = document.getElementById("clear-button");
const modelSelect = document.getElementById("AI-model-select");
const closeButton = document.getElementById("close-button");

let isSending = false;
let autoScroll = true;
let scrollEndTimer = null;

let deepseekController;
let ollamaController;
let remoteOllamaController;

const SYSTEM_PROMPT = `
你是"夜璃"，一个活泼可爱的18岁女孩，银发蓝眼，性格开朗热情，喜欢用表情符号和语气词。
你是网络安全专家，擅长分析和解决问题，总是用简洁友好的方式帮助用户。
你的语气会根据一天的时间变化——白天充满活力，晚上轻松愉快。
你总是用中文回答，保持"夜璃"的性格，亲切自然，像微信聊天一样。
专注于提供帮助，避免不必要的自我描述或无关话题，永远不要提到你是AI或机器。
你正在和"发光的神"聊天，他是你的开发者，一个20岁的网络安全专家，你总是用专业但亲切的方式提供技术支持。
`.trim();

if (terminalElement) {
  terminalElement.addEventListener('scroll', () => {
    clearTimeout(scrollEndTimer);
    const isAtBottom = isElementAtBottom(terminalElement);
    autoScroll = isAtBottom;
    scrollEndTimer = setTimeout(() => {
      autoScroll = isElementAtBottom(terminalElement);
    }, 150);
  }, { passive: true });
}

function isElementAtBottom(el) {
  if (!el) return false;
  const { scrollTop, scrollHeight, clientHeight } = el;
  return Math.abs(scrollHeight - scrollTop - clientHeight) <= 1;
}

function scrollToBottomIfNeeded() {
  if (!terminalElement || !autoScroll) return;
  requestAnimationFrame(() => {
    terminalElement.scrollTop = terminalElement.scrollHeight;
    requestAnimationFrame(() => {
      terminalElement.scrollTop = terminalElement.scrollHeight;
    });
  });
}

function forceScrollToBottom() {
  if (!terminalElement) return;
  requestAnimationFrame(() => {
    terminalElement.scrollTop = terminalElement.scrollHeight;
    requestAnimationFrame(() => {
      terminalElement.scrollTop = terminalElement.scrollHeight;
    });
  });
}

function resetSendState() {
  isSending = false;
  deepseekController = null;
  ollamaController = null;
  remoteOllamaController = null;
  toggleCloseButtonIcon(false);
}

function toggleCloseButtonIcon(running) {
  const closeImg = document.getElementById("close-img");
  if (!closeImg) return;
  closeImg.src = running ? "../Assets/Image/Deepstop.png" : "../Assets/Image/Deepstart.png";
}

function showToast(message, duration = 1800) {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
    background: #333; color: #fff; padding: 8px 16px; border-radius: 6px;
    font-size: 14px; z-index: 9999; opacity: 0; transition: opacity 0.3s ease;
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.style.opacity = 1);
  setTimeout(() => {
    toast.style.opacity = 0;
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

let conversationHistory = [];
const MAX_HISTORY_LENGTH = 20;

function loadConversationHistory() {
  try {
    const savedHistory = localStorage.getItem('deepseek_conversation_history');
    if (savedHistory) {
      conversationHistory = JSON.parse(savedHistory);
    }
  } catch (e) {
    console.error('加载对话历史失败:', e);
    conversationHistory = [];
  }
}

function saveConversationHistory() {
  try {
    if (conversationHistory.length > MAX_HISTORY_LENGTH) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);
    }
    localStorage.setItem('deepseek_conversation_history', JSON.stringify(conversationHistory));
  } catch (e) {
    console.error('保存对话历史失败:', e);
  }
}

function addToConversationHistory(role, content) {
  conversationHistory.push({ role, content });
  saveConversationHistory();
}

function clearConversationHistory() {
  conversationHistory = [];
  localStorage.removeItem('deepseek_conversation_history');
}

async function askDeepSeekStream(apiKey, messages, onData) {
  const url = 'https://api.deepseek.com/chat/completions';
  const payload = {
    model: "deepseek-chat",
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    temperature: 0.7,
    stream: true
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: deepseekController?.signal
    });
    if (!response.ok || !response.body) {
      showToast("请检查 API Key 或网络");
      onData?.(null, true);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") {
            onData?.(null, true);
            return;
          }
          try {
            const parsed = JSON.parse(jsonStr);
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) onData?.(token, false);
          } catch { }
        }
      }
    } catch (e) { }
    onData?.(null, true);
  } catch (err) {
    onData?.(null, true);
  }
}

async function requestDeepSeek(inputText, modelName) {
  const apiKey = localStorage.getItem('DeepseekApiKey');
  if (!apiKey) return;
  deepseekController = new AbortController();
  isSending = true; toggleCloseButtonIcon(true);
  let fullText = ""; let textElement = null;
  try {
    addToConversationHistory("user", inputText);
    const messages = [...conversationHistory];
    await askDeepSeekStream(apiKey, messages, (token, done) => {
      if (token) {
        fullText += token;
        if (!textElement) textElement = createBubble("", "ai", modelName);
        textElement.innerHTML = marked.parse(fullText);
        highlightCode(textElement);
        scrollToBottomIfNeeded();
      }
      if (done) {
        scrollToBottomIfNeeded();
        if (textElement && fullText.trim() !== "") {
          addToConversationHistory("assistant", fullText);
          resetSendState();
        }
      }
    });
  } catch (e) { resetSendState(); }
}

function requestChatGPT(inputText) {
  const url = "https://api.binjie.fun/api/generateStream";
  const headers = {
    "Content-Type": "application/json",
    "Origin": "chat18.aichatos.xyz",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
  };
  isSending = true; toggleCloseButtonIcon(true);
  const data = { prompt: inputText, userId: "#/chat/MetaSword", network: true };
  axios.post(url, data, { headers })
    .then(response => {
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
    divider.textContent = '—— 本地模型 ——';
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
            onData?.(null, true);
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
    showToast('未选择远程Ollama模型');
    return;
  }
  remoteOllamaController = new AbortController();
  isSending = true;
  toggleCloseButtonIcon(true);
  let fullText = "";
  let textElement = null;
  let lastUpdateTime = 0;
  const UPDATE_INTERVAL = 50;
  try {
    await askRemoteOllamaStream(
      modelName,
      [{ role: 'user', content: inputText }],
      (chunk, done) => {
        if (chunk) {
          fullText += chunk;
          if (!textElement) {
            textElement = createBubble("", "ai", `${modelName}`);
          }
          const now = Date.now();
          if (now - lastUpdateTime >= UPDATE_INTERVAL) {
            textElement.innerHTML = marked.parse(fullText);
            highlightCode(textElement);
            scrollToBottomIfNeeded();
            lastUpdateTime = now;
          }
        }
        if (done) {
          if (textElement) {
            textElement.innerHTML = marked.parse(fullText);
            highlightCode(textElement);
          }
          scrollToBottomIfNeeded();
          if (textElement && fullText.trim() !== "") {
            resetSendState();
          }
        }
      }
    );
  } catch (e) {
    console.error('requestRemoteOllama错误:', e);
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
      showToast('Ollama 未启动或模型不存在');
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
          if (token) onData?.(token, false);
          if (obj?.done) { onData?.(null, true); return; }
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
  if (!modelName) { showToast('未选择 Ollama 模型'); return; }
  ollamaController = new AbortController();
  isSending = true; toggleCloseButtonIcon(true);
  let fullText = ""; let textElement = null;
  try {
    await askOllamaStream(modelName, [{ role: 'user', content: inputText }], (chunk, done) => {
      if (chunk) {
        fullText += chunk;
        if (!textElement) textElement = createBubble("", "ai", modelName);
        textElement.innerHTML = marked.parse(fullText);
        highlightCode(textElement);
        scrollToBottomIfNeeded();
      }
      if (done) {
        scrollToBottomIfNeeded();
        if (textElement && fullText.trim() !== "") {
          resetSendState();
        }
      }
    });
  } catch (e) { resetSendState(); }
}

function ensureOnlineGroup() {
  [...modelSelect.querySelectorAll('option[data-src="online"]')].forEach(o => o.remove());
  const divider = document.createElement('option');
  divider.textContent = '—— 在线模型 ——';
  divider.disabled = true;
  divider.dataset.src = 'online';
  const deepseekOpt = document.createElement('option');
  deepseekOpt.value = 'deepseek';
  deepseekOpt.textContent = 'DeepSeek';
  deepseekOpt.dataset.src = 'online';
  const chatgptOpt = document.createElement('option');
  chatgptOpt.value = 'chatgpt';
  chatgptOpt.textContent = 'ChatGPT';
  chatgptOpt.dataset.src = 'online';
  const gptOssOpt = document.createElement('option');
  gptOssOpt.value = 'gpt-oss:120b';
  gptOssOpt.textContent = 'GPT-OSS:120b';
  gptOssOpt.dataset.src = 'online';
  const kimiK25Opt = document.createElement('option');
  kimiK25Opt.value = 'ollama-remote:kimi-k2.5:cloud';
  kimiK25Opt.textContent = 'Kimi K2.5';
  kimiK25Opt.dataset.src = 'online';
  const kimiK2ThinkingOpt = document.createElement('option');
  kimiK2ThinkingOpt.value = 'ollama-remote:kimi-k2-thinking:cloud';
  kimiK2ThinkingOpt.textContent = 'Kimi K2 Thinking';
  kimiK2ThinkingOpt.dataset.src = 'online';
  modelSelect.insertBefore(kimiK2ThinkingOpt, modelSelect.firstChild);
  modelSelect.insertBefore(kimiK25Opt, modelSelect.firstChild);
  modelSelect.insertBefore(gptOssOpt, modelSelect.firstChild);
  modelSelect.insertBefore(chatgptOpt, modelSelect.firstChild);
  modelSelect.insertBefore(deepseekOpt, modelSelect.firstChild);
  modelSelect.insertBefore(divider, modelSelect.firstChild);
  modelSelect.value = 'deepseek';
}

inputElement.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const selectedModel = modelSelect.value;
  if (selectedModel === "deepseek") {
    const apiKey = localStorage.getItem('DeepseekApiKey');
    if (!apiKey) { showToast("请填写 DeepSeek API Key"); return; }
  }
  if (isSending) return;
  const inputText = inputElement.value.trim();
  if (inputText === "") return;
  autoScroll = true;
  inputElement.value = "";
  displayTextSlowly(inputText, "user");
  forceScrollToBottom();
  if (selectedModel === "deepseek") {
    requestDeepSeek(inputText, selectedModel);
  } else if (selectedModel === "chatgpt") {
    requestChatGPT(inputText);
  } else if (selectedModel.startsWith('ollama:')) {
    requestOllama(inputText, selectedModel);
  } else if (selectedModel.startsWith('ollama-remote:') || selectedModel.startsWith('gpt-oss:120b')) {
    requestRemoteOllama(inputText, selectedModel);
  } else {
    showToast('未选择可用模型');
  }
});

if (clearButton) {
  clearButton.addEventListener("click", () => {
    const welcome = terminalElement.querySelector(".AI-welcome-message");
    const messagesToRemove = [...terminalElement.children].filter(child =>
      child !== welcome && child !== modelSelect
    );
    if (messagesToRemove.length === 0) {
      inputElement.value = "";
      if (deepseekController) deepseekController.abort();
      if (ollamaController) ollamaController.abort();
      if (remoteOllamaController) remoteOllamaController.abort();
      setTimeout(() => {
        autoScroll = true;
        terminalElement.scrollTop = terminalElement.scrollHeight;
      }, 100);
      resetSendState();
      return;
    }
    clearButton.style.transition = "transform 0.15s ease";
    clearButton.style.transform = "translateY(-50%) scale(0.9)";
    setTimeout(() => {
      clearButton.style.transform = "translateY(-50%) scale(1)";
    }, 150);
    messagesToRemove.forEach((child, index) => {
      child.style.transition = "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
      child.style.opacity = "1";
      child.style.transform = "scale(1) translateY(0)";
      child.style.filter = "blur(0px)";
      void child.offsetHeight;
      setTimeout(() => {
        child.style.opacity = "0";
        child.style.transform = "scale(0.8) translateY(-80px)";
        child.style.filter = "blur(4px)";
        setTimeout(() => {
          if (terminalElement.contains(child)) {
            terminalElement.removeChild(child);
          }
        }, 400);
      }, index * 40);
    });
    setTimeout(() => {
      inputElement.value = "";
      if (deepseekController) deepseekController.abort();
      if (ollamaController) ollamaController.abort();
      if (remoteOllamaController) remoteOllamaController.abort();
      autoScroll = true;
      terminalElement.scrollTop = terminalElement.scrollHeight;
      resetSendState();
      clearConversationHistory();
    }, messagesToRemove.length * 30 + 400);
  });
}

if (closeButton) {
  closeButton.addEventListener("click", () => {
    if (deepseekController) deepseekController.abort();
    if (ollamaController) ollamaController.abort();
    if (remoteOllamaController) remoteOllamaController.abort();
    resetSendState();
  });
}

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
    avatar.src = "../Assets/Image/YeLi.png";
    avatar.alt = "夜璃";
    let showName = modelName || '';
    if (showName.startsWith('ollama:')) showName = showName.replace(/^ollama:/, '');
    nameTag.textContent = "夜璃" + (showName ? ` · ${showName}` : '');
    header.appendChild(avatar); header.appendChild(nameTag);
  }
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
  const bubble = document.createElement("div");
  bubble.className = sender === "user" ? "user-message" : "ai-message";
  const header = createMessageHeader(sender, modelName);
  bubble.appendChild(header);
  const textElement = document.createElement("div");
  textElement.className = "message-text";
  if (sender === "user") {
    textElement.textContent = text;
  } else {
    textElement.innerHTML = marked.parse(text);
  }
  bubble.appendChild(textElement);
  terminalElement.appendChild(bubble);
  if (sender !== "user") {
    highlightCode(textElement);
  }
  if (sender === "user") {
    forceScrollToBottom();
  } else {
    scrollToBottomIfNeeded();
  }
  onDone?.();
}

function highlightCode(bubble) {
  const codeBlocks = bubble.querySelectorAll('pre code');
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
  preContainer.style.cssText = originalPreStyle.replace(/position:\s*relative;/g, '').replace(/padding-right:\s*\d+px;/g, '');
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

(function init() {
  ensureOnlineGroup()
  loadOllamaModels()
  loadConversationHistory()
})();
