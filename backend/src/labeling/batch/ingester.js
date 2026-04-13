const db = require("../../db/database");
const { EXTRA_LABELS, STAGE_A_LABELS } = require("../shared/catalog");
const { decode } = require("./customId");
const { downloadFile } = require("./openaiClient");

const STAGE_LABEL_MAP = {
    A: new Map(STAGE_A_LABELS.map((label) => [label.requestKey, label])),
    B: new Map(EXTRA_LABELS.map((label) => [label.requestKey, label])),
};

async function run(batchJob) {
    if (batchJob.status === "failed") {
        await db.run(
            `
                UPDATE batch_jobs
                SET status = 'failed_fatal',
                    last_error = $1
                WHERE id = $2
            `,
            [serializeBatchError(batchJob), batchJob.id]
        );
        console.error(
            `[batch ingester] failed_fatal local_batch_id=${batchJob.id} remote_batch_id=${batchJob.openai_batch_id} stage=${batchJob.stage}`
        );
        return;
    }

    if (batchJob.status === "cancelled") {
        console.warn(
            `[batch ingester] cancelled local_batch_id=${batchJob.id} remote_batch_id=${batchJob.openai_batch_id} stage=${batchJob.stage}`
        );
        await markBatchPostsFailed(batchJob, "cancelled");
        return;
    }

    if (!["completed", "expired"].includes(batchJob.status)) {
        return;
    }

    const summary = {
        failed: 0,
        staleSkipped: 0,
        succeeded: 0,
    };

    if (batchJob.openai_output_file_id) {
        const output = await downloadFile(batchJob.openai_output_file_id);
        await ingestOutputLines(batchJob, output, summary);
    }

    if (batchJob.openai_error_file_id) {
        const errorFile = await downloadFile(batchJob.openai_error_file_id);
        await ingestErrorLines(batchJob, errorFile, summary);
    }

    await db.run(
        `
            UPDATE batch_jobs
            SET status = 'ingested',
                ingested_at = NOW()
            WHERE id = $1
        `,
        [batchJob.id]
    );

    const backlog = await getBacklogCounts();
    console.log(
        `[batch ingester] ingested local_batch_id=${batchJob.id} remote_batch_id=${batchJob.openai_batch_id} stage=${batchJob.stage} status=${batchJob.status} succeeded=${summary.succeeded} failed=${summary.failed} stale_skipped=${summary.staleSkipped} pending_stage_a=${backlog.stageAPending} pending_stage_b=${backlog.stageBPending}`
    );
}

async function ingestOutputLines(batchJob, contents, summary) {
    const lines = splitJsonl(contents);

    for (const line of lines) {
        const entry = JSON.parse(line);
        const { postId, requestKey, stage } = decode(entry.custom_id);

        if (stage !== batchJob.stage) {
            continue;
        }

        if (!entry.response || entry.response.status_code !== 200) {
            summary.failed += 1;
            await markSinglePostFailed(batchJob, postId, entry.response?.status_code ? `status_${entry.response.status_code}` : "request_failed");
            continue;
        }

        const labelConfig = STAGE_LABEL_MAP[stage].get(requestKey);
        if (!labelConfig) {
            summary.failed += 1;
            await markSinglePostFailed(batchJob, postId, "unknown_request_key");
            continue;
        }

        let parsed;
        try {
            parsed = parseChatCompletionPayload(entry.response.body, labelConfig);
        } catch (error) {
            summary.failed += 1;
            await markSinglePostFailed(batchJob, postId, "invalid_response");
            continue;
        }

        const result = await applySuccessfulLabel(batchJob, postId, labelConfig, parsed);
        if (result === "stale") {
            summary.staleSkipped += 1;
            continue;
        }

        summary.succeeded += 1;
    }
}

async function ingestErrorLines(batchJob, contents, summary) {
    const lines = splitJsonl(contents);

    for (const line of lines) {
        const entry = JSON.parse(line);
        const { postId, stage } = decode(entry.custom_id);

        if (stage !== batchJob.stage) {
            continue;
        }

        const code = entry.error?.code || "request_failed";
        summary.failed += 1;
        await markSinglePostFailed(batchJob, postId, code);
    }
}

async function applySuccessfulLabel(batchJob, postId, labelConfig, parsed) {
    return db.withTransaction(async (tx) => {
        const batchIdColumn = batchJob.stage === "A" ? "stage_a_batch_id" : "stage_b_batch_id";
        const statusColumn = batchJob.stage === "A" ? "stage_a_status" : "stage_b_status";
        const errorColumn = batchJob.stage === "A" ? "stage_a_last_error" : "stage_b_last_error";
        const rows = await tx.all(
            `
                SELECT *
                FROM posts
                WHERE id = $1
                FOR UPDATE
            `,
            [postId]
        );
        const row = rows[0];

        if (!row || Number(row[batchIdColumn]) !== Number(batchJob.id) || row[statusColumn] !== "queued") {
            return "stale";
        }

        const mergedConfidence = {
            ...(row.label_confidence || {}),
            [labelConfig.responseKey || labelConfig.key]: parsed.confidence,
            [`image_used_${labelConfig.requestKey}`]: parsed.imageUsed,
        };

        await tx.query(
            `
                UPDATE posts
                SET ${labelConfig.column} = $1,
                    label_confidence = $2,
                    ${errorColumn} = NULL
                WHERE id = $3
            `,
            [parsed.value, JSON.stringify(mergedConfidence), postId]
        );

        if (batchJob.stage === "A" && labelConfig.column === "is_political" && parsed.value === 1 && row.stage_b_status === "n/a") {
            await tx.query(
                `
                    UPDATE posts
                    SET stage_b_status = 'pending',
                        stage_b_last_error = NULL
                    WHERE id = $1
                `,
                [postId]
            );
        }

        const refreshedRows = await tx.all(
            `
                SELECT *
                FROM posts
                WHERE id = $1
            `,
            [postId]
        );
        const refreshed = refreshedRows[0];

        if (batchJob.stage === "A") {
            const stageADone = refreshed.han_label !== null && refreshed.is_political !== null;

            if (stageADone) {
                await tx.query(
                    `
                        UPDATE posts
                        SET stage_a_status = 'done',
                            stage_a_batch_id = NULL
                        WHERE id = $1
                    `,
                    [postId]
                );
            }
        } else {
            const stageBDone = EXTRA_LABELS.every((label) => refreshed[label.column] !== null);

            if (stageBDone) {
                await tx.query(
                    `
                        UPDATE posts
                        SET stage_b_status = 'done',
                            stage_b_batch_id = NULL
                        WHERE id = $1
                    `,
                    [postId]
                );
            }
        }
        return "applied";
    });
}

async function markBatchPostsFailed(batchJob, reason) {
    const statusColumn = batchJob.stage === "A" ? "stage_a_status" : "stage_b_status";
    const batchIdColumn = batchJob.stage === "A" ? "stage_a_batch_id" : "stage_b_batch_id";
    const errorColumn = batchJob.stage === "A" ? "stage_a_last_error" : "stage_b_last_error";

    await db.withTransaction(async (tx) => {
        await tx.query(
            `
                UPDATE posts
                SET ${statusColumn} = 'failed',
                    ${errorColumn} = $1,
                    ${batchIdColumn} = NULL
                WHERE ${batchIdColumn} = $2
            `,
            [reason, batchJob.id]
        );

        await tx.query(
            `
                UPDATE batch_jobs
                SET status = 'ingested',
                    ingested_at = NOW(),
                    last_error = $1
                WHERE id = $2
            `,
            [reason, batchJob.id]
        );
    });
}

async function markSinglePostFailed(batchJob, postId, reason) {
    const statusColumn = batchJob.stage === "A" ? "stage_a_status" : "stage_b_status";
    const batchIdColumn = batchJob.stage === "A" ? "stage_a_batch_id" : "stage_b_batch_id";
    const errorColumn = batchJob.stage === "A" ? "stage_a_last_error" : "stage_b_last_error";

    await db.withTransaction(async (tx) => {
        const rows = await tx.all(
            `
                SELECT id
                FROM posts
                WHERE id = $1
                  AND ${batchIdColumn} = $2
                FOR UPDATE
            `,
            [postId, batchJob.id]
        );

        if (!rows.length) {
            return;
        }

        await tx.query(
            `
                UPDATE posts
                SET ${statusColumn} = 'failed',
                    ${errorColumn} = $1,
                    ${batchIdColumn} = NULL
                WHERE id = $2
            `,
            [reason, postId]
        );
    });
}

function parseChatCompletionPayload(body, labelConfig) {
    const messageContent = body?.choices?.[0]?.message?.content;
    const raw = Array.isArray(messageContent)
        ? messageContent.map((item) => item?.text || item?.value || "").join("\n")
        : String(messageContent || "");
    const match = raw.trim().match(/\{[\s\S]*\}/);

    if (!match) {
        throw new Error("No JSON object found in batch response");
    }

    const parsed = JSON.parse(match[0]);
    const responseKey = labelConfig.responseKey || labelConfig.key;
    const value = parsed?.[responseKey];
    const confidence = Number(parsed?.confidence?.[responseKey]);

    if (!(value === 0 || value === 1 || value === "0" || value === "1")) {
        throw new Error(`Invalid value for ${responseKey}`);
    }

    if (!Number.isFinite(confidence)) {
        throw new Error(`Invalid confidence for ${responseKey}`);
    }

    return {
        confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(4)))),
        imageUsed: normalizeImageUsed(parsed.image_used),
        value: Number(value),
    };
}

function normalizeImageUsed(value) {
    if (value === true || value === 1 || value === "1") return true;
    return false;
}

function splitJsonl(contents) {
    return String(contents || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function serializeBatchError(batchJob) {
    return JSON.stringify(batchJob.errors || batchJob.last_error || {
        message: "Batch failed before output ingestion.",
    });
}

async function getBacklogCounts() {
    const rows = await db.all(
        `
            SELECT
                COUNT(*) FILTER (WHERE stage_a_status = 'pending')::int AS stage_a_pending,
                COUNT(*) FILTER (WHERE stage_b_status = 'pending')::int AS stage_b_pending
            FROM posts
        `
    );
    const row = rows?.[0] || {};

    return {
        stageAPending: Number(row.stage_a_pending) || 0,
        stageBPending: Number(row.stage_b_pending) || 0,
    };
}

module.exports = {
    run,
};
