const { AzureOpenAI, OpenAI, toFile } = require("openai");
const { getBatchProvider, getBatchRequestUrl, isAzureBatchProvider } = require("./util");

let clientInstance = null;

function getClient() {
    if (clientInstance) {
        return clientInstance;
    }

    const openAiApiKey = clean(process.env.OPENAI_API_KEY);
    if (openAiApiKey && getBatchProvider() !== "azure") {
        clientInstance = new OpenAI({
            apiKey: openAiApiKey,
            maxRetries: 0,
        });
        return clientInstance;
    }

    const azureEndpoint = clean(process.env.AZURE_OPENAI_ENDPOINT);
    const azureApiKey = clean(process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY);
    const azureApiVersion = clean(process.env.AZURE_OPENAI_API_VERSION) || "2024-10-21";

    if (azureEndpoint && azureApiKey) {
        clientInstance = new AzureOpenAI({
            apiKey: azureApiKey,
            apiVersion: azureApiVersion,
            endpoint: azureEndpoint,
            maxRetries: 0,
        });
        return clientInstance;
    }

    throw new Error("Missing batch credentials. Set OPENAI_API_KEY or AZURE_OPENAI_*.");
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
    if (isAzureBatchProvider()) {
        return azureBatchRequest("/openai/batches", {
            body: {
                completion_window: "24h",
                endpoint: endpoint || getBatchRequestUrl(),
                input_file_id: fileId,
            },
            method: "POST",
        });
    }

    const client = getClient();
    return client.batches.create({
        completion_window: "24h",
        endpoint: endpoint || getBatchRequestUrl(),
        input_file_id: fileId,
    });
}

async function retrieveBatch(batchId) {
    if (isAzureBatchProvider()) {
        return azureBatchRequest(`/openai/batches/${batchId}`, {
            method: "GET",
        });
    }

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

async function azureBatchRequest(path, { body, method }) {
    const endpoint = clean(process.env.AZURE_OPENAI_ENDPOINT);
    const apiKey = clean(process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY);
    const apiVersion = clean(process.env.AZURE_OPENAI_API_VERSION) || "2024-10-21";

    if (!endpoint || !apiKey) {
        throw new Error("Missing Azure OpenAI settings for batch requests.");
    }

    const response = await fetch(`${endpoint.replace(/\/+$/, "")}${path}?api-version=${apiVersion}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            "api-key": apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`Azure batch request failed: ${response.status} ${responseText}`.trim());
    }

    return response.json();
}

module.exports = {
    createBatch,
    downloadFile,
    retrieveBatch,
    uploadBatchFile,
};
