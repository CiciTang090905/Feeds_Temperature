document.getElementById("summarize-button").addEventListener("click", () => {
    const result = document.getElementById("result");
    const summaryType = document.getElementById("summary-type").value;

    result.innerHTML = '<div class="loader"></div>';

    //Get API key

    chrome.storage.sync.get(["geminiApiKey"], ({ geminiApiKey }) => {
        //connect content.js for page text, get the info
        //send text to Gemini
        if (!geminiApiKey) {
            result.textContent = "Missing Gemini API key.";
            return;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => { //get the 1st matching tab in return tabs array
            chrome.tabs.sendMessage(tab.id, { type: "GET_ARTICLE_TEXT" },
                async (response) => {
                    if (chrome.runtime.lastError) {
                        result.textContent = `Error: ${chrome.runtime.lastError.message}`;
                        return;
                    }
                    const text = response?.text;

                    if (!text) {
                        result.textContent = "Couldn't extract text from this page";
                        return;
                    }

                    try {
                        const summary = await getGeminiSummary(text, summaryType, geminiApiKey);
                        result.textContent = summary;
                    } catch (error) {
                        result.textContent = "Gemini error: " + error.message;
                    }
                }
            );
        }
        );
    })

    async function getGeminiSummary(rawText, type, apiKey) {
        const max = 20000;
        const text = rawText.length > max ? rawText.slice(0, max) + "..." : rawText;

        const promptMap = { //prompt sent to gemini to generate output
            brief: `Summarize in 2-3 sentences: \n\n${text}`,
            detailed: `Give a detailed summary: \n\n${text}`,
            bullets: `S
            
            ummarize in 5-7 bullet points (start each line with "- "): \n\n${text}`,
        };

        const prompt = promptMap[type] || promptMap.brief;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2 },
            })
        });

        if (!res.ok) {
            const { error } = await res.json();
            throw new Error(error?.message || "Request failed");
        }

        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "No Summary"; //if null or undefined, use fallback

    }
});

document.getElementById("copy-button").addEventListener("click", () => {
    const txt = document.getElementById("result").textContent;
    if (!txt) return;

    navigator.clipboard.writeText(txt).then(() => {
        const btn = document.getElementById("copy-button");
        const old = btn.textContent;
        btn.textContent = "Copied!";

        setTimeout(() => {
            btn.textContent = old;
        }, 2000);
    });
});