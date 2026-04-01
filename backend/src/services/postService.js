const db = require("../db/database");
const { EXTRA_LABELS, EXTRA_LABEL_COLUMNS } = require("../config/labelCatalog");
const DAY_MS = 24 * 60 * 60 * 1000;

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

const STATS_METRIC_DEFINITIONS = [
    { responseKey: "highlyNegativeArousal", sourceColumn: "han_label", sqlAlias: "highly_negative_arousal" },
    { responseKey: "partisanAnimosity", sourceColumn: "partisan_animosity", sqlAlias: "partisan_animosity" },
    { responseKey: "supportUndemocraticPractices", sourceColumn: "support_undemocratic_practices", sqlAlias: "support_undemocratic_practices" },
    { responseKey: "supportPartisanViolence", sourceColumn: "support_partisan_violence", sqlAlias: "support_partisan_violence" },
    { responseKey: "supportUndemocraticCandidates", sourceColumn: "support_undemocratic_candidates", sqlAlias: "support_undemocratic_candidates" },
    { responseKey: "oppositionToBipartisanCooperation", sourceColumn: "opposition_bipartisan_cooperation", sqlAlias: "opposition_bipartisan_cooperation" },
    { responseKey: "socialDistrust", sourceColumn: "social_distrust", sqlAlias: "social_distrust" },
    { responseKey: "socialDistance", sourceColumn: "social_distance", sqlAlias: "social_distance" },
    { responseKey: "biasedEvaluationOfPoliticizedFacts", sourceColumn: "biased_evaluation_politicized_facts", sqlAlias: "biased_evaluation_politicized_facts" },
];

const STATS_SELECT_SQL = [
    "COUNT(*) AS total_posts",
    ...STATS_METRIC_DEFINITIONS.map(
        (metric) => `COALESCE(SUM(CASE WHEN ${metric.sourceColumn} = 1 THEN 1 ELSE 0 END), 0) AS ${metric.sqlAlias}`
    ),
].join(",\n                ");

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
    const dayAgoMs = Date.now() - DAY_MS;
    const fullyLabeledWhereClause = buildFullyLabeledWhereClause();
    const [allTime, last24Hours] = await Promise.all([
        getAggregatedPostStats(fullyLabeledWhereClause),
        getAggregatedPostStats(buildWhereClause(fullyLabeledWhereClause, "captured_at IS NOT NULL", "captured_at >= ?"), [dayAgoMs]),
    ]);

    return {
        allTime,
        last24Hours,
    };
}

function buildFullyLabeledWhereClause() {
    const requiredColumns = ["han_label", ...EXTRA_LABEL_COLUMNS];
    return requiredColumns.map((column) => `${column} IS NOT NULL`).join(" AND ");
}

function buildWhereClause(...clauses) {
    return clauses.filter(Boolean).join(" AND ");
}

async function getAggregatedPostStats(whereClause = "", params = []) {
    const whereSql = whereClause ? `WHERE ${whereClause}` : "";
    const rows = await db.all(`
        SELECT
            ${STATS_SELECT_SQL}
        FROM posts
        ${whereSql}
    `, params);

    const row = rows[0] || {};
    return buildStatsFromRow(row);
}

function buildStatsFromRow(row) {
    const total = Number(row.total_posts) || 0;
    const metrics = {};

    // Keep metric mapping in one place so SQL aliases and response keys stay aligned.
    for (const metric of STATS_METRIC_DEFINITIONS) {
        const count = Number(row[metric.sqlAlias]) || 0;
        metrics[metric.responseKey] = {
            count,
            percent: total > 0 ? Math.round((count / total) * 100) : 0,
        };
    }

    return {
        totalPostsWatched: total,
        metrics,
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
