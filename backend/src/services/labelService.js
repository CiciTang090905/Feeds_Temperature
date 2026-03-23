const PROMPT_TEMPLATE = `Classify the following social media post.

Label whether the author expresses high-arousal negative emotion (e.g., anger, outrage, hostility, aggressive frustration, contempt).

High-arousal negative emotion = activated, intense negativity directed at someone or something.
Examples: anger, rage, outrage, hostility, insults, aggressive blame.

Do not label:
- sadness, disappointment, worry, or fatigue
- neutral statements or factual reporting
- positive emotions

Focus on the emotional tone of the author, not the topic.

Output rule

Return only:
1 if high-arousal negative emotion is expressed
0 otherwise
No explanation. Only output 0 or 1.

Post
{POST}`;

function buildPrompt(postText) {
    return PROMPT_TEMPLATE.replace("{POST}", postText);
}

async function classifyPostText(postText) {
    const endpoint = clean(process.env.AZURE_OPENAI_ENDPOINT);
    const apiKey = clean(process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY);
    const deployment = clean(process.env.AZURE_OPENAI_DEPLOYMENT);
    const apiVersion = clean(process.env.AZURE_OPENAI_API_VERSION) || "2024-10-21";

    if (!endpoint || !apiKey || !deployment) {
        throw new Error("Missing Azure OpenAI settings in backend/.env.");
    }

    const base = endpoint.replace(/\/+$/, "");
    const url = `${base}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "api-key": apiKey,
        },
        body: JSON.stringify({
            messages: [
                {
                    role: "developer",
                    content: "Return exactly one character: 0 or 1.",
                },
                {
                    role: "user",
                    content: buildPrompt(postText),
                },
            ],
            max_completion_tokens: 64,
            reasoning_effort: "minimal",
        }),
    });

    if (!response.ok) {
        const responseText = await response.text();
        const filterInfo = parseContentFilterError(responseText);

        if (filterInfo.isContentFilter) {
            // Use a typed error so the worker can safely apply fallback logic.
            const error = new Error(
                `Azure OpenAI request failed: ${response.status} content_filter (${filterInfo.category || "unknown"})`
            );
            error.code = "CONTENT_FILTER";
            error.filterCategory = filterInfo.category || null;
            throw error;
        }

        throw new Error(`Azure OpenAI request failed: ${response.status} ${responseText}`);
    }

    const data = await response.json();
    const output = extractChatOutput(data);
    const match = String(output).match(/[01]/);

    if (!match) {
        throw new Error(`No 0/1 label found in model output: ${JSON.stringify(output)}`);
    }

    return {
        label: Number(match[0]),
        model: data.model || deployment,
        rawOutput: output,
    };
}

function parseContentFilterError(responseText) {
    try {
        const payload = JSON.parse(responseText);
        const code = payload?.error?.code;
        const jailbreak = payload?.error?.innererror?.content_filter_result?.jailbreak;

        // Normalize provider-specific payload into a stable category for worker handling.
        if (code === "content_filter") {
            return {
                isContentFilter: true,
                category: jailbreak?.detected ? "jailbreak" : "content_filter",
            };
        }
    } catch (error) {
        // Keep default false when payload is not JSON.
    }

    return {
        isContentFilter: false,
        category: null,
    };
}

function extractChatOutput(data) {
    const messageContent = data?.choices?.[0]?.message?.content;

    if (typeof messageContent === "string") {
        return messageContent;
    }

    if (Array.isArray(messageContent)) {
        const text = messageContent
            .map((item) => {
                if (typeof item === "string") return item;
                if (typeof item?.text === "string") return item.text;
                if (typeof item?.value === "string") return item.value;
                return "";
            })
            .join("\n")
            .trim();

        if (text) return text;
    }

    if (typeof data?.choices?.[0]?.text === "string") {
        return data.choices[0].text;
    }

    return "";
}

function clean(value) {
    if (!value) return "";
    return value.trim().replace(/^['"]|['"]$/g, "");
}

module.exports = {
    classifyPostText,
};
