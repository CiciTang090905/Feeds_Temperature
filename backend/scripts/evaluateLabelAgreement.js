const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { initializeDatabase, all } = require("../src/db/database");
const { EXTRA_LABELS } = require("../src/config/labelCatalog");
const { classifyHanAndPolitical, classifyPoliticalSublabels } = require("../src/services/labelService");

dotenv.config({ path: path.join(process.cwd(), ".env") });

const DEFAULT_SAMPLE_SIZE = 15;
const TEMP_DIR = path.resolve(__dirname, "../tmp");
const TEMP_REPORT_PATH = path.join(TEMP_DIR, "label-eval-latest.txt");

async function main() {
    const sampleSize = Number(process.argv[2]) || DEFAULT_SAMPLE_SIZE;
    await initializeDatabase();

    const logger = createLogger();
    const sampledPosts = await getSampledPosts(sampleSize);
    if (sampledPosts.length === 0) {
        logger.log("No labeled posts found to evaluate.");
        logger.flush();
        return;
    }

    shuffleInPlace(sampledPosts);

    const tracker = createTracker();
    const mismatches = [];

    for (const post of sampledPosts) {
        const imageUrl = extractImageContextUrl(post.media);

        const firstPass = await classifyHanAndPolitical(post.text || "", imageUrl, post.quotedPost || null);
        trackImageUsage(tracker.imageUsage.firstPass, imageUrl, firstPass.imageUsed);

        compareLabel(tracker, mismatches, post.id, "han_label", post.han_label, firstPass.labels.han_label);
        compareLabel(tracker, mismatches, post.id, "is_political", post.is_political, firstPass.labels.is_political);

        if (post.is_political === 1) {
            const sublabelResult = await classifyPoliticalSublabels(post.text || "", imageUrl, post.quotedPost || null);
            trackImageUsage(tracker.imageUsage.politicalSublabels, imageUrl, sublabelResult.imageUsed);

            for (const label of EXTRA_LABELS) {
                const expected = post[label.column];
                if (expected === null || expected === undefined) continue;
                const actual = sublabelResult.labels[label.column];
                compareLabel(tracker, mismatches, post.id, label.column, expected, actual);
            }
        }
    }

    printReport(sampledPosts, tracker, mismatches, logger);
    logger.flush();
}

async function getSampledPosts(limit) {
    const selectSublabels = EXTRA_LABELS.map((label) => label.column).join(",\n            ");

    return all(
        `
            SELECT
                id,
                text,
                media_json,
                quoted_post_json,
                han_label,
                is_political,
                ${selectSublabels}
            FROM posts
            WHERE han_label IS NOT NULL
              AND is_political IS NOT NULL
            ORDER BY RANDOM()
            LIMIT ?
        `,
        [limit]
    ).then((rows) => rows.map(mapRow));
}

function mapRow(row) {
    return {
        ...row,
        media: row.media_json ? safeJsonParse(row.media_json) : null,
        quotedPost: row.quoted_post_json ? safeJsonParse(row.quoted_post_json) : null,
    };
}

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
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

function createTracker() {
    return {
        perLabel: new Map(),
        overall: {
            total: 0,
            matched: 0,
        },
        imageUsage: {
            firstPass: createImageUsageCounter(),
            politicalSublabels: createImageUsageCounter(),
        },
    };
}

function createImageUsageCounter() {
    return {
        totalCalls: 0,
        withImageCalls: 0,
        imageUsedTrue: 0,
    };
}

function trackImageUsage(counter, imageUrl, imageUsed) {
    counter.totalCalls += 1;
    if (imageUrl) {
        counter.withImageCalls += 1;
    }
    if (imageUsed) {
        counter.imageUsedTrue += 1;
    }
}

function compareLabel(tracker, mismatches, postId, labelKey, expected, actual) {
    const current = tracker.perLabel.get(labelKey) || { total: 0, matched: 0 };

    current.total += 1;
    tracker.overall.total += 1;

    if (Number(expected) === Number(actual)) {
        current.matched += 1;
        tracker.overall.matched += 1;
    } else {
        mismatches.push({
            postId,
            label: labelKey,
            expected: Number(expected),
            predicted: Number(actual),
        });
    }

    tracker.perLabel.set(labelKey, current);
}

function printReport(sampledPosts, tracker, mismatches, logger) {
    const sampledIds = sampledPosts.map((post) => post.id);

    logger.log("\n=== Label Agreement Evaluation ===");
    logger.log(`Sample size: ${sampledPosts.length}`);
    logger.log(`Sampled post IDs (shuffled): ${sampledIds.join(", ")}`);

    logger.log("\nPer-label agreement:");
    for (const [label, stats] of tracker.perLabel.entries()) {
        const percent = stats.total > 0 ? Math.round((stats.matched / stats.total) * 100) : 0;
        logger.log(`- ${label}: ${stats.matched}/${stats.total} (${percent}%)`);
    }

    const overallPercent = tracker.overall.total > 0
        ? Math.round((tracker.overall.matched / tracker.overall.total) * 100)
        : 0;
    logger.log(`\nOverall agreement: ${tracker.overall.matched}/${tracker.overall.total} (${overallPercent}%)`);

    logger.log("\nImage utilization:");
    printImageUsageLine("First pass", tracker.imageUsage.firstPass, logger);
    printImageUsageLine("Political sublabels", tracker.imageUsage.politicalSublabels, logger);

    logger.log("\nMismatches:");
    if (mismatches.length === 0) {
        logger.log("- None");
        return;
    }

    const preview = mismatches.slice(0, 40);
    for (const item of preview) {
        logger.log(`- post_id:${item.postId} label:${item.label} expected:${item.expected} predicted:${item.predicted}`);
    }

    if (mismatches.length > preview.length) {
        logger.log(`- ... ${mismatches.length - preview.length} more mismatch(es)`);
    }
}

function printImageUsageLine(name, usage, logger) {
    const withImageRate = usage.totalCalls > 0 ? Math.round((usage.withImageCalls / usage.totalCalls) * 100) : 0;
    const usedRate = usage.totalCalls > 0 ? Math.round((usage.imageUsedTrue / usage.totalCalls) * 100) : 0;

    logger.log(
        `- ${name}: total_calls=${usage.totalCalls}, with_image=${usage.withImageCalls} (${withImageRate}%), image_used_true=${usage.imageUsedTrue} (${usedRate}%)`
    );
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

main().catch((error) => {
    console.error("evaluateLabelAgreement failed:", error.message);
    process.exit(1);
});
