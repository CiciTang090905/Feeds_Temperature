const CAPTURE_STORAGE_KEY = "captured_posts";
const capturedIds = new Set();
const tweetIdRegex = /\/status\/([0-9]+)/;

function isOnX() {
    return /(^|\.)x\.com$/.test(location.hostname) || /(^|\.)twitter\.com$/.test(location.hostname);
}

function extractTweetIdFromArticle(articleDOM) {
    const links = articleDOM.querySelectorAll("a[href*='status']");
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

function getTweetAuthor(tweetArticle) {
    const userNameDiv = tweetArticle.querySelector('div[data-testid="User-Name"]');
    if (!userNameDiv) return { name: "", handle: "" };

    const spans = userNameDiv.querySelectorAll("span");
    let name = "";
    let handle = "";

    for (const span of spans) {
        const text = span.textContent.trim();
        if (text.startsWith("@")) {
            handle = text;
            break;
        }
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
    const media = { images: [], videoThumbnails: [], videoSources: [], videoPageUrls: [] };
    const isUsefulSourceUrl = (url) => {
        if (!url) return false;
        return !url.startsWith("blob:") && !url.startsWith("data:");
    };

    const videos = tweetArticle.querySelectorAll("video");
    videos.forEach((video) => {
        if (video.poster && !media.videoThumbnails.includes(video.poster)) {
            media.videoThumbnails.push(video.poster);
        }

        const directVideoSrc = video.currentSrc || video.src || "";
        if (isUsefulSourceUrl(directVideoSrc) && !media.videoSources.includes(directVideoSrc)) {
            media.videoSources.push(directVideoSrc);
        }
    });

    const videoSources = tweetArticle.querySelectorAll("video source[src]");
    videoSources.forEach((source) => {
        const src = source.src || source.getAttribute("src") || "";
        if (!isUsefulSourceUrl(src) || media.videoSources.includes(src)) return;
        media.videoSources.push(src);
    });

    const videoLinks = tweetArticle.querySelectorAll("a[href*='/status/'][href*='/video/']");
    videoLinks.forEach((link) => {
        const href = link.href || link.getAttribute("href") || "";
        if (!href || media.videoPageUrls.includes(href)) return;
        media.videoPageUrls.push(href);
    });

    const excludePatterns = ["profile_images", "emoji", "hashflag"];
    const imgs = tweetArticle.querySelectorAll("img[src]");
    imgs.forEach((img) => {
        const src = img.src;
        if (!src || media.images.includes(src) || media.videoThumbnails.includes(src)) return;
        if (excludePatterns.some((pattern) => src.includes(pattern))) return;

        if (src.includes("amplify_video_thumb") || src.includes("tweet_video_thumb") || src.includes("ext_tw_video_thumb")) {
            media.videoThumbnails.push(src);
            return;
        }

        if (src.includes("pbs.twimg.com/media") || src.includes("pbs.twimg.com/card_img")) {
            media.images.push(src);
        }
    });

    return media;
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

function loadCapturedPosts() {
    return new Promise((resolve) => {
        chrome.storage.local.get(CAPTURE_STORAGE_KEY, (result) => {
            resolve(result[CAPTURE_STORAGE_KEY] || []);
        });
    });
}

function saveCapturedPosts(posts) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [CAPTURE_STORAGE_KEY]: posts }, resolve);
    });
}

async function captureVisibleTweets() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const newPosts = [];

    articles.forEach((article) => {
        if (!isInViewport(article)) return;

        const tweetId = extractTweetIdFromArticle(article);
        if (!tweetId || capturedIds.has(tweetId)) return;

        const text = getTweetText(article);
        if (!text) return;

        capturedIds.add(tweetId);
        newPosts.push({
            platform: "x",
            tweetId,
            author: getTweetAuthor(article),
            postedAt: getTweetDate(article),
            text,
            media: getTweetMedia(article),
            capturedAt: Date.now(),
            pageUrl: location.href,
        });
    });

    if (newPosts.length === 0) return;

    const stored = await loadCapturedPosts();
    const storedIds = new Set(stored.map((post) => post.tweetId));
    const uniquePosts = newPosts.filter((post) => !storedIds.has(post.tweetId));

    if (uniquePosts.length === 0) return;

    await saveCapturedPosts(stored.concat(uniquePosts));
    console.log(`Captured ${uniquePosts.length} new X post(s).`);
}

let captureTimerId = null;
let captureStarted = false;

function startPostCapture() {
    if (captureStarted || !isOnX()) return;
    captureStarted = true;
    captureVisibleTweets();
    captureTimerId = setInterval(captureVisibleTweets, 1000);
    console.log("Starting X post capture");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startPostCapture, { once: true });
} else {
    startPostCapture();
}

window.showStoredPosts = async function () {
    const posts = await loadCapturedPosts();
    console.table(posts.map((post) => ({
        tweetId: post.tweetId,
        author: post.author ? `${post.author.name} (${post.author.handle})` : "",
        postedAt: post.postedAt || "",
        text: post.text.slice(0, 80) + (post.text.length > 80 ? "..." : ""),
        images: (post.media?.images || []).join("\n"),
        videoThumbnails: (post.media?.videoThumbnails || []).join("\n"),
        capturedAt: new Date(post.capturedAt).toLocaleString(),
    })));
    return posts;
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
