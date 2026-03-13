const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
//SQLite database for storing posts, using sqlite3 package. Database file is located 
// at data/feeds-temperature.db. If the file doesn't exist, 
// it will be created automatically when we connect to it. The initializeDatabase 
// function creates the posts table if it doesn't already exist, with columns for id, 
// platform, tweet_id, author_json, posted_at, text, media_json, captured_at, 
// page_url, and received_at. The run and all functions are helper functions for 
// running SQL queries against the database.

//resolve gives full absolute path
const dataDir = path.resolve(__dirname, "../../data"); //backend/src/db/ --> back two levels
const dbPath = path.join(dataDir, "feeds-temperature.db");
//backend/data/feeds-temperature.db

//stores the database connection once it is created
let dbInstance = null;

function getDb() {
    if (dbInstance) return dbInstance;

    fs.mkdirSync(dataDir, { recursive: true });
    dbInstance = new sqlite3.Database(dbPath); //creates a connection to an SQLite database file
    return dbInstance;
}

function run(sql, params = []) { //write type query
    const db = getDb();
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }

            resolve({
                lastID: this.lastID,
                changes: this.changes,
            });
        });
    });
}

function all(sql, params = []) {//read type query   
    const db = getDb();
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(rows);
        });
    });
}

async function initializeDatabase() {
    await run(`
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            tweet_id TEXT NOT NULL,
            author_json TEXT,
            posted_at TEXT,
            text TEXT NOT NULL,
            media_json TEXT,
            captured_at INTEGER,
            page_url TEXT,
            received_at TEXT NOT NULL,
            UNIQUE(platform, tweet_id)
        )
    `);
    //reject duplicate posts 


}

module.exports = {
    all,
    initializeDatabase,
    run,
};
