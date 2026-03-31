const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { EXTRA_LABEL_COLUMNS } = require("../src/config/labelCatalog");

const limit = Number(process.argv[2]) || 20;
const dbPath = path.resolve(__dirname, "../data/feeds-temperature.db");

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openError) => {
    if (openError) {
        console.error("Failed to open database:", openError.message);
        process.exit(1);
    }
});

db.all(
    `
        SELECT
            id,
            han_label,
            ${EXTRA_LABEL_COLUMNS.join(",\n            ")},
            substr(text, 1, 120) AS preview
        FROM posts
        ORDER BY id DESC
        LIMIT ?
    `,
    [limit],
    (error, rows) => {
        db.close();

        if (error) {
            console.error("Failed to query labels:", error.message);
            process.exit(1);
        }

        console.table(rows);
    }
);
