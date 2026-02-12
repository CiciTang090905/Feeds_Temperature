
function extractTextFromTab(tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { type: "GET_ARTICLE_TEXT" }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response?.text || "");
        });
    });
}

async function extractTextFromActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab.");
    return await extractTextFromTab(tab.id);
}

document.getElementById("summarize-button").addEventListener("click", async () => {
    const result = document.getElementById("result");
    const summaryType = document.getElementById("summary-type").value;

    result.innerHTML = '<div class="loader"></div>';

    //Get API key
    const { geminiApiKey } = await chrome.storage.sync.get(["geminiApiKey"]);
    if (!geminiApiKey) {
        result.textContent = "Missing Gemini API key.";
        return;
    }
    try {
        const text = await extractTextFromActiveTab();
        if (!text) {
            result.textContent = "Couldn't extract text from this page";
            return;
        }

        const summary = await getGeminiSummary(text, summaryType, geminiApiKey);
        result.textContent = summary;
    } catch (error) {
        result.textContent = "Gemini error: " + error.message;
    }
});

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

};

//Especially for feeds on social media, X
//when click stat button
//1. show the first hundred words in quote
//2. show the word counts of the post
//3. show popularity, including stats such as #likes, #repost, #comments, #views
//4. show date of post, and who post it
//5. The attachment is image, video, or none
document.getElementById("stat-button").addEventListener("click", async () => {
    const result = document.getElementById("result");
    result.innerHTML = '<div class="loader"></div>';

    try {
        const text = await extractTextFromActiveTab();

        if (!text) {
            result.textContent = "Couldn't extract text from this page.";
            return;
        }

        const stats = computeStats(text);
        result.textContent = renderStats(stats);
    } catch (e) {
        result.textContent = "Error: " + e.message;
    }
});

function computeStats(rawText) {
    const text = (rawText || "").trim();
    const words = text.split(/\s+/).filter(Boolean);
    const chars = text.length;

    const preview100 = words.slice(0, 100).join(" ");

    // very simple sentence heuristic
    const sentences = text ? text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean) : [];
    const sentenceCount = sentences.length;

    // reading time heuristic: 200 wpm
    const wpm = 200;
    const readingMinutes = words.length ? Math.max(1, Math.round(words.length / wpm)) : 0;

    // optional: top words (filter short/common tokens)
    const stop = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "are", "was", "were", "be", "it", "this", "that", "with", "as", "at", "by", "from"]);
    const freq = new Map();
    for (const w of words) {
        const t = w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        if (!t || t.length < 3 || stop.has(t)) continue;
        freq.set(t, (freq.get(t) || 0) + 1);
    }
    const topWords = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([w, c]) => ({ word: w, count: c }));

    return {
        preview100,
        wordCount: words.length,
        charCount: chars,
        sentenceCount,
        readingMinutes,
        topWords
    };
}

function renderStats(stats) {
    const topWordLines = stats.topWords.length
        ? stats.topWords.map(x => `- ${x.word}: ${x.count}`).join("\n")
        : "(no strong keywords)";

    return (
        `Preview (first 100 words):
"${stats.preview100}"

Counts:
- Words: ${stats.wordCount}
- Characters: ${stats.charCount}
- Sentences (approx): ${stats.sentenceCount}
- Estimated reading time: ${stats.readingMinutes} min

Top words:
${topWordLines}`
    );
}



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