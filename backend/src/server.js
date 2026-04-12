require("./config/loadEnv");

const app = require("./app");
const { start: startBatchScheduler } = require("./labeling/batch/scheduler");
const { startLabelWorker } = require("./labeling/sync/labelWorker");
const { closeDatabase, initializeDatabase } = require("./db/database");

const port = Number(process.env.PORT) || 3001;
let server = null;

async function startServer() {
    await initializeDatabase();
    if (process.env.LABEL_BATCH_ENABLED === "1") {
        startBatchScheduler();
    } else {
        startLabelWorker();
    }

    server = app.listen(port, () => {
        console.log(`Backend listening on http://localhost:${port}`);
    });
}

async function shutdown(signal) {
    console.log(`Received ${signal}. Shutting down backend.`);

    if (server) {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }

    await closeDatabase();
    process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        shutdown(signal).catch((error) => {
            console.error("Failed during shutdown:", error);
            process.exit(1);
        });
    });
}

startServer().catch((error) => {
    console.error("Failed to start backend:", error);
    process.exit(1);
});
