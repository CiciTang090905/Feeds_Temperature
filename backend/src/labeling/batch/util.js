function getOpenAIBatchModel() {
    const model = clean(process.env.OPENAI_BATCH_MODEL);

    if (!model) {
        throw new Error("Missing OPENAI_BATCH_MODEL for batch labeling.");
    }

    return model;
}

function getBatchRequestUrl() {
    return "/v1/chat/completions";
}

function clean(value) {
    if (!value) return "";
    return value.trim().replace(/^['"]|['"]$/g, "");
}

module.exports = {
    getBatchRequestUrl,
    getOpenAIBatchModel,
};
