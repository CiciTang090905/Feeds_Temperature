const path = require("path");
const dotenv = require("dotenv");
const sqlite3 = require("sqlite3").verbose();
const { classifyPostText } = require("../src/services/labelService");

dotenv.config({ path: path.join(process.cwd(), ".env") });

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

function getPostText(postId) {
    const dbPath = path.resolve(__dirname, "../data/feeds-temperature.db");
    const sql = postId
        ? "SELECT text FROM posts WHERE id = ?"
        : "SELECT text FROM posts ORDER BY id DESC LIMIT 1";
    const params = postId ? [postId] : [];

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openError) => {
            if (openError) reject(openError);
        });

        db.get(sql, params, (error, row) => {
            db.close();

            if (error) {
                reject(error);
                return;
            }

            if (!row || !row.text) {
                reject(new Error("No posts found in the database."));
                return;
            }

            resolve(row.text);
        });
    });
}

main().catch((error) => {
    console.error("labelOnePost failed:", error.message);
    process.exit(1);
});
