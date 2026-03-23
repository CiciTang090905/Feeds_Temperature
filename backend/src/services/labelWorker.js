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
            const platform = post.platform || "unknown";
            const platformPostId = post.tweetId || "unknown";
            const dbId = post.id;

            try {
                const result = await classifyPostText(post.text);
                await postService.savePostLabel(dbId, result.label);
                console.log(`processing: ${platform}:${platformPostId} | db_id:${dbId} --> label:${result.label}`);
            } catch (error) {
                if (error.code === "CONTENT_FILTER") {
                    // Skip repeated retries for posts blocked by provider-side content filtering.
                    await postService.savePostLabel(dbId, 0);
                    console.warn(
                        `processing: ${platform}:${platformPostId} | db_id:${dbId} --> label:0 (fallback: ${error.filterCategory || "content_filter"})`
                    );
                    continue;
                }

                // Keep the batch moving when one post fails for a transient/non-filter reason.
                console.error(`processing: ${platform}:${platformPostId} | db_id:${dbId} --> failed (${error.message})`);
            }
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
