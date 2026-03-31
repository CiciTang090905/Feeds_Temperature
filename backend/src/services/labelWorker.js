const postService = require("./postService");
const { classifyPostText, classifyPostsForLabel } = require("./labelService");
const { EXTRA_LABELS } = require("../config/labelCatalog");

const DEFAULT_INTERVAL_MS = 10000;
const DEFAULT_BATCH_SIZE = 25;

let isRunning = false;
let timer = null;

async function labelOnce() {
    if (isRunning) {
        console.log("labelWorker check skipped: previous run still in progress");
        return;
    }
    isRunning = true;
    const startedAt = new Date().toISOString();

    try {
        console.log(`labelWorker check starts: ${startedAt}`);
        await processHanBatch();
        await processNextExtraLabelBatch();
        console.log("labelWorker check complete");
    } catch (error) {
        console.error("labelWorker failed:", error.message);
    } finally {
        isRunning = false;
    }
}

async function processHanBatch() {
    const posts = await postService.getUnlabeledPosts(DEFAULT_BATCH_SIZE);
    if (posts.length === 0) {
        console.log("no unlabeled high_arousal_negative posts found");
        return;
    }

    console.log(`Found ${posts.length} unlabeled high_arousal_negative post(s).`);

    for (const post of posts) {
        const platform = post.platform || "unknown";
        const platformPostId = post.tweetId || "unknown";
        const dbId = post.id;

        try {
            const result = await classifyPostText(post.text);
            await postService.savePostLabel(dbId, result.label);
            console.log(
                `processing: ${platform}:${platformPostId} | db_id:${dbId} --> high_arousal_negative:${result.label}`
            );
        } catch (error) {
            if (error.code === "CONTENT_FILTER") {
                await postService.savePostLabel(dbId, 0);
                console.warn(
                    `processing: ${platform}:${platformPostId} | db_id:${dbId} --> high_arousal_negative:0 (fallback: ${error.filterCategory || "content_filter"})`
                );
                continue;
            }

            console.error(
                `processing: ${platform}:${platformPostId} | db_id:${dbId} --> high_arousal_negative failed (${error.message})`
            );
        }
    }
}

async function processNextExtraLabelBatch() {
    for (const label of EXTRA_LABELS) {
        const posts = await postService.getUnlabeledPostsByLabelColumn(label.column, DEFAULT_BATCH_SIZE);

        if (posts.length === 0) {
            continue;
        }

        console.log(`Found ${posts.length} unlabeled post(s) for ${label.key}.`);

        try {
            const batchResult = await classifyPostsForLabel(posts, label);

            for (const result of batchResult.results) {
                await postService.savePostLabelByColumn(result.id, label.column, result.label);
                console.log(`processing: db_id:${result.id} --> ${label.key}:${result.label}`);
            }

            console.log(`extra-label batch complete for ${label.key}: processed ${batchResult.results.length} post(s)`);
        } catch (error) {
            if (error.code === "CONTENT_FILTER") {
                for (const post of posts) {
                    await postService.savePostLabelByColumn(post.id, label.column, 0);
                    console.warn(
                        `processing: db_id:${post.id} --> ${label.key}:0 (batch fallback: ${error.filterCategory || "content_filter"})`
                    );
                }

                console.warn(`extra-label batch fallback applied for ${label.key}`);
                return;
            }

            console.error(`extra-label batch failed for ${label.key}: ${error.message}`);
            return;
        }

        // Only one extra label is processed per worker cycle to keep prompts fully isolated.
        return;
    }

    console.log("no unlabeled posts found for extra labels");
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
