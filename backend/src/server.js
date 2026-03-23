const dotenv = require("dotenv");
const app = require("./app");
const { initializeDatabase } = require("./db/database");
const { startLabelWorker } = require("./services/labelWorker");

dotenv.config();

const port = Number(process.env.PORT) || 3001;

async function startServer() {
    await initializeDatabase();
    startLabelWorker();

    app.listen(port, () => {
        console.log(`Backend listening on http://localhost:${port}`);
    });
}

startServer().catch((error) => {
    console.error("Failed to start backend:", error);
    process.exit(1);
});
