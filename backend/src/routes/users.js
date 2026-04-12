const express = require("express");
const rateLimit = require("express-rate-limit");
const usersController = require("../controllers/usersController");
const { requireUser } = require("../middleware/requireUser");

const router = express.Router();

const loginRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    legacyHeaders: false,
    standardHeaders: true,
    message: { error: "Too many login attempts. Try again later." },
});

router.post("/register", usersController.register);
router.post("/login", loginRateLimiter, usersController.login);
router.patch("/me", requireUser, usersController.updateMe);

module.exports = router;
