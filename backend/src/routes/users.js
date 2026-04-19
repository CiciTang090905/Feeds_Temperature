const express = require("express");
const usersController = require("../controllers/usersController");
const { requireUser } = require("../middleware/requireUser");

const router = express.Router();
router.post("/auto-login", usersController.autoLogin);
router.patch("/me", requireUser, usersController.updateMe);

module.exports = router;
