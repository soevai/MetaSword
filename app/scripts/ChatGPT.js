const axios = require('axios');

var inputElement = document.getElementById("input");
var terminalElement = document.getElementById("terminal");

inputElement.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
        var inputText = inputElement.value.trim();
        if (inputText === "") {
            return;
        }

        if (inputText === "clear") {
            terminalElement.innerHTML = "";
            inputElement.value = "";
            return;
        }

        var newParagraph = document.createElement("p");
        newParagraph.textContent = `< ${inputText}`;
        terminalElement.appendChild(newParagraph);

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
                } else {
                    var responseData = response.data;
                    displayTextSlowly(responseData, ">");
                }
            })
            .catch(error => {
                console.error("Request error:", error);
            });

        inputElement.value = "";
    }
});

function displayTextSlowly(text, sender) {
    var newParagraph = document.createElement("p");
    terminalElement.appendChild(newParagraph);

    var index = 0;
    var intervalId = setInterval(function () {
        if (index < text.length) {
            newParagraph.textContent = (sender ? `${sender} ` : "") + text.slice(0, index + 1) + "_";
            index++;
            terminalElement.scrollTop = terminalElement.scrollHeight;
        } else {
            clearInterval(intervalId);
            var displayedText = (sender ? `${sender} ` : "") + text + "_";
            newParagraph.textContent = displayedText;
            terminalElement.scrollTop = terminalElement.scrollHeight;
        }
    }, 30);
}
