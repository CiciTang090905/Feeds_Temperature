require("../src/config/loadEnv");

const { tick } = require("../src/labeling/batch/submitter");

tick()
    .then(() => {
        console.log("Batch submitter tick complete.");
    })
    .catch((error) => {
        console.error("batchSubmitNow failed:", error.message);
        process.exit(1);
    });
