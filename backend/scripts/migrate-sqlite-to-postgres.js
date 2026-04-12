const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");

require("../src/config/loadEnv");

const { closeDatabase, initializeDatabase } = require("../src/db/database");
const { getDatabaseUrl } = require("../src/db/migrate");
const { EXTRA_LABEL_COLUMNS } = require("../src/config/labelCatalog");

const DEFAULT_BATCH_SIZE = 500;
const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path.resolve(__dirname, "../data/feeds-temperature.db");

async function main() {
    await initializeDatabase();

    const sqliteDb = await openSqliteDatabase(SQLITE_DB_PATH);
    const postgresPool = new Pool({
        connectionString: getDatabaseUrl(),
    });

    try {
        await sqliteRun(sqliteDb, "PRAGMA wal_checkpoint(TRUNCATE);");
        const legacyUserId = await getLegacyOwnerUserId(postgresPool);

        const sourceColumns = await getSourceColumns(sqliteDb);
        const totalRows = await getTotalPosts(sqliteDb);

        if (totalRows === 0) {
            console.log("No SQLite posts found to copy.");
            return;
        }

        let copiedCount = 0;
        let offset = 0;

        while (offset < totalRows) {
            const rows = await readSourceBatch(sqliteDb, sourceColumns, DEFAULT_BATCH_SIZE, offset);
            if (rows.length === 0) {
                break;
            }

            const inserted = await insertPostBatch(
                postgresPool,
                rows.map((row) => mapSqliteRowToPostgresValues(row, legacyUserId))
            );
            copiedCount += inserted;
            offset += rows.length;

            console.log(`copied ${copiedCount} / ${totalRows} posts`);
        }

        await resetPostsIdSequence(postgresPool);
    } finally {
        await postgresPool.end();
        await closeSqliteDatabase(sqliteDb);
        await closeDatabase();
    }
}

function openSqliteDatabase(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(db);
        });
    });
}

function sqliteAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(rows);
        });
    });
}

function sqliteRun(db, sql) {
    return new Promise((resolve, reject) => {
        db.run(sql, (error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

function closeSqliteDatabase(db) {
    return new Promise((resolve, reject) => {
        db.close((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

async function getSourceColumns(sqliteDb) {
    const rows = await sqliteAll(sqliteDb, "PRAGMA table_info(posts)");
    return new Set(rows.map((row) => row.name));
}

async function getTotalPosts(sqliteDb) {
    const rows = await sqliteAll(sqliteDb, "SELECT COUNT(*) AS total FROM posts");
    return Number(rows[0]?.total) || 0;
}

async function readSourceBatch(sqliteDb, sourceColumns, limit, offset) {
    return sqliteAll(
        sqliteDb,
        `
            SELECT
                id,
                platform,
                tweet_id,
                ${selectSourceExpression(sourceColumns, ["author_json", "author"], "author_json")},
                ${selectSourceExpression(sourceColumns, ["posted_at"], "posted_at")},
                text,
                ${selectSourceExpression(sourceColumns, ["media_json", "media"], "media_json")},
                ${selectSourceExpression(sourceColumns, ["quoted_post", "quoted_post_json"], "quoted_post")},
                ${selectSourceExpression(sourceColumns, ["captured_at"], "captured_at")},
                ${selectSourceExpression(sourceColumns, ["received_at"], "received_at")},
                ${selectSourceExpression(sourceColumns, ["han_label"], "han_label")},
                ${selectSourceExpression(sourceColumns, ["is_political"], "is_political")},
                ${selectSourceExpression(sourceColumns, ["label_confidence_json", "label_confidence"], "label_confidence_json")},
                ${selectSourceExpression(sourceColumns, ["label_skip_reason"], "label_skip_reason")},
                ${EXTRA_LABEL_COLUMNS.map((column) => selectSourceExpression(sourceColumns, [column], column)).join(",\n                ")}
            FROM posts
            ORDER BY id ASC
            LIMIT ?
            OFFSET ?
        `,
        [limit, offset]
    );
}

function selectSourceExpression(sourceColumns, candidates, alias) {
    for (const candidate of candidates) {
        if (sourceColumns.has(candidate)) {
            return `${candidate} AS ${alias}`;
        }
    }

    return `NULL AS ${alias}`;
}

function mapSqliteRowToPostgresValues(row, legacyUserId) {
    return {
        id: Number(row.id),
        user_id: Number(legacyUserId),
        platform: row.platform,
        tweet_id: row.tweet_id,
        author: safeJsonParse(row.author_json),
        posted_at: row.posted_at || null,
        text: row.text,
        media: safeJsonParse(row.media_json),
        quoted_post: safeJsonParse(row.quoted_post),
        captured_at: row.captured_at == null ? null : Number(row.captured_at),
        received_at: row.received_at,
        han_label: normalizeNullableInteger(row.han_label),
        is_political: normalizeNullableInteger(row.is_political),
        label_confidence: safeJsonParse(row.label_confidence_json),
        label_skip_reason: row.label_skip_reason || null,
        partisan_animosity: normalizeNullableInteger(row.partisan_animosity),
        support_undemocratic_practices: normalizeNullableInteger(row.support_undemocratic_practices),
        support_partisan_violence: normalizeNullableInteger(row.support_partisan_violence),
        support_undemocratic_candidates: normalizeNullableInteger(row.support_undemocratic_candidates),
        opposition_bipartisan_cooperation: normalizeNullableInteger(row.opposition_bipartisan_cooperation),
        social_distrust: normalizeNullableInteger(row.social_distrust),
        social_distance: normalizeNullableInteger(row.social_distance),
        biased_evaluation_politicized_facts: normalizeNullableInteger(row.biased_evaluation_politicized_facts),
    };
}

function normalizeNullableInteger(value) {
    return value == null ? null : Number(value);
}

function safeJsonParse(value) {
    if (value == null || value === "") {
        return null;
    }

    if (typeof value === "object") {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

async function insertPostBatch(pool, rows) {
    if (rows.length === 0) {
        return 0;
    }

    const columns = [
        "id",
        "user_id",
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

    const values = [];
    const placeholders = rows.map((row, rowIndex) => {
        const rowValues = columns.map((column) => serializePostgresValue(row[column]));
        values.push(...rowValues);

        const baseIndex = rowIndex * columns.length;
        const rowPlaceholders = columns.map((_, columnIndex) => `$${baseIndex + columnIndex + 1}`);
        return `(${rowPlaceholders.join(", ")})`;
    });

    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const result = await client.query(
            `
                INSERT INTO posts (
                    ${columns.join(", ")}
                ) VALUES
                    ${placeholders.join(",\n                    ")}
                ON CONFLICT (user_id, platform, tweet_id) DO NOTHING
            `,
            values
        );
        await client.query("COMMIT");
        return result.rowCount || 0;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

function serializePostgresValue(value) {
    if (value == null) {
        return null;
    }

    if (typeof value === "object") {
        return JSON.stringify(value);
    }

    return value;
}

async function resetPostsIdSequence(pool) {
    await pool.query(`
        SELECT setval(
            pg_get_serial_sequence('posts', 'id'),
            COALESCE((SELECT MAX(id) FROM posts), 1),
            (SELECT MAX(id) IS NOT NULL FROM posts)
        )
    `);
}

async function getLegacyOwnerUserId(pool) {
    const result = await pool.query(
        `
            SELECT id
            FROM users
            WHERE username = $1
            ORDER BY id ASC
            LIMIT 1
        `,
        ["legacy-owner"]
    );

    const userId = result.rows?.[0]?.id;
    if (!userId) {
        throw new Error("Could not find legacy-owner user for SQLite migration.");
    }

    return Number(userId);
}

main().catch(async (error) => {
    console.error("migrate-sqlite-to-postgres failed:", error.message);
    await closeDatabase().catch(() => {});
    process.exit(1);
});
