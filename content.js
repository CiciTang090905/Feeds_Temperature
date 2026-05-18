const CAPTURE_STORAGE_KEY = "captured_posts";
const STATS_PANEL_ID = "feeds-temperature-stats-panel";
const STATS_PANEL_HEADER_ID = "feeds-temperature-stats-panel-header";
const STATS_PANEL_BODY_ID = "feeds-temperature-stats-panel-body";
const STATS_PANEL_TOGGLE_ID = "feeds-temperature-stats-panel-toggle";
const STATS_PANEL_TOOLTIP_ID = "feeds-temperature-stats-panel-tooltip";
const STATS_REFRESH_MS = 10000;
const PANEL_DEFAULT_HEIGHT = "720px";
const PANEL_DEFAULT_MIN_HEIGHT = "180px";
const FEED_TEMPERATURE_PANEL_STYLE_ID = "feeds-temperature-panel-style";
const capturedIds = new Set();
const tweetIdRegex = /\/status\/([0-9]+)/;
const STATS_TABS = [
    { key: "allTime", label: "All time", required: null },
    { key: "last24Hours", label: "Last 24h", required: "last24Hours" },
    { key: "lastWeek", label: "Last week", required: "lastWeek" },
];
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

const METRIC_DEFINITIONS = {
    highlyNegativeArousal:
        "Activated, intense negativity directed at someone: anger, rage, outrage, hostility, insults, aggressive blame.",
    political: "Content about civic, ideological, governmental, electoral, legal, public-policy, or public-affairs topics.",
    partisanAnimosity: "Dislike for opposing partisans: hostility directed at members of the other political party.",
    biasedEvaluationOfPoliticizedFacts:
        "Skepticism of facts that favor the worldview of the other party: partially presenting political facts with a partisan stance.",
    socialDistance:
        "Resistance to interpersonal contact with outpartisans: language that increases distrust, hate, prejudice, or discrimination.",
    socialDistrust: "Distrust of people in general: generalized skepticism about others' intentions and reliability.",
    supportPartisanViolence:
        "Willingness to use violent tactics against outpartisans: threatening, intimidating, or endorsing violence for political goals.",
    supportUndemocraticPractices:
        "Willingness to forgo democratic principles for partisan gain: attacking judicial independence, undermining free press, challenging election legitimacy.",
    supportUndemocraticCandidates: "Willingness to ignore democratic practices to elect in-party candidates.",
    oppositionToBipartisanCooperation: "Resistance to cross-partisan collaboration: opposing cooperation between political parties.",
};

const ZONE_STYLES = {
    low: {
        label: "Low",
        color: "#3fa66a",
        border: "rgba(63,166,106,0.45)",
        background: "rgba(63,166,106,0.12)",
    },
    typical: {
        label: "Typical",
        color: "#7ac74c",
        border: "rgba(122,199,76,0.45)",
        background: "rgba(122,199,76,0.12)",
    },
    elevated: {
        label: "Elevated",
        color: "#f0a93b",
        border: "rgba(240,169,59,0.45)",
        background: "rgba(240,169,59,0.12)",
    },
    high: {
        label: "High",
        color: "#dd4a2c",
        border: "rgba(221,74,44,0.45)",
        background: "rgba(221,74,44,0.12)",
    },
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
        minWidth: "280px",
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
        containerType: "inline-size",
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
        #${STATS_PANEL_ID} .ft-gauge-card {
            transition: border-color 140ms ease, background 140ms ease;
        }
        #${STATS_PANEL_ID} .ft-gauge-card:hover {
            border-color: rgba(255, 255, 255, 0.2);
            background: rgba(255, 255, 255, 0.055);
        }
        #${STATS_PANEL_ID} .ft-gauge-grid {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
        #${STATS_PANEL_ID} .ft-gauge-svg {
            width: min(118px, 100%);
            height: auto;
        }
        #${STATS_PANEL_TOOLTIP_ID}::after {
            content: "";
            position: absolute;
            left: 50%;
            bottom: -6px;
            transform: translateX(-50%);
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 6px solid rgba(0, 0, 0, 0.94);
        }
        @container (max-width: 315px) {
            #${STATS_PANEL_ID} .ft-gauge-grid {
                grid-template-columns: minmax(0, 1fr);
            }
            #${STATS_PANEL_ID} .ft-gauge-card {
                padding: 10px 10px 11px;
            }
        }
        @container (max-width: 295px) {
            #${STATS_PANEL_ID} .ft-metric-count {
                font-size: 9px;
            }
            #${STATS_PANEL_ID} .ft-metric-label {
                font-size: 10px;
            }
            #${STATS_PANEL_ID} .ft-metric-value {
                font-size: 22px;
            }
            #${STATS_PANEL_ID} .ft-metric-context {
                max-width: 100%;
                font-size: 9px;
            }
            #${STATS_PANEL_ID} .ft-zone-label {
                font-size: 7px;
            }
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
    { key: "biasedEvaluationOfPoliticizedFacts", label: "Biased fact evaluation" },
];

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

function ensureStatsTooltip() {
    let tooltip = document.getElementById(STATS_PANEL_TOOLTIP_ID);
    if (tooltip) return tooltip;

    tooltip = createElement("div", {
        position: "fixed",
        display: "none",
        width: "210px",
        boxSizing: "border-box",
        padding: "8px 9px",
        borderRadius: "7px",
        background: "rgba(0, 0, 0, 0.94)",
        border: "1px solid rgba(255, 255, 255, 0.18)",
        color: "rgba(255, 255, 255, 0.86)",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        fontSize: "11px",
        lineHeight: "1.35",
        textAlign: "left",
        zIndex: "2147483647",
        pointerEvents: "none",
        boxShadow: "0 8px 18px rgba(0, 0, 0, 0.42)",
    });
    tooltip.id = STATS_PANEL_TOOLTIP_ID;
    document.body.appendChild(tooltip);
    return tooltip;
}

function showMetricTooltip(anchor, definition) {
    if (!definition) return;

    const tooltip = ensureStatsTooltip();
    tooltip.textContent = definition;
    tooltip.style.display = "block";

    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const top = Math.max(8, anchorRect.top - tooltipRect.height - 10);
    const centeredLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
    const left = clamp(centeredLeft, 8, window.innerWidth - tooltipRect.width - 8);

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
}

function hideMetricTooltip() {
    const tooltip = document.getElementById(STATS_PANEL_TOOLTIP_ID);
    if (!tooltip) return;
    tooltip.style.display = "none";
}

function createSvgElement(tagName, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
    for (const [key, value] of Object.entries(attributes)) {
        element.setAttribute(key, String(value));
    }
    return element;
}

function formatMetricPercent(percent) {
    const value = Number(percent) || 0;
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatAveragePercent(average) {
    return `${Number(average).toFixed(1)}%`;
}

function ratioToAngle(ratio) {
    const r = Number(ratio);
    if (!Number.isFinite(r)) return null;
    if (r <= 25) return (r / 25) * 30;
    if (r <= 100) return 30 + ((r - 25) / 75) * 60;
    if (r <= 125) return 90 + ((r - 100) / 25) * 15;
    if (r <= 175) return 105 + ((r - 125) / 50) * 30;
    const clamped = Math.min(r, 300);
    return 135 + ((clamped - 175) / 125) * 45;
}

function getRatioCaption(ratio, percent) {
    if (Number(percent) === 0) return ["Less than 1% of posts"];

    const delta = Math.round(Number(ratio) - 100);
    if (delta > 0) return [`${delta}% above average`];
    if (delta < 0) return [`${Math.abs(delta)}% below average`];
    return ["Same as average"];
}

function getSafeGradientId(metricKey) {
    const safeKey = String(metricKey || "metric").replace(/[^a-zA-Z0-9_-]/g, "-");
    return `grad-${safeKey}-${Math.random().toString(36).slice(2, 8)}`;
}

function createRatioGaugeSvg(metricKey, metricStats) {
    const svg = createSvgElement("svg", {
        viewBox: "0 0 200 140",
        width: "100%",
        role: "img",
    });
    svg.classList.add("ft-gauge-svg");

    const title = `${metricKey} compared with ${formatAveragePercent(metricStats.baseline)} average`;
    svg.appendChild(createSvgElement("title")).textContent = title;

    const gradientId = getSafeGradientId(metricKey);
    const defs = createSvgElement("defs");
    const gradient = createSvgElement("linearGradient", {
        id: gradientId,
        x1: "20",
        y1: "120",
        x2: "180",
        y2: "120",
        gradientUnits: "userSpaceOnUse",
    });
    [
        ["0%", "#2f8a55"],
        ["22%", "#6abf3a"],
        ["40%", "#b8d038"],
        ["50%", "#e8c93a"],
        ["60%", "#f0a93b"],
        ["72%", "#ee7a32"],
        ["86%", "#dd4a2c"],
        ["100%", "#c9302c"],
    ].forEach(([offset, color]) => {
        gradient.appendChild(createSvgElement("stop", { offset, "stop-color": color }));
    });
    defs.appendChild(gradient);
    svg.appendChild(defs);

    svg.appendChild(
        createSvgElement("path", {
            d: "M 20 120 A 80 80 0 0 1 180 120",
            fill: "none",
            stroke: `url(#${gradientId})`,
            "stroke-width": "16",
            "stroke-linecap": "round",
        })
    );

    svg.appendChild(createSvgElement("line", { x1: "100", y1: "36", x2: "100", y2: "50", stroke: "#d8dce0", "stroke-width": "2" }));
    const averageLabel = createSvgElement("text", {
        x: "100",
        y: "30",
        "text-anchor": "middle",
        "font-size": "11",
        fill: "#d8dce0",
    });
    averageLabel.textContent = formatAveragePercent(metricStats.baseline);
    svg.appendChild(averageLabel);

    const angle = ratioToAngle(metricStats?.ratio);
    if (angle != null) {
        const needle = createSvgElement("g", { transform: `rotate(${(angle - 90).toFixed(2)} 100 120)` });
        needle.appendChild(createSvgElement("line", { x1: "100", y1: "120", x2: "100", y2: "58", stroke: "#f4c842", "stroke-width": "3", "stroke-linecap": "round" }));
        needle.appendChild(createSvgElement("circle", { cx: "100", cy: "120", r: "8", fill: "none", stroke: "#f4c842", "stroke-width": "2.5" }));
        svg.appendChild(needle);
    }

    return svg;
}

function createRatioGauge(metric, metricStats) {
    const normalizedStats = metricStats || {};
    const zone = normalizedStats.zone;
    const zoneStyle = ZONE_STYLES[zone];
    const svg = createRatioGaugeSvg(metric.key, normalizedStats);
    const count = Number(normalizedStats.count) || 0;

    const card = createElement("article", {
        minWidth: "0",
        background: "rgba(255, 255, 255, 0.04)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "10px",
        padding: "10px 9px 11px",
        display: "grid",
        justifyItems: "center",
        textAlign: "center",
    });
    card.className = "ft-gauge-card";

    const countEl = createElement("div", {
        width: "100%",
        color: "rgba(255, 255, 255, 0.42)",
        fontSize: "10px",
        fontWeight: "600",
        lineHeight: "1.2",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        marginBottom: "4px",
    });
    countEl.className = "ft-metric-count";
    countEl.textContent = `${count} posts classified`;

    const labelWrap = createElement("div", {
        position: "relative",
        maxWidth: "100%",
        color: "#d8dce0",
        fontSize: "12px",
        fontWeight: "600",
        lineHeight: "1.2",
        marginTop: "7px",
        textDecoration: "underline dotted rgba(255, 255, 255, 0.35)",
        textUnderlineOffset: "3px",
        cursor: "default",
        whiteSpace: "normal",
    });
    labelWrap.className = "ft-label-wrap ft-metric-label";
    labelWrap.textContent = metric.label;
    labelWrap.addEventListener("mouseenter", () => {
        showMetricTooltip(labelWrap, METRIC_DEFINITIONS[metric.key]);
    });
    labelWrap.addEventListener("mousemove", () => {
        showMetricTooltip(labelWrap, METRIC_DEFINITIONS[metric.key]);
    });
    labelWrap.addEventListener("mouseleave", hideMetricTooltip);
    labelWrap.addEventListener("blur", hideMetricTooltip);

    const valueEl = createElement("div", {
        color: "#f4c842",
        fontFamily: "monospace",
        fontSize: "25px",
        fontWeight: "700",
        lineHeight: "1",
        marginTop: "5px",
    });
    valueEl.className = "ft-metric-value";
    valueEl.textContent = `${formatMetricPercent(normalizedStats.percent)}%`;

    const contextEl = createElement("div", {
        minHeight: "28px",
        color: "#9aa3ad",
        fontSize: "10px",
        fontWeight: "600",
        lineHeight: "1.25",
        marginTop: "6px",
        maxWidth: "118px",
    });
    contextEl.className = "ft-metric-context";
    for (const line of getRatioCaption(normalizedStats.ratio, normalizedStats.percent)) {
        const lineEl = createElement("div");
        lineEl.textContent = line;
        contextEl.appendChild(lineEl);
    }

    card.appendChild(countEl);
    card.appendChild(svg);
    card.appendChild(labelWrap);
    card.appendChild(valueEl);
    card.appendChild(contextEl);

    if (zoneStyle) {
        const badge = createElement("div", {
            padding: "3px 10px",
            borderRadius: "999px",
            border: `1px solid ${zoneStyle.border}`,
            background: zoneStyle.background,
            color: zoneStyle.color,
            fontSize: "10px",
            fontWeight: "700",
            lineHeight: "1.1",
            marginTop: "9px",
        });
        badge.textContent = zoneStyle.label;
        card.appendChild(badge);
    }

    return card;
}

function createGaugeGrid(metrics, getStats) {
    const grid = createElement("div", {
        display: "grid",
        gap: "8px",
    });
    grid.className = "ft-gauge-grid";

    for (const metric of metrics) {
        grid.appendChild(createRatioGauge(metric, getStats(metric.key) || {}));
    }

    return grid;
}

function createColorLegend() {
    const legend = createElement("section", {
        padding: "8px 16px 4px",
        display: "grid",
        rowGap: "5px",
    });

    const scaleLabels = createElement("div", {
        display: "flex",
        justifyContent: "space-between",
        color: "rgba(255, 255, 255, 0.4)",
        fontSize: "10px",
        lineHeight: "1",
        paddingBottom: "2px",
    });
    const lowLabel = createElement("span");
    lowLabel.textContent = "Low";
    const highLabel = createElement("span");
    highLabel.textContent = "High";
    scaleLabels.appendChild(lowLabel);
    scaleLabels.appendChild(highLabel);

    const bar = createElement("div", {
        position: "relative",
        height: "6px",
        borderRadius: "999px",
        background:
            "linear-gradient(90deg, #2f8a55 0%, #6abf3a 37.5%, #e8c93a 50%, #f0a93b 62.5%, #ee7a32 87.5%, #c9302c 100%)",
    });
    const tick = createElement("div", {
        position: "absolute",
        left: "50%",
        top: "-3px",
        width: "1px",
        height: "12px",
        background: "rgba(255, 255, 255, 0.72)",
    });
    const tickLabel = createElement("div", {
        position: "absolute",
        left: "50%",
        top: "10px",
        transform: "translateX(-50%)",
        color: "rgba(255, 255, 255, 0.44)",
        fontSize: "8px",
        whiteSpace: "nowrap",
    });
    tickLabel.textContent = "Average";
    bar.appendChild(tick);
    bar.appendChild(tickLabel);

    const zoneRow = createElement("div", {
        display: "grid",
        gridTemplateColumns: "37.5fr 25fr 25fr 12.5fr",
        columnGap: "2px",
        marginTop: "13px",
        color: "rgba(255, 255, 255, 0.32)",
        fontSize: "8px",
        fontWeight: "700",
        textAlign: "center",
    });

    const zones = [
        { label: "Low", title: "0-75% of average" },
        { label: "Typical", title: "75-125% of average" },
        { label: "Elevated", title: "125-175% of average" },
        { label: "High", title: ">175% of average" },
    ];

    for (const { label, title } of zones) {
        const zone = createElement("div", {
            borderLeft: "1px solid rgba(255, 255, 255, 0.16)",
            borderRight: "1px solid rgba(255, 255, 255, 0.16)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.16)",
            paddingTop: "5px",
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        });
        zone.textContent = label;
        zone.title = title;
        zone.className = "ft-zone-label";
        zoneRow.appendChild(zone);
    }

    legend.appendChild(scaleLabels);
    legend.appendChild(bar);
    legend.appendChild(zoneRow);
    return legend;
}

function createMetricsSection(sectionStats) {
    const container = createElement("section", {
        display: "grid",
        rowGap: "8px",
        padding: "10px 16px 10px",
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

    const allPostsCount = Number(sectionStats.totalPostsWatched) || 0;
    const politicalPostsCount = Number(sectionStats.politicalPosts?.totalPosts) || 0;

    container.appendChild(createGroupLabel(`% of all posts (${allPostsCount} posts)`));
    container.appendChild(createGaugeGrid(ALL_POST_ROWS, (key) => sectionStats.allPosts?.[key]));

    const divider = createElement("div", {
        height: "1px",
        background: "rgba(255, 255, 255, 0.08)",
        margin: "2px 0 0",
    });
    container.appendChild(divider);

    container.appendChild(createGroupLabel(`% of political posts (${politicalPostsCount} posts)`));
    container.appendChild(createGaugeGrid(POLITICAL_METRIC_ROWS, (key) => sectionStats.politicalPosts?.metrics?.[key]));

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

function getAvailableStatsTabs(stats) {
    return STATS_TABS.filter((tab) => !tab.required || stats?.[tab.required]);
}

function createTabRow(activeTab, onSwitch, tabs) {
    const row = createElement("div", {
        display: "flex",
        alignItems: "stretch",
        marginTop: "8px",
        borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
        padding: "0 16px",
    });

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
    hideMetricTooltip();
    const container = createElement("div", {});
    const allTimeStats = stats?.allTime || stats;
    const tabs = getAvailableStatsTabs(stats);
    const activeTabAvailable = tabs.some((tab) => tab.key === activeStatsTab);
    if (!activeTabAvailable) {
        activeStatsTab = "allTime";
    }

    container.appendChild(createProgressSection(allTimeStats));
    container.appendChild(
        createTabRow(activeStatsTab, (tab) => {
            activeStatsTab = tab;
            renderStatsPanelBody(panelBody, stats);
        }, tabs)
    );
    container.appendChild(createColorLegend());
    const activeSectionStats = stats?.[activeStatsTab] || (activeStatsTab === "allTime" ? stats?.allTime || stats : null);
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
