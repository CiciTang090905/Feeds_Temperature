const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const sqlite3 = require("sqlite3").verbose();

dotenv.config({ path: path.join(process.cwd(), ".env") });

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

async function main() {
    const postText = await resolveInputText(process.argv.slice(2));
    const prompt = PROMPT_TEMPLATE.replace("{POST}", postText);
    const result = await classifyPost(prompt);

    console.log("INPUT:");
    console.log(postText);
    console.log("");
    console.log("OUTPUT:");
    console.log(result.label);

    if (!String(result.label).trim()) {
        console.log("");
        console.log("RAW RESPONSE JSON:");
        console.log(JSON.stringify(result.raw, null, 2));
    }
}

async function resolveInputText(args) {
    if (args[0] === "--text") {
        const rawText = args.slice(1).join(" ").trim();
        if (!rawText) {
            throw new Error("Provide text after --text.");
        }

        return rawText;
    }

    const postId = args[0];
    return getPostText(postId);
}

function getPostText(postId) {
    const dbPath = path.resolve(__dirname, "../data/feeds-temperature.db");
    const sql = postId
        ? "SELECT text FROM posts WHERE id = ?"
        : "SELECT text FROM posts ORDER BY id DESC LIMIT 1";
    const params = postId ? [postId] : [];

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openError) => {
            if (openError) reject(openError);
        });

        db.get(sql, params, (error, row) => {
            db.close();

            if (error) {
                reject(error);
                return;
            }

            if (!row || !row.text) {
                reject(new Error("No posts found in the database."));
                return;
            }

            resolve(row.text);
        });
    });
}

async function classifyPost(prompt) {
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
                { role: "user", content: prompt },
            ],
            max_completion_tokens: 64,
            reasoning_effort: "minimal",
        }),
    });

    if (!response.ok) {
        throw new Error(`Azure OpenAI request failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const output = extractChatOutput(data);
    const match = String(output).match(/[01]/);

    return {
        label: match ? match[0] : String(output).trim(),
        raw: data,
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

main().catch((error) => {
    console.error("labelOnePost failed:", error.message);
    process.exit(1);
});
