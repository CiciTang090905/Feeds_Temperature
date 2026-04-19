const userService = require("../services/userService");

async function requireUser(req, res, next) {
    try {
        const authHeader = String(req.headers.authorization || "");
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        const googleId = match ? match[1].trim() : "";

        if (!googleId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const user = await userService.findUserByGoogleId(googleId);
        if (!user) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        req.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            googleId: user.googleId,
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
