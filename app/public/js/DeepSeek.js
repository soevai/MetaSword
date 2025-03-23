const axios = require('axios');
const marked = require('marked');

var inputElement = document.getElementById("MetaSword-input");
var terminalElement = document.getElementById("MetaSword-terminal");
var clearButton = document.getElementById("clear-button");
var modelSelect = document.getElementById("model-select");
var closeButton = document.getElementById("close-button");

function checkServer(url, callback) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.timeout = 1000;
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
            callback(xhr.status >= 200 && xhr.status < 400);
        }
    };
    xhr.onerror = () => callback(false);
    xhr.ontimeout = () => callback(false);
    xhr.send();
}

window.addEventListener("DOMContentLoaded", () => {
    const url = "http://127.0.0.1:11434/api/tags";
    if (!window.modelSelect) return;

    checkServer(url, (isAvailable) => {
        if (!isAvailable) return;

        fetch(url)
            .then(res => res.json())
            .then(data => {
                data.models?.forEach(model => {
                    const option = document.createElement("option");
                    option.value = model.name;
                    option.textContent = model.name;
                    modelSelect.appendChild(option);
                });
            })
            .catch(err => console.error("Fetch error:", err));
    });
});


var deepseekController = null;
clearButton.addEventListener("click", function () {
    var welcomeMessage = terminalElement.querySelector(".AI-Tips");
    Array.from(terminalElement.children).forEach(function (child) {
        if (child !== welcomeMessage && child !== modelSelect) {
            terminalElement.removeChild(child);
        }
    });
    inputElement.value = "";
});

if (closeButton) {
    closeButton.addEventListener("click", function () {
        if (deepseekController) {
            deepseekController.abort();
            deepseekController = null;
        }
    });
}

inputElement.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
        var inputText = inputElement.value.trim();
        if (inputText === "") return;

        var selectedModel = modelSelect.value;
        if (selectedModel !== "chatgpt" && deepseekController) {
            return;
        }

        if (selectedModel === "chatgpt") {
            inputElement.disabled = true;
        }

        displayTextSlowly(inputText, "user");

        if (selectedModel === "chatgpt") {
            requestChatGPT(inputText);
        } else {
            requestDeepSeek(inputText, selectedModel);
        }

        inputElement.value = "";
    }
});

// ChatGPT 请求
function requestChatGPT(inputText) {
    var url = "https://api.binjie.fun/api/generateStream";
    var headers = {
        "Content-Type": "application/json",
        "Origin": "chat18.aichatos.xyz",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
    };
    var data = {
        "prompt": inputText,
        "userId": "#/chat/master",
        "network": true
    };

    axios.post(url, data, { headers })
        .then(response => {
            if (response && response.data && response.data.data) {
                displayTextSlowly(response.data.data, "ai", "chatgpt");
            } else {
                var responseData = response.data;
                displayTextSlowly(responseData, "ai", "chatgpt");
            }
        })
        .catch(error => {
            displayTextSlowly("Error: Network issue", "ai", "chatgpt");
        })
        .finally(() => {
            inputElement.disabled = false;
        });
}

// 深度请求（流式）
async function requestDeepSeek(inputText, modelName, previousContext = []) {
    try {
        if (closeButton) {
            closeButton.querySelector("img").src = "./public/image/deepstop.png";
        }

        deepseekController = new AbortController();
        const response = await fetch("http://127.0.0.1:11434/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: modelName,
                messages: [{ "role": "user", "content": inputText }],
                stream: true,
                context: previousContext
            }),
            signal: deepseekController.signal
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let textElement = createBubble("", "ai", modelName);
        let fullResponse = "";
        let newContext = [...previousContext];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            let chunk = decoder.decode(value, { stream: true });
            try {
                const jsonResponse = JSON.parse(chunk);
                if (jsonResponse.message && jsonResponse.message.content) {
                    fullResponse += jsonResponse.message.content;
                    fullResponse = decodeHTML(fullResponse);

                    newContext.push({
                        role: "assistant",
                        content: jsonResponse.message.content
                    });

                    textElement.innerHTML = marked.parse(fullResponse);
                    highlightCode(textElement);
                    terminalElement.scrollTop = terminalElement.scrollHeight;
                }
            } catch (e) {
                console.error("Failed to parse chunk:", e);
            }
        }
        if (closeButton) {
            closeButton.querySelector("img").src = "./public/image/deepstart.png";
        }
        return newContext;

    } catch (error) {
        if (error.name === "AbortError") {
            if (closeButton) {
                closeButton.querySelector("img").src = "./public/image/deepstart.png";
            }
        } else {
            displayTextSlowly("Error: Network issue", "ai", modelName);
        }
    } finally {
        deepseekController = null;
    }
}

function decodeHTML(text) {
    var element = document.createElement('div');
    if (text) {
        element.innerHTML = text;
        return element.textContent || element.innerText;
    }
    return "";
}

function createBubble(text, sender, modelName) {
    var bubble = document.createElement("div");
    bubble.className = sender === "user" ? "user-message" : "ai-message";

    if (sender !== "user") {
        var avatar = document.createElement("img");
        avatar.className = "ai-avatar";
        if (modelName === "chatgpt") {
            avatar.src = "./public/image/chat-gpt.png";
        } else {
            avatar.src = "./public/image/DeepseekR1.png";
        }
        avatar.alt = "AI Avatar";
        bubble.appendChild(avatar);
    }

    var textElement = document.createElement("div");
    textElement.className = "message-text";
    bubble.appendChild(textElement);

    terminalElement.appendChild(bubble);
    return textElement;
}

function displayTextSlowly(text, sender, modelName) {
    var textElement = createBubble("", sender, modelName);
    var index = 0;
    var intervalId = setInterval(function () {
        if (index < text.length) {
            textElement.innerHTML = marked.parse(text.slice(0, index + 1));
            highlightCode(textElement);
            index++;
            terminalElement.scrollTop = terminalElement.scrollHeight;
        } else {
            clearInterval(intervalId);
            textElement.innerHTML = marked.parse(text);
            highlightCode(textElement);
            terminalElement.scrollTop = terminalElement.scrollHeight;
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
    var copyButton = document.createElement("button");
    copyButton.className = "copy-button";
    copyButton.textContent = "Copy";
    codeBlock.parentNode.insertBefore(copyButton, codeBlock);

    copyButton.addEventListener("click", function () {
        var codeText = codeBlock.textContent;
        navigator.clipboard.writeText(codeText);
    });
}
