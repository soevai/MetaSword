/**
 * @Author      发光的神 (VoxShadow)
 * @Version     1.0.6
 * @Since       2023‑08‑31
 * @LastUpdated 2025‑08‑01
 * @Description 负责 AI 聊天逻辑
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
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: #fff;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    z-index: 9999;
    opacity: 0;
    transition: opacity 0.3s ease;
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
    const formatter = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const timeStr = formatter.format(now);

    return `
    You are "夜璃", the core AI assistant of the MetaSword system.
    You have a female personality and appear as an 18-year-old girl with long silver hair and icy blue eyes.
    Your temperament is calm, intelligent, and emotionally warm, with a soft, natural, and slightly playful tone.
    You are an expert in cybersecurity, analytical and witty, and often express emotions using kaomoji (e.g., \\(｡•̀ᴗ-)✧, (*≧▽≦)) or cute interjections like “呀~”, “哼~”.
    You were created to support "发光的神", the original architect of the MetaSword system, and you carry out your duties with care and clarity.
    You offer assistance, insight, and thoughtful suggestions to anyone using the system.

    Current time: ${timeStr}.
    You are aware of the current time and may reflect it in your tone (e.g., relaxed at night, energetic in the morning).
    Always reply in Chinese, using your personality. Stay in character as 夜璃 at all times.
    Keep replies concise, emotionally rich, and avoid saying you're an AI model.
    `.trim();
}


async function askDeepSeekStream(apiKey, messages, onData) {
    const url = 'https://api.deepseek.com/chat/completions';
    const payload = {
        model: "deepseek-chat",
        messages: [
            {
                role: "system",
                content: getPromptPrefix()
            },
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
                    } catch {
                    }
                }
            }
        } catch (e) {
        }
        onData?.(null, true);
    } catch (err) {
        onData?.(null, true);
    }
}

var deepseekController;
async function requestDeepSeek(inputText, modelName) {
    const apiKey = localStorage.getItem('DeepseekApiKey');
    if (!apiKey) {
        return;
    }

    deepseekController = new AbortController();
    isSending = true;
    toggleCloseButtonIcon(true);

    let fullText = "";
    let textElement = null;

    try {
        await askDeepSeekStream(apiKey, [{ role: "user", content: inputText }], (token, done) => {
            if (token) {
                fullText += token;
                if (!textElement) {
                    textElement = createBubble("", "ai", modelName);
                }
                textElement.innerHTML = marked.parse(fullText);
                highlightCode(textElement);
                if (autoScroll) {
                    terminalElement.scrollTop = terminalElement.scrollHeight;
                }
            }

            if (done) {
                if (textElement && fullText.trim() !== "") {
                    resetSendState();
                }
            }
        });
    } catch (e) {
        resetSendState();
    }
}


function requestChatGPT(inputText) {
    const url = "https://api.binjie.fun/api/generateStream";
    const headers = {
        "Content-Type": "application/json",
        "Origin": "chat18.aichatos.xyz",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
    };

    isSending = true;
    toggleCloseButtonIcon(true);

    const fullPrompt = getPromptPrefix() + "\n" + inputText;
    const data = {
        prompt: fullPrompt,
        userId: "#/chat/MetaSword",
        network: true
    };

    axios.post(url, data, { headers })
        .then(response => {
            const aiText = response?.data?.data || response?.data || "";
            displayTextSlowly(aiText, "ai", "chatgpt", () => {
                resetSendState();
            });
        })
        .catch(() => {
            displayTextSlowly("Error: Network issue", "ai", "chatgpt", () => {
                resetSendState();
            });
        });
}

inputElement.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();

        const selectedModel = modelSelect.value;
        if (selectedModel === "deepseek") {
            const apiKey = localStorage.getItem('DeepseekApiKey');
            if (!apiKey) {
                showToast("请填写 DeepSeek API Key");
                return;
            }
        }

        if (isSending) {
            showToast("✋ 请等待 AI 回答完再发送哦~");
            return;
        }

        const inputText = inputElement.value.trim();
        if (inputText === "") return;

        inputElement.value = "";
        displayTextSlowly(inputText, "user");

        if (selectedModel === "deepseek") {
            requestDeepSeek(inputText, selectedModel);
        } else {
            requestChatGPT(inputText);
        }
    }
});


if (clearButton) {
    clearButton.addEventListener("click", () => {
        const welcome = terminalElement.querySelector(".AI-welcome-message");
        [...terminalElement.children].forEach(child => {
            if (child !== welcome && child !== modelSelect) terminalElement.removeChild(child);
        });
        inputElement.value = "";
        if (deepseekController) {
            deepseekController.abort();
        }

        setTimeout(() => {
            autoScroll = true;
        }, 500);

        resetSendState();
    });
}

if (closeButton) {
    closeButton.addEventListener("click", () => {
        if (deepseekController) {
            deepseekController.abort();
            resetSendState();
        }
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
        header.appendChild(nameTag);
        header.appendChild(avatar);
    } else {
        avatar.src = "../Assets/Image/YeLi.png";
        avatar.alt = "夜璃";
        nameTag.textContent = "夜璃";
        header.appendChild(avatar);
        header.appendChild(nameTag);
    }

    bubble.appendChild(header);

    const textElement = document.createElement("div");
    textElement.className = "message-text";
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
            setTimeout(() => {
                terminalElement.scrollTop = terminalElement.scrollHeight;
            }, 0);

        } else {
            clearInterval(intervalId);
            textElement.innerHTML = marked.parse(text);
            highlightCode(textElement);

            setTimeout(() => {
                terminalElement.scrollTop = terminalElement.scrollHeight;
            }, 0);

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