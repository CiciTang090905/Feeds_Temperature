const postService = require("./postService");
const { classifyPostsForLabel } = require("./labelService");
const { EXTRA_LABELS } = require("../config/labelCatalog");
const { notifyStatsUpdated } = require("./statsEvents");

const DEFAULT_INTERVAL_MS = 10000;
const DEFAULT_BATCH_SIZE = 25;
const HAN_BATCH_LABEL_CONFIG = {
    key: "high_arousal_negative",
    column: "han_label",
    name: "high-arousal negative emotion",
    definition: "activated, intense negativity directed at someone or something",
    extraGuidance:
        "Examples: anger, rage, outrage, hostility, insults, aggressive blame. Do not label sadness, worry, fatigue, neutral reporting, or positive emotions.",
};

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
        const hanProcessedCount = await processHanBatch();
        const extraProcessedCount = await processNextExtraLabelBatch();
        const totalProcessedCount = (hanProcessedCount || 0) + (extraProcessedCount || 0);

        if (totalProcessedCount > 0) {
            notifyStatsUpdated({
                hanProcessedCount: hanProcessedCount || 0,
                extraProcessedCount: extraProcessedCount || 0,
                totalProcessedCount,
            });
        }

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
        return 0;
    }

    console.log(`Found ${posts.length} unlabeled high_arousal_negative post(s).`);

    try {
        const batchResult = await classifyPostsForLabel(posts, HAN_BATCH_LABEL_CONFIG);

        for (const result of batchResult.results) {
            const post = posts.find((item) => String(item.id) === String(result.id));
            const platform = post?.platform || "unknown";
            const platformPostId = post?.tweetId || "unknown";

            await postService.savePostLabel(result.id, result.label);
            console.log(
                `processing: ${platform}:${platformPostId} | db_id:${result.id} --> high_arousal_negative:${result.label}`
            );
        }

        console.log(`han-label batch complete: processed ${batchResult.results.length} post(s)`);
        return batchResult.results.length;
    } catch (error) {
        if (error.code === "CONTENT_FILTER") {
            for (const post of posts) {
                const platform = post.platform || "unknown";
                const platformPostId = post.tweetId || "unknown";
                await postService.savePostLabel(post.id, 0);
                console.warn(
                    `processing: ${platform}:${platformPostId} | db_id:${post.id} --> high_arousal_negative:0 (batch fallback: ${error.filterCategory || "content_filter"})`
                );
            }
            console.warn("han-label batch fallback applied");
            return posts.length;
        }

        console.error(`han-label batch failed: ${error.message}`);
        return 0;
    }
}

async function processNextExtraLabelBatch() {
    let processedAny = false;
    let processedCount = 0;

    for (const label of EXTRA_LABELS) {
        const posts = await postService.getUnlabeledPostsByLabelColumn(label.column, DEFAULT_BATCH_SIZE);

        if (posts.length === 0) {
            continue;
        }

        processedAny = true;
        console.log(`Found ${posts.length} unlabeled post(s) for ${label.key}.`);

        try {
            const batchResult = await classifyPostsForLabel(posts, label);

            for (const result of batchResult.results) {
                await postService.savePostLabelByColumn(result.id, label.column, result.label);
                console.log(`processing: db_id:${result.id} --> ${label.key}:${result.label}`);
            }

            console.log(`extra-label batch complete for ${label.key}: processed ${batchResult.results.length} post(s)`);
            processedCount += batchResult.results.length;
        } catch (error) {
            if (error.code === "CONTENT_FILTER") {
                for (const post of posts) {
                    await postService.savePostLabelByColumn(post.id, label.column, 0);
                    console.warn(
                        `processing: db_id:${post.id} --> ${label.key}:0 (batch fallback: ${error.filterCategory || "content_filter"})`
                    );
                }

                console.warn(`extra-label batch fallback applied for ${label.key}`);
                processedCount += posts.length;
                continue;
            }

            console.error(`extra-label batch failed for ${label.key}: ${error.message}`);
            return processedCount;
        }
    }

    if (!processedAny) {
        console.log("no unlabeled posts found for extra labels");
    }

    return processedCount;
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
