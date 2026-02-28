async function extractTextFromTab(tabId) {
    const trySend = () =>
        new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_DATA" }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response || { kind: "unknown", text: "", stats: null });
            });
        });

    try {
        return await trySend();
    } catch (e) {
        // If there's no receiver (content script not loaded), inject then retry once.
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content.js"],
        });
        return await trySend();
    }
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
    const { geminiApiKey } = await chrome.storage.sync.get(["geminiApiKey"]);
    if (!geminiApiKey) {
        result.textContent = "Missing Gemini API key.";
        return;
    }
    try {
        const data = await extractTextFromActiveTab(); // object now
        const text = data?.text || "";
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
        bullets: `Summarize in 5-7 bullet points (start each line with "- "): \n\n${text}`,
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
        const data = await extractTextFromActiveTab(); // now returns object

        if (!data || !data.text) {
            result.textContent = "Couldn't extract text from this page.";
            return;
        }
        const stats = computeStats(data.text);
        let output = renderStats(stats);

        // Append engagement metrics ONLY for tweets
        if (data.kind === "tweet" && data.stats) {
            output += `
            
Popularity:
- Replies: ${data.stats.replies ?? 0}
- Reposts: ${data.stats.reposts ?? 0}
- Likes: ${data.stats.likes ?? 0}
- Bookmarks: ${data.stats.bookmarks ?? 0}
- Views: ${data.stats.views ?? 0}`;
        }
        result.textContent = output;
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
    const stop = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "are", "was", "were", "be", "it", "this", "that", "with", "as", "at", "by", "from"]);
    const freq = new Map();
    for (const w of words) {
        const t = w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        if (!t || t.length < 3 || stop.has(t)) continue;
        freq.set(t, (freq.get(t) || 0) + 1);
    }
    const topWords = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w, c]) => ({ word: w, count: c }));
    return {
        preview100,
        wordCount: words.length,
        charCount: chars,
        sentenceCount,
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

Top words:
${topWordLines}`
    );
}

document.getElementById("copy-btn").addEventListener("click", () => {
    const txt = document.getElementById("result").textContent;
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(() => {
        const btn = document.getElementById("copy-btn");
        const old = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => {
            btn.textContent = old;
        }, 2000);
    });
});