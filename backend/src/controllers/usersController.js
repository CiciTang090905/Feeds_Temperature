const { hashAccessToken, isValidAccessToken } = require("../auth/tokenAuth");
const userService = require("../services/userService");

async function register(req, res, next) {
    try {
        const username = normalizeUsername(req.body?.username);
        const token = String(req.body?.token || "").trim();

        if (!username) {
            return res.status(400).json({ error: "Username is required." });
        }

        if (username.length > 100) {
            return res.status(400).json({ error: "Username must be 100 characters or fewer." });
        }

        if (!isValidAccessToken(token)) {
            return res.status(400).json({ error: "Token must be 64 lowercase hex characters." });
        }

        try {
            const user = await userService.createUser({
                tokenHash: hashAccessToken(token),
                username,
            });

            return res.status(201).json({
                userId: user.id,
                username: user.username,
            });
        } catch (error) {
            if (error.code === "23505") {
                return res.status(409).json({ error: "Access code already exists." });
            }

            throw error;
        }
    } catch (error) {
        return next(error);
    }
}

async function login(req, res, next) {
    try {
        const token = String(req.body?.token || "").trim();
        if (!isValidAccessToken(token)) {
            return res.status(400).json({ error: "Token must be 64 lowercase hex characters." });
        }

        const user = await userService.findUserByTokenHash(hashAccessToken(token));
        if (!user) {
            return res.status(401).json({ error: "Invalid access code." });
        }

        await userService.touchLastSeen(user.id);

        return res.json({
            userId: user.id,
            username: user.username,
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

module.exports = {
    login,
    register,
    updateMe,
};
