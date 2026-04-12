const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_POSTS_PER_WINDOW = 1000;

const buckets = new Map();

function ingestRateLimit(req, res, next) {
    const userId = req.user?.id;
    const posts = Array.isArray(req.body?.posts) ? req.body.posts : [];
    const limit = Number(process.env.INGEST_POST_LIMIT_PER_HOUR) || DEFAULT_POSTS_PER_WINDOW;

    if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const now = Date.now();
    const key = String(userId);
    const bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
        buckets.set(key, {
            count: posts.length,
            resetAt: now + WINDOW_MS,
        });
        return next();
    }

    if (bucket.count + posts.length > limit) {
        res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
        return res.status(429).json({ error: "Post ingest rate limit exceeded." });
    }

    bucket.count += posts.length;
    return next();
}

module.exports = {
    ingestRateLimit,
};
