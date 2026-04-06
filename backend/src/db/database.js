const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { EXTRA_LABEL_COLUMNS } = require("../config/labelCatalog");

const dataDir = path.resolve(__dirname, "../../data");
const dbPath = path.join(dataDir, "feeds-temperature.db");

let dbInstance = null;

function getDb() {
    if (dbInstance) return dbInstance;

    fs.mkdirSync(dataDir, { recursive: true });
    dbInstance = new sqlite3.Database(dbPath);
    return dbInstance;
}

function run(sql, params = []) {
    const db = getDb();
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }

            resolve({
                lastID: this.lastID,
                changes: this.changes,
            });
        });
    });
}

function all(sql, params = []) {
    const db = getDb();
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(rows);
        });
    });
}

async function hasColumn(tableName, columnName) {
    const columns = await all(`PRAGMA table_info(${tableName})`);
    return columns.some((column) => column.name === columnName);
}

async function migratePostsTable() {
    const hasPageUrl = await hasColumn("posts", "page_url");
    const hasLabel = await hasColumn("posts", "han_label");
    const hasIsPolitical = await hasColumn("posts", "is_political");
    const hasLabelConfidenceJson = await hasColumn("posts", "label_confidence_json");
    const hasLabelSkipReason = await hasColumn("posts", "label_skip_reason");
    const hasQuotedPost = await hasColumn("posts", "quoted_post");
    const hasQuotedPostJson = await hasColumn("posts", "quoted_post_json");
    const hasLabelModel = await hasColumn("posts", "label_model");
    const hasLabelError = await hasColumn("posts", "label_error");
    const extraLabelColumnsSql = EXTRA_LABEL_COLUMNS.map((column) => `${column} INTEGER`).join(",\n                ");
    const quotedPostSelectExpression = hasQuotedPost && hasQuotedPostJson
        ? "COALESCE(quoted_post, quoted_post_json)"
        : hasQuotedPost
            ? "quoted_post"
            : hasQuotedPostJson
                ? "quoted_post_json"
                : "NULL";

    if (hasPageUrl || hasLabelModel || hasLabelError || hasQuotedPostJson) {
        await run("ALTER TABLE posts RENAME TO posts_old");
        await run(`
            CREATE TABLE posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                tweet_id TEXT NOT NULL,
                author_json TEXT,
                posted_at TEXT,
                text TEXT NOT NULL,
                media_json TEXT,
                quoted_post TEXT,
                captured_at INTEGER,
                received_at TEXT NOT NULL,
                han_label INTEGER,
                is_political INTEGER,
                label_confidence_json TEXT,
                label_skip_reason TEXT,
                ${extraLabelColumnsSql},
                UNIQUE(platform, tweet_id)
            )
        `);
        await run(`
            INSERT INTO posts (
                id,
                platform,
                tweet_id,
                author_json,
                posted_at,
                text,
                media_json,
                quoted_post,
                captured_at,
                received_at,
                han_label,
                is_political,
                label_confidence_json,
                label_skip_reason
            )
            SELECT
                id,
                platform,
                tweet_id,
                author_json,
                posted_at,
                text,
                media_json,
                ${quotedPostSelectExpression} AS quoted_post,
                captured_at,
                received_at,
                han_label,
                NULL AS is_political,
                NULL AS label_confidence_json,
                NULL AS label_skip_reason
            FROM posts_old
        `);
        await run("DROP TABLE posts_old");
    } else {
        if (!hasLabel) {
            await run("ALTER TABLE posts ADD COLUMN han_label INTEGER");
        }

        for (const column of EXTRA_LABEL_COLUMNS) {
            const hasExtraLabelColumn = await hasColumn("posts", column);
            if (!hasExtraLabelColumn) {
                await run(`ALTER TABLE posts ADD COLUMN ${column} INTEGER`);
            }
        }
    }

    if (!(await hasColumn("posts", "is_political"))) {
        await run("ALTER TABLE posts ADD COLUMN is_political INTEGER");
    }

    if (!(await hasColumn("posts", "label_confidence_json"))) {
        await run("ALTER TABLE posts ADD COLUMN label_confidence_json TEXT");
    }

    if (!hasLabelSkipReason && !(await hasColumn("posts", "label_skip_reason"))) {
        await run("ALTER TABLE posts ADD COLUMN label_skip_reason TEXT");
    }

    if (!(await hasColumn("posts", "quoted_post"))) {
        await run("ALTER TABLE posts ADD COLUMN quoted_post TEXT");
    }
}

async function initializeDatabase() {
    const extraLabelColumnsSql = EXTRA_LABEL_COLUMNS.map((column) => `${column} INTEGER`).join(",\n            ");

    await run(`
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            tweet_id TEXT NOT NULL,
            author_json TEXT,
            posted_at TEXT,
            text TEXT NOT NULL,
            media_json TEXT,
            quoted_post TEXT,
            captured_at INTEGER,
            received_at TEXT NOT NULL,
            han_label INTEGER,
            is_political INTEGER,
            label_confidence_json TEXT,
            label_skip_reason TEXT,
            ${extraLabelColumnsSql},
            UNIQUE(platform, tweet_id)
        )
    `);

    await migratePostsTable();
}

module.exports = {
    all,
    initializeDatabase,
    run,
};
