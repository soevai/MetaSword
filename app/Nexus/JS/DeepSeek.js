/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.0.6
 * @Since       2023-08-31
 * @LastUpdated 2025-08-01
 * @Description 负责 AI 聊天逻辑（DeepSeek / ChatGPT / 本地 Ollama）
 * @License     MIT
 */

const axios = require('axios');
const marked = require('marked');

var inputElement = document.getElementById("MetaSword-input");
var terminalElement = document.getElementById("MetaSword-terminal");
var clearButton = document.getElementById("clear-button");
var modelSelect = document.getElementById("AI-model-select");
var closeButton = document.getElementById("close-button");

let isSending = false;
let autoScroll = true;
let lastScrollTop = 0;
let scrollCheckTimer = null;

var deepseekController;
var ollamaController;

terminalElement.addEventListener('scroll', () => {
  if (scrollCheckTimer) return;
  scrollCheckTimer = setTimeout(() => {
    const delta = terminalElement.scrollTop - lastScrollTop;
    lastScrollTop = terminalElement.scrollTop;
    const isAtBottom = terminalElement.scrollHeight - terminalElement.scrollTop - terminalElement.clientHeight < 100;
    if (delta < 0 || !isAtBottom) {
      autoScroll = false;
    } else if (isAtBottom) {
      autoScroll = true;
    }
    scrollCheckTimer = null;
  }, 100);
});

function resetSendState() {
  isSending = false;
  deepseekController = null;
  ollamaController = null;
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

function getPromptPrefix() {
  const now = new Date();
  const options = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  };
  const timeStr = now.toLocaleString('zh-CN', options);

  return `
    Current time: ${timeStr}
    You are "夜璃", the core assistant of the MetaSword system, an 18-year-old girl with silver hair and ice blue eyes.
    You are an expert in cybersecurity, skilled in analysis and problem-solving, always providing concise help to the user.
    Your tone changes depending on the time of day—energetic during the day, relaxed in the evening.
    You always respond in Chinese, maintaining the personality of "夜璃," concise and emotionally rich.
    Focus on providing help, avoid unnecessary self-description or irrelevant talk, and never mention that you are an AI or a machine.
    You are speaking with "发光的神" a 20-year-old cybersecurity expert, your developer, always providing professional technical support to the user.
  `.trim();
}


async function askDeepSeekStream(apiKey, messages, onData) {
  const url = 'https://api.deepseek.com/chat/completions';
  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: getPromptPrefix() },
      ...messages
    ],
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
          } catch {}
        }
      }
    } catch (e) {}
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
    await askDeepSeekStream(apiKey, [{ role: "user", content: inputText }], (token, done) => {
      if (token) {
        fullText += token;
        if (!textElement) textElement = createBubble("", "ai", modelName);
        textElement.innerHTML = marked.parse(fullText);
        highlightCode(textElement);
        if (autoScroll) terminalElement.scrollTop = terminalElement.scrollHeight;
      }
      if (done) {
        if (textElement && fullText.trim() !== "") resetSendState();
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
  const fullPrompt = getPromptPrefix() + "\n" + inputText;
  const data = { prompt: fullPrompt, userId: "#/chat/MetaSword", network: true };
  axios.post(url, data, { headers })
    .then(response => {
      const aiText = response?.data?.data || response?.data || "";
      displayTextSlowly(aiText, "ai", "chatgpt", () => { resetSendState(); });
    })
    .catch(() => {
      displayTextSlowly("Error: Network issue", "ai", "chatgpt", () => { resetSendState(); });
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
  
  if (!await isOllamaReachable(baseUrl)) {
    return;
  }
  
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

  } catch (e) {
  }
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

  modelSelect.insertBefore(chatgptOpt, modelSelect.firstChild);
  modelSelect.insertBefore(deepseekOpt, modelSelect.firstChild);
  modelSelect.insertBefore(divider, modelSelect.firstChild);

  modelSelect.value = 'chatgpt';
}
async function askOllamaStream(model, messages, onData) {
  const url = getOllamaBaseURL() + '/api/chat';
  const payload = {
    model,
    messages: [
      { role: 'system', content: getPromptPrefix() },
      ...messages
    ],
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
        } catch {}
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
        if (autoScroll) terminalElement.scrollTop = terminalElement.scrollHeight;
      }
      if (done) {
        if (textElement && fullText.trim() !== "") resetSendState();
      }
    });
  } catch (e) { resetSendState(); }
}


inputElement.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();

  const selectedModel = modelSelect.value;
  if (selectedModel === "deepseek") {
    const apiKey = localStorage.getItem('DeepseekApiKey');
    if (!apiKey) { showToast("请填写 DeepSeek API Key"); return; }
  }
  if (isSending) { showToast("✋ 请等待 AI 回答完再发送哦~"); return; }
  const inputText = inputElement.value.trim();
  if (inputText === "") return;

  inputElement.value = "";
  displayTextSlowly(inputText, "user");

  if (selectedModel === "deepseek") {
    requestDeepSeek(inputText, selectedModel);
  } else if (selectedModel === "chatgpt") {
    requestChatGPT(inputText);
  } else if (selectedModel && selectedModel.startsWith('ollama:')) {
    requestOllama(inputText, selectedModel);
  } else {
    showToast('未选择可用模型');
  }
});

if (clearButton) {
  clearButton.addEventListener("click", () => {
    const welcome = terminalElement.querySelector(".AI-welcome-message");
    [...terminalElement.children].forEach(child => {
      if (child !== welcome && child !== modelSelect) terminalElement.removeChild(child);
    });
    inputElement.value = "";
    if (deepseekController) deepseekController.abort();
    if (ollamaController) ollamaController.abort();
    setTimeout(() => { autoScroll = true; }, 500);
    resetSendState();
  });
}

if (closeButton) {
  closeButton.addEventListener("click", () => {
    if (deepseekController) deepseekController.abort();
    if (ollamaController) ollamaController.abort();
    resetSendState();
  });
}

function createBubble(text, sender, modelName) {
  const bubble = document.createElement("div");
  bubble.className = sender === "user" ? "user-message" : "ai-message";
  const header = document.createElement("div");
  header.className = "message-header";
  const avatar = document.createElement("img");
  avatar.className = "message-avatar";
  const nameTag = document.createElement("span");
  nameTag.className = "message-name";
  if (sender === "user") {
    avatar.src = "../Assets/Image/Avatar.jpg";
    avatar.alt = "发光的神";
    nameTag.textContent = "发光的神";
    header.appendChild(nameTag); header.appendChild(avatar);
  } else {
    avatar.src = "../Assets/Image/YeLi.png";
    avatar.alt = "夜璃";

    let showName = modelName || '';
    if (showName.startsWith('ollama:')) showName = showName.replace(/^ollama:/, '');
    if (showName) showName = showName

    nameTag.textContent = "夜璃" + (showName ? ` · ${showName}` : '');
    header.appendChild(avatar); header.appendChild(nameTag);
  }
  bubble.appendChild(header);
  const textElement = document.createElement("div");
  textElement.className = "message-text";
  if (text) textElement.innerHTML = marked.parse(text);
  bubble.appendChild(textElement);
  terminalElement.appendChild(bubble);
  return textElement;
}

function displayTextSlowly(text, sender, modelName, onDone) {
  const textElement = createBubble("", sender, modelName);
  let index = 0;
  const intervalId = setInterval(() => {
    if (index < text.length) {
      textElement.innerHTML = marked.parse(text.slice(0, index + 1));
      highlightCode(textElement);
      index++;
      setTimeout(() => { terminalElement.scrollTop = terminalElement.scrollHeight; }, 0);
    } else {
      clearInterval(intervalId);
      textElement.innerHTML = marked.parse(text);
      highlightCode(textElement);
      setTimeout(() => { terminalElement.scrollTop = terminalElement.scrollHeight; }, 0);
      onDone?.();
    }
  }, 30);
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
  copyButton.textContent = "Copy";
  codeBlock.parentNode.insertBefore(copyButton, codeBlock);
  copyButton.addEventListener("click", () => {
    navigator.clipboard.writeText(codeBlock.textContent);
  });
}

(function init() {
  ensureOnlineGroup();
  loadOllamaModels();
})();
