const CAPTURE_STORAGE_KEY = "captured_posts";
const STATS_PANEL_ID = "feeds-temperature-stats-panel";
const STATS_PANEL_HEADER_ID = "feeds-temperature-stats-panel-header";
const STATS_PANEL_BODY_ID = "feeds-temperature-stats-panel-body";
const STATS_PANEL_TOGGLE_ID = "feeds-temperature-stats-panel-toggle";
const STATS_REFRESH_MS = 10000;
const PANEL_DEFAULT_HEIGHT = "720px";
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

const METRIC_BASELINES = {
    highlyNegativeArousal: 10,
    political: 20,
    partisanAnimosity: 10,
    supportUndemocraticPractices: 3,
    supportPartisanViolence: 3,
    supportUndemocraticCandidates: 3,
    oppositionToBipartisanCooperation: 5,
    socialDistrust: 8,
    socialDistance: 8,
    biasedEvaluationOfPoliticizedFacts: 10,
};

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

const COLOR_STOPS = [
    { p: 0.00, r: 93, g: 202, b: 165 },
    { p: 0.25, r: 151, g: 196, b: 89 },
    { p: 0.45, r: 250, g: 199, b: 117 },
    { p: 0.65, r: 239, g: 159, b: 39 },
    { p: 0.85, r: 226, g: 75, b: 74 },
    { p: 1.00, r: 163, g: 45, b: 45 },
];

const SEVERITY_STYLES = {
    below: { label: "Below avg", color: "#5DCAA5", background: "rgba(93, 202, 165, 0.16)" },
    normal: { label: "Normal", color: "#97C459", background: "rgba(151, 196, 89, 0.16)" },
    elevated: { label: "Elevated", color: "#EF9F27", background: "rgba(239, 159, 39, 0.18)" },
    high: { label: "High", color: "#E24B4A", background: "rgba(226, 75, 74, 0.18)" },
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
        #${STATS_PANEL_ID} .ft-gauge-card {
            transition: border-color 140ms ease, background 140ms ease;
        }
        #${STATS_PANEL_ID} .ft-gauge-card:hover {
            border-color: rgba(255, 255, 255, 0.2);
            background: rgba(255, 255, 255, 0.055);
        }
        #${STATS_PANEL_ID} .ft-label-wrap:hover .ft-tooltip {
            display: block;
        }
        #${STATS_PANEL_ID} .ft-tooltip::after {
            content: "";
            position: absolute;
            left: 50%;
            bottom: -6px;
            transform: translateX(-50%);
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 6px solid rgba(0, 0, 0, 0.94);
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

function interpolateColor(t) {
    const clamped = clamp(Number(t) || 0, 0, 1);
    const nextIndex = COLOR_STOPS.findIndex((stop) => stop.p >= clamped);
    if (nextIndex <= 0) return `rgb(${COLOR_STOPS[0].r}, ${COLOR_STOPS[0].g}, ${COLOR_STOPS[0].b})`;

    const start = COLOR_STOPS[nextIndex - 1];
    const end = COLOR_STOPS[nextIndex] || COLOR_STOPS[COLOR_STOPS.length - 1];
    const localT = end.p === start.p ? 0 : (clamped - start.p) / (end.p - start.p);
    const r = Math.round(start.r + (end.r - start.r) * localT);
    const g = Math.round(start.g + (end.g - start.g) * localT);
    const b = Math.round(start.b + (end.b - start.b) * localT);
    return `rgb(${r}, ${g}, ${b})`;
}

function polarToPoint(cx, cy, radius, angleDeg) {
    const angle = (angleDeg * Math.PI) / 180;
    return {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
    };
}

function describeArc(cx, cy, radius, startDeg, endDeg) {
    const start = polarToPoint(cx, cy, radius, startDeg);
    const end = polarToPoint(cx, cy, radius, endDeg);
    const largeArcFlag = Math.abs(endDeg - startDeg) <= 180 ? "0" : "1";
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function createSvgElement(tagName, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
    for (const [key, value] of Object.entries(attributes)) {
        element.setAttribute(key, String(value));
    }
    return element;
}

function getMetricPosition(value, baseline) {
    const maxVal = Math.max(1, baseline * 3.5);
    return clamp((Number(value) || 0) / maxVal, 0, 1);
}

function getSeverity(value, baseline) {
    const numericValue = Number(value) || 0;
    if (numericValue < baseline * 0.75) return "below";
    if (numericValue <= baseline * 1.25) return "normal";
    if (numericValue <= baseline * 1.75) return "elevated";
    return "high";
}

function getAverageDeltaText(value, baseline) {
    const numericValue = Number(value) || 0;
    if (!baseline) return "";

    const delta = Math.round(((numericValue - baseline) / baseline) * 100);
    if (delta > 0) return `${delta}% above avg`;
    if (delta < 0) return `${Math.abs(delta)}% below avg`;
    return "0% above avg";
}

function getMetricContextText(value, baseline, severity) {
    const numericValue = Number(value) || 0;
    const deltaText = getAverageDeltaText(numericValue, baseline);

    if (severity === "high" && numericValue > 0) {
        const inverse = Math.max(1, Math.round(100 / numericValue));
        return `1 in ${inverse} posts | ${deltaText}`;
    }

    if (numericValue === 0) return `None detected | ${deltaText}`;
    if (severity === "normal") return `Within normal range | ${deltaText}`;
    return deltaText;
}

function formatMetricPercent(percent) {
    const value = Number(percent) || 0;
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function createGaugeSvg(value, baseline) {
    const svg = createSvgElement("svg", {
        viewBox: "0 0 110 74",
        width: "110",
        height: "74",
        role: "img",
        "aria-hidden": "true",
    });

    const cx = 55;
    const cy = 48;
    const radius = 34;
    const startDeg = -210;
    const sweepDeg = 240;
    const segments = 40;
    const position = getMetricPosition(value, baseline);
    const needleAngle = startDeg + position * sweepDeg;
    const needleColor = interpolateColor(position);

    for (let i = 0; i < segments; i++) {
        const segmentStart = startDeg + (i / segments) * sweepDeg;
        const segmentEnd = startDeg + ((i + 0.72) / segments) * sweepDeg;
        const path = createSvgElement("path", {
            d: describeArc(cx, cy, radius, segmentStart, segmentEnd),
            fill: "none",
            stroke: interpolateColor(i / (segments - 1)),
            "stroke-width": "7",
            "stroke-linecap": "round",
            opacity: "0.78",
        });
        svg.appendChild(path);
    }

    const baselinePosition = getMetricPosition(baseline, baseline);
    const baselineAngle = startDeg + baselinePosition * sweepDeg;
    const tickOuter = polarToPoint(cx, cy, radius + 5, baselineAngle);
    const tickInner = polarToPoint(cx, cy, radius - 6, baselineAngle);
    svg.appendChild(
        createSvgElement("line", {
            x1: tickInner.x.toFixed(2),
            y1: tickInner.y.toFixed(2),
            x2: tickOuter.x.toFixed(2),
            y2: tickOuter.y.toFixed(2),
            stroke: "rgba(255, 255, 255, 0.72)",
            "stroke-width": "1.3",
            "stroke-linecap": "round",
        })
    );

    const labelPoint = polarToPoint(cx, cy, radius + 12, baselineAngle);
    const baselineLabel = createSvgElement("text", {
        x: labelPoint.x.toFixed(2),
        y: labelPoint.y.toFixed(2),
        fill: "rgba(255, 255, 255, 0.48)",
        "font-size": "7",
        "text-anchor": "middle",
        "dominant-baseline": "middle",
    });
    baselineLabel.textContent = `${formatMetricPercent(baseline)}%`;
    svg.appendChild(baselineLabel);

    const needleEnd = polarToPoint(cx, cy, 24, needleAngle);
    svg.appendChild(
        createSvgElement("line", {
            x1: cx,
            y1: cy,
            x2: needleEnd.x.toFixed(2),
            y2: needleEnd.y.toFixed(2),
            stroke: needleColor,
            "stroke-width": "2.2",
            "stroke-linecap": "round",
        })
    );
    svg.appendChild(createSvgElement("circle", { cx, cy, r: "4", fill: needleColor }));
    svg.appendChild(createSvgElement("circle", { cx, cy, r: "1.8", fill: "rgba(15, 20, 25, 0.97)" }));

    return { svg, color: needleColor };
}

function createGaugeCard(metric, metricStats) {
    const value = Number(metricStats?.percent) || 0;
    const count = Number(metricStats?.count) || 0;
    const baseline = METRIC_BASELINES[metric.key] || 10;
    const severity = getSeverity(value, baseline);
    const severityStyle = SEVERITY_STYLES[severity];
    const { svg, color } = createGaugeSvg(value, baseline);

    const card = createElement("article", {
        minWidth: "0",
        background: "rgba(255, 255, 255, 0.04)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "10px",
        padding: "8px 8px 10px",
        display: "grid",
        justifyItems: "center",
        rowGap: "3px",
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
    });
    countEl.textContent = `${count} posts classified`;

    const labelWrap = createElement("div", {
        position: "relative",
        maxWidth: "100%",
        color: "rgba(255, 255, 255, 0.7)",
        fontSize: "11px",
        lineHeight: "1.2",
        textDecoration: "underline dotted rgba(255, 255, 255, 0.35)",
        textUnderlineOffset: "3px",
        cursor: "help",
        whiteSpace: "normal",
    });
    labelWrap.className = "ft-label-wrap";
    labelWrap.textContent = metric.label;

    const tooltip = createElement("div", {
        display: "none",
        position: "absolute",
        left: "50%",
        bottom: "calc(100% + 8px)",
        transform: "translateX(-50%)",
        width: "200px",
        boxSizing: "border-box",
        padding: "8px 9px",
        borderRadius: "7px",
        background: "rgba(0, 0, 0, 0.94)",
        border: "1px solid rgba(255, 255, 255, 0.18)",
        color: "rgba(255, 255, 255, 0.84)",
        fontSize: "11px",
        lineHeight: "1.35",
        textAlign: "left",
        zIndex: "2",
        pointerEvents: "none",
    });
    tooltip.className = "ft-tooltip";
    tooltip.textContent = METRIC_DEFINITIONS[metric.key] || "";
    labelWrap.appendChild(tooltip);

    const valueEl = createElement("div", {
        color,
        fontFamily: "monospace",
        fontSize: "18px",
        fontWeight: "700",
        lineHeight: "1",
    });
    valueEl.textContent = `${formatMetricPercent(value)}%`;

    const contextEl = createElement("div", {
        minHeight: "24px",
        color: "rgba(255, 255, 255, 0.38)",
        fontSize: "10px",
        fontWeight: "600",
        lineHeight: "1.2",
        maxWidth: "112px",
    });
    contextEl.textContent = getMetricContextText(value, baseline, severity);

    const badge = createElement("div", {
        padding: "2px 6px",
        borderRadius: "5px",
        background: severityStyle.background,
        color: severityStyle.color,
        fontSize: "9px",
        fontWeight: "700",
        lineHeight: "1.1",
    });
    badge.textContent = severityStyle.label;

    card.appendChild(countEl);
    card.appendChild(svg);
    card.appendChild(labelWrap);
    card.appendChild(valueEl);
    card.appendChild(contextEl);
    card.appendChild(badge);
    return card;
}

function createGaugeGrid(metrics, getStats) {
    const grid = createElement("div", {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: "8px",
    });

    const sortedMetrics = metrics
        .map((metric) => ({ metric, stats: getStats(metric.key) || {} }))
        .sort((a, b) => (Number(b.stats.percent) || 0) - (Number(a.stats.percent) || 0));

    for (const item of sortedMetrics) {
        grid.appendChild(createGaugeCard(item.metric, item.stats));
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
    });
    scaleLabels.appendChild(document.createTextNode("Low"));
    scaleLabels.appendChild(document.createTextNode("High"));

    const bar = createElement("div", {
        position: "relative",
        height: "6px",
        borderRadius: "999px",
        background:
            "linear-gradient(90deg, rgb(93, 202, 165), rgb(151, 196, 89), rgb(250, 199, 117), rgb(239, 159, 39), rgb(226, 75, 74), rgb(163, 45, 45))",
    });
    const tick = createElement("div", {
        position: "absolute",
        left: "28.6%",
        top: "-3px",
        width: "1px",
        height: "12px",
        background: "rgba(255, 255, 255, 0.72)",
    });
    const tickLabel = createElement("div", {
        position: "absolute",
        left: "28.6%",
        top: "10px",
        transform: "translateX(-50%)",
        color: "rgba(255, 255, 255, 0.44)",
        fontSize: "8px",
        whiteSpace: "nowrap",
    });
    tickLabel.textContent = "Baseline (avg)";
    bar.appendChild(tick);
    bar.appendChild(tickLabel);

    const zoneRow = createElement("div", {
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        columnGap: "2px",
        marginTop: "13px",
        color: "rgba(255, 255, 255, 0.32)",
        fontSize: "8px",
        fontWeight: "700",
        textAlign: "center",
    });

    for (const label of ["Below avg", "Normal", "Elevated", "High"]) {
        const zone = createElement("div", {
            borderLeft: "1px solid rgba(255, 255, 255, 0.16)",
            borderRight: "1px solid rgba(255, 255, 255, 0.16)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.16)",
            paddingTop: "5px",
        });
        zone.textContent = label;
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

    container.appendChild(createGroupLabel("% of all posts"));
    container.appendChild(createGaugeGrid(ALL_POST_ROWS, (key) => sectionStats.allPosts?.[key]));

    const divider = createElement("div", {
        height: "1px",
        background: "rgba(255, 255, 255, 0.08)",
        margin: "4px 0 0",
    });
    container.appendChild(divider);

    container.appendChild(createGroupLabel("% of political posts"));
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
    container.appendChild(createColorLegend());
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
