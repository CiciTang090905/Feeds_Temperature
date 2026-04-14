function getOpenAIBatchModel() {
    const model = clean(process.env.OPENAI_BATCH_MODEL) || clean(process.env.AZURE_OPENAI_DEPLOYMENT);

    if (!model) {
        throw new Error("Missing OPENAI_BATCH_MODEL (or AZURE_OPENAI_DEPLOYMENT) for batch labeling.");
    }

    return model;
}

function getBatchRequestUrl() {
    if (isAzureBatchProvider()) {
        return "/chat/completions";
    }

    return "/v1/chat/completions";
}

function isAzureBatchProvider() {
    const provider = getBatchProvider();
    if (provider === "azure") {
        return true;
    }

    if (provider === "openai") {
        return false;
    }

    const openAiApiKey = clean(process.env.OPENAI_API_KEY);
    if (openAiApiKey) {
        return false;
    }

    const azureEndpoint = clean(process.env.AZURE_OPENAI_ENDPOINT);
    const azureApiKey = clean(process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY);
    return Boolean(azureEndpoint && azureApiKey);
}

function getBatchProvider() {
    const provider = clean(process.env.LABEL_BATCH_PROVIDER).toLowerCase();

    if (!provider) {
        return "auto";
    }

    if (!["auto", "azure", "openai"].includes(provider)) {
        throw new Error("LABEL_BATCH_PROVIDER must be one of: auto, azure, openai.");
    }

    return provider;
}

function clean(value) {
    if (!value) return "";
    return value.trim().replace(/^['"]|['"]$/g, "");
}

module.exports = {
    getBatchRequestUrl,
    getOpenAIBatchModel,
    getBatchProvider,
    isAzureBatchProvider,
};
