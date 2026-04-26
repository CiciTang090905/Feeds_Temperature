# Feed Temperature — Stats Panel Gauge UI Redesign

## Overview

Replace the current bar-chart stats display in the Feed Temperature floating panel (`content.js`) with radial gauge cards. The goal is to make exposure statistics feel more impactful and interpretable, so users understand the severity of the content they're being exposed to.

The panel lives as an overlay on X/Twitter, rendered by `content.js`. It fetches data from `GET /api/posts/stats` every 10 seconds and re-renders. The new UI must update live as new posts are captured and labeled.

---

## 1. Panel layout changes

### 1a. Fix truncation on load
- Increase `PANEL_DEFAULT_HEIGHT` so all metrics are visible without manual resizing.
- Alternatively, auto-size: after rendering the body, set `panel.style.height` to fit content (respect `maxHeight: "80vh"` and allow scroll if needed).

### 1b. Structure (top to bottom)
1. **Header** — unchanged (FEED TEMPERATURE, Live badge, toggle button)
2. **Count row** — unchanged (e.g. "628 of 631 labeled" + error badge)
3. **Progress bar** — unchanged (green/red segments)
4. **Tabs** — unchanged ("All time" / "Last 24h")
5. **Color legend** — NEW (see Section 4)
6. **"% OF ALL POSTS" section** — gauge cards in 2-column grid
7. **"% OF POLITICAL POSTS" section** — gauge cards in 2-column grid

---

## 2. Gauge card specification

Each metric gets a card containing:

### 2a. SVG radial gauge
- **Arc**: half-circle (240° sweep, from -210° to +30°), built from ~40 small arc segments with interpolated colors forming a smooth gradient: green → yellow-green → amber → orange → red → dark red.
- **Arc scale**: each gauge scales relative to its own baseline. `maxVal = baseline × 3.5`. This ensures that a value 270% above baseline appears deep in the red zone, not at 74% of the arc.
- **Baseline tick**: a short line crossing the arc at the baseline position, with the baseline percentage as a small label next to it (e.g. "10%").
- **Needle**: line from center to the value's position on the arc. Color = interpolated from the same gradient based on the needle's position. Capped at arc end if value exceeds maxVal.
- **Center dot**: filled circle at needle pivot, same color as needle, with a small inner dot in the panel background color.

### 2b. Label with tooltip
- Metric name displayed below the gauge with a dotted underline (`cursor: help`).
- On hover, show a tooltip with the metric's definition from `catalog.js`.

Definitions to use (from `backend/src/labeling/shared/catalog.js`):

| Label (display) | Definition (tooltip) |
|---|---|
| Negative arousal | Activated, intense negativity directed at someone — anger, rage, outrage, hostility, insults, aggressive blame. |
| Political | Content about civic, ideological, governmental, electoral, legal, public-policy, or public-affairs topics. |
| Partisan animosity | Dislike for opposing partisans — hostility directed at members of the other political party. |
| Biased fact eval | Skepticism of facts that favor the worldview of the other party — partially presenting political facts with a partisan stance. |
| Social distance | Resistance to interpersonal contact with outpartisans — language that increases distrust, hate, prejudice, or discrimination. |
| Social distrust | Distrust of people in general — generalized skepticism about others' intentions and reliability. |
| Partisan violence | Willingness to use violent tactics against outpartisans — threatening, intimidating, or endorsing violence for political goals. |
| Undemocratic practices | Willingness to forgo democratic principles for partisan gain — attacking judicial independence, undermining free press, challenging election legitimacy. |
| Undemocratic candidates | Willingness to ignore democratic practices to elect in-party candidates. |
| Anti-bipartisan | Resistance to cross-partisan collaboration — opposing cooperation between political parties. |

### 2c. Percentage value
- Large text (18px, font-weight 700).
- Color matches the needle color (interpolated from gradient at the value's position).

### 2d. Contextual line
- Small text (10px, low opacity) below the percentage.
- Logic:

```
if value === 0:
    "None detected"
else if value <= baseline × 1.25:
    "Below average"
else:
    pctAbove = Math.round((value - baseline) / baseline × 100)
    if value >= 10:
        inv = Math.round(100 / value)
        "{inv} in {100/inv} posts · {pctAbove}% above avg"
        // e.g. "1 in 3 posts · 270% above avg"
    else:
        "{pctAbove}% above avg"
```

### 2e. Card styling
- Background: `rgba(255,255,255,0.04)`
- Border: `1px solid rgba(255,255,255,0.08)`, radius 10px
- On hover: border lightens to `rgba(255,255,255,0.2)`
- Grid: `grid-template-columns: 1fr 1fr`, gap 8px

### 2f. Sort order
- Within each section, sort gauge cards by value descending (highest/worst first).

---

## 3. Baseline / threshold configuration

### 3a. Hardcoded placeholders (for now)

Store in a single config object at the top of the rendering code, so it's easy to swap to API-driven values later:

```javascript
const METRIC_BASELINES = {
    // % of all posts
    highlyNegativeArousal: 10,
    political: 20,
    // % of political posts
    partisanAnimosity: 10,
    supportUndemocraticPractices: 3,
    supportPartisanViolence: 3,
    supportUndemocraticCandidates: 3,
    oppositionToBipartisanCooperation: 5,
    socialDistrust: 8,
    socialDistance: 8,
    biasedEvaluationOfPoliticizedFacts: 10,
};
```

**Note**: These are placeholder values. They will be replaced with real baselines derived from population averages once we have enough users. The PI has experiment data (`baseline_exposure_infeed.csv` from the Science paper dataset) that can provide research-grounded starting values.

### 3b. Future: population-driven baselines
- Eventually, the backend should compute and serve per-platform average percentages across all users.
- Add an endpoint (e.g. `GET /api/posts/baselines`) or include baseline data in the existing `/api/posts/stats` response.
- The frontend config object would then be populated from the API response instead of hardcoded values.

---

## 4. Color legend

Placed between the tabs and the first section label.

### 4a. Structure
- A horizontal gradient bar spanning the full width, with "Low" on the left and "High" on the right.
- A small tick mark on the gradient bar at the ~28% position (representing the baseline/average position on the gauge arc), labeled "Baseline (avg across users)".
- Below the bar, four bracket/brace annotations showing the severity zones:

| Zone | Range (relative to baseline) | Color region |
|---|---|---|
| Below avg | value ≤ baseline × 1.25 | Green |
| 0–25% above | baseline × 1.25 < value ≤ baseline × 1.25 | Yellow-green |
| 25–75% above | baseline × 1.25 < value ≤ baseline × 1.75 | Amber-orange |
| >75% above | value > baseline × 1.75 | Red |

Each zone has a small bracket shape (U-shaped border-bottom + border-left + border-right) with the label text centered below.

---

## 5. Color gradient interpolation

The gauge arc and needle colors use the same interpolation function. Color stops:

```javascript
const COLOR_STOPS = [
    { p: 0.00, r: 93,  g: 202, b: 165 },  // green
    { p: 0.25, r: 151, g: 196, b: 89  },  // yellow-green
    { p: 0.45, r: 250, g: 199, b: 117 },  // amber
    { p: 0.65, r: 239, g: 159, b: 39  },  // orange
    { p: 0.85, r: 226, g: 75,  b: 74  },  // red
    { p: 1.00, r: 163, g: 45,  b: 45  },  // dark red
];
```

Interpolation: for a given `t` (0 to 1), find the two surrounding stops and linearly interpolate RGB.

The `t` value for the needle = `clampedValue / maxVal` where `maxVal = baseline × 3.5`.

---

## 6. Gauge arc geometry

```
Center: (cx=55, cy=48)
Radius: 34
Stroke width: 7
Arc start: -210° (bottom-left)
Arc end: +30° (bottom-right)
Sweep: 240°
Segments: 40 small arcs with individually interpolated colors
```

Needle length: 24px from center.

Value-to-angle mapping:
```
angle = startDeg + (min(value, maxVal) / maxVal) × sweep
```

---

## 7. Data flow and live updates

### 7a. Data source
The existing `refreshStatsPanel()` function fetches stats via `getCaptureStatus()` → background script → `GET /api/posts/stats`. This already runs on a 10-second interval (`STATS_REFRESH_MS = 10000`).

### 7b. Stats response shape (from backend)
```json
{
    "allTime": {
        "totalPostsWatched": 628,
        "allPosts": {
            "highlyNegativeArousal": { "count": 96, "percent": 15 },
            "political": { "count": 179, "percent": 29 }
        },
        "politicalPosts": {
            "totalPosts": 179,
            "metrics": {
                "partisanAnimosity": { "count": 50, "percent": 28 },
                "supportUndemocraticPractices": { "count": 1, "percent": 1 },
                ...
            }
        }
    },
    "last24Hours": { ... same shape ... }
}
```

### 7c. Rendering flow
1. `refreshStatsPanel()` fires every 10 seconds.
2. It calls `renderStatsPanelBody(panelBody, stats)`.
3. `renderStatsPanelBody` should:
   - Determine which time window to show based on the active tab (All time / Last 24h).
   - Extract percent values from the stats response.
   - For each metric, look up its baseline from `METRIC_BASELINES`.
   - Build gauge cards using the `mkCard(data)` function.
   - Sort cards by value descending within each section.
   - Replace the panel body content.
4. When new posts are captured and labeled, the stats endpoint returns updated percentages, and the gauges re-render automatically on the next 10-second refresh.

### 7d. Tab switching
- Both tabs should be clickable.
- Clicking a tab re-renders the gauge cards using the corresponding section data (`stats.allTime` vs `stats.last24Hours`).
- Store active tab state in a variable so it persists across refreshes.

---

## 8. Tooltip implementation

- Wrap each label in a container with `position: relative`.
- The tooltip is a child div with `position: absolute; bottom: calc(100% + 6px)`.
- Show on hover via CSS: `.label-wrap:hover .tooltip { display: block; }`.
- Tooltip has a small triangle pointer (CSS `::after` pseudo-element with border trick).
- Tooltip width: 200px, dark background (`rgba(0,0,0,0.94)`), light border, 11px font.
- Content: the definition string from the table in Section 2b.

---

## 9. Files to modify

- **`content.js`** — main changes:
  - Replace `createStatRow()` and `createSectionCaption()` with gauge card rendering.
  - Replace `createStatsSection()` with new section builder that creates gauge grids.
  - Update `renderStatsPanelBody()` to use new rendering.
  - Add `METRIC_BASELINES` config object.
  - Add color interpolation function.
  - Add SVG gauge builder function.
  - Add tooltip CSS (inject via `createElement` style or inline styles).
  - Add tab click handlers with state persistence across refreshes.
  - Add legend rendering.
  - Adjust `PANEL_DEFAULT_HEIGHT` for new content size.

No backend changes required. The `/api/posts/stats` response already provides all needed data.

---

## 10. Summary of key formulas

```
maxVal          = baseline × 3.5
needlePosition  = min(value, maxVal) / maxVal        // 0 to 1
needleAngle     = -210° + needlePosition × 240°
needleColor     = interpolate(COLOR_STOPS, needlePosition)
pctAboveAvg     = round((value - baseline) / baseline × 100)
contextLine     = value === 0 ? "None detected"
                : value <= baseline × 1.25 ? "Below average"
                : value >= 10 ? "1 in {round(100/value)} posts · {pctAboveAvg}% above avg"
                : "{pctAboveAvg}% above avg"
```
