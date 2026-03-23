const path = require("path");
const dotenv = require("dotenv");
const { initializeDatabase } = require("../src/db/database");
const { labelOnce, startLabelWorker } = require("../src/services/labelWorker");

dotenv.config({ path: path.join(process.cwd(), ".env") });

async function main() {
    const watchMode = process.argv.includes("--watch");

    await initializeDatabase();

    if (!watchMode) {
        await labelOnce();
        return;
    }

    startLabelWorker();
}

main().catch((error) => {
    console.error("labelUnlabeledPosts failed:", error.message);
    process.exit(1);
});
