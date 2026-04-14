require("../src/config/loadEnv");

const { all, closeDatabase, initializeDatabase } = require("../src/db/database");
const { classifyPostText } = require("../src/services/labelService");

async function main() {
    const postText = await resolveInputText(process.argv.slice(2));
    const result = await classifyPostText(postText);

    console.log("INPUT:");
    console.log(postText);
    console.log("");
    console.log("OUTPUT:");
    console.log(result.label);
}

async function resolveInputText(args) {
    if (args[0] === "--text") {
        const rawText = args.slice(1).join(" ").trim();
        if (!rawText) {
            throw new Error("Provide text after --text.");
        }

        return rawText;
    }

    const postId = args[0];
    return getPostText(postId);
}

async function getPostText(postId) {
    await initializeDatabase();

    const rows = await all(
        postId
            ? "SELECT text FROM posts WHERE id = $1 LIMIT 1"
            : "SELECT text FROM posts ORDER BY id DESC LIMIT 1",
        postId ? [postId] : []
    );
    const row = rows[0];

    if (!row || !row.text) {
        throw new Error("No posts found in the database.");
    }

    return row.text;
}

main()
    .then(() => closeDatabase())
    .catch(async (error) => {
        console.error("labelOnePost failed:", error.message);
        await closeDatabase().catch(() => { });
        process.exit(1);
    });
