export const shorthands = undefined;

export const up = (pgm) => {
    pgm.sql(`
        ALTER TABLE users
        DROP CONSTRAINT IF EXISTS users_token_hash_key
    `);

    pgm.dropColumn("users", "token_hash");
};

export const down = (pgm) => {
    pgm.addColumn("users", {
        token_hash: {
            type: "text",
        },
    });

    pgm.addConstraint("users", "users_token_hash_key", {
        unique: ["token_hash"],
    });
};
