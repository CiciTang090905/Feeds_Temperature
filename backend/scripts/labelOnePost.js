const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const sqlite3 = require("sqlite3").verbose();

loadEnv();

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
    const postText = await getLatestPostText();
    if (!postText) {
        console.error("No posts found in the database.");
        process.exit(1);
    }

    const prompt = PROMPT_TEMPLATE.replace("{POST}", postText);
    const config = getAzureConfig();
    const rawOutput = await classifyPost(prompt, config);
    const label = normalizeLabel(rawOutput);

    console.log("INPUT:");
    console.log(postText);
    console.log("");
    console.log("OUTPUT:");
    console.log(label);
}

function loadEnv() {
    const envPath = path.join(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) {
        console.error("Missing backend/.env. Create it locally with your Azure OpenAI settings.");
        process.exit(1);
    }

    dotenv.config({ path: envPath });
}

function normalizeEnvValue(value) {
    if (!value) return "";
    return value.trim().replace(/^['"]|['"]$/g, "");
}

function getAzureConfig() {
    const endpoint = normalizeEnvValue(process.env.AZURE_OPENAI_ENDPOINT);
    const apiKey = normalizeEnvValue(
        process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_OPENAI_KEY
    );
    const deployment = normalizeEnvValue(process.env.AZURE_OPENAI_DEPLOYMENT);
    const apiVersion = normalizeEnvValue(process.env.AZURE_OPENAI_API_VERSION);

    if (!endpoint || !apiKey || !deployment) {
        console.error(
            "Missing Azure OpenAI config in backend/.env. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY (or AZURE_OPENAI_API_KEY), and AZURE_OPENAI_DEPLOYMENT."
        );
        process.exit(1);
    }

    return {
        endpoint,
        apiKey,
        deployment,
        apiVersion,
    };
}

function getLatestPostText() {
    const dbPath = path.resolve(__dirname, "../data/feeds-temperature.db");

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (error) => {
            if (error) {
                reject(error);
            }
        });

        db.get(
            "SELECT text FROM posts ORDER BY id DESC LIMIT 1",
            [],
            (error, row) => {
                db.close();

                if (error) {
                    reject(error);
                    return;
                }

                resolve(row ? row.text : null);
            }
        );
    });
}

async function classifyPost(prompt, config) {
    const baseUrl = buildBaseUrl(config.endpoint);
    const url = new URL("responses", baseUrl);

    if (config.apiVersion) {
        url.searchParams.set("api-version", config.apiVersion);
    }

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.deployment,
            input: prompt,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Azure OpenAI request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data.output_text || "";
}

function buildBaseUrl(endpoint) {
    const trimmed = endpoint.replace(/\/+$/, "");
    if (trimmed.endsWith("/openai/v1")) {
        return `${trimmed}/`;
    }

    return `${trimmed}/openai/v1/`;
}

function normalizeLabel(outputText) {
    const cleaned = String(outputText).trim();
    if (cleaned === "0" || cleaned === "1") {
        return cleaned;
    }

    const match = cleaned.match(/\b[01]\b/);
    if (match) {
        return match[0];
    }

    throw new Error(`Model returned unexpected output: ${cleaned}`);
}

main().catch((error) => {
    console.error("labelOnePost failed:", error.message);
    process.exit(1);
});
