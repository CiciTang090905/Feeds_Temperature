const CAPTURE_STORAGE_KEY = "captured_posts";
const CAPTURE_STATS_KEY = "capture_stats";
const SYNC_STATUS_KEY = "capture_sync_status";
const BACKEND_BATCH_URL = "http://localhost:3001/api/posts/batch";
const BACKEND_POSTS_URL = "http://localhost:3001/api/posts";
const MAX_BATCH_SIZE = 15;
// Retry failed sync attempts so pending local posts can drain automatically.
const SYNC_RETRY_INTERVAL_MS = 5000;

// Prevent overlapping sync requests from racing each other.
let syncInProgress = false;
// Keep a single scheduled retry at a time.
let retryTimer = null;

chrome.runtime.onInstalled.addListener(() => {
    console.log("Feeds_temperature extension installed");
});

function getStoredPosts() {
    return new Promise((resolve) => {
        chrome.storage.local.get(CAPTURE_STORAGE_KEY, (result) => {
            resolve(result[CAPTURE_STORAGE_KEY] || []);
        });
    });
}

function setStoredPosts(posts) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [CAPTURE_STORAGE_KEY]: posts }, resolve);
    });
}

function setSyncStatus(status) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [SYNC_STATUS_KEY]: status }, resolve);
    });
}

function getCaptureStats() {
    return new Promise((resolve) => {
        chrome.storage.local.get(CAPTURE_STATS_KEY, (result) => {
            resolve(result[CAPTURE_STATS_KEY] || {
                totalCapturedCount: 0,
                totalUploadedCount: 0,
                lastCapturedAt: null,
                lastUploadedAt: null,
            });
        });
    });
}

function setCaptureStats(stats) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [CAPTURE_STATS_KEY]: stats }, resolve);
    });
}

async function fetchBackendPostStats() {
    try {
        const response = await fetch(BACKEND_POSTS_URL);
        if (!response.ok) {
            throw new Error(`Backend responded with ${response.status}`);
        }

        const data = await response.json();
        return {
            ok: true,
            count: data.count || 0,
            recentPosts: Array.isArray(data.posts) ? data.posts.slice(0, 10) : [],
        };
    } catch (error) {
        return {
            ok: false,
            count: null,
            recentPosts: [],
            error: error.message,
        };
    }
}

async function syncCapturedPosts() {
    if (syncInProgress) {
        return { ok: false, reason: "sync_in_progress" };
    }

    syncInProgress = true;
    let posts = [];
    try {
        posts = await getStoredPosts();
        if (posts.length === 0) {
            const captureStats = await getCaptureStats();
            await setSyncStatus({
                lastSyncedAt: Date.now(),
                lastResult: "idle",
                pendingCount: 0,
                totalUploadedCount: captureStats.totalUploadedCount || 0,
            });
            clearRetryTimer();
            return { ok: true, syncedCount: 0 };
        }

        const batch = posts.slice(0, MAX_BATCH_SIZE);
        const response = await fetch(BACKEND_BATCH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ posts: batch }),
        });

        if (!response.ok) {
            throw new Error(`Backend responded with ${response.status}`);
        }

        const data = await response.json();
        const ackedIds = new Set([...(data.acceptedIds || []), ...(data.duplicateIds || [])]);
        const remainingPosts = posts.filter((post) => !ackedIds.has(post.tweetId));
        const captureStats = await getCaptureStats();
        const totalUploadedCount = (captureStats.totalUploadedCount || 0) + ackedIds.size;

        await setStoredPosts(remainingPosts);
        await setCaptureStats({
            ...captureStats,
            totalUploadedCount,
            lastUploadedAt: ackedIds.size > 0 ? Date.now() : captureStats.lastUploadedAt,
        });
        await setSyncStatus({
            lastSyncedAt: Date.now(),
            lastResult: "success",
            pendingCount: remainingPosts.length,
            lastBatchSyncedCount: ackedIds.size,
            totalUploadedCount,
        });

        if (remainingPosts.length > 0) {
            scheduleRetry();
        } else {
            clearRetryTimer();
        }
        return { ok: true, syncedCount: ackedIds.size };
    } catch (error) {
        const captureStats = await getCaptureStats();
        await setSyncStatus({
            lastSyncedAt: Date.now(),
            lastResult: "error",
            pendingCount: posts.length,
            totalUploadedCount: captureStats.totalUploadedCount || 0,
            error: error.message,
        });
        scheduleRetry();
        throw error;
    } finally {
        syncInProgress = false;
    }
}

function clearRetryTimer() {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = null;
}

function scheduleRetry() {
    // Debounce retries so repeated failures do not create timer storms.
    if (retryTimer) return;

    retryTimer = setTimeout(() => {
        retryTimer = null;
        syncCapturedPosts().catch(() => {
            // Error status is already persisted in syncCapturedPosts catch path.
        });
    }, SYNC_RETRY_INTERVAL_MS);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "GET_CAPTURE_STATUS") {
        chrome.storage.local.get([CAPTURE_STORAGE_KEY, CAPTURE_STATS_KEY, SYNC_STATUS_KEY], async (result) => {
            const posts = result[CAPTURE_STORAGE_KEY] || [];
            const captureStats = result[CAPTURE_STATS_KEY] || {
                totalCapturedCount: 0,
                totalUploadedCount: 0,
                lastCapturedAt: null,
                lastUploadedAt: null,
            };
            const syncStatus = result[SYNC_STATUS_KEY] || null;
            const backendStats = await fetchBackendPostStats();
            sendResponse({
                pendingCount: posts.length,
                captureStats,
                syncStatus,
                backendStats,
            });
        });
        return true;
    }

    if (request.type === "CLEAR_CAPTURED_POSTS") {
        chrome.storage.local.set({ [CAPTURE_STORAGE_KEY]: [] }, () => {
            sendResponse({ ok: true });
        });
        return true;
    }

    if (request.type === "RECORD_CAPTURE_ACTIVITY") {
        getCaptureStats()
            .then((stats) => setCaptureStats({
                ...stats,
                totalCapturedCount: (stats.totalCapturedCount || 0) + (request.capturedCount || 0),
                lastCapturedAt: request.lastCapturedAt || stats.lastCapturedAt,
            }))
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (request.type === "SYNC_CAPTURED_POSTS") {
        syncCapturedPosts()
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }
});

// Try flushing any pending local backlog when the service worker is activated.
syncCapturedPosts().catch(() => {
    // Retry scheduling is handled in syncCapturedPosts catch path.
});
