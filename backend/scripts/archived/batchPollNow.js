require("../../src/config/loadEnv");

const { tick } = require("../../src/labeling/batch_archived/poller");

tick()
    .then(() => {
        console.log("Batch poller tick complete.");
    })
    .catch((error) => {
        console.error("batchPollNow failed:", error.message);
        process.exit(1);
    });
