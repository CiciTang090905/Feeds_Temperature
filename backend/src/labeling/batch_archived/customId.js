function encode({ postId, stage, requestKey }) {
    const normalizedPostId = Number(postId);
    const normalizedStage = String(stage || "").trim().toUpperCase();
    const normalizedRequestKey = String(requestKey || "").trim();

    if (!Number.isInteger(normalizedPostId) || normalizedPostId <= 0) {
        throw new Error(`Invalid postId for custom_id: ${JSON.stringify(postId)}`);
    }

    if (!["A", "B"].includes(normalizedStage)) {
        throw new Error(`Invalid stage for custom_id: ${JSON.stringify(stage)}`);
    }

    if (!/^[a-z0-9_]+$/.test(normalizedRequestKey)) {
        throw new Error(`Invalid requestKey for custom_id: ${JSON.stringify(requestKey)}`);
    }

    return `p${normalizedPostId}-s${normalizedStage}-${normalizedRequestKey}`;
}

function decode(value) {
    const raw = String(value || "").trim();
    const match = raw.match(/^p(\d+)-s([AB])-([a-z0-9_]+)$/);

    if (!match) {
        throw new Error(`Malformed custom_id: ${JSON.stringify(value)}`);
    }

    return {
        postId: Number(match[1]),
        requestKey: match[3],
        stage: match[2],
    };
}

module.exports = {
    decode,
    encode,
};
