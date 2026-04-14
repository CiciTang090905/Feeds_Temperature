const fs = require("fs");
const path = require("path");

require("../src/config/loadEnv");

const { all, closeDatabase, initializeDatabase } = require("../src/db/database");
const { EXTRA_LABELS } = require("../src/labeling/shared/catalog");
const { classifyHanAndPolitical, classifyPoliticalSublabels } = require("../src/services/labelService");

const DEFAULT_SAMPLE_SIZE = 15;
const DEFAULT_RUN_COUNT = 10;
const MAX_REQUEST_ATTEMPTS = 3;
const TEMP_DIR = path.resolve(__dirname, "../tmp");
const TEMP_REPORT_PATH = path.join(TEMP_DIR, "label-stability-latest.txt");
const SUBLABEL_COLUMNS = EXTRA_LABELS.map((label) => label.column);

async function main() {
    const sampleSize = Number(process.argv[2]) || DEFAULT_SAMPLE_SIZE;
    const runCount = Number(process.argv[3]) || DEFAULT_RUN_COUNT;

    await initializeDatabase();

    const logger = createLogger();
    const sampledPosts = await getSampledPosts(sampleSize);
    if (sampledPosts.length === 0) {
        logger.log("No posts found to evaluate.");
        logger.flush();
        return;
    }

    logger.log("=== Label Stability Evaluation ===");
    logger.log(`Sample size: ${sampledPosts.length}`);
    logger.log(`Run count: ${runCount}`);
    logger.log(`Sampled post IDs: ${sampledPosts.map((post) => post.id).join(", ")}`);
    logger.log("");

    const runs = [];
    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
        const shuffledPosts = [...sampledPosts];
        shuffleInPlace(shuffledPosts);
        logger.log(`Run ${runIndex + 1}/${runCount} order: ${shuffledPosts.map((post) => post.id).join(", ")}`);

        const runResults = [];
        for (const post of shuffledPosts) {
            const result = await relabelPost(post);
            runResults.push(result);

            logger.log(
                `  post:${post.id} han:${result.labels.han_label} political:${result.labels.is_political}`
                + (result.labels.is_political === 1 ? " sublabels:labeled" : " sublabels:skipped")
                + ` mode:${result.imageMode}`
            );
        }

        runs.push({
            index: runIndex + 1,
            order: shuffledPosts.map((post) => post.id),
            results: runResults,
        });
    }

    const summary = buildSummary(sampledPosts, runs);
    printSummary(summary, logger);
    logger.flush();
}

async function getSampledPosts(limit) {
    const rows = await all(
        `
            SELECT
                id,
                user_id,
                platform,
                tweet_id,
                text,
                media,
                quoted_post
            FROM posts
            WHERE text IS NOT NULL
              AND TRIM(text) <> ''
            ORDER BY RANDOM()
            LIMIT $1
        `,
        [limit]
    );

    return rows.map((row) => ({
        id: Number(row.id),
        userId: row.user_id == null ? null : Number(row.user_id),
        platform: row.platform,
        tweetId: row.tweet_id,
        text: row.text,
        media: row.media || null,
        quotedPost: row.quoted_post || null,
    }));
}

async function relabelPost(post) {
    const preferredImageUrl = extractImageContextUrl(post.media);
    const firstPass = await classifyFirstPassWithFallback(post, preferredImageUrl);

    const labels = {
        han_label: firstPass.labels.han_label,
        is_political: firstPass.labels.is_political,
    };

    if (firstPass.labels.is_political === 1) {
        const secondPass = await classifyPoliticalWithFallback(post, firstPass.imageUrl);
        for (const column of SUBLABEL_COLUMNS) {
            labels[column] = secondPass.labels[column];
        }
    } else {
        for (const column of SUBLABEL_COLUMNS) {
            labels[column] = null;
        }
    }

    return {
        postId: post.id,
        labels,
        imageMode: firstPass.imageUrl ? "image" : "text-only",
    };
}

async function classifyFirstPassWithFallback(post, imageUrl) {
    try {
        const result = await withRetry(() => classifyHanAndPolitical(post.text || "", imageUrl, post.quotedPost || null));
        return {
            ...result,
            imageUrl,
        };
    } catch (error) {
        if (!imageUrl || !isImageDownloadTimeoutError(error)) {
            throw error;
        }

        const fallback = await withRetry(() => classifyHanAndPolitical(post.text || "", null, post.quotedPost || null));
        return {
            ...fallback,
            imageUrl: null,
        };
    }
}

async function classifyPoliticalWithFallback(post, imageUrl) {
    try {
        return await withRetry(() => classifyPoliticalSublabels(post.text || "", imageUrl, post.quotedPost || null));
    } catch (error) {
        if (!imageUrl || !isImageDownloadTimeoutError(error)) {
            throw error;
        }

        return withRetry(() => classifyPoliticalSublabels(post.text || "", null, post.quotedPost || null));
    }
}

async function withRetry(fn) {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (!isRetriableAzureError(error) || attempt === MAX_REQUEST_ATTEMPTS) {
                break;
            }
        }
    }

    throw lastError;
}

function isRetriableAzureError(error) {
    const message = String(error?.message || "");
    return /Azure OpenAI request failed: 5\d\d/.test(message)
        || /connection timeout/i.test(message)
        || /Timed out while downloading image/i.test(message);
}

function isImageDownloadTimeoutError(error) {
    return /Timed out while downloading image/i.test(String(error?.message || ""));
}

function extractImageContextUrl(media) {
    const image = Array.isArray(media?.images) ? media.images[0] : null;
    if (image) return image;

    const screenshot = Array.isArray(media?.videoThumbnails) ? media.videoThumbnails[0] : null;
    return screenshot || null;
}

function shuffleInPlace(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
}

function buildSummary(sampledPosts, runs) {
    const perPost = [];
    const overallByLabel = new Map();
    const labelKeys = ["han_label", "is_political", ...SUBLABEL_COLUMNS];

    for (const post of sampledPosts) {
        const runResults = runs
            .map((run) => run.results.find((result) => result.postId === post.id))
            .filter(Boolean);

        const labelSummaries = {};

        for (const labelKey of labelKeys) {
            const values = runResults.map((result) => normalizeLabelValue(result.labels[labelKey]));
            const counts = countValues(values);
            const dominant = getDominantEntry(counts);
            const agreement = values.length > 0 ? Number((dominant.count / values.length).toFixed(4)) : 0;

            labelSummaries[labelKey] = {
                values,
                counts,
                dominantValue: dominant.value,
                dominantCount: dominant.count,
                agreement,
                unanimous: counts.size <= 1,
            };

            const overall = overallByLabel.get(labelKey) || { totalPosts: 0, agreementSum: 0, unanimousPosts: 0 };
            overall.totalPosts += 1;
            overall.agreementSum += agreement;
            if (counts.size <= 1) {
                overall.unanimousPosts += 1;
            }
            overallByLabel.set(labelKey, overall);
        }

        perPost.push({
            postId: post.id,
            platform: post.platform,
            tweetId: post.tweetId,
            labelSummaries,
        });
    }

    return {
        sampleSize: sampledPosts.length,
        runCount: runs.length,
        sampledIds: sampledPosts.map((post) => post.id),
        runs: runs.map((run) => ({ index: run.index, order: run.order })),
        perPost,
        overallByLabel,
    };
}

function normalizeLabelValue(value) {
    if (value === null || value === undefined) {
        return "null";
    }
    return String(Number(value));
}

function countValues(values) {
    const counts = new Map();
    for (const value of values) {
        counts.set(value, (counts.get(value) || 0) + 1);
    }
    return counts;
}

function getDominantEntry(counts) {
    let dominantValue = "null";
    let dominantCount = 0;

    for (const [value, count] of counts.entries()) {
        if (count > dominantCount) {
            dominantValue = value;
            dominantCount = count;
        }
    }

    return {
        value: dominantValue,
        count: dominantCount,
    };
}

function printSummary(summary, logger) {
    logger.log("");
    logger.log("=== Overall Agreement By Label ===");
    for (const [labelKey, stats] of summary.overallByLabel.entries()) {
        const averageAgreement = stats.totalPosts > 0
            ? Math.round((stats.agreementSum / stats.totalPosts) * 100)
            : 0;
        logger.log(
            `- ${labelKey}: avg_agreement=${averageAgreement}% unanimous_posts=${stats.unanimousPosts}/${stats.totalPosts}`
        );
    }

    logger.log("");
    logger.log("=== Per-Post Breakdown ===");
    for (const post of summary.perPost) {
        logger.log(`post_id:${post.postId} ${post.platform}:${post.tweetId}`);
        for (const [labelKey, stats] of Object.entries(post.labelSummaries)) {
            const countsText = Array.from(stats.counts.entries())
                .map(([value, count]) => `${value}:${count}`)
                .join(", ");
            logger.log(
                `  - ${labelKey}: agreement=${Math.round(stats.agreement * 100)}% dominant=${stats.dominantValue} values=[${stats.values.join(", ")}] counts={${countsText}}`
            );
        }
    }
}

function createLogger() {
    const lines = [];

    return {
        log(message) {
            const text = String(message);
            lines.push(text);
            console.log(text);
        },
        flush() {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
            fs.writeFileSync(TEMP_REPORT_PATH, `${lines.join("\n")}\n`, "utf8");
            console.log(`\nSaved report: ${TEMP_REPORT_PATH}`);
        },
    };
}

main()
    .then(() => closeDatabase())
    .catch(async (error) => {
        console.error("evaluateLabelStability failed:", error.message);
        await closeDatabase().catch(() => {});
        process.exit(1);
    });
