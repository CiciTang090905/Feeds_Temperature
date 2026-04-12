export const shorthands = undefined;

export const up = (pgm) => {
    pgm.createTable("batch_jobs", {
        id: {
            type: "bigserial",
            primaryKey: true,
        },
        stage: {
            type: "text",
            notNull: true,
            check: "stage IN ('A', 'B')",
        },
        openai_batch_id: {
            type: "text",
            notNull: true,
            unique: true,
        },
        openai_input_file_id: {
            type: "text",
            notNull: true,
        },
        openai_output_file_id: {
            type: "text",
        },
        openai_error_file_id: {
            type: "text",
        },
        status: {
            type: "text",
            notNull: true,
        },
        request_count: {
            type: "integer",
            notNull: true,
        },
        submitted_at: {
            type: "timestamptz",
            notNull: true,
            default: pgm.func("NOW()"),
        },
        completed_at: {
            type: "timestamptz",
        },
        ingested_at: {
            type: "timestamptz",
        },
        last_error: {
            type: "text",
        },
    });

    pgm.addColumns("posts", {
        stage_a_status: {
            type: "text",
            notNull: true,
            default: "pending",
        },
        stage_b_status: {
            type: "text",
            notNull: true,
            default: "n/a",
        },
        stage_a_batch_id: {
            type: "bigint",
            references: "batch_jobs",
            onDelete: "SET NULL",
        },
        stage_b_batch_id: {
            type: "bigint",
            references: "batch_jobs",
            onDelete: "SET NULL",
        },
        stage_a_last_error: {
            type: "text",
        },
        stage_b_last_error: {
            type: "text",
        },
    });

    pgm.sql("CREATE INDEX idx_posts_stage_a_pending ON posts(stage_a_status) WHERE stage_a_status='pending'");
    pgm.sql("CREATE INDEX idx_posts_stage_b_pending ON posts(stage_b_status) WHERE stage_b_status='pending'");
    pgm.createIndex("posts", "stage_a_batch_id", { name: "idx_posts_stage_a_batch" });
    pgm.createIndex("posts", "stage_b_batch_id", { name: "idx_posts_stage_b_batch" });
    pgm.createIndex("batch_jobs", "status", { name: "idx_batch_jobs_status" });

    pgm.sql("UPDATE posts SET stage_a_status='done' WHERE han_label IS NOT NULL AND is_political IS NOT NULL");
    pgm.sql("UPDATE posts SET stage_b_status='done' WHERE stage_a_status='done' AND is_political=1 AND partisan_animosity IS NOT NULL");
    pgm.sql("UPDATE posts SET stage_b_status='pending' WHERE stage_a_status='done' AND is_political=1 AND partisan_animosity IS NULL");
    pgm.sql("UPDATE posts SET stage_b_status='n/a' WHERE stage_a_status='done' AND is_political=0");
};

export const down = (pgm) => {
    pgm.dropIndex("batch_jobs", "status", { name: "idx_batch_jobs_status" });
    pgm.dropIndex("posts", "stage_b_batch_id", { name: "idx_posts_stage_b_batch" });
    pgm.dropIndex("posts", "stage_a_batch_id", { name: "idx_posts_stage_a_batch" });
    pgm.sql("DROP INDEX IF EXISTS idx_posts_stage_b_pending");
    pgm.sql("DROP INDEX IF EXISTS idx_posts_stage_a_pending");
    pgm.dropColumns("posts", [
        "stage_a_status",
        "stage_b_status",
        "stage_a_batch_id",
        "stage_b_batch_id",
        "stage_a_last_error",
        "stage_b_last_error",
    ]);
    pgm.dropTable("batch_jobs");
};
