const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

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
    const hasLabelModel = await hasColumn("posts", "label_model");
    const hasLabelError = await hasColumn("posts", "label_error");

    if (hasPageUrl || hasLabelModel || hasLabelError) {
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
                captured_at INTEGER,
                received_at TEXT NOT NULL,
                han_label INTEGER,
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
                captured_at,
                received_at,
                han_label
            )
            SELECT
                id,
                platform,
                tweet_id,
                author_json,
                posted_at,
                text,
                media_json,
                captured_at,
                received_at,
                han_label
            FROM posts_old
        `);
        await run("DROP TABLE posts_old");
        return;
    }

    if (!hasLabel) {
        await run("ALTER TABLE posts ADD COLUMN han_label INTEGER");
    }
}

async function initializeDatabase() {
    await run(`
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            tweet_id TEXT NOT NULL,
            author_json TEXT,
            posted_at TEXT,
            text TEXT NOT NULL,
            media_json TEXT,
            captured_at INTEGER,
            received_at TEXT NOT NULL,
            han_label INTEGER,
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
