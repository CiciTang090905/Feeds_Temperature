const db = require("../db/database");
const { EXTRA_LABELS, EXTRA_LABEL_COLUMNS } = require("../labeling/shared/catalog");
const { POLITICAL_POST_METRIC_DEFINITIONS, buildStatsFromRow } = require("./statsBuilder");

const DAY_MS = 24 * 60 * 60 * 1000;

const BASE_POST_COLUMNS = [
    "id",
    "platform",
    "tweet_id",
    "author",
    "posted_at",
    "text",
    "media",
    "quoted_post",
    "captured_at",
    "received_at",
    "han_label",
    "is_political",
    "label_confidence",
    "label_skip_reason",
    ...EXTRA_LABEL_COLUMNS,
];

const STATS_SELECT_SQL = [
    "COUNT(*) AS total_posts",
    "COALESCE(SUM(CASE WHEN han_label = 1 THEN 1 ELSE 0 END), 0) AS highly_negative_arousal",
    "COALESCE(SUM(CASE WHEN is_political = 1 THEN 1 ELSE 0 END), 0) AS political_posts",
    ...POLITICAL_POST_METRIC_DEFINITIONS.map(
        (metric) => `COALESCE(SUM(CASE WHEN is_political = 1 AND ${metric.sourceColumn} = 1 THEN 1 ELSE 0 END), 0) AS ${metric.sqlAlias}`
    ),
].join(",\n                ");

function buildPostKey(post) {
    return `${post.platform}:${post.tweetId}`;
}

function buildSelectColumns({ postAlias = "posts", userPostAlias = null } = {}) {
    const columns = BASE_POST_COLUMNS.map((column) => `${postAlias}.${column} AS ${column}`);

    if (userPostAlias) {
        columns.push(`${userPostAlias}.user_id AS user_id`);
        columns.push(`${userPostAlias}.captured_at AS user_captured_at`);
        columns.push(`${userPostAlias}.received_at AS user_received_at`);
    } else {
        columns.push("NULL::bigint AS user_id");
        columns.push(`${postAlias}.captured_at AS user_captured_at`);
        columns.push(`${postAlias}.received_at AS user_received_at`);
    }

    return columns.join(",\n            ");
}

async function ingestPosts(posts) {
    throw new Error("ingestPosts requires a user context. Use ingestPostsForUser(userId, posts).");
}

async function ingestPostsForUser(userId, posts) {
    const acceptedIds = [];
    const duplicateIds = [];

    await db.withTransaction(async (tx) => {
        for (const post of posts) {
            const key = buildPostKey(post);
            const receivedAt = new Date().toISOString();

            try {
                const canonicalRows = await tx.query(
                    `
                        INSERT INTO posts (
                            platform,
                            tweet_id,
                            author,
                            posted_at,
                            text,
                            media,
                            quoted_post,
                            captured_at,
                            received_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        ON CONFLICT (platform, tweet_id) DO UPDATE
                        SET author = COALESCE(posts.author, EXCLUDED.author),
                            posted_at = COALESCE(posts.posted_at, EXCLUDED.posted_at),
                            text = COALESCE(NULLIF(posts.text, ''), EXCLUDED.text),
                            media = COALESCE(posts.media, EXCLUDED.media),
                            quoted_post = COALESCE(posts.quoted_post, EXCLUDED.quoted_post),
                            captured_at = COALESCE(
                                GREATEST(posts.captured_at, EXCLUDED.captured_at),
                                posts.captured_at,
                                EXCLUDED.captured_at
                            ),
                            received_at = GREATEST(posts.received_at, EXCLUDED.received_at)
                        RETURNING id
                    `,
                    [
                        post.platform,
                        post.tweetId,
                        JSON.stringify(post.author || null),
                        post.postedAt || null,
                        post.text,
                        JSON.stringify(post.media || null),
                        JSON.stringify(post.quotedPost || null),
                        post.capturedAt || null,
                        receivedAt,
                    ]
                );

                const postId = Number(canonicalRows.rows[0].id);
                const linkInsert = await tx.run(
                    `
                        INSERT INTO user_posts (
                            user_id,
                            post_id,
                            captured_at,
                            received_at
                        ) VALUES ($1, $2, $3, $4)
                        ON CONFLICT (user_id, post_id) DO NOTHING
                        RETURNING post_id
                    `,
                    [userId, postId, post.capturedAt || null, receivedAt]
                );

                if (linkInsert.changes === 0) {
                    await tx.run(
                        `
                            UPDATE user_posts
                            SET captured_at = COALESCE(
                                    GREATEST(captured_at, $1),
                                    captured_at,
                                    $1
                                ),
                                received_at = GREATEST(received_at, $2)
                            WHERE user_id = $3
                              AND post_id = $4
                        `,
                        [post.capturedAt || null, receivedAt, userId, postId]
                    );

                    duplicateIds.push(post.tweetId);
                    continue;
                }

                acceptedIds.push(post.tweetId);
            } catch (error) {
                error.message = `Failed to store post ${key}: ${error.message}`;
                throw error;
            }
        }
    });

    return {
        insertedCount: acceptedIds.length,
        duplicateCount: duplicateIds.length,
        acceptedIds,
        duplicateIds,
    };
}

async function getAllPosts() {
    return getAllPostsForUser(null);
}

async function getAllPostsForUser(userId) {
    const rows = await db.all(
        userId == null
            ? `
                SELECT
                    ${buildSelectColumns({ postAlias: "posts" })}
                FROM posts
                ORDER BY posts.id DESC
            `
            : `
                SELECT
                    ${buildSelectColumns({ postAlias: "posts", userPostAlias: "user_posts" })}
                FROM user_posts
                JOIN posts
                  ON posts.id = user_posts.post_id
                WHERE user_posts.user_id = $1
                ORDER BY user_posts.received_at DESC, posts.id DESC
            `,
        userId == null ? [] : [userId]
    );

    return rows.map(mapRowToPost);
}

async function getPostStats() {
    return getPostStatsForUser(null);
}

async function getPostStatsForUser(userId) {
    if (userId == null) {
        const labeledWhereClause = buildLabeledWhereClause("posts");
        const last24HoursWhereClause = buildWhereClause(labeledWhereClause, buildReceivedAtSinceWhereClause("posts", "24 hours"));
        const lastWeekWhereClause = buildWhereClause(labeledWhereClause, buildReceivedAtSinceWhereClause("posts", "7 days"));
        const [allTime, last24Hours, lastWeek, totalCapturedAllTime, totalCapturedLast24Hours, totalCapturedLastWeek] = await Promise.all([
            getAggregatedPostStats("FROM posts", labeledWhereClause, []),
            getAggregatedPostStats("FROM posts", last24HoursWhereClause, []),
            getAggregatedPostStats("FROM posts", lastWeekWhereClause, []),
            getTotalCapturedCount("FROM posts", "", []),
            getTotalCapturedCount("FROM posts", buildReceivedAtSinceWhereClause("posts", "24 hours"), []),
            getTotalCapturedCount("FROM posts", buildReceivedAtSinceWhereClause("posts", "7 days"), []),
        ]);

        allTime.totalCaptured = totalCapturedAllTime;
        last24Hours.totalCaptured = totalCapturedLast24Hours;
        lastWeek.totalCaptured = totalCapturedLastWeek;

        return {
            allTime,
            last24Hours,
            lastWeek,
        };
    }

    const fromClause = `
        FROM user_posts
        JOIN posts
          ON posts.id = user_posts.post_id
    `;
    const labeledWhereClause = buildWhereClause(buildUserWhereClause("user_posts", userId, 1), buildLabeledWhereClause("posts"));
    const last24HoursWhereClause = buildWhereClause(labeledWhereClause, buildReceivedAtSinceWhereClause("user_posts", "24 hours"));
    const lastWeekWhereClause = buildWhereClause(labeledWhereClause, buildReceivedAtSinceWhereClause("user_posts", "7 days"));
    const userWhereClause = buildUserWhereClause("user_posts", userId, 1);
    const [allTime, last24Hours, lastWeek, totalCapturedAllTime, totalCapturedLast24Hours, totalCapturedLastWeek] = await Promise.all([
        getAggregatedPostStats(fromClause, labeledWhereClause, [userId]),
        getAggregatedPostStats(fromClause, last24HoursWhereClause, [userId]),
        getAggregatedPostStats(fromClause, lastWeekWhereClause, [userId]),
        getTotalCapturedCount("FROM user_posts", userWhereClause, [userId]),
        getTotalCapturedCount(
            "FROM user_posts",
            buildWhereClause(userWhereClause, buildReceivedAtSinceWhereClause("user_posts", "24 hours")),
            [userId]
        ),
        getTotalCapturedCount(
            "FROM user_posts",
            buildWhereClause(userWhereClause, buildReceivedAtSinceWhereClause("user_posts", "7 days")),
            [userId]
        ),
    ]);

    allTime.totalCaptured = totalCapturedAllTime;
    last24Hours.totalCaptured = totalCapturedLast24Hours;
    lastWeek.totalCaptured = totalCapturedLastWeek;

    return {
        allTime,
        last24Hours,
        lastWeek,
    };
}

function buildLabeledWhereClause(postAlias = "posts") {
    return `${postAlias}.han_label IS NOT NULL`;
}

function buildUserWhereClause(tableAlias, userId, paramIndex = 1) {
    if (userId == null) {
        return "";
    }

    return `${tableAlias}.user_id = $${paramIndex}`;
}

function buildReceivedAtSinceWhereClause(tableAlias, interval) {
    const allowedIntervals = new Set(["24 hours", "7 days"]);
    if (!allowedIntervals.has(interval)) {
        throw new Error(`Unsupported stats interval: ${interval}`);
    }

    return `${tableAlias}.received_at >= NOW() - INTERVAL '${interval}'`;
}

function buildWhereClause(...clauses) {
    return clauses.filter(Boolean).join(" AND ");
}

async function getAggregatedPostStats(fromClause, whereClause = "", params = []) {
    const whereSql = whereClause ? `WHERE ${whereClause}` : "";
    const rows = await db.all(
        `
            SELECT
                ${STATS_SELECT_SQL}
            ${fromClause}
            ${whereSql}
        `,
        params
    );

    const row = rows[0] || {};
    return buildStatsFromRow(row);
}

async function getTotalCapturedCount(fromClause, whereClause = "", params = []) {
    const whereSql = whereClause ? `WHERE ${whereClause}` : "";
    const rows = await db.all(
        `
            SELECT COUNT(*) AS total_captured
            ${fromClause}
            ${whereSql}
        `,
        params
    );

    return Number(rows[0]?.total_captured) || 0;
}

async function getUnlabeledPosts(limit = 25) {
    const rows = await db.all(
        `
            SELECT
                ${buildSelectColumns({ postAlias: "posts" })}
            FROM posts
            WHERE (han_label IS NULL OR is_political IS NULL)
              AND (label_skip_reason IS NULL OR TRIM(label_skip_reason) = '')
            ORDER BY id ASC
            LIMIT $1
        `,
        [limit]
    );

    return rows.map(mapRowToPost);
}

async function getUnlabeledPostsForPoliticalSublabels(limit = 25) {
    const rows = await db.all(
        `
            SELECT
                ${buildSelectColumns({ postAlias: "posts" })}
            FROM posts
            WHERE is_political = 1
              AND (
                  partisan_animosity IS NULL OR
                  support_undemocratic_practices IS NULL OR
                  support_partisan_violence IS NULL OR
                  support_undemocratic_candidates IS NULL OR
                  opposition_bipartisan_cooperation IS NULL OR
                  social_distrust IS NULL OR
                  social_distance IS NULL OR
                  biased_evaluation_politicized_facts IS NULL
              )
            ORDER BY id ASC
            LIMIT $1
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
                ${buildSelectColumns({ postAlias: "posts" })}
            FROM posts
            WHERE ${labelColumn} IS NULL
              AND (label_skip_reason IS NULL OR TRIM(label_skip_reason) = '')
            ORDER BY id ASC
            LIMIT $1
        `,
        [limit]
    );

    return rows.map(mapRowToPost);
}

async function savePostLabel(id, label) {
    await db.run(
        `
            UPDATE posts
            SET han_label = $1
            WHERE id = $2
        `,
        [label, id]
    );
}

async function savePostLabelByColumn(id, labelColumn, label) {
    assertValidExtraLabelColumn(labelColumn);

    await db.run(
        `
            UPDATE posts
            SET ${labelColumn} = $1
            WHERE id = $2
        `,
        [label, id]
    );
}

async function saveHanAndPoliticalLabels(id, labels = {}, confidence = {}) {
    await db.run(
        `
            UPDATE posts
            SET han_label = $1,
                is_political = $2::smallint,
                label_confidence = $3,
                label_skip_reason = NULL
            WHERE id = $4
        `,
        [
            labels.hanLabel,
            labels.isPolitical,
            JSON.stringify(confidence || {}),
            id,
        ]
    );
}

async function markPostLabelSkipped(id, reason) {
    await db.run(
        `
            UPDATE posts
            SET label_skip_reason = $1
            WHERE id = $2
        `,
        [String(reason || "request_failed_after_retry"), id]
    );
}

async function savePoliticalSublabels(id, sublabels = {}, confidence = {}) {
    const mergedConfidence = await mergeConfidenceByPostId(id, confidence);

    await db.run(
        `
            UPDATE posts
            SET partisan_animosity = $1,
                support_undemocratic_practices = $2,
                support_partisan_violence = $3,
                support_undemocratic_candidates = $4,
                opposition_bipartisan_cooperation = $5,
                social_distrust = $6,
                social_distance = $7,
                biased_evaluation_politicized_facts = $8,
                label_confidence = $9
            WHERE id = $10
        `,
        [
            sublabels.partisan_animosity,
            sublabels.support_undemocratic_practices,
            sublabels.support_partisan_violence,
            sublabels.support_undemocratic_candidates,
            sublabels.opposition_bipartisan_cooperation,
            sublabels.social_distrust,
            sublabels.social_distance,
            sublabels.biased_evaluation_politicized_facts,
            JSON.stringify(mergedConfidence),
            id,
        ]
    );
}

async function mergeConfidenceByPostId(id, nextConfidence) {
    const rows = await db.all(
        `
            SELECT label_confidence
            FROM posts
            WHERE id = $1
            LIMIT 1
        `,
        [id]
    );

    const existing = rows?.[0]?.label_confidence || {};
    return {
        ...existing,
        ...(nextConfidence || {}),
    };
}

function mapRowToPost(row) {
    const extraLabels = EXTRA_LABELS.reduce((acc, label) => {
        acc[label.key] = row[label.column];
        return acc;
    }, {});

    return {
        id: Number(row.id),
        userId: row.user_id == null ? null : Number(row.user_id),
        platform: row.platform,
        tweetId: row.tweet_id,
        author: row.author || null,
        postedAt: formatTimestamp(row.posted_at),
        text: row.text,
        media: row.media || null,
        quotedPost: row.quoted_post || null,
        capturedAt: row.user_captured_at == null ? null : Number(row.user_captured_at),
        receivedAt: formatTimestamp(row.user_received_at),
        hanLabel: row.han_label,
        isPolitical: row.is_political,
        labelConfidence: row.label_confidence || null,
        labelSkipReason: row.label_skip_reason || null,
        extraLabels,
    };
}

function formatTimestamp(value) {
    if (value == null) {
        return null;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    return value;
}

function assertValidExtraLabelColumn(column) {
    if (!EXTRA_LABEL_COLUMNS.includes(column)) {
        throw new Error(`Unsupported label column: ${column}`);
    }
}

module.exports = {
    getAllPosts,
    getAllPostsForUser,
    getPostStats,
    getPostStatsForUser,
    getUnlabeledPosts,
    getUnlabeledPostsForPoliticalSublabels,
    getUnlabeledPostsByLabelColumn,
    ingestPosts,
    ingestPostsForUser,
    markPostLabelSkipped,
    saveHanAndPoliticalLabels,
    savePostLabel,
    savePostLabelByColumn,
    savePoliticalSublabels,
};
