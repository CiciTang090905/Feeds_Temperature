const userService = require("../services/userService");

async function autoLogin(req, res, next) {
    try {
        const googleId = String(req.body?.googleId || "").trim();
        const email = String(req.body?.email || "").trim().toLowerCase();

        if (!googleId) {
            return res.status(400).json({ error: "googleId is required." });
        }
        if (!email) {
            return res.status(400).json({ error: "email is required." });
        }

        const username = buildUsernameFromEmail(email);
        let user = await userService.createUserByGoogleId({
            googleId,
            email,
            username,
        });

        await userService.touchLastSeen(user.id);

        return res.json({
            userId: user.id,
            username: user.username,
            email: user.email || email,
        });
    } catch (error) {
        return next(error);
    }
}

async function updateMe(req, res, next) {
    try {
        const username = normalizeUsername(req.body?.username);
        if (!username) {
            return res.status(400).json({ error: "Username is required." });
        }

        if (username.length > 100) {
            return res.status(400).json({ error: "Username must be 100 characters or fewer." });
        }

        const user = await userService.updateUsername(req.user.id, username);
        return res.json({
            userId: user.id,
            username: user.username,
        });
    } catch (error) {
        return next(error);
    }
}

function normalizeUsername(value) {
    return String(value || "").trim();
}

function buildUsernameFromEmail(email) {
    const prefix = String(email || "").split("@")[0] || "feed-user";
    const normalized = prefix
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 100);

    return normalized || "feed-user";
}

module.exports = {
    autoLogin,
    updateMe,
};
