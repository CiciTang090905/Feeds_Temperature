const path = require("path");
const { runner } = require("node-pg-migrate");

const migrationsDir = path.resolve(__dirname, "../../migrations");

function getDatabaseUrl() {
    const databaseUrl = String(process.env.DATABASE_URL || "").trim();

    if (!databaseUrl) {
        throw new Error("Missing DATABASE_URL in backend/.env.local or backend/.env.");
    }

    return databaseUrl;
}

async function runDbMigrations({ direction = "up", count = Infinity, log = () => {} } = {}) {
    return runner({
        checkOrder: true,
        count,
        databaseUrl: getDatabaseUrl(),
        dir: migrationsDir,
        direction,
        lockValue: 72418631,
        migrationsTable: "pgmigrations",
        noLock: false,
        singleTransaction: true,
        verbose: false,
        logger: {
            debug: () => {},
            error: console.error,
            info: log,
            warn: console.warn,
        },
    });
}

module.exports = {
    getDatabaseUrl,
    migrationsDir,
    runDbMigrations,
};
