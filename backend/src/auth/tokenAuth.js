const crypto = require("crypto");

const ACCESS_TOKEN_REGEX = /^[0-9a-f]{64}$/;

function isValidAccessToken(token) {
    return ACCESS_TOKEN_REGEX.test(String(token || "").trim());
}

function hashAccessToken(token) {
    return crypto.createHash("sha256").update(String(token || "").trim(), "utf8").digest("hex");
}

module.exports = {
    hashAccessToken,
    isValidAccessToken,
};
