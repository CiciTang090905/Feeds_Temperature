const { OpenAI, toFile } = require("openai");
const { getBatchRequestUrl } = require("./util");

let clientInstance = null;

function getClient() {
    if (clientInstance) {
        return clientInstance;
    }

    const openAiApiKey = clean(process.env.OPENAI_API_KEY);
    if (!openAiApiKey) {
        throw new Error("Missing OPENAI_API_KEY for batch labeling.");
    }

    clientInstance = new OpenAI({
        apiKey: openAiApiKey,
        maxRetries: 0,
    });
    return clientInstance;
}

async function uploadBatchFile(jsonlString) {
    const client = getClient();
    const file = await client.files.create({
        file: await toFile(Buffer.from(jsonlString, "utf8"), `batch-${Date.now()}.jsonl`),
        purpose: "batch",
    });

    return file.id;
}

async function createBatch(fileId, endpoint) {
    const client = getClient();
    return client.batches.create({
        completion_window: "24h",
        endpoint: endpoint || getBatchRequestUrl(),
        input_file_id: fileId,
    });
}

async function retrieveBatch(batchId) {
    const client = getClient();
    return client.batches.retrieve(batchId);
}

async function downloadFile(fileId) {
    const client = getClient();
    const response = await client.files.content(fileId);
    return response.text();
}

function clean(value) {
    if (!value) return "";
    return value.trim().replace(/^['"]|['"]$/g, "");
}

module.exports = {
    createBatch,
    downloadFile,
    retrieveBatch,
    uploadBatchFile,
};
