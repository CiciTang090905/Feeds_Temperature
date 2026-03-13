const cors = require("cors"); //adds CORS middleware, allows requests from other origins
const healthRouter = require("./routes/health");
const postsRouter = require("./routes/posts");

const express = require("express"); 
const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" })); //parsed request body as JSON, and put on req.body

app.use("/health", healthRouter);
app.use("/api/posts", postsRouter);

app.use((error, request, response, next) => { //error-handling middleware
    console.error(error);
    response.status(500).json({
        error: "Internal server error",
    });
});

module.exports = app;
