require("../src/config/loadEnv");

const db = require("../src/db/database");

async function main() {
    const batchRef = String(process.argv[2] || "").trim();
    if (!batchRef) {
        throw new Error("Provide a batch id or remote batch id. Example: npm run batch:inspect -- 12");
    }

    await db.initializeDatabase();

    const batchJob = await findBatchJob(batchRef);
    if (!batchJob) {
        throw new Error(`No batch job found for "${batchRef}".`);
    }

    const posts = await loadBatchPosts(batchJob);
    const summary = summarizePosts(posts, batchJob.stage);

    console.log("Batch job:");
    console.table([
        {
            completed_at: formatTimestamp(batchJob.completed_at),
            id: Number(batchJob.id),
            ingested_at: formatTimestamp(batchJob.ingested_at),
            last_error: truncate(batchJob.last_error, 120),
            openai_batch_id: batchJob.openai_batch_id,
            output_file_id: batchJob.openai_output_file_id || "",
            error_file_id: batchJob.openai_error_file_id || "",
            request_count: Number(batchJob.request_count),
            stage: batchJob.stage,
            status: batchJob.status,
            submitted_at: formatTimestamp(batchJob.submitted_at),
        },
    ]);

    console.log("\nLinked post summary:");
    console.table([summary]);

    console.log("\nLinked posts:");
    console.table(
        posts.slice(0, 50).map((row) => ({
            id: Number(row.id),
            preview: truncate(row.text, 80),
            stage_a_last_error: row.stage_a_last_error || "",
            stage_a_status: row.stage_a_status,
            stage_b_last_error: row.stage_b_last_error || "",
            stage_b_status: row.stage_b_status,
        }))
    );

    if (posts.length > 50) {
        console.log(`\nShowing first 50 of ${posts.length} linked posts.`);
    }
}

async function findBatchJob(batchRef) {
    const isNumeric = /^\d+$/.test(batchRef);
    const rows = await db.all(
        `
            SELECT *
            FROM batch_jobs
            WHERE ${isNumeric ? "id = $1::bigint OR openai_batch_id = $2" : "openai_batch_id = $1"}
            ORDER BY id DESC
            LIMIT 1
        `,
        isNumeric ? [batchRef, batchRef] : [batchRef]
    );

    return rows[0] || null;
}

async function loadBatchPosts(batchJob) {
    const batchIdColumn = batchJob.stage === "A" ? "stage_a_batch_id" : "stage_b_batch_id";

    return db.all(
        `
            SELECT
                id,
                text,
                stage_a_status,
                stage_b_status,
                stage_a_last_error,
                stage_b_last_error
            FROM posts
            WHERE ${batchIdColumn} = $1
            ORDER BY id ASC
        `,
        [batchJob.id]
    );
}

function summarizePosts(posts, stage) {
    const statusKey = stage === "A" ? "stage_a_status" : "stage_b_status";
    const errorKey = stage === "A" ? "stage_a_last_error" : "stage_b_last_error";

    return posts.reduce(
        (acc, row) => {
            acc.total += 1;
            const status = row[statusKey];
            if (status === "queued") acc.queued += 1;
            if (status === "done") acc.done += 1;
            if (status === "failed") acc.failed += 1;
            if (row[errorKey]) acc.with_errors += 1;
            return acc;
        },
        { done: 0, failed: 0, queued: 0, total: 0, with_errors: 0 }
    );
}

function truncate(value, maxLength) {
    const text = String(value || "");
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
}

function formatTimestamp(value) {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

main()
    .then(() => db.closeDatabase())
    .catch(async (error) => {
        console.error("batchInspect failed:", error.message);
        await db.closeDatabase().catch(() => {});
        process.exit(1);
    });
