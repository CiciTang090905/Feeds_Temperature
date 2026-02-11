document.getElementById("summarize-button").addEventListener("click", () => {
    const result = document.getElementById("result");
    result.textContent = "Extracting text...";

    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        chrome.tabs.sendMessage(tab.id, { type: "GET_ARTICLE_TEXT" }, ({ text }) => {
            if (chrome.runtime.lastError) {
                result.textContent = `Error: ${chrome.runtime.lastError.message}`;
                return;
            }
            result.textContent = text ? text.slice(0, 500) + "..." : "No article text found.";
        }
        );
    }
    );
}
);
