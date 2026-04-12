const { tick: pollTick } = require("./poller");
const { tick: submitTick } = require("./submitter");

let pollerTimer = null;
let submitterTimer = null;

function start() {
    if (pollerTimer || submitterTimer) {
        return;
    }

    const submitterInterval = Number(process.env.LABEL_BATCH_SUBMITTER_INTERVAL_MS) || 600000;
    const pollerInterval = Number(process.env.LABEL_BATCH_POLLER_INTERVAL_MS) || 60000;

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

    console.log(`Batch scheduler started. submitter=${submitterInterval}ms poller=${pollerInterval}ms`);
}

module.exports = {
    start,
};
