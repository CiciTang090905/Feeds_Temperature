// =============================================================
// Console script: capture visible tweets and persist to
// localStorage.
//
// Usage – paste into DevTools console on x.com / twitter.com
//   • Automatically scans every 500 ms for new tweets
//   • Deduplicates by tweet ID
//   • Accumulates up to the storage limit (~5 MB)
//   • Helper functions at the bottom to inspect / clear storage
// =============================================================

const STORAGE_KEY = "captured_posts";

// In-memory set of IDs we've already persisted this session
const seenIds = new Set();

const tweetIdRegex = /\/status\/([0-9]+)/;

function extractTweetId(tweetDOM) {
    const links = tweetDOM.querySelectorAll("a[href*='status']");
    for (let i = 0; i < links.length; i++) {
        const match = links[i].href.match(tweetIdRegex);
        if (match !== null) return match[1];
    }
    return null;
}

function getTweetText(tweetArticle) {
    const node = tweetArticle.querySelector('div[data-testid="tweetText"]');
    return node ? node.innerText : "";
}

function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
        rect.left < (window.innerWidth || document.documentElement.clientWidth)
    );
}

//Storage (using localStorage so it works when pasted into DevTools console)
function loadStoredPosts() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.warn("⚠️ Failed to load stored posts:", e);
        return [];
    }
}

function saveStoredPosts(posts) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
    } catch (e) {
        console.warn("⚠️ Failed to save (storage may be full):", e);
    }
}

//capture logic
function captureVisibleTweets() {
    const articles = document.querySelectorAll("article");
    const newPosts = [];

    articles.forEach((article) => {
        if (!isInViewport(article)) return;
        const tweetId = extractTweetId(article);
        if (!tweetId) return;
        if (seenIds.has(tweetId)) return;

        const text = getTweetText(article);
        if (!text) return;

        seenIds.add(tweetId);
        newPosts.push({
            tweetId,
            text,
            capturedAt: Date.now(),
        });
    });

    if (newPosts.length === 0) return;

    let stored = loadStoredPosts();
    // pull out the ids from the storage
    const storedIdSet = new Set(stored.map((p) => p.tweetId));
    // filter out the new posts that are already in storage
    const trulyNew = newPosts.filter((p) => !storedIdSet.has(p.tweetId));

    if (trulyNew.length === 0) return;

    stored = stored.concat(trulyNew);
    saveStoredPosts(stored);

    console.log(
        `✅ +${trulyNew.length} new post(s) saved  |  ${stored.length} total in storage`
    );
}

//Start scanning
let started = false;
let timerId = null;

function startCapture() {
    if (started) return;
    started = true;
    captureVisibleTweets();
    timerId = setInterval(captureVisibleTweets, 500);
    console.log("🟢 Post capture started – scanning every 500 ms");
}

startCapture();

//functions for console
function showStoredPosts() {
    const posts = loadStoredPosts();
    console.log(`${posts.length} posts in storage:`);
    console.table(
        posts.map((p) => ({
            tweetId: p.tweetId,
            text: p.text.slice(0, 80) + (p.text.length > 80 ? "…" : ""),
            captured: new Date(p.capturedAt).toLocaleString(),
        }))
    );
    return posts;
}

function exportPostsAsText() {
    const posts = loadStoredPosts();
    const lines = posts.map(
        (p, i) =>
            `--- Post #${i + 1} (ID: ${p.tweetId}) [${new Date(p.capturedAt).toLocaleString()}] ---\n${p.text}`
    );
    const blob = lines.join("\n\n");
    console.log(blob);
    return blob;
}

function clearStoredPosts() {
    saveStoredPosts([]);
    seenIds.clear();
    console.log("🗑️ Storage cleared");
}

function stopCapture() {
    if (timerId) clearInterval(timerId);
    started = false;
    console.log("🔴 Capture stopped");
}
