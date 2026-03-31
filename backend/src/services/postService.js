const db = require("../db/database");
const { EXTRA_LABELS, EXTRA_LABEL_COLUMNS } = require("../config/labelCatalog");

const SELECT_COLUMNS_SQL = [
    "id",
    "platform",
    "tweet_id",
    "author_json",
    "posted_at",
    "text",
    "media_json",
    "captured_at",
    "received_at",
    "han_label",
    ...EXTRA_LABEL_COLUMNS,
].join(",\n            ");

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
                        received_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    post.platform,
                    post.tweetId,
                    JSON.stringify(post.author || null),
                    post.postedAt || null,
                    post.text,
                    JSON.stringify(post.media || null),
                    post.capturedAt || null,
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
            ${SELECT_COLUMNS_SQL}
        FROM posts
        ORDER BY id DESC
    `);

    return rows.map(mapRowToPost);
}

async function getPostStats() {
    const rows = await db.all(`
        SELECT
            COUNT(*) AS total_posts,
            COALESCE(SUM(CASE WHEN han_label = 1 THEN 1 ELSE 0 END), 0) AS highly_negative_arousal,
            COALESCE(SUM(CASE WHEN partisan_animosity = 1 THEN 1 ELSE 0 END), 0) AS partisan_animosity,
            COALESCE(SUM(CASE WHEN support_undemocratic_practices = 1 THEN 1 ELSE 0 END), 0) AS support_undemocratic_practices,
            COALESCE(SUM(CASE WHEN support_partisan_violence = 1 THEN 1 ELSE 0 END), 0) AS support_partisan_violence,
            COALESCE(SUM(CASE WHEN support_undemocratic_candidates = 1 THEN 1 ELSE 0 END), 0) AS support_undemocratic_candidates,
            COALESCE(SUM(CASE WHEN opposition_bipartisan_cooperation = 1 THEN 1 ELSE 0 END), 0) AS opposition_bipartisan_cooperation,
            COALESCE(SUM(CASE WHEN social_distrust = 1 THEN 1 ELSE 0 END), 0) AS social_distrust,
            COALESCE(SUM(CASE WHEN social_distance = 1 THEN 1 ELSE 0 END), 0) AS social_distance,
            COALESCE(SUM(CASE WHEN biased_evaluation_politicized_facts = 1 THEN 1 ELSE 0 END), 0) AS biased_evaluation_politicized_facts
        FROM posts
    `);

    const row = rows[0] || {};
    const total = Number(row.total_posts) || 0;
    const toMetric = (value) => {
        const count = Number(value) || 0;
        return {
            count,
            percent: total > 0 ? Math.round((count / total) * 100) : 0,
        };
    };

    return {
        totalPostsWatched: total,
        metrics: {
            highlyNegativeArousal: toMetric(row.highly_negative_arousal),
            partisanAnimosity: toMetric(row.partisan_animosity),
            supportUndemocraticPractices: toMetric(row.support_undemocratic_practices),
            supportPartisanViolence: toMetric(row.support_partisan_violence),
            supportUndemocraticCandidates: toMetric(row.support_undemocratic_candidates),
            oppositionToBipartisanCooperation: toMetric(row.opposition_bipartisan_cooperation),
            socialDistrust: toMetric(row.social_distrust),
            socialDistance: toMetric(row.social_distance),
            biasedEvaluationOfPoliticizedFacts: toMetric(row.biased_evaluation_politicized_facts),
        },
    };
}

async function getUnlabeledPosts(limit = 25) {
    const rows = await db.all(
        `
            SELECT
                ${SELECT_COLUMNS_SQL}
            FROM posts
            WHERE han_label IS NULL
            ORDER BY id ASC
            LIMIT ?
        `,
        [limit]
    );

    return rows.map(mapRowToPost);
}

async function getUnlabeledPostsByLabelColumn(labelColumn, limit = 25) {
    assertValidExtraLabelColumn(labelColumn);

    const rows = await db.all(
        `
            SELECT
                ${SELECT_COLUMNS_SQL}
            FROM posts
            WHERE ${labelColumn} IS NULL
            ORDER BY id ASC
            LIMIT ?
        `,
        [limit]
    );

    return rows.map(mapRowToPost);
}

async function savePostLabel(id, label) {
    await db.run(
        `
            UPDATE posts
            SET han_label = ?
            WHERE id = ?
        `,
        [label, id]
    );
}

async function savePostLabelByColumn(id, labelColumn, label) {
    assertValidExtraLabelColumn(labelColumn);

    await db.run(
        `
            UPDATE posts
            SET ${labelColumn} = ?
            WHERE id = ?
        `,
        [label, id]
    );
}

function mapRowToPost(row) {
    const extraLabels = EXTRA_LABELS.reduce((acc, label) => {
        acc[label.key] = row[label.column];
        return acc;
    }, {});

    return {
        id: row.id,
        platform: row.platform,
        tweetId: row.tweet_id,
        author: row.author_json ? JSON.parse(row.author_json) : null,
        postedAt: row.posted_at,
        text: row.text,
        media: row.media_json ? JSON.parse(row.media_json) : null,
        capturedAt: row.captured_at,
        receivedAt: row.received_at,
        hanLabel: row.han_label,
        extraLabels,
    };
}

function assertValidExtraLabelColumn(column) {
    if (!EXTRA_LABEL_COLUMNS.includes(column)) {
        throw new Error(`Unsupported label column: ${column}`);
    }
}

module.exports = {
    getAllPosts,
    getPostStats,
    getUnlabeledPosts,
    getUnlabeledPostsByLabelColumn,
    ingestPosts,
    savePostLabel,
    savePostLabelByColumn,
};
