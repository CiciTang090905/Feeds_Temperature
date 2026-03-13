const express = require("express");

const router = express.Router();

///health + / = /health
//a request to GET /health
router.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "feeds-temperature-backend",
    });
});

module.exports = router;
