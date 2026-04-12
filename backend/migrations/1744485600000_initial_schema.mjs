export const shorthands = undefined;

export const up = (pgm) => {
    pgm.createTable(
        "posts",
        {
            id: {
                type: "bigserial",
                primaryKey: true,
            },
            platform: {
                type: "text",
                notNull: true,
            },
            tweet_id: {
                type: "text",
                notNull: true,
            },
            author: {
                type: "jsonb",
            },
            posted_at: {
                type: "timestamptz",
            },
            text: {
                type: "text",
                notNull: true,
            },
            media: {
                type: "jsonb",
            },
            quoted_post: {
                type: "jsonb",
            },
            captured_at: {
                type: "bigint",
            },
            received_at: {
                type: "timestamptz",
                notNull: true,
            },
            han_label: {
                type: "smallint",
            },
            is_political: {
                type: "smallint",
            },
            label_confidence: {
                type: "jsonb",
            },
            label_skip_reason: {
                type: "text",
            },
            partisan_animosity: {
                type: "smallint",
            },
            support_undemocratic_practices: {
                type: "smallint",
            },
            support_partisan_violence: {
                type: "smallint",
            },
            support_undemocratic_candidates: {
                type: "smallint",
            },
            opposition_bipartisan_cooperation: {
                type: "smallint",
            },
            social_distrust: {
                type: "smallint",
            },
            social_distance: {
                type: "smallint",
            },
            biased_evaluation_politicized_facts: {
                type: "smallint",
            },
        },
        {
            constraints: {
                unique: ["platform", "tweet_id"],
            },
        }
    );

    pgm.sql("CREATE INDEX idx_posts_received_at ON posts(received_at DESC)");
};

export const down = (pgm) => {
    pgm.dropTable("posts");
};
