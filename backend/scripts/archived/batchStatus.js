require("../../src/config/loadEnv");

const db = require("../../src/db/database");

async function main() {
    await db.initializeDatabase();

    const rows = await db.all(
        `
            SELECT
                id,
                stage,
                openai_batch_id,
                status,
                request_count,
                submitted_at
            FROM batch_jobs
            WHERE status NOT IN ('ingested', 'failed_fatal')
            ORDER BY submitted_at ASC
        `
    );

    console.table(rows.map((row) => ({
        age_minutes: ageMinutes(row.submitted_at),
        id: Number(row.id),
        openai_batch_id: row.openai_batch_id,
        request_count: row.request_count,
        stage: row.stage,
        status: row.status,
    })));
}

function ageMinutes(value) {
    const submittedAt = value instanceof Date ? value : new Date(value);
    return Math.round((Date.now() - submittedAt.getTime()) / 60000);
}

main()
    .then(() => db.closeDatabase())
    .catch(async (error) => {
        console.error("batchStatus failed:", error.message);
        await db.closeDatabase().catch(() => {});
        process.exit(1);
    });
