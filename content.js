const postLists = [];

function isOnX() {
    return /(^|\.)x\.com$/.test(location.hostname) || /(^|\.)twitter\.com$/.test(location.hostname);
}

function addSimpleBannerText() {
    if (document.getElementById("injectText")) return;

    const textarea = document.createElement("textarea");
    textarea.id = "injectText";
    textarea.value = "HELLO FROM EXTENSION";
    textarea.style.position = "fixed"; //fixed to viewport
    textarea.style.zIndex = "2147483647"; //set high value, rendered on top
    textarea.style.background = "#706f6f";
    textarea.style.color = "white";
    textarea.style.padding = "8px 10px";
    textarea.style.borderRadius = "10px";
    textarea.style.border = "1px solid rgba(189, 177, 177, 0.15)";
    textarea.style.boxShadow = "0 2px 6px rgba(0,0,0,0.25)";
    textarea.style.boxSizing = "border-box";
    textarea.style.resize = "both";
    textarea.style.overflow = "auto";
    textarea.style.width = `${Math.round(window.innerWidth * 0.2)}px`;
    textarea.style.height = `${Math.round(window.innerHeight / 4)}px`;
    textarea.style.maxWidth = `${window.innerWidth}px`;
    textarea.style.maxHeight = `${window.innerHeight}px`;

    document.body.appendChild(textarea);
    function updatePosition() { //set up position, just below the sidebar
        const innerColumn = document.querySelector('header[role="banner"] nav[role="navigation"]');
        if (!innerColumn) return;
        const rect = innerColumn.getBoundingClientRect();
        textarea.style.left = `${rect.left}px`;
        textarea.style.top = `${Math.round(window.innerHeight * 0.58)}px`;
    }
    updatePosition();
    window.addEventListener("resize", updatePosition); //everytime resize the wind, render again with update position
}

function renderStatOnTweet() {
    if (!isOnX()) return;

    setTimeout(addSimpleBannerText, 300);

    const posts = getPostLists();

    posts.forEach((p) => {
        console.log(`POST #${p.id}`);
        console.log("text:", p.text);
        console.log("stats:", p.stats);
    });

    if (posts.length === 0) { //retry after 1 second if no posts found, since X can be slow to load content
        setTimeout(renderStatOnTweet, 1000);
    }
}

function getPostLists() {
    const timeline = document.querySelector("div[aria-label='Timeline: Your Home Timeline']") ||
        document.querySelector("main[role='main']");
    if (!timeline) return postLists;
    const posts = timeline.querySelectorAll("div[data-testid='cellInnerDiv']");
    posts.forEach((post) => {
        //if already seen, do not add
        if (post.hasAttribute("data-post-id")) return;

        post.setAttribute("data-post-id", String(postLists.length));
        const article = post.querySelector('article[data-testid="tweet"]');
        if (!article) return;

        const stats = getTweetStats(article);
        const text = getTweetText(article);
        //only add posts with text content
        if (!text) return;

        postLists.push({ id: post.getAttribute("data-post-id"), text, stats });
    });
    return postLists;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderStatOnTweet);
} else {
    renderStatOnTweet();
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
    // Use regex to extract all numbers and corresponding metrics
    // such as "4,200 reposts"
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