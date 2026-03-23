const postService = require("./postService");
const { classifyPostText } = require("./labelService");

const DEFAULT_INTERVAL_MS = 10000;
const DEFAULT_BATCH_SIZE = 25;

let isRunning = false;
let timer = null;

async function labelOnce() {
    if (isRunning) return;
    isRunning = true;

    try {
        const posts = await postService.getUnlabeledPosts(DEFAULT_BATCH_SIZE);
        if (posts.length === 0) {
            return;
        }

        console.log(`Found ${posts.length} unlabeled post(s).`);

        for (const post of posts) {
            const result = await classifyPostText(post.text);
            await postService.savePostLabel(post.id, result.label);
            console.log(`Labeled post ${post.id}: ${result.label}`);
        }
    } catch (error) {
        console.error("labelWorker failed:", error.message);
    } finally {
        isRunning = false;
    }
}

function startLabelWorker() {
    if (timer) return;

    const intervalMs = Number(process.env.LABEL_POLL_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
    console.log(`Auto-label worker started. Polling every ${intervalMs} ms.`);

    labelOnce().catch((error) => {
        console.error("labelWorker failed:", error.message);
    });

    timer = setInterval(() => {
        labelOnce().catch((error) => {
            console.error("labelWorker failed:", error.message);
        });
    }, intervalMs);
}

module.exports = {
    labelOnce,
    startLabelWorker,
};
