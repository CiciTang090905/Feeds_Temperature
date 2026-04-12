const { hashAccessToken, isValidAccessToken } = require("../auth/tokenAuth");
const userService = require("../services/userService");

async function requireUser(req, res, next) {
    try {
        const authHeader = String(req.headers.authorization || "");
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        const token = match ? match[1].trim() : "";

        if (!isValidAccessToken(token)) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const user = await userService.findUserByTokenHash(hashAccessToken(token));
        if (!user) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        req.user = {
            id: user.id,
            username: user.username,
        };

        userService.touchLastSeen(user.id).catch(() => {});
        return next();
    } catch (error) {
        return next(error);
    }
}

module.exports = {
    requireUser,
};
