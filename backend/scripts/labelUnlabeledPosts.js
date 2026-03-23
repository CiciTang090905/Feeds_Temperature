const path = require("path");
const dotenv = require("dotenv");
const { initializeDatabase } = require("../src/db/database");
const postService = require("../src/services/postService");
const { classifyPostText } = require("../src/services/labelService");

dotenv.config({ path: path.join(process.cwd(), ".env") });

async function main() {
    const watchMode = process.argv.includes("--watch");
    const intervalMs = Number(process.env.LABEL_POLL_INTERVAL_MS) || 30000;

    await initializeDatabase();

    if (!watchMode) {
        await labelOnce();
        return;
    }

    console.log(`Watching for unlabeled posts every ${intervalMs} ms...`);
    await labelOnce();
    setInterval(() => {
        labelOnce().catch((error) => {
            console.error("labelUnlabeledPosts failed:", error.message);
        });
    }, intervalMs);
}

let isRunning = false;

async function labelOnce() {
    if (isRunning) return;
    isRunning = true;

    try {
        const posts = await postService.getUnlabeledPosts(25);
        if (posts.length === 0) {
            console.log("No unlabeled posts found.");
            return;
        }

        console.log(`Found ${posts.length} unlabeled post(s).`);

        for (const post of posts) {
            const result = await classifyPostText(post.text);
            await postService.savePostLabel(post.id, result.label);
            console.log(`Labeled post ${post.id}: ${result.label}`);
        }
    } finally {
        isRunning = false;
    }
}

main().catch((error) => {
    console.error("labelUnlabeledPosts failed:", error.message);
    process.exit(1);
});
