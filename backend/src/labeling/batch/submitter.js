const db = require("../../db/database");
const { buildPassARequests, buildPassBRequests } = require("./jsonlBuilder");
const { getBatchRequestUrl, getOpenAIBatchModel } = require("./util");
const { createBatch, uploadBatchFile } = require("./openaiClient");

const MAX_POSTS_PER_BATCH = 50000;
let isRunning = false;

async function tick() {
    if (isRunning) {
        return;
    }

    isRunning = true;

    try {
        await submitStageA();
        await submitStageB();
    } finally {
        isRunning = false;
    }
}

async function submitStageA() {
    const posts = await db.all(
        `
            SELECT id, text, media, quoted_post
            FROM posts
            WHERE stage_a_status = 'pending'
            ORDER BY id
            LIMIT $1
        `,
        [MAX_POSTS_PER_BATCH]
    );

    if (!posts.length) {
        return;
    }

    const jsonl = buildPassARequests(posts, getOpenAIBatchModel());
    const requestCount = validateJsonl(jsonl);
    const inputFileId = await uploadBatchFile(jsonl);
    const batch = await createBatch(inputFileId, getBatchRequestUrl());

    await db.withTransaction(async (tx) => {
        const inserted = await tx.all(
            `
                INSERT INTO batch_jobs (
                    stage,
                    openai_batch_id,
                    openai_input_file_id,
                    status,
                    request_count
                ) VALUES ($1, $2, $3, $4, $5)
                RETURNING id
            `,
            ["A", batch.id, inputFileId, batch.status || "validating", requestCount]
        );
        const batchJobId = Number(inserted[0].id);
        const postIds = posts.map((post) => Number(post.id));

        await tx.query(
            `
                UPDATE posts
                SET stage_a_status = 'queued',
                    stage_a_batch_id = $1,
                    stage_a_last_error = NULL
                WHERE id = ANY($2::bigint[])
                  AND stage_a_status = 'pending'
            `,
            [batchJobId, postIds]
        );
    });

    console.log(`Submitted Stage A batch ${batch.id} for ${posts.length} posts (${requestCount} requests).`);
}

async function submitStageB() {
    const posts = await db.all(
        `
            SELECT id, text, media, quoted_post
            FROM posts
            WHERE stage_b_status = 'pending'
              AND is_political = 1
            ORDER BY id
            LIMIT $1
        `,
        [MAX_POSTS_PER_BATCH]
    );

    if (!posts.length) {
        return;
    }

    const jsonl = buildPassBRequests(posts, getOpenAIBatchModel());
    const requestCount = validateJsonl(jsonl);
    const inputFileId = await uploadBatchFile(jsonl);
    const batch = await createBatch(inputFileId, getBatchRequestUrl());

    await db.withTransaction(async (tx) => {
        const inserted = await tx.all(
            `
                INSERT INTO batch_jobs (
                    stage,
                    openai_batch_id,
                    openai_input_file_id,
                    status,
                    request_count
                ) VALUES ($1, $2, $3, $4, $5)
                RETURNING id
            `,
            ["B", batch.id, inputFileId, batch.status || "validating", requestCount]
        );
        const batchJobId = Number(inserted[0].id);
        const postIds = posts.map((post) => Number(post.id));

        await tx.query(
            `
                UPDATE posts
                SET stage_b_status = 'queued',
                    stage_b_batch_id = $1,
                    stage_b_last_error = NULL
                WHERE id = ANY($2::bigint[])
                  AND stage_b_status = 'pending'
                  AND is_political = 1
            `,
            [batchJobId, postIds]
        );
    });

    console.log(`Submitted Stage B batch ${batch.id} for ${posts.length} posts (${requestCount} requests).`);
}

function validateJsonl(jsonlString) {
    const lines = String(jsonlString || "").trim().split("\n").filter(Boolean);
    const seenCustomIds = new Set();

    for (const line of lines) {
        const parsed = JSON.parse(line);

        if (!parsed.custom_id || !parsed.method || !parsed.url || !parsed.body) {
            throw new Error(`Invalid batch request line: ${line}`);
        }

        if (seenCustomIds.has(parsed.custom_id)) {
            throw new Error(`Duplicate custom_id in batch payload: ${parsed.custom_id}`);
        }

        seenCustomIds.add(parsed.custom_id);
    }

    return lines.length;
}

module.exports = {
    tick,
    validateJsonl,
};
