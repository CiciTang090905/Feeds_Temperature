//id: post.getAttribute("data-post-id"), text, stats 
const postLists = [];
let updateTimerId = null;
let started = false;

function isOnX() {
    return /(^|\.)x\.com$/.test(location.hostname) || /(^|\.)twitter\.com$/.test(location.hostname);
}

function addSimpleBannerText() {
    if (document.getElementById("injectTextWrap")) return;

    //draggable container
    const wrap = document.createElement("div");
    wrap.id = "injectTextWrap";
    wrap.style.position = "fixed";
    wrap.style.zIndex = "2147483647";
    wrap.style.left = "20px";
    wrap.style.top = "200px";
    wrap.style.boxSizing = "border-box";

    const handle = document.createElement("div");
    handle.textContent = "Drag";
    handle.style.cursor = "grab";
    handle.style.userSelect = "none";
    handle.style.padding = "6px 10px";
    handle.style.borderRadius = "10px 10px 0 0";
    handle.style.background = "rgba(0,0,0,0.8)";
    handle.style.color = "white";
    handle.style.fontSize = "12px";
    handle.style.border = "1px solid rgba(189, 177, 177, 0.15)";
    handle.style.borderBottom = "none";
    handle.style.boxShadow = "0 2px 6px rgba(0,0,0,0.25)";

    const textarea = document.createElement("textarea");
    textarea.id = "injectText";
    textarea.value = "Loading...";

    textarea.style.display = "block";
    textarea.style.background = "#706f6f";
    textarea.style.color = "white";
    textarea.style.padding = "8px 10px";
    textarea.style.borderRadius = "0 0 10px 10px";
    textarea.style.border = "1px solid rgba(189, 177, 177, 0.15)";
    textarea.style.boxShadow = "0 2px 6px rgba(0,0,0,0.25)";
    textarea.style.boxSizing = "border-box";
    textarea.style.resize = "both";
    textarea.style.overflow = "auto";
    textarea.style.width = `${Math.round(window.innerWidth * 0.2)}px`;
    textarea.style.height = `${Math.round(window.innerHeight / 4)}px`;

    wrap.appendChild(handle);
    wrap.appendChild(textarea);
    document.body.appendChild(wrap);

    // Auto-position until user drags
    let userMoved = false;

    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    function updatePosition() {
        if (userMoved) return;

        const innerColumn = document.querySelector('header[role="banner"] nav[role="navigation"]');
        if (!innerColumn) return;

        const rect = innerColumn.getBoundingClientRect();

        const desiredLeft = rect.left;
        const desiredTop = Math.round(window.innerHeight * 0.58);

        const maxLeft = window.innerWidth - wrap.offsetWidth - 8;
        const maxTop = window.innerHeight - wrap.offsetHeight - 8;

        wrap.style.left = `${clamp(desiredLeft, 8, maxLeft)}px`;
        wrap.style.top = `${clamp(desiredTop, 8, maxTop)}px`;
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);

    // Drag (on handle)
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener("mousedown", (e) => {
        dragging = true;
        userMoved = true;

        handle.style.cursor = "grabbing";

        const rect = wrap.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        document.body.style.userSelect = "none";
        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!dragging) return;

        const maxLeft = window.innerWidth - wrap.offsetWidth - 8;
        const maxTop = window.innerHeight - wrap.offsetHeight - 8;

        const nextLeft = clamp(e.clientX - offsetX, 8, maxLeft);
        const nextTop = clamp(e.clientY - offsetY, 8, maxTop);

        wrap.style.left = `${nextLeft}px`;
        wrap.style.top = `${nextTop}px`;
    });

    document.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        handle.style.cursor = "grab";
        document.body.style.userSelect = "auto";
    });

    handle.addEventListener("dblclick", () => {
        userMoved = false;
        updatePosition();
    });
}

function renderStatOnTweet() {
    if (!isOnX()) return;
    addSimpleBannerText();
    clearList();
    const posts = getPostLists();
    const textBox = document.getElementById("injectText");

    if (textBox) {
        textBox.value = `Found ${posts.length} posts\n\n` +
            posts.map(p => `POST #${p.id}\nText: ${p.text}\nStats:\n${formatStat(p.stats)}\n`).join("\n");
    }

    if (posts.length === 0) { //retry after 1 second if no posts found, since X can be slow to load content
        setTimeout(renderStatOnTweet, 1000);
    }
}

function formatStat(stats) {
    if (!stats) return "No stats available";
    return [
        `• Replies: ${stats.replies ?? 0}`,
        `• Reposts: ${stats.reposts ?? 0}`,
        `• Likes: ${stats.likes ?? 0}`,
        `• Bookmarks: ${stats.bookmarks ?? 0}`,
        `• Views: ${stats.views ?? 0}`,
    ].join("\n");
}

function clearList() {
    postLists.length = 0;
}

function getPostLists() {
    const timeline =
        document.querySelector("div[aria-label='Timeline: Your Home Timeline']") ||
        document.querySelector("main[role='main']");
    if (!timeline) return postLists;

    const posts = timeline.querySelectorAll("div[data-testid='cellInnerDiv']");
    let id = 0;

    posts.forEach((post) => {
        const article = post.querySelector('article[data-testid="tweet"]');
        if (!article) return;
        const stats = getTweetStats(article);
        const text = getTweetText(article);
        if (!text) return;
        post.setAttribute("data-post-id", String(id));
        postLists.push({ id: String(id), text, stats });
        id++;
    });
    return postLists;
}

//set timmer to update stats every 3 seconds, since X can update stats in real time
function start3sTimmer() {
    if (started) return;
    started = true;

    // Run once now
    renderStatOnTweet();

    // Then every 3 seconds
    updateTimerId = setInterval(() => {
        renderStatOnTweet();
    }, 3000);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start3sTimmer);
} else {
    start3sTimmer();
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

function getTweetAuthor(tweetArticle) {
    const userNameDiv = tweetArticle.querySelector('div[data-testid="User-Name"]');
    if (!userNameDiv) return { name: "", handle: "" };
    const spans = userNameDiv.querySelectorAll("span");
    let name = "";
    let handle = "";
    for (const span of spans) {
        const text = span.textContent.trim();
        if (text.startsWith("@")) { handle = text; break; }
    }
    const nameLink = userNameDiv.querySelector("a span");
    if (nameLink) name = nameLink.textContent.trim();
    return { name, handle };
}

function getTweetDate(tweetArticle) {
    const timeEl = tweetArticle.querySelector("time[datetime]");
    return timeEl ? timeEl.getAttribute("datetime") : "";
}

function getTweetMedia(tweetArticle) {
    const media = { images: [], videoThumbnails: [] };

    const videos = tweetArticle.querySelectorAll("video[poster]");
    videos.forEach((v) => {
        if (v.poster) media.videoThumbnails.push(v.poster);
    });

    const excludePatterns = ["profile_images", "emoji", "hashflag"];
    const imgs = tweetArticle.querySelectorAll("img[src]");
    imgs.forEach((img) => {
        const src = img.src;
        if (!src || media.images.includes(src) || media.videoThumbnails.includes(src)) return;
        if (excludePatterns.some((p) => src.includes(p))) return;
        if (src.includes("amplify_video_thumb") || src.includes("tweet_video_thumb") || src.includes("ext_tw_video_thumb")) {
            media.videoThumbnails.push(src);
        } else if (src.includes("pbs.twimg.com/media") || src.includes("pbs.twimg.com/card_img")) {
            media.images.push(src);
        }
    });

    return media;
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
            media: getTweetMedia(tweetArticle),
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

// Post capture – stores visible tweets to chrome.storage.local
// Only runs on x.com
// functions for checking storage status on DevTools console 

const CAPTURE_STORAGE_KEY = "captured_posts";
const capturedIds = new Set();
const tweetIdRegex = /\/status\/([0-9]+)/;

function extractTweetIdFromArticle(articleDOM) {
    const links = articleDOM.querySelectorAll("a[href*='status']");
    for (let i = 0; i < links.length; i++) {
        const match = links[i].href.match(tweetIdRegex);
        if (match !== null) return match[1];
    }
    return null;
}

function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
        rect.left < (window.innerWidth || document.documentElement.clientWidth)
    );
}

// Storage helpers using chrome.storage.local
async function loadCapturedPosts() {
    return new Promise((resolve) => {
        chrome.storage.local.get(CAPTURE_STORAGE_KEY, (result) => {
            resolve(result[CAPTURE_STORAGE_KEY] || []);
        });
    });
}

async function saveCapturedPosts(posts) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [CAPTURE_STORAGE_KEY]: posts }, resolve);
    });
}

// Capture
async function captureVisibleTweets() {
    const articles = document.querySelectorAll("article");
    const newPosts = [];

    articles.forEach((article) => {
        if (!isInViewport(article)) return;
        const tweetId = extractTweetIdFromArticle(article);
        if (!tweetId) return;
        if (capturedIds.has(tweetId)) return;

        const text = getTweetText(article);
        const media = getTweetMedia(article);
        const author = getTweetAuthor(article);
        const postedAt = getTweetDate(article);
        if (!text) return;

        capturedIds.add(tweetId);
        newPosts.push({ tweetId, author, postedAt, text, media, capturedAt: Date.now() });
    });

    if (newPosts.length === 0) return;

    let stored = await loadCapturedPosts();
    const storedIdSet = new Set(stored.map((p) => p.tweetId));
    const trulyNew = newPosts.filter((p) => !storedIdSet.has(p.tweetId));

    if (trulyNew.length === 0) return;

    stored = stored.concat(trulyNew);
    await saveCapturedPosts(stored);
    console.log(`${trulyNew.length} new post(s) saved. ${stored.length} total in storage.`);
}

//on x.com only
let captureTimerId = null;
let captureStarted = false;

function startPostCapture() {
    if (captureStarted) return;
    captureStarted = true;
    captureVisibleTweets();
    captureTimerId = setInterval(captureVisibleTweets, 500);
    console.log("Starting Capture...");
}

if (isOnX()) {
    startPostCapture();
}

window.showStoredPosts = async function () {
    const posts = await loadCapturedPosts();
    console.log(`${posts.length} posts in storage:`);
    console.table(
        posts.map((p) => ({
            tweetId: p.tweetId,
            author: p.author ? `${p.author.name} (${p.author.handle})` : "",
            postedAt: p.postedAt || "",
            images: (p.media?.images?.length) ? p.media.images.join(", ") : "none",
            videoThumbnails: (p.media?.videoThumbnails?.length) ? p.media.videoThumbnails.join(", ") : "none",
            text: p.text.slice(0, 80) + (p.text.length > 80 ? "…" : ""),
            captured: new Date(p.capturedAt).toLocaleString(),
        }))
    );
    return posts;
};

window.exportPostsAsText = async function () {
    const posts = await loadCapturedPosts();
    const lines = posts.map(
        (p, i) => {
            const authorStr = p.author ? `${p.author.name} (${p.author.handle})` : "unknown";
            const imgs = p.media?.images?.length ? p.media.images.join("\n  ") : "none";
            const vids = p.media?.videoThumbnails?.length ? p.media.videoThumbnails.join("\n  ") : "none";
            return `--- Post #${i + 1} (ID: ${p.tweetId}) [${new Date(p.capturedAt).toLocaleString()}] ---\nAuthor: ${authorStr}\nPosted: ${p.postedAt || "unknown"}\n${p.text}\nImages: ${imgs}\nVideo Thumbnails: ${vids}`;
        }
    );
    const blob = lines.join("\n\n");
    console.log(blob);
    return blob;
};

window.clearStoredPosts = async function () {
    await saveCapturedPosts([]);
    capturedIds.clear();
    console.log("Storage cleared");
};

window.stopPostCapture = function () {
    if (captureTimerId) clearInterval(captureTimerId);
    captureStarted = false;
    console.log("Capture stopped");
};