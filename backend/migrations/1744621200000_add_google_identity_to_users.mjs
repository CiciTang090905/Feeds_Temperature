export const shorthands = undefined;

export const up = (pgm) => {
    pgm.addColumns("users", {
        google_id: {
            type: "text",
        },
        email: {
            type: "text",
        },
    });

    pgm.alterColumn("users", "token_hash", {
        notNull: false,
    });

    pgm.addConstraint("users", "users_google_id_key", {
        unique: ["google_id"],
    });

    pgm.createIndex("users", "google_id", {
        name: "idx_users_google_id",
    });
};

export const down = (pgm) => {
    pgm.dropIndex("users", "google_id", {
        name: "idx_users_google_id",
    });

    pgm.dropConstraint("users", "users_google_id_key");

    pgm.dropColumns("users", ["google_id", "email"]);

    pgm.alterColumn("users", "token_hash", {
        notNull: true,
    });
};
