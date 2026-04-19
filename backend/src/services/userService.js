const db = require("../db/database");

async function createUserByGoogleId({ googleId, email, username }) {
    const rows = await db.all(
        `
            INSERT INTO users (username, google_id, email)
            VALUES ($1, $2, $3)
            ON CONFLICT (google_id) DO UPDATE
            SET email = COALESCE(users.email, EXCLUDED.email),
                username = COALESCE(NULLIF(users.username, ''), EXCLUDED.username)
            RETURNING id, username, email, google_id, created_at, last_seen
        `,
        [username, googleId, email]
    );

    return mapUser(rows[0]);
}

async function findUserByGoogleId(googleId) {
    const rows = await db.all(
        `
            SELECT id, username, email, google_id, created_at, last_seen
            FROM users
            WHERE google_id = $1
            LIMIT $2
        `,
        [googleId, 1]
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
            RETURNING id, username, email, google_id, created_at, last_seen
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
        email: row.email || null,
        googleId: row.google_id || null,
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
    createUserByGoogleId,
    findUserByGoogleId,
    touchLastSeen,
    updateUsername,
};
