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

const BATCH_PROMPT_TEMPLATE = `Do the following messages express {{LABEL_NAME}}?
{{LABEL_NAME}} is defined as "{{LABEL_DEFINITION}}".
{{OPTIONAL_EXTRA_GUIDANCE}}

FORMAT:
The input messages are given as JSON lines in the format
{"id": <message_id>, "message": <message>}.

The output must be a JSON array of objects in the format
[{"id": <message_id>, "answer": <YES or NO>}, ... ].

INPUT MESSAGES:
{{INPUT_MESSAGES}}`;

function buildPrompt(postText) {
    return PROMPT_TEMPLATE.replace("{POST}", postText);
}

async function classifyPostText(postText) {
    const data = await runChatCompletion([
        {
            role: "developer",
            content: "Return exactly one character: 0 or 1.",
        },
        {
            role: "user",
            content: buildPrompt(postText),
        },
    ], { maxCompletionTokens: 64 });

    const output = extractChatOutput(data);
    const match = String(output).match(/[01]/);

    if (!match) {
        throw new Error(`No 0/1 label found in model output: ${JSON.stringify(output)}`);
    }

    return {
        label: Number(match[0]),
        model: data.model || getAzureConfig().deployment,
        rawOutput: output,
    };
}

async function classifyPostsForLabel(posts, labelConfig) {
    if (!Array.isArray(posts) || posts.length === 0) {
        throw new Error("classifyPostsForLabel requires at least one post.");
    }

    const prompt = buildBatchPrompt(posts, labelConfig);
    const data = await runChatCompletion([
        {
            role: "developer",
            content: "You are a strict classifier. Return only the requested JSON array and no extra text.",
        },
        {
            role: "user",
            content: prompt,
        },
    ], { maxCompletionTokens: 1024 });

    const output = extractChatOutput(data);
    const labelsById = parseBatchLabelOutput(output, posts.map((post) => String(post.id)));

    return {
        results: posts.map((post) => ({
            id: post.id,
            label: labelsById.get(String(post.id)),
        })),
        model: data.model || getAzureConfig().deployment,
        rawOutput: output,
    };
}

function buildBatchPrompt(posts, labelConfig) {
    const inputLines = posts
        .map((post) => JSON.stringify({ id: String(post.id), message: post.text || "" }))
        .join("\n");

    const optionalGuidance = labelConfig.extraGuidance || "";

    return BATCH_PROMPT_TEMPLATE
        .replaceAll("{{LABEL_NAME}}", labelConfig.name)
        .replace("{{LABEL_DEFINITION}}", labelConfig.definition)
        .replace("{{OPTIONAL_EXTRA_GUIDANCE}}", optionalGuidance)
        .replace("{{INPUT_MESSAGES}}", inputLines);
}

function parseBatchLabelOutput(output, expectedIds) {
    const parsed = parseJsonArrayOutput(output);
    const answers = new Map();

    for (const item of parsed) {
        const id = String(item?.id || "");
        const label = normalizeYesNo(item?.answer);

        if (!id) {
            throw new Error(`Batch label output is missing id: ${JSON.stringify(item)}`);
        }

        if (label === null) {
            throw new Error(`Batch label output has invalid answer for id ${id}: ${JSON.stringify(item?.answer)}`);
        }

        answers.set(id, label);
    }

    for (const id of expectedIds) {
        if (!answers.has(id)) {
            throw new Error(`Batch label output missing expected id ${id}.`);
        }
    }

    return answers;
}

function parseJsonArrayOutput(output) {
    const raw = String(output || "").trim();

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
    } catch (error) {
        // Fallback for models that wrap the JSON with extra text.
    }

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
        throw new Error(`No JSON array found in model output: ${JSON.stringify(output)}`);
    }

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) {
        throw new Error(`Model output JSON is not an array: ${JSON.stringify(output)}`);
    }

    return parsed;
}

function normalizeYesNo(answer) {
    const value = String(answer || "").trim().toUpperCase();

    if (value === "YES") return 1;
    if (value === "NO") return 0;

    return null;
}

async function runChatCompletion(messages, options = {}) {
    const config = getAzureConfig();
    const url = `${config.base}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;
    const maxCompletionTokens = Number(options.maxCompletionTokens) || 2048;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "api-key": config.apiKey,
        },
        body: JSON.stringify({
            messages,
            max_completion_tokens: maxCompletionTokens,
            reasoning_effort: "minimal",
        }),
    });

    if (!response.ok) {
        const responseText = await response.text();
        const filterInfo = parseContentFilterError(responseText);

        if (filterInfo.isContentFilter) {
            const error = new Error(
                `Azure OpenAI request failed: ${response.status} content_filter (${filterInfo.category || "unknown"})`
            );
            error.code = "CONTENT_FILTER";
            error.filterCategory = filterInfo.category || null;
            throw error;
        }

        throw new Error(`Azure OpenAI request failed: ${response.status} ${responseText}`);
    }

    return response.json();
}

function getAzureConfig() {
    const endpoint = clean(process.env.AZURE_OPENAI_ENDPOINT);
    const apiKey = clean(process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY);
    const deployment = clean(process.env.AZURE_OPENAI_DEPLOYMENT);
    const apiVersion = clean(process.env.AZURE_OPENAI_API_VERSION) || "2024-10-21";

    if (!endpoint || !apiKey || !deployment) {
        throw new Error("Missing Azure OpenAI settings in backend/.env.");
    }

    return {
        apiKey,
        deployment,
        apiVersion,
        base: endpoint.replace(/\/+$/, ""),
    };
}

function parseContentFilterError(responseText) {
    try {
        const payload = JSON.parse(responseText);
        const code = payload?.error?.code;
        const jailbreak = payload?.error?.innererror?.content_filter_result?.jailbreak;

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
    classifyPostsForLabel,
};
