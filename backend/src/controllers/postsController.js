const postService = require("../services/postService");

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
        const result = await postService.ingestPosts(posts);

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
        const posts = await postService.getAllPosts();

        return res.json({
            count: posts.length,
            posts,
        });
    } catch (error) {
        return next(error);
    }
}

module.exports = {
    ingestPostsBatch,
    listPosts,
};
