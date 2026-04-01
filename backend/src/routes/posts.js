const express = require("express");
const postsController = require("../controllers/postsController");

const router = express.Router();

router.post("/batch", postsController.ingestPostsBatch);
router.get("/", postsController.listPosts);
router.get("/stats", postsController.getPostStats);
router.get("/events", postsController.streamStatsEvents);

module.exports = router;
