const CAPTURE_STORAGE_KEY = "captured_posts";
const STATS_PANEL_ID = "feeds-temperature-stats-panel";
const STATS_PANEL_HEADER_ID = "feeds-temperature-stats-panel-header";
const STATS_PANEL_BODY_ID = "feeds-temperature-stats-panel-body";
const STATS_PANEL_TOGGLE_ID = "feeds-temperature-stats-panel-toggle";
const STATS_REFRESH_MS = 10000;
const PANEL_DEFAULT_HEIGHT = "520px";
const PANEL_DEFAULT_MIN_HEIGHT = "180px";
const FEED_TEMPERATURE_PANEL_STYLE_ID = "feeds-temperature-panel-style";
const capturedIds = new Set();
const tweetIdRegex = /\/status\/([0-9]+)/;
let statsPanelTimerId = null;
let activeStatsTab = "allTime";
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

const METRIC_COLORS = {
    highlyNegativeArousal: "#c44040",
    political: "#6b63b5",
    partisanAnimosity: "#b85a3a",
    supportUndemocraticPractices: "#9a7530",
    supportPartisanViolence: "#8c3535",
    supportUndemocraticCandidates: "#7d3a52",
    oppositionToBipartisanCooperation: "#6b6a65",
    socialDistrust: "#2a8a68",
    socialDistance: "#2a6a99",
    biasedEvaluationOfPoliticizedFacts: "#5a8525",
};

function ensureStatsPanel() {
    let panel = document.getElementById(STATS_PANEL_ID);
    if (panel) return panel;

    panel = createElement("div", {
        position: "fixed",
        top: "72px",
        right: "16px",
        width: "320px",
        height: PANEL_DEFAULT_HEIGHT,
        maxHeight: "80vh",
        minWidth: "260px",
        minHeight: PANEL_DEFAULT_MIN_HEIGHT,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        resize: "both",
        borderRadius: "12px",
        background: "rgba(15, 20, 25, 0.97)",
        color: "#f7f9f9",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
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
        background: "rgba(255, 255, 255, 0.04)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
    });
    header.id = STATS_PANEL_HEADER_ID;

    injectPanelStyles(panel);

    const titleSpan = createElement("span", {
        fontSize: "13px",
        fontWeight: "500",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "rgba(255, 255, 255, 0.6)",
    });
    titleSpan.textContent = "Feed temperature";

    const rightCluster = createElement("div", {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    });

    const liveBadge = createElement("span", {
        fontFamily: "monospace",
        fontSize: "11px",
        padding: "2px 8px",
        borderRadius: "6px",
        background: "rgba(29, 158, 117, 0.15)",
        color: "#1D9E75",
        display: "flex",
        alignItems: "center",
        gap: "5px",
    });

    const pulseDot = createElement("span", {
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: "#1D9E75",
        display: "inline-block",
    });
    pulseDot.className = "ft-pulse-green";

    liveBadge.appendChild(pulseDot);
    liveBadge.appendChild(document.createTextNode("live"));

    const toggleButton = createElement("button", {
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

    header.appendChild(titleSpan);
    rightCluster.appendChild(liveBadge);
    rightCluster.appendChild(toggleButton);
    header.appendChild(rightCluster);

    const body = createElement("div", {
        flex: "1 1 auto",
        minHeight: "0",
        padding: "0",
        paddingBottom: "8px",
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

function injectPanelStyles(panel) {
    if (panel.querySelector(`#${FEED_TEMPERATURE_PANEL_STYLE_ID}`)) {
        return;
    }

    const style = document.createElement("style");
    style.id = FEED_TEMPERATURE_PANEL_STYLE_ID;
    style.textContent = `
        @keyframes ft-pulse-green {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }
        @keyframes ft-pulse-amber {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }
        @keyframes ft-barber {
            0% { background-position: 0 0; }
            100% { background-position: 11.3px 0; }
        }
        .ft-pulse-green { animation: ft-pulse-green 2s ease-in-out infinite; }
        .ft-pulse-amber { animation: ft-pulse-amber 1.5s ease-in-out infinite; }
        .ft-barber { animation: ft-barber 0.8s linear infinite; }
    `;
    panel.appendChild(style);
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
    { key: "highlyNegativeArousal", label: "Negative arousal" },
    { key: "political", label: "Political" },
];

const POLITICAL_METRIC_ROWS = [
    { key: "partisanAnimosity", label: "Partisan animosity" },
    { key: "supportUndemocraticPractices", label: "Undemocratic practices" },
    { key: "supportPartisanViolence", label: "Partisan violence" },
    { key: "supportUndemocraticCandidates", label: "Undemocratic candidates" },
    { key: "oppositionToBipartisanCooperation", label: "Anti-bipartisan" },
    { key: "socialDistrust", label: "Social distrust" },
    { key: "socialDistance", label: "Social distance" },
    { key: "biasedEvaluationOfPoliticizedFacts", label: "Biased fact eval" },
];

function createMetricRow(label, count, percent, fillColor) {
    const row = createElement("div", {
        display: "grid",
        gridTemplateColumns: "165px minmax(120px, 1fr) 64px",
        alignItems: "center",
        columnGap: "8px",
        padding: "6px 0",
    });

    const labelEl = createElement("div", {
        fontSize: "12px",
        color: "rgba(255, 255, 255, 0.65)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    });
    labelEl.textContent = label;

    const track = createElement("div", {
        height: "8px",
        borderRadius: "4px",
        background: "rgba(255, 255, 255, 0.06)",
        overflow: "hidden",
    });

    const fill = createElement("div", {
        height: "8px",
        borderRadius: "4px",
        background: fillColor,
        width: `${Math.max(0, Math.min(100, Number(percent) || 0))}%`,
    });
    track.appendChild(fill);

    const valueEl = createElement("div", {
        textAlign: "right",
        whiteSpace: "nowrap",
    });

    const countSpan = createElement("span", {
        color: "#f7f9f9",
        fontFamily: "monospace",
        fontSize: "11px",
    });
    countSpan.textContent = String(Number(count) || 0);

    const percentSpan = createElement("span", {
        color: "rgba(255, 255, 255, 0.35)",
        fontFamily: "monospace",
        fontSize: "11px",
    });
    percentSpan.textContent = `(${Number(percent) || 0}%)`;

    valueEl.appendChild(countSpan);
    valueEl.appendChild(percentSpan);

    row.appendChild(labelEl);
    row.appendChild(track);
    row.appendChild(valueEl);
    return row;
}

function createGroupLabel(text) {
    const caption = createElement("div", {
        fontSize: "11px",
        fontWeight: "500",
        letterSpacing: "0.03em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.35)",
        marginTop: "4px",
        marginBottom: "10px",
    });
    caption.textContent = text;
    return caption;
}

function createMetricsSection(sectionStats) {
    const container = createElement("section", {
        display: "grid",
        rowGap: "0",
        padding: "14px 16px 8px",
    });

    if (!sectionStats || !sectionStats.allPosts || !sectionStats.politicalPosts) {
        const empty = createElement("div", {
            opacity: "0.72",
            fontSize: "12px",
        });
        empty.textContent = "No data available.";
        container.appendChild(empty);
        return container;
    }

    container.appendChild(createGroupLabel("% of all posts"));
    for (const metric of ALL_POST_ROWS) {
        const metricStats = sectionStats.allPosts?.[metric.key] || {};
        container.appendChild(
            createMetricRow(
                metric.label,
                metricStats.count,
                metricStats.percent,
                METRIC_COLORS[metric.key] || "#6b63b5"
            )
        );
    }

    const divider = createElement("div", {
        height: "1px",
        background: "rgba(255, 255, 255, 0.08)",
        margin: "10px 0",
    });
    container.appendChild(divider);

    container.appendChild(createGroupLabel("% of political posts"));
    for (const metric of POLITICAL_METRIC_ROWS) {
        const metricStats = sectionStats.politicalPosts?.metrics?.[metric.key] || {};
        container.appendChild(
            createMetricRow(
                metric.label,
                metricStats.count,
                metricStats.percent,
                METRIC_COLORS[metric.key] || "#6b63b5"
            )
        );
    }

    return container;
}

function createProgressSection(stats) {
    const captured = Number(stats?.totalCaptured) || 0;
    const labeled = Number(stats?.totalPostsWatched) || 0;
    const queue = Math.max(0, captured - labeled);
    const effectivePct = captured > 0 ? (labeled / captured) * 100 : 100;
    const queueOnlyState = labeled === 0 && captured > 0;
    const pct = queueOnlyState ? 0 : effectivePct;

    const section = createElement("section", {
        padding: "14px 16px 12px",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        display: "grid",
        rowGap: "12px",
    });

    const topRow = createElement("div", {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "12px",
    });

    const left = createElement("div", {
        display: "flex",
        alignItems: "baseline",
        gap: "8px",
    });

    const labeledValue = createElement("span", {
        fontFamily: "monospace",
        fontSize: "22px",
        fontWeight: "700",
        color: "#f7f9f9",
        lineHeight: "1",
    });
    labeledValue.textContent = String(labeled);

    const labeledMeta = createElement("span", {
        fontSize: "12px",
        color: "rgba(255, 255, 255, 0.4)",
    });
    labeledMeta.textContent = `of ${captured} labeled`;

    left.appendChild(labeledValue);
    left.appendChild(labeledMeta);
    topRow.appendChild(left);

    if (queue > 0) {
        const badge = createElement("span", {
            background: "rgba(186, 117, 23, 0.15)",
            color: "#BA7517",
            borderRadius: "6px",
            padding: "3px 10px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontFamily: "monospace",
            fontSize: "12px",
        });

        const amberDot = createElement("span", {
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "#BA7517",
            display: "inline-block",
        });
        amberDot.className = "ft-pulse-amber";

        badge.appendChild(amberDot);
        badge.appendChild(document.createTextNode(String(queue)));
        topRow.appendChild(badge);
    }

    section.appendChild(topRow);

    const progressTrack = createElement("div", {
        position: "relative",
        height: "8px",
        borderRadius: "4px",
        background: "rgba(255, 255, 255, 0.06)",
        overflow: "hidden",
    });

    const progressFill = createElement("div", {
        position: "absolute",
        left: "0",
        top: "0",
        height: "8px",
        borderRadius: "4px",
        background: "#6b63b5",
        width: `${Math.max(0, Math.min(100, pct))}%`,
    });
    progressTrack.appendChild(progressFill);

    if (queue > 0) {
        const pendingStripe = createElement("div", {
            position: "absolute",
            top: "0",
            left: `${Math.max(0, Math.min(100, pct))}%`,
            height: "8px",
            width: `${Math.max(0, 100 - pct)}%`,
            backgroundImage:
                "repeating-linear-gradient(-45deg, rgba(107, 99, 181, 0.2) 0, rgba(107, 99, 181, 0.2) 6px, transparent 6px, transparent 12px)",
            backgroundSize: "12px 12px",
        });
        pendingStripe.className = "ft-barber";
        progressTrack.appendChild(pendingStripe);
    }

    section.appendChild(progressTrack);
    return section;
}

function createTabRow(activeTab, onSwitch) {
    const row = createElement("div", {
        display: "flex",
        alignItems: "stretch",
        marginTop: "8px",
        borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
        padding: "0 16px",
    });

    const tabs = [
        { key: "allTime", label: "All time" },
        { key: "last24Hours", label: "Last 24h" },
    ];

    for (const tab of tabs) {
        const isActive = activeTab === tab.key;
        const button = createElement("button", {
            flex: "1 1 0",
            background: "transparent",
            border: "0",
            borderBottom: isActive ? "2px solid #6b63b5" : "2px solid transparent",
            color: isActive ? "#f7f9f9" : "rgba(255, 255, 255, 0.35)",
            padding: "10px 0",
            fontSize: "13px",
            fontWeight: isActive ? "500" : "400",
            cursor: "pointer",
            borderRadius: "0",
        });
        button.type = "button";
        button.textContent = tab.label;
        button.addEventListener("click", () => {
            if (tab.key !== activeTab) {
                onSwitch(tab.key);
            }
        });
        row.appendChild(button);
    }

    return row;
}

function renderStatsPanelBody(panelBody, stats) {
    const container = createElement("div", {});
    const allTimeStats = stats?.allTime || stats;
    container.appendChild(createProgressSection(allTimeStats));
    container.appendChild(
        createTabRow(activeStatsTab, (tab) => {
            activeStatsTab = tab;
            renderStatsPanelBody(panelBody, stats);
        })
    );
    const activeSectionStats = activeStatsTab === "allTime" ? (stats?.allTime || stats) : (stats?.last24Hours || null);
    container.appendChild(createMetricsSection(activeSectionStats));
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

function mergeDashboardStatsWithLocalCapture(stats, captureStatus) {
    if (!stats || typeof stats !== "object") {
        return stats;
    }

    const allTimeStats = stats.allTime || stats;
    const backendCaptured = Number(allTimeStats?.totalCaptured) || 0;
    const backendLabeled = Number(allTimeStats?.totalPostsWatched) || 0;
    const localCaptured = Number(captureStatus?.captureStats?.totalCapturedCount) || 0;
    const pendingCount = Number(captureStatus?.pendingCount) || 0;
    const capturedFloorFromQueue = backendLabeled + pendingCount;
    const mergedCaptured = Math.max(backendCaptured, localCaptured, capturedFloorFromQueue);

    if (stats.allTime) {
        return {
            ...stats,
            allTime: {
                ...stats.allTime,
                totalCaptured: mergedCaptured,
            },
        };
    }

    return {
        ...stats,
        totalCaptured: mergedCaptured,
    };
}

async function refreshStatsPanel() {
    ensureStatsPanel();
    const panelBody = document.getElementById(STATS_PANEL_BODY_ID);
    if (!panelBody) return;

    try {
        const status = await getCaptureStatus();
        if (!status?.session?.googleId) {
            panelBody.textContent = "Sign into Chrome to use Feed Temperature.";
            return;
        }

        if (status?.dashboardStats?.unauthorized) {
            panelBody.textContent = "Sign into Chrome to use Feed Temperature.";
            return;
        }

        if (!status?.dashboardStats?.ok || !status?.dashboardStats?.stats) {
            throw new Error(status?.dashboardStats?.error || "Stats unavailable");
        }

        const statsWithLocalCapture = mergeDashboardStatsWithLocalCapture(status.dashboardStats.stats, status);
        renderStatsPanelBody(panelBody, statsWithLocalCapture);
    } catch (error) {
        panelBody.textContent = "Stats unavailable. Check whether the hosted backend is reachable.";
    }
}

function startStatsPanel() {
    const panel = ensureStatsPanel();
    observeStatsPanelResize(panel);
    initStatsPanelViewportHandlers();
    keepStatsPanelInViewport();
    refreshStatsPanel();

    if (statsPanelTimerId) clearInterval(statsPanelTimerId);
    statsPanelTimerId = setInterval(refreshStatsPanel, STATS_REFRESH_MS);
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

function getCaptureStatus() {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "GET_CAPTURE_STATUS" }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response || null);
        });
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type === "REFRESH_STATS_PANEL") {
        refreshStatsPanel().catch(() => { });
        sendResponse?.({ ok: true });
        return true;
    }

    return false;
});

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
    captureStarted = false;
    console.log("Capture stopped");
};
