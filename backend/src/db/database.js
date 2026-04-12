const { Pool } = require("pg");
const { getDatabaseUrl, runDbMigrations } = require("./migrate");

let poolInstance = null;
let initializationPromise = null;

function getPool() {
    if (poolInstance) {
        return poolInstance;
    }

    poolInstance = new Pool({
        connectionString: getDatabaseUrl(),
    });

    poolInstance.on("error", (error) => {
        console.error("Unexpected Postgres pool error:", error);
    });

    return poolInstance;
}

async function ensureInitialized() {
    if (!initializationPromise) {
        initializationPromise = (async () => {
            await runDbMigrations();
            return getPool();
        })().catch((error) => {
            initializationPromise = null;
            throw error;
        });
    }

    await initializationPromise;
    return getPool();
}

async function run(sql, params = [], client = null) {
    const result = await query(sql, params, client);
    const insertedId = result.rows?.[0]?.id;

    return {
        lastID: insertedId == null ? null : Number(insertedId),
        changes: result.rowCount || 0,
    };
}

async function all(sql, params = [], client = null) {
    const result = await query(sql, params, client);
    return result.rows;
}

async function query(sql, params = [], client = null) {
    const executor = client || await ensureInitialized();
    return executor.query(sql, params);
}

async function withTransaction(callback) {
    const pool = await ensureInitialized();
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const result = await callback({
            all: (sql, params = []) => all(sql, params, client),
            query: (sql, params = []) => query(sql, params, client),
            run: (sql, params = []) => runInClient(client, sql, params),
        });
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function runInClient(client, sql, params = []) {
    const result = await query(sql, params, client);
    const insertedId = result.rows?.[0]?.id;

    return {
        lastID: insertedId == null ? null : Number(insertedId),
        changes: result.rowCount || 0,
    };
}

async function initializeDatabase() {
    await ensureInitialized();
}

async function closeDatabase() {
    if (initializationPromise) {
        try {
            await initializationPromise;
        } catch (error) {
            // Allow cleanup after failed initialization attempts.
        }
    }

    initializationPromise = null;

    if (!poolInstance) {
        return;
    }

    const pool = poolInstance;
    poolInstance = null;
    await pool.end();
}

module.exports = {
    all,
    closeDatabase,
    initializeDatabase,
    query,
    run,
    withTransaction,
};
