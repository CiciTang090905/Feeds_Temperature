require("../src/config/loadEnv");

const { runDbMigrations } = require("../src/db/migrate");

async function main() {
    const direction = process.argv[2] || "up";
    const rawCount = process.argv[3];
    const count = rawCount ? Number(rawCount) : Infinity;

    if (!["up", "down"].includes(direction)) {
        throw new Error("Usage: node scripts/runDbMigrate.js <up|down> [count]");
    }

    if (rawCount && !Number.isFinite(count)) {
        throw new Error(`Invalid migration count: ${rawCount}`);
    }

    const results = await runDbMigrations({
        count,
        direction,
        log: (message) => console.log(message),
    });

    if (!results.length) {
        console.log(`No ${direction} migrations to run.`);
        return;
    }

    console.log(`Completed ${direction} migration(s):`);
    for (const migration of results) {
        console.log(`- ${migration.name}`);
    }
}

main().catch((error) => {
    console.error("runDbMigrate failed:", error.message);
    process.exit(1);
});
