const express = require("express");
const postsController = require("../controllers/postsController");
const { requireUser } = require("../middleware/requireUser");
const { ingestRateLimit } = require("../middleware/ingestRateLimit");

const router = express.Router();

router.use(requireUser);
router.post("/batch", ingestRateLimit, postsController.ingestPostsBatch);
router.get("/", postsController.listPosts);
router.get("/stats", postsController.getPostStats);
router.get("/events", postsController.streamStatsEvents);

module.exports = router;
