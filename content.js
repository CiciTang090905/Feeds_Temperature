function getArticleText() {
    const article = document.querySelector("article");
    if (article) return article.innerText;
    const paragraphs = Array.from(document.querySelectorAll("p"));
    return paragraphs.map((p) => p.innerText).join("\n");
}

function getTweetStats() {
    const group = document.querySelector('article div[role="group"][aria-label]');
    if (!group) return null;

    const label = group.getAttribute("aria-label");
    if (!label) return null;

    const stats = {};

    const regex = /([\d,.]+)\s+(repl(?:y|ies)|reposts?|likes?|bookmarks?|views?)/gi;
    let match;

    while ((match = regex.exec(label)) !== null) {
        const value = match[1].replace(/,/g, "");
        const metric = match[2].toLowerCase();

        if (metric.startsWith("repl")) stats.replies = value;
        else if (metric.startsWith("repost")) stats.reposts = value;
        else if (metric.startsWith("like")) stats.likes = value;
        else if (metric.startsWith("bookmark")) stats.bookmarks = value;
        else if (metric.startsWith("view")) stats.views = value;
    }

    return stats;
}

function findTweetArticle() {
    const byTestId = document.querySelector('article[data-testid="tweet"]');
    if (byTestId) return byTestId;

    const tweetText = document.querySelector('div[data-testid="tweetText"]');
    return tweetText ? tweetText.closest("article") : null;
}


function getTweetText(tweetArticle) {
    // Tweet text is under data-testid="tweetText"
    const node = tweetArticle.querySelector('div[data-testid="tweetText"]');
    return node ? node.innerText : "";
}

function getTweetStats(tweetArticle) {
    // On Tweet, there is div[role="group"][aria-label="... replies, ... likes, ..."] for statistics
    const group = tweetArticle.querySelector('div[role="group"][aria-label]');
    if (!group) return null;
    const label = group.getAttribute("aria-label");
    if (!label) return null;
    const stats = {};
    const regex = /([\d,.]+)\s+(repl(?:y|ies)|reposts?|likes?|bookmarks?|views?)/gi;
    let match;

    while ((match = regex.exec(label)) !== null) {
        const value = match[1].replace(/,/g, "");
        const metric = match[2].toLowerCase();

        if (metric.startsWith("repl")) stats.replies = value;
        else if (metric.startsWith("repost")) stats.reposts = value;
        else if (metric.startsWith("like")) stats.likes = value;
        else if (metric.startsWith("bookmark")) stats.bookmarks = value;
        else if (metric.startsWith("view")) stats.views = value;
    }

    return stats;
}

function getPageData() {
    const tweetArticle = findTweetArticle();

    if (tweetArticle) {
        return {
            kind: "tweet",
            text: getTweetText(tweetArticle),
            stats: getTweetStats(tweetArticle),
        };
    }
    return {
        kind: "article",
        text: getArticleText(),
        stats: null,
    };
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.type === "GET_PAGE_DATA") {
        sendResponse(getPageData());
    }
});