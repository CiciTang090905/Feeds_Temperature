import crypto from "crypto";

export const shorthands = undefined;

export const up = (pgm) => {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");

    pgm.createTable("users", {
        id: {
            type: "bigserial",
            primaryKey: true,
        },
        username: {
            type: "text",
            notNull: true,
        },
        token_hash: {
            type: "text",
            notNull: true,
            unique: true,
        },
        created_at: {
            type: "timestamptz",
            notNull: true,
            default: pgm.func("NOW()"),
        },
        last_seen: {
            type: "timestamptz",
        },
    });

    pgm.addColumn("posts", {
        user_id: {
            type: "bigint",
            references: "users",
            onDelete: "cascade",
        },
    });

    pgm.sql(`
        INSERT INTO users (username, token_hash)
        VALUES ('legacy-owner', '${tokenHash}')
    `);

    pgm.sql(`
        UPDATE posts
        SET user_id = (SELECT id FROM users WHERE token_hash = '${tokenHash}')
        WHERE user_id IS NULL
    `);

    pgm.alterColumn("posts", "user_id", {
        notNull: true,
    });

    pgm.sql(`
        ALTER TABLE posts
        DROP CONSTRAINT IF EXISTS posts_platform_tweet_id_key
    `);

    pgm.addConstraint("posts", "posts_user_id_platform_tweet_id_key", {
        unique: ["user_id", "platform", "tweet_id"],
    });

    pgm.createIndex("posts", ["user_id", { name: "received_at", sort: "DESC" }], {
        name: "idx_posts_user_received_at",
    });

    console.log(`[migration users_and_post_ownership] legacy-owner access code: ${rawToken}`);
};

export const down = (pgm) => {
    pgm.dropIndex("posts", ["user_id", { name: "received_at", sort: "DESC" }], {
        name: "idx_posts_user_received_at",
    });

    pgm.dropConstraint("posts", "posts_user_id_platform_tweet_id_key");
    pgm.addConstraint("posts", "posts_platform_tweet_id_key", {
        unique: ["platform", "tweet_id"],
    });

    pgm.dropColumn("posts", "user_id");
    pgm.dropTable("users");
};
