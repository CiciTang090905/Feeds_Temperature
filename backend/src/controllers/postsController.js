const postService = require("../services/postService");
const { getStatsEventState, onStatsUpdated } = require("../services/statsEvents");

function validatePostsPayload(posts) {
    if (!Array.isArray(posts)) {
        return "`posts` must be an array";
    }

    const invalidPost = posts.find((post) => {
        return !post || typeof post !== "object" || !post.platform || !post.tweetId || !post.text;
    });

    if (invalidPost) {
        return "Each post must include `platform`, `tweetId`, and `text`";
    }

    return null;
}

async function ingestPostsBatch(req, res, next) {
    const { posts } = req.body || {};
    const validationError = validatePostsPayload(posts);

    if (validationError) { //not null, indicate not valid
        return res.status(400).json({ error: validationError });
    }

    try {
        const result = await postService.ingestPostsForUser(req.user.id, posts);

        return res.status(202).json({
            receivedCount: posts.length,
            insertedCount: result.insertedCount,
            duplicateCount: result.duplicateCount,
            acceptedIds: result.acceptedIds,
            duplicateIds: result.duplicateIds,
        });
    } catch (error) {
        return next(error);
    }
}

async function listPosts(req, res, next) {
    try {
        const posts = await postService.getAllPostsForUser(req.user.id);

        return res.json({
            count: posts.length,
            posts,
        });
    } catch (error) {
        return next(error);
    }
}

async function getPostStats(req, res, next) {
    try {
        const stats = await postService.getPostStatsForUser(req.user.id);

        return res.json(stats);
    } catch (error) {
        return next(error);
    }
}

function streamStatsEvents(req, res) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const writeEvent = (event, payload) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    writeEvent("connected", {
        ...getStatsEventState(),
        connectedAt: new Date().toISOString(),
        userId: req.user.id,
    });

    const unsubscribe = onStatsUpdated((payload) => {
        writeEvent("stats_updated", payload);
    });

    const heartbeat = setInterval(() => {
        writeEvent("ping", { at: new Date().toISOString() });
    }, 25000);

    req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
    });
}

module.exports = {
    getPostStats,
    ingestPostsBatch,
    listPosts,
    streamStatsEvents,
};
