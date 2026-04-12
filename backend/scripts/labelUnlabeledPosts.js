require("../src/config/loadEnv");

const { closeDatabase, initializeDatabase } = require("../src/db/database");
const { labelOnce, startLabelWorker } = require("../src/labeling/sync/labelWorker");

async function main() {
    const watchMode = process.argv.includes("--watch");

    await initializeDatabase();

    if (!watchMode) {
        await labelOnce();
        return;
    }

    startLabelWorker();
}

main()
    .then(async () => {
        if (!process.argv.includes("--watch")) {
            await closeDatabase();
        }
    })
    .catch(async (error) => {
        console.error("labelUnlabeledPosts failed:", error.message);
        await closeDatabase().catch(() => {});
        process.exit(1);
    });

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        closeDatabase()
            .catch(() => {})
            .finally(() => process.exit(0));
    });
}
