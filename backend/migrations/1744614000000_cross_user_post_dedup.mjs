export const shorthands = undefined;

export const up = (pgm) => {
    pgm.createTable(
        "user_posts",
        {
            user_id: {
                type: "bigint",
                notNull: true,
                references: "users",
                onDelete: "cascade",
            },
            post_id: {
                type: "bigint",
                notNull: true,
                references: "posts",
                onDelete: "cascade",
            },
            captured_at: {
                type: "bigint",
            },
            received_at: {
                type: "timestamptz",
                notNull: true,
                default: pgm.func("NOW()"),
            },
        },
        {
            constraints: {
                primaryKey: ["user_id", "post_id"],
            },
        }
    );

    pgm.sql(`
        CREATE TEMP TABLE post_dedup_map AS
        WITH ranked_posts AS (
            SELECT
                id AS old_post_id,
                FIRST_VALUE(id) OVER (
                    PARTITION BY platform, tweet_id
                    ORDER BY (
                        CASE WHEN han_label IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN is_political IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN partisan_animosity IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN support_undemocratic_practices IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN support_partisan_violence IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN support_undemocratic_candidates IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN opposition_bipartisan_cooperation IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN social_distrust IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN social_distance IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN biased_evaluation_politicized_facts IS NOT NULL THEN 1 ELSE 0 END
                    ) DESC,
                    id ASC
                ) AS canonical_post_id
            FROM posts
        )
        SELECT old_post_id, canonical_post_id
        FROM ranked_posts
    `);

    pgm.sql(`
        INSERT INTO user_posts (user_id, post_id, captured_at, received_at)
        SELECT
            posts.user_id,
            post_dedup_map.canonical_post_id,
            MAX(posts.captured_at) AS captured_at,
            MAX(posts.received_at) AS received_at
        FROM posts
        JOIN post_dedup_map
          ON post_dedup_map.old_post_id = posts.id
        GROUP BY posts.user_id, post_dedup_map.canonical_post_id
        ON CONFLICT (user_id, post_id) DO UPDATE
        SET captured_at = COALESCE(
                GREATEST(user_posts.captured_at, EXCLUDED.captured_at),
                user_posts.captured_at,
                EXCLUDED.captured_at
            ),
            received_at = GREATEST(user_posts.received_at, EXCLUDED.received_at)
    `);

    pgm.sql(`
        DELETE FROM posts
        USING post_dedup_map
        WHERE posts.id = post_dedup_map.old_post_id
          AND post_dedup_map.old_post_id <> post_dedup_map.canonical_post_id
    `);

    pgm.dropIndex("posts", ["user_id", { name: "received_at", sort: "DESC" }], {
        name: "idx_posts_user_received_at",
    });

    pgm.sql(`
        ALTER TABLE posts
        DROP CONSTRAINT IF EXISTS posts_user_id_platform_tweet_id_key
    `);

    pgm.sql(`
        ALTER TABLE posts
        DROP CONSTRAINT IF EXISTS posts_platform_tweet_id_key
    `);

    pgm.addConstraint("posts", "posts_platform_tweet_id_key", {
        unique: ["platform", "tweet_id"],
    });

    pgm.dropColumn("posts", "user_id");

    pgm.createIndex("user_posts", ["user_id", { name: "received_at", sort: "DESC" }], {
        name: "idx_user_posts_user_received_at",
    });
    pgm.createIndex("user_posts", "post_id", {
        name: "idx_user_posts_post_id",
    });
    pgm.createIndex("user_posts", "captured_at", {
        name: "idx_user_posts_captured_at",
    });
};

export const down = (pgm) => {
    pgm.addColumn("posts", {
        user_id: {
            type: "bigint",
            references: "users",
            onDelete: "cascade",
        },
    });

    pgm.sql(`
        UPDATE posts
        SET user_id = source.user_id
        FROM (
            SELECT post_id, MIN(user_id) AS user_id
            FROM user_posts
            GROUP BY post_id
        ) AS source
        WHERE source.post_id = posts.id
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

    pgm.dropIndex("user_posts", "captured_at", {
        name: "idx_user_posts_captured_at",
    });
    pgm.dropIndex("user_posts", "post_id", {
        name: "idx_user_posts_post_id",
    });
    pgm.dropIndex("user_posts", ["user_id", { name: "received_at", sort: "DESC" }], {
        name: "idx_user_posts_user_received_at",
    });

    pgm.dropTable("user_posts");
};
