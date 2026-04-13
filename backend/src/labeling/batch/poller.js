const db = require("../../db/database");
const { retrieveBatch } = require("./openaiClient");
const { run: runIngester } = require("./ingester");

const TERMINAL_STATUSES = new Set(["cancelled", "completed", "expired", "failed"]);
let isRunning = false;

async function tick() {
    if (isRunning) {
        return;
    }

    isRunning = true;

    try {
        const jobs = await db.all(
            `
                SELECT *
                FROM batch_jobs
                WHERE status NOT IN ('ingested', 'failed_fatal')
                ORDER BY submitted_at ASC
            `
        );

        console.log(`[batch poller] active_jobs=${jobs.length}`);

        for (const job of jobs) {
            const batch = await retrieveBatch(job.openai_batch_id);
            const nextStatus = batch.status || job.status;
            console.log(
                `[batch poller] local_batch_id=${job.id} remote_batch_id=${job.openai_batch_id} stage=${job.stage} status=${job.status} -> ${nextStatus}`
            );

            await db.run(
                `
                    UPDATE batch_jobs
                    SET status = $1,
                        openai_output_file_id = $2,
                        openai_error_file_id = $3,
                        completed_at = CASE
                            WHEN completed_at IS NULL AND $1 IN ('completed', 'expired', 'cancelled', 'failed') THEN NOW()
                            ELSE completed_at
                        END,
                        last_error = CASE WHEN $4 = '' THEN last_error ELSE $4 END
                    WHERE id = $5
                `,
                [
                    nextStatus,
                    batch.output_file_id || null,
                    batch.error_file_id || null,
                    batch.errors ? JSON.stringify(batch.errors) : "",
                    job.id,
                ]
            );

            if (TERMINAL_STATUSES.has(nextStatus)) {
                console.log(
                    `[batch poller] ingesting terminal batch local_batch_id=${job.id} remote_batch_id=${job.openai_batch_id} stage=${job.stage} terminal_status=${nextStatus}`
                );
                await runIngester({
                    ...job,
                    errors: batch.errors,
                    openai_error_file_id: batch.error_file_id || null,
                    openai_output_file_id: batch.output_file_id || null,
                    status: nextStatus,
                });
            }
        }
    } finally {
        isRunning = false;
    }
}

module.exports = {
    tick,
};
