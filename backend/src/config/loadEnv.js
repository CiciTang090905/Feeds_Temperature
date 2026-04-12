const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

let didLoadEnv = false;

function loadEnv() {
    if (didLoadEnv) {
        return;
    }

    const cwd = process.cwd();
    const envPath = resolveEnvPath(cwd);

    if (envPath) {
        dotenv.config({ path: envPath });
    }

    didLoadEnv = true;
}

function resolveEnvPath(cwd) {
    const explicitEnvFile = clean(process.env.ENV_FILE);
    if (explicitEnvFile) {
        return path.isAbsolute(explicitEnvFile) ? explicitEnvFile : path.join(cwd, explicitEnvFile);
    }

    const localEnvPath = path.join(cwd, ".env.local");
    if (fs.existsSync(localEnvPath)) {
        return localEnvPath;
    }

    const defaultEnvPath = path.join(cwd, ".env");
    if (fs.existsSync(defaultEnvPath)) {
        return defaultEnvPath;
    }

    return null;
}

function clean(value) {
    if (!value) return "";
    return value.trim().replace(/^['"]|['"]$/g, "");
}

loadEnv();

module.exports = {
    loadEnv,
};
