const CAPTURE_STORAGE_KEY = "captured_posts";
const BACKEND_STATS_URL = "http://localhost:3001/api/posts/stats";
const BACKEND_STATS_EVENTS_URL = "http://localhost:3001/api/posts/events";
const STATS_PANEL_ID = "feeds-temperature-stats-panel";
const STATS_PANEL_HEADER_ID = "feeds-temperature-stats-panel-header";
const STATS_PANEL_BODY_ID = "feeds-temperature-stats-panel-body";
const STATS_PANEL_TOGGLE_ID = "feeds-temperature-stats-panel-toggle";
const STATS_REFRESH_MS = 10000;
const PANEL_DEFAULT_HEIGHT = "420px";
const PANEL_DEFAULT_MIN_HEIGHT = "180px";
const capturedIds = new Set();
const tweetIdRegex = /\/status\/([0-9]+)/;
let statsPanelTimerId = null;
let statsEventsSource = null;
const panelState = {
    drag: null,
    expandedHeight: PANEL_DEFAULT_HEIGHT,
    expandedMinHeight: PANEL_DEFAULT_MIN_HEIGHT,
};

function isOnX() {
    return /(^|\.)x\.com$/.test(location.hostname) || /(^|\.)twitter\.com$/.test(location.hostname);
}

function extractTweetIdFromStatusUrl(url) {
    const match = String(url || "").match(tweetIdRegex);
    return match ? match[1] : null;
}

function extractTweetIdFromArticle(articleDOM) {
    const links = articleDOM.querySelectorAll("a[href*='/status/']");

    // Prefer the permalink/time link for the top-level post to avoid picking quoted tweet IDs.
    for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const hasTimestamp = Boolean(link.querySelector("time"));
        if (!hasTimestamp) continue;
        const tweetId = extractTweetIdFromStatusUrl(link.href);
        if (tweetId) return tweetId;
    }

    for (let i = 0; i < links.length; i++) {
        const tweetId = extractTweetIdFromStatusUrl(links[i].href);
        if (tweetId) return tweetId;
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

function getTweetMedia(tweetArticle, options = {}) {
    const { excludeNestedRoleLinkMedia = false } = options;
    const media = { images: [], videoThumbnails: [] };

    const videos = tweetArticle.querySelectorAll("video");
    videos.forEach((video) => {
        if (excludeNestedRoleLinkMedia) {
            const roleLinkContainer = video.closest("div[role='link']");
            if (roleLinkContainer && roleLinkContainer !== tweetArticle && tweetArticle.contains(roleLinkContainer)) return;
        }
        if (video.poster && !media.videoThumbnails.includes(video.poster)) {
            media.videoThumbnails.push(video.poster);
        }
    });

    const excludePatterns = ["profile_images", "emoji", "hashflag"];
    const imgs = tweetArticle.querySelectorAll("img[src]");
    imgs.forEach((img) => {
        if (excludeNestedRoleLinkMedia) {
            const roleLinkContainer = img.closest("div[role='link']");
            if (roleLinkContainer && roleLinkContainer !== tweetArticle && tweetArticle.contains(roleLinkContainer)) return;
        }
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

function extractQuotedPost(tweetArticle, primaryTweetId) {
    const roleLinkBlocks = Array.from(tweetArticle.querySelectorAll("div[role='link'][tabindex='0']"));
    for (const block of roleLinkBlocks) {
        const quotedTextNode = block.querySelector('div[data-testid="tweetText"]');
        if (!quotedTextNode) continue;

        const quotedText = quotedTextNode.innerText.trim();
        const statusLink = block.querySelector("a[href*='/status/']");
        const xLink = block.querySelector("a[href*='x.com/'], a[href*='twitter.com/']");
        const linkHref = (statusLink && statusLink.href) || (xLink && xLink.href) || "";
        const quotedTweetId = extractTweetIdFromStatusUrl(linkHref);
        if (quotedTweetId && quotedTweetId === primaryTweetId) continue;

        const quotedMedia = getTweetMedia(block);
        const hasQuotedMedia = quotedMedia.images.length > 0 || quotedMedia.videoThumbnails.length > 0;
        if (!quotedText && !hasQuotedMedia) continue;

        return {
            tweetId: quotedTweetId || null,
            url: linkHref || null,
            author: getTweetAuthor(block),
            text: quotedText,
            media: quotedMedia,
        };
    }

    // Fallback for layouts where quoted cards are not represented by role=link blocks.
    const textNodes = Array.from(tweetArticle.querySelectorAll('div[data-testid="tweetText"]'));
    if (textNodes.length <= 1) return null;

    // The first tweetText is the top-level post text. Any additional tweetText is usually quoted context.
    for (let i = 1; i < textNodes.length; i++) {
        const quotedTextNode = textNodes[i];
        const quotedText = quotedTextNode ? quotedTextNode.innerText.trim() : "";
        const quotedContainer = quotedTextNode.closest("div[role='link']") || quotedTextNode.parentElement;
        if (!quotedContainer || !tweetArticle.contains(quotedContainer)) continue;

        const statusLink = quotedContainer.querySelector("a[href*='/status/']");
        const xLink = quotedContainer.querySelector("a[href*='x.com/'], a[href*='twitter.com/']");
        const linkHref = (statusLink && statusLink.href) || (xLink && xLink.href) || "";
        const quotedTweetId = extractTweetIdFromStatusUrl(linkHref);

        if (quotedTweetId && quotedTweetId === primaryTweetId) continue;

        const quotedMedia = getTweetMedia(quotedContainer);
        const hasQuotedMedia = quotedMedia.images.length > 0 || quotedMedia.videoThumbnails.length > 0;
        if (!quotedText && !hasQuotedMedia) continue;

        return {
            tweetId: quotedTweetId || null,
            url: linkHref || null,
            author: getTweetAuthor(quotedContainer),
            text: quotedText,
            media: quotedMedia,
        };
    }

    return null;
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

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function setStyles(element, styles) {
    Object.assign(element.style, styles);
}

function createElement(tagName, styles = {}) {
    const element = document.createElement(tagName);
    setStyles(element, styles);
    return element;
}

function ensureStatsPanel() {
    let panel = document.getElementById(STATS_PANEL_ID);
    if (panel) return panel;

    panel = createElement("div", {
        position: "fixed",
        top: "72px",
        right: "16px",
        width: "300px",
        height: PANEL_DEFAULT_HEIGHT,
        maxHeight: "80vh",
        minWidth: "260px",
        minHeight: PANEL_DEFAULT_MIN_HEIGHT,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        resize: "both",
        borderRadius: "12px",
        background: "rgba(15, 20, 25, 0.96)",
        color: "#f7f9f9",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
        zIndex: "2147483647",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        fontSize: "13px",
        lineHeight: "1.45",
    });
    panel.id = STATS_PANEL_ID;

    const header = createElement("div", {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px",
        cursor: "grab",
        background: "rgba(255, 255, 255, 0.06)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.14)",
    });
    header.id = STATS_PANEL_HEADER_ID;
    header.textContent = "Feed Temperature";

    const toggleButton = createElement("button", {
        marginLeft: "10px",
        width: "24px",
        height: "24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0",
        border: "1px solid rgba(255, 255, 255, 0.2)",
        borderRadius: "6px",
        background: "rgba(255, 255, 255, 0.1)",
        color: "#f7f9f9",
        cursor: "pointer",
        fontSize: "16px",
        lineHeight: "24px",
    });
    toggleButton.id = STATS_PANEL_TOGGLE_ID;
    toggleButton.type = "button";
    toggleButton.textContent = "−";
    header.appendChild(toggleButton);

    const body = createElement("div", {
        flex: "1 1 auto",
        minHeight: "0",
        padding: "12px",
        paddingBottom: "20px",
        overflowY: "auto",
        overflowX: "hidden",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
    });
    body.id = STATS_PANEL_BODY_ID;
    body.textContent = "Loading stats...";

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    wireStatsPanelInteractions(panel, header, body, toggleButton);

    return panel;
}

function wireStatsPanelInteractions(panel, header, body, toggleButton) {
    header.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        if (event.target === toggleButton) return;

        const rect = panel.getBoundingClientRect();
        panelState.drag = {
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
        };

        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = "auto";
        header.style.cursor = "grabbing";
        event.preventDefault();
    });

    document.addEventListener("mousemove", (event) => {
        if (!panelState.drag) return;

        const nextLeft = clamp(event.clientX - panelState.drag.offsetX, 8, window.innerWidth - panel.offsetWidth - 8);
        const nextTop = clamp(event.clientY - panelState.drag.offsetY, 8, window.innerHeight - panel.offsetHeight - 8);

        panel.style.left = `${nextLeft}px`;
        panel.style.top = `${nextTop}px`;
    });

    document.addEventListener("mouseup", () => {
        if (!panelState.drag) return;
        panelState.drag = null;
        header.style.cursor = "grab";
    });

    toggleButton.addEventListener("click", () => {
        const isMinimized = body.style.display === "none";
        if (isMinimized) {
            body.style.display = "block";
            panel.style.height = panelState.expandedHeight;
            panel.style.minHeight = panelState.expandedMinHeight;
            panel.style.resize = "both";
            toggleButton.textContent = "−";
        } else {
            // Preserve expanded size so users keep their preferred panel dimensions.
            panelState.expandedHeight = panel.style.height || `${panel.offsetHeight}px`;
            panelState.expandedMinHeight = panel.style.minHeight || PANEL_DEFAULT_MIN_HEIGHT;
            body.style.display = "none";
            panel.style.height = `${header.offsetHeight}px`;
            panel.style.minHeight = `${header.offsetHeight}px`;
            panel.style.resize = "none";
            toggleButton.textContent = "+";
        }
    });
}

const ALL_POST_ROWS = [
    { key: "highlyNegativeArousal", label: "Highly negative arousal" },
    { key: "political", label: "Political" },
];

const POLITICAL_METRIC_ROWS = [
    { key: "partisanAnimosity", label: "Partisan animosity" },
    { key: "supportUndemocraticPractices", label: "Support for undemocratic practices" },
    { key: "supportPartisanViolence", label: "Support for partisan violence" },
    { key: "supportUndemocraticCandidates", label: "Support for undemocratic candidates" },
    { key: "oppositionToBipartisanCooperation", label: "Opposition to bipartisan cooperation" },
    { key: "socialDistrust", label: "Social distrust" },
    { key: "socialDistance", label: "Social distance" },
    { key: "biasedEvaluationOfPoliticizedFacts", label: "Biased evaluation of politicized facts" },
];

function createStatRow(label, value, isStrong = false) {
    const row = createElement("div", {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "baseline",
        columnGap: "10px",
    });

    const labelEl = createElement("div", {
        opacity: "0.94",
        fontWeight: isStrong ? "700" : "500",
    });
    labelEl.textContent = label;

    const valueEl = createElement("div", {
        textAlign: "right",
        fontWeight: "700",
        whiteSpace: "nowrap",
    });
    valueEl.textContent = value;

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
}

function createSectionCaption(text) {
    const caption = createElement("div", {
        marginTop: "8px",
        marginBottom: "2px",
        opacity: "0.8",
        fontSize: "12px",
        fontWeight: "700",
        letterSpacing: "0.02em",
    });
    caption.textContent = text;
    return caption;
}

function createStatsSection(title, sectionStats) {
    const card = createElement("section", {
        border: "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: "10px",
        background: "rgba(255, 255, 255, 0.03)",
        padding: "10px",
    });

    const heading = createElement("div", {
        fontSize: "15px",
        fontWeight: "800",
        marginBottom: "8px",
    });
    heading.textContent = title;
    card.appendChild(heading);

    const rows = createElement("div", {
        display: "grid",
        rowGap: "6px",
    });

    if (!sectionStats || !sectionStats.allPosts || !sectionStats.politicalPosts) {
        const empty = createElement("div", {
            opacity: "0.72",
            fontSize: "12px",
        });
        empty.textContent = "No data available.";
        rows.appendChild(empty);
        card.appendChild(rows);
        return card;
    }

    rows.appendChild(createStatRow("Posts watched", String(Number(sectionStats.totalPostsWatched) || 0), true));

    rows.appendChild(createSectionCaption("% of all posts"));
    for (const metric of ALL_POST_ROWS) {
        const percent = Number(sectionStats.allPosts?.[metric.key]?.percent) || 0;
        rows.appendChild(createStatRow(metric.label, `${percent}%`));
    }

    rows.appendChild(createSectionCaption("% of political posts"));
    for (const metric of POLITICAL_METRIC_ROWS) {
        const percent = Number(sectionStats.politicalPosts?.metrics?.[metric.key]?.percent) || 0;
        rows.appendChild(createStatRow(metric.label, `${percent}%`));
    }

    card.appendChild(rows);
    return card;
}

function renderStatsPanelBody(panelBody, stats) {
    const container = createElement("div", {
        display: "grid",
        rowGap: "10px",
    });

    // Support both new payload (allTime/last24Hours) and legacy payload.
    if (stats?.allTime || stats?.last24Hours) {
        container.appendChild(createStatsSection("All Time", stats.allTime));
        container.appendChild(createStatsSection("Last 24 Hours", stats.last24Hours));
    } else {
        container.appendChild(createStatsSection("All Time", stats));
        container.appendChild(createStatsSection("Last 24 Hours", null));
    }

    panelBody.replaceChildren(container);
}

function keepStatsPanelInViewport() {
    const panel = document.getElementById(STATS_PANEL_ID);
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    const nextLeft = clamp(rect.left, 8, window.innerWidth - rect.width - 8);
    const nextTop = clamp(rect.top, 8, window.innerHeight - rect.height - 8);

    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    panel.style.right = "auto";
}

function observeStatsPanelResize(panel) {
    if (typeof ResizeObserver !== "function") return;

    const observer = new ResizeObserver(() => {
        keepStatsPanelInViewport();
    });
    observer.observe(panel);
}

function initStatsPanelViewportHandlers() {
    window.addEventListener("resize", keepStatsPanelInViewport);
}

async function refreshStatsPanel() {
    ensureStatsPanel();
    const panelBody = document.getElementById(STATS_PANEL_BODY_ID);
    if (!panelBody) return;

    try {
        const response = await fetch(BACKEND_STATS_URL);
        if (!response.ok) {
            throw new Error(`Backend responded with ${response.status}`);
        }

        const stats = await response.json();
        renderStatsPanelBody(panelBody, stats);
    } catch (error) {
        panelBody.textContent = "Stats unavailable. Start backend server on localhost:3001.";
    }
}

function startStatsPanel() {
    const panel = ensureStatsPanel();
    observeStatsPanelResize(panel);
    initStatsPanelViewportHandlers();
    startStatsEventsStream();
    keepStatsPanelInViewport();
    refreshStatsPanel();

    if (statsPanelTimerId) clearInterval(statsPanelTimerId);
    statsPanelTimerId = setInterval(refreshStatsPanel, STATS_REFRESH_MS);
}

function stopStatsEventsStream() {
    if (!statsEventsSource) return;
    statsEventsSource.close();
    statsEventsSource = null;
}

function startStatsEventsStream() {
    if (typeof EventSource !== "function") return;
    if (statsEventsSource) return;

    const source = new EventSource(BACKEND_STATS_EVENTS_URL);
    statsEventsSource = source;

    source.addEventListener("stats_updated", () => {
        refreshStatsPanel();
    });

    source.onerror = () => {
        if (statsEventsSource !== source) return;
        stopStatsEventsStream();
        // Polling continues even if SSE is unavailable.
    };
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
        const quotedPost = extractQuotedPost(article, tweetId);

        capturedIds.add(tweetId);
        newPosts.push({
            platform: "x",
            tweetId,
            author: getTweetAuthor(article),
            postedAt: getTweetDate(article),
            text,
            media: getTweetMedia(article, { excludeNestedRoleLinkMedia: true }),
            quotedPost,
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

    chrome.runtime.sendMessage({
        type: "RECORD_CAPTURE_ACTIVITY",
        capturedCount: uniquePosts.length,
        lastCapturedAt: uniquePosts[uniquePosts.length - 1].capturedAt,
    }, () => {
        if (chrome.runtime.lastError) {
            console.warn("Capture activity update failed:", chrome.runtime.lastError.message);
        }
    });

    chrome.runtime.sendMessage({ type: "SYNC_CAPTURED_POSTS" }, () => {
        if (chrome.runtime.lastError) {
            console.warn("Background sync trigger failed:", chrome.runtime.lastError.message);
        }
    });
}

let captureTimerId = null;
let captureStarted = false;

function startPostCapture() {
    if (captureStarted || !isOnX()) return;
    captureStarted = true;
    captureVisibleTweets();
    captureTimerId = setInterval(captureVisibleTweets, 1000);
    startStatsPanel();
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
        quotedPostUrl: post.quotedPost?.url || "",
        quotedPostText: post.quotedPost?.text ? `${post.quotedPost.text.slice(0, 60)}${post.quotedPost.text.length > 60 ? "..." : ""}` : "",
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
    if (statsPanelTimerId) clearInterval(statsPanelTimerId);
    stopStatsEventsStream();
    captureStarted = false;
    console.log("Capture stopped");
};
