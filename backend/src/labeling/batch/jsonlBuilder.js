const { EXTRA_LABELS, STAGE_A_LABELS } = require("../shared/catalog");
const {
    STRICT_CLASSIFIER_DEVELOPER_MESSAGE,
    buildSingleLabelBatchPrompt,
    buildUserMessage,
} = require("../shared/prompts");
const { encode } = require("./customId");
const { getBatchRequestUrl } = require("./util");

const DEFAULT_MAX_TOKENS = 250;

function buildPassARequests(posts, model) {
    return buildRequests(posts, model, "A", STAGE_A_LABELS);
}

function buildPassBRequests(posts, model) {
    return buildRequests(posts, model, "B", EXTRA_LABELS);
}

function buildRequests(posts, model, stage, labelConfigs) {
    if (!Array.isArray(posts)) {
        throw new Error("posts must be an array");
    }

    if (!model) {
        throw new Error("model is required");
    }

    return posts
        .flatMap((post) => labelConfigs.map((labelConfig) => buildRequestLine(post, model, stage, labelConfig)))
        .join("\n");
}

function buildRequestLine(post, model, stage, labelConfig) {
    const imageUrl = extractImageContextUrl(post);
    const prompt = buildSingleLabelBatchPrompt({
        labelDefinition: labelConfig.definition,
        labelGuidance: labelConfig.extraGuidance,
        labelName: labelConfig.name,
        postText: post.text || "",
        quotedPost: post.quotedPost || null,
        responseKey: labelConfig.responseKey || labelConfig.key,
    });

    return JSON.stringify({
        custom_id: encode({
            postId: post.id,
            requestKey: labelConfig.requestKey,
            stage,
        }),
        method: "POST",
        url: getBatchRequestUrl(),
        body: {
            max_tokens: DEFAULT_MAX_TOKENS,
            messages: [
                {
                    role: "system",
                    content: STRICT_CLASSIFIER_DEVELOPER_MESSAGE,
                },
                buildUserMessage(prompt, imageUrl),
            ],
            model,
            response_format: {
                type: "json_object",
            },
        },
    });
}

function extractImageContextUrl(post) {
    const media = post?.media || {};
    const image = Array.isArray(media.images) ? media.images[0] : null;
    if (image) return image;

    const screenshot = Array.isArray(media.videoThumbnails) ? media.videoThumbnails[0] : null;
    return screenshot || null;
}

module.exports = {
    buildPassARequests,
    buildPassBRequests,
    extractImageContextUrl,
};
