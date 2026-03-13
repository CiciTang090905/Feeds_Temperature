const db = require("../db/database");

function buildPostKey(post) {
    return `${post.platform}:${post.tweetId}`;
}

async function ingestPosts(posts) {
    const acceptedIds = [];
    const duplicateIds = [];

    for (const post of posts) {
        const key = buildPostKey(post);
        const receivedAt = new Date().toISOString();

        try {
            const result = await db.run(
                `
                    INSERT OR IGNORE INTO posts (
                        platform,
                        tweet_id,
                        author_json,
                        posted_at,
                        text,
                        media_json,
                        captured_at,
                        page_url,
                        received_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    post.platform,
                    post.tweetId,
                    JSON.stringify(post.author || null),
                    post.postedAt || null,
                    post.text,
                    JSON.stringify(post.media || null),
                    post.capturedAt || null,
                    post.pageUrl || null,
                    receivedAt,
                ]
            );

            if (result.changes === 0) {
                duplicateIds.push(post.tweetId);
                continue;
            }

            acceptedIds.push(post.tweetId);
        } catch (error) {
            error.message = `Failed to store post ${key}: ${error.message}`;
            throw error;
        }
    }

    return {
        insertedCount: acceptedIds.length,
        duplicateCount: duplicateIds.length,
        acceptedIds,
        duplicateIds,
    };
}

async function getAllPosts() {
    const rows = await db.all(`
        SELECT
            platform,
            tweet_id,
            author_json,
            posted_at,
            text,
            media_json,
            captured_at,
            page_url,
            received_at
        FROM posts
        ORDER BY id DESC
    `);

    return rows.map((row) => ({
        platform: row.platform,
        tweetId: row.tweet_id,
        author: row.author_json ? JSON.parse(row.author_json) : null,
        postedAt: row.posted_at,
        text: row.text,
        media: row.media_json ? JSON.parse(row.media_json) : null,
        capturedAt: row.captured_at,
        pageUrl: row.page_url,
        receivedAt: row.received_at,
    }));
}

module.exports = {
    ingestPosts,
    getAllPosts,
};
