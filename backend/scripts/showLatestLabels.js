require("../src/config/loadEnv");

const { all, closeDatabase, initializeDatabase } = require("../src/db/database");
const { EXTRA_LABEL_COLUMNS } = require("../src/config/labelCatalog");

async function main() {
    const limit = Number(process.argv[2]) || 20;
    await initializeDatabase();

    const rows = await all(
        `
            SELECT
                id,
                han_label,
                is_political,
                ${EXTRA_LABEL_COLUMNS.join(",\n                ")},
                LEFT(text, 120) AS preview
            FROM posts
            ORDER BY id DESC
            LIMIT $1
        `,
        [limit]
    );

    console.table(rows);
}

main()
    .then(() => closeDatabase())
    .catch(async (error) => {
        console.error("showLatestLabels failed:", error.message);
        await closeDatabase().catch(() => {});
        process.exit(1);
    });
