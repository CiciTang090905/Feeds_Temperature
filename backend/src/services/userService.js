const db = require("../db/database");

async function createUser({ username, tokenHash }) {
    const rows = await db.all(
        `
            INSERT INTO users (username, token_hash)
            VALUES ($1, $2)
            RETURNING id, username
        `,
        [username, tokenHash]
    );

    return mapUser(rows[0]);
}

async function findUserByTokenHash(tokenHash) {
    const rows = await db.all(
        `
            SELECT id, username, created_at, last_seen
            FROM users
            WHERE token_hash = $1
            LIMIT $2
        `,
        [tokenHash, 1]
    );

    return mapUser(rows[0] || null);
}

async function touchLastSeen(id) {
    await db.run(
        `
            UPDATE users
            SET last_seen = NOW()
            WHERE id = $1
        `,
        [id]
    );
}

async function updateUsername(id, username) {
    const rows = await db.all(
        `
            UPDATE users
            SET username = $1
            WHERE id = $2
            RETURNING id, username, created_at, last_seen
        `,
        [username, id]
    );

    return mapUser(rows[0] || null);
}

function mapUser(row) {
    if (!row) return null;

    return {
        id: Number(row.id),
        username: row.username,
        createdAt: formatTimestamp(row.created_at),
        lastSeen: formatTimestamp(row.last_seen),
    };
}

function formatTimestamp(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return value;
}

module.exports = {
    createUser,
    findUserByTokenHash,
    touchLastSeen,
    updateUsername,
};
