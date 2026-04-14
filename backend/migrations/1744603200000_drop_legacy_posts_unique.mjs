export const shorthands = undefined;

export const up = (pgm) => {
    pgm.sql(`
        ALTER TABLE posts
        DROP CONSTRAINT IF EXISTS posts_uniq_platform_tweet_id
    `);

    pgm.sql(`
        DROP INDEX IF EXISTS posts_uniq_platform_tweet_id
    `);
};

export const down = (pgm) => {
    pgm.sql(`
        ALTER TABLE posts
        ADD CONSTRAINT posts_uniq_platform_tweet_id UNIQUE (platform, tweet_id)
    `);
};
