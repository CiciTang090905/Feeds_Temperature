const { tick: pollTick } = require("./poller");
const { tick: submitTick } = require("./submitter");
const { countByStatus } = require("./submitter");

let pollerTimer = null;
let submitterTimer = null;
let backlogSummaryTimer = null;

function start() {
    if (pollerTimer || submitterTimer) {
        return;
    }

    const submitterInterval = Number(process.env.LABEL_BATCH_SUBMITTER_INTERVAL_MS) || 600000;
    const pollerInterval = Number(process.env.LABEL_BATCH_POLLER_INTERVAL_MS) || 60000;
    const backlogSummaryInterval = Number(process.env.LABEL_BATCH_BACKLOG_LOG_INTERVAL_MS) || 180000;

    submitterTimer = setInterval(() => {
        submitTick().catch((error) => {
            console.error("batch submitter failed:", error.message);
        });
    }, submitterInterval);

    pollerTimer = setInterval(() => {
        pollTick().catch((error) => {
            console.error("batch poller failed:", error.message);
        });
    }, pollerInterval);

    backlogSummaryTimer = setInterval(() => {
        logBacklogSummary().catch((error) => {
            console.error("batch backlog summary failed:", error.message);
        });
    }, backlogSummaryInterval);

    console.log(
        `Batch scheduler started. submitter=${submitterInterval}ms poller=${pollerInterval}ms backlog_summary=${backlogSummaryInterval}ms`
    );

    submitTick().catch((error) => {
        console.error("initial batch submitter failed:", error.message);
    });

    pollTick().catch((error) => {
        console.error("initial batch poller failed:", error.message);
    });

    logBacklogSummary().catch((error) => {
        console.error("initial batch backlog summary failed:", error.message);
    });
}

async function logBacklogSummary() {
    const [stageAPending, stageBPending, stageAQueued, stageBQueued] = await Promise.all([
        countByStatus("stage_a_status", "pending"),
        countByStatus("stage_b_status", "pending"),
        countByStatus("stage_a_status", "queued"),
        countByStatus("stage_b_status", "queued"),
    ]);

    console.log(
        `[batch backlog] stage_a_pending=${stageAPending} stage_a_queued=${stageAQueued} stage_b_pending=${stageBPending} stage_b_queued=${stageBQueued}`
    );
}

module.exports = {
    start,
};
