const express = require("express");
const postsController = require("../controllers/postsController");

const router = express.Router();

router.post("/batch", postsController.ingestPostsBatch);
router.get("/", postsController.listPosts);

module.exports = router;
