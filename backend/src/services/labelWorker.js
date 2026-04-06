const postService = require("./postService");
const { classifyHanAndPolitical, classifyPoliticalSublabels } = require("./labelService");
const { notifyStatsUpdated } = require("./statsEvents");

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
        const processedCount = await processUnlabeledPosts();

        if (processedCount > 0) {
            notifyStatsUpdated({
                hanProcessedCount: processedCount,
                extraProcessedCount: 0,
                totalProcessedCount: processedCount,
            });
        }

        console.log("labelWorker check complete");
    } catch (error) {
        console.error("labelWorker failed:", error.message);
    } finally {
        isRunning = false;
    }
}

async function processUnlabeledPosts() {
    const posts = await postService.getUnlabeledPosts(DEFAULT_BATCH_SIZE);
    if (posts.length === 0) {
        console.log("no unlabeled posts found for first-pass labels");
        return 0;
    }

    console.log(`Found ${posts.length} unlabeled post(s) for first-pass labels.`);

    let processedCount = 0;

    for (const post of posts) {
        const imageUrl = extractImageContextUrl(post);

        try {
            const firstPass = await classifyHanAndPolitical(post.text || "", imageUrl);

            await postService.saveHanAndPoliticalLabels(
                post.id,
                {
                    hanLabel: firstPass.labels.han_label,
                    isPolitical: firstPass.labels.is_political,
                },
                {
                    highly_aroused_negativity: firstPass.confidence.highly_aroused_negativity,
                    is_political: firstPass.confidence.is_political,
                    image_used_first_pass: firstPass.imageUsed,
                }
            );

            console.log(
                `processing: ${post.platform}:${post.tweetId} | db_id:${post.id} --> high_arousal_negative:${firstPass.labels.han_label} is_political:${firstPass.labels.is_political}`
            );

            if (firstPass.labels.is_political === 1) {
                await processPoliticalSublabelsForPost(post, imageUrl);
            }

            processedCount += 1;
        } catch (error) {
            if (error.code === "CONTENT_FILTER") {
                await postService.saveHanAndPoliticalLabels(
                    post.id,
                    {
                        hanLabel: 0,
                        isPolitical: 0,
                    },
                    {
                        highly_aroused_negativity: null,
                        is_political: null,
                        image_used_first_pass: false,
                    }
                );
                console.warn(
                    `processing: ${post.platform}:${post.tweetId} | db_id:${post.id} --> high_arousal_negative:0 is_political:0 (fallback: ${error.filterCategory || "content_filter"})`
                );
                processedCount += 1;
                continue;
            }

            console.error(`first-pass labeling failed for db_id:${post.id}: ${error.message}`);
        }
    }

    return processedCount;
}

async function processPoliticalSublabelsForPost(post, imageUrl) {
    try {
        const sublabels = await classifyPoliticalSublabels(post.text || "", imageUrl);
        await postService.savePoliticalSublabels(
            post.id,
            sublabels.labels,
            {
                ...sublabels.confidence,
                image_used_political_sublabels: sublabels.imageUsed,
            }
        );

        console.log(
            `processing: ${post.platform}:${post.tweetId} | db_id:${post.id} --> political_sublabels_saved`
        );
    } catch (error) {
        if (error.code === "CONTENT_FILTER") {
            await postService.savePoliticalSublabels(
                post.id,
                {
                    partisan_animosity: 0,
                    support_undemocratic_practices: 0,
                    support_partisan_violence: 0,
                    support_undemocratic_candidates: 0,
                    opposition_bipartisan_cooperation: 0,
                    social_distrust: 0,
                    social_distance: 0,
                    biased_evaluation_politicized_facts: 0,
                },
                {
                    partisan_animosity: null,
                    support_undemocratic_practices: null,
                    support_partisan_violence: null,
                    support_undemocratic_candidates: null,
                    opposition_bipartisan_cooperation: null,
                    social_distrust: null,
                    social_distance: null,
                    biased_evaluation_politicized_facts: null,
                    image_used_political_sublabels: false,
                }
            );
            console.warn(
                `processing: ${post.platform}:${post.tweetId} | db_id:${post.id} --> political_sublabels:all_0 (fallback: ${error.filterCategory || "content_filter"})`
            );
            return;
        }

        console.error(`political sublabeling failed for db_id:${post.id}: ${error.message}`);
    }
}

function extractImageContextUrl(post) {
    const media = post?.media || {};
    const image = Array.isArray(media.images) ? media.images[0] : null;
    if (image) return image;

    const screenshot = Array.isArray(media.videoThumbnails) ? media.videoThumbnails[0] : null;
    return screenshot || null;
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
