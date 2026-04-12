const path = require("path");
const { Migration } = require("node-pg-migrate");
const { migrationsDir } = require("../src/db/migrate");

async function main() {
    const name = String(process.argv[2] || "").trim();

    if (!name) {
        throw new Error("Provide a migration name, for example: npm run db:migrate:create -- add_users");
    }

    const migrationPath = await Migration.create(name, migrationsDir, {
        templateFileName: path.join(__dirname, "templates", "migration-template.mjs"),
    });

    console.log(`Created migration: ${path.relative(process.cwd(), migrationPath)}`);
}

main().catch((error) => {
    console.error("createDbMigration failed:", error.message);
    process.exit(1);
});
