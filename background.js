const CAPTURE_STORAGE_KEY = "captured_posts";
const CAPTURE_STATS_KEY = "capture_stats";
const SYNC_STATUS_KEY = "capture_sync_status";
const USER_SESSION_KEY = "user_session";
const BACKEND_BATCH_URL = "http://34.207.146.239:3001/api/posts/batch";
const BACKEND_POSTS_URL = "http://34.207.146.239:3001/api/posts";
const MAX_BATCH_SIZE = 15;
const SYNC_RETRY_INTERVAL_MS = 5000;

let syncInProgress = false;
let retryTimer = null;

chrome.runtime.onInstalled.addListener(() => {
    console.log("Feeds_temperature extension installed");
    chrome.runtime.openOptionsPage();
});

function getStoredPosts() {
    return readLocal(CAPTURE_STORAGE_KEY, []);
}

function setStoredPosts(posts) {
    return writeLocal(CAPTURE_STORAGE_KEY, posts);
}

function setSyncStatus(status) {
    return writeLocal(SYNC_STATUS_KEY, status);
}

function getCaptureStats() {
    return readLocal(CAPTURE_STATS_KEY, {
        totalCapturedCount: 0,
        totalUploadedCount: 0,
        lastCapturedAt: null,
        lastUploadedAt: null,
    });
}

function setCaptureStats(stats) {
    return writeLocal(CAPTURE_STATS_KEY, stats);
}

function getUserSession() {
    return readLocal(USER_SESSION_KEY, null);
}

function setUserSession(session) {
    return writeLocal(USER_SESSION_KEY, session);
}

async function clearUserSession() {
    return new Promise((resolve) => {
        chrome.storage.local.remove([USER_SESSION_KEY], resolve);
    });
}

async function fetchBackendPostStats() {
    const session = await getUserSession();
    if (!session?.token) {
        return {
            ok: false,
            count: null,
            recentPosts: [],
            error: "Sign in required",
            unauthorized: true,
        };
    }

    try {
        const response = await fetch(BACKEND_POSTS_URL, {
            headers: buildAuthHeaders(session.token),
        });

        if (response.status === 401) {
            await handleUnauthorized();
            return {
                ok: false,
                count: null,
                recentPosts: [],
                error: "Sign in required",
                unauthorized: true,
            };
        }

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
        const session = await getUserSession();
        if (!session?.token) {
            await setSyncStatus({
                lastSyncedAt: Date.now(),
                lastResult: "auth_required",
                pendingCount: (await getStoredPosts()).length,
            });
            clearRetryTimer();
            return { ok: false, reason: "auth_required" };
        }

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
            headers: {
                ...buildAuthHeaders(session.token),
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ posts: batch }),
        });

        if (response.status === 401) {
            await handleUnauthorized();
            throw new Error("Sign in required");
        }

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

        if (ackedIds.size > 0) {
            scheduleStatsRefreshes({
                reason: "sync_complete",
                syncedCount: ackedIds.size,
            });
        }

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
        if (error.message !== "Sign in required") {
            scheduleRetry();
        } else {
            clearRetryTimer();
        }
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
    if (retryTimer) return;

    retryTimer = setTimeout(() => {
        retryTimer = null;
        syncCapturedPosts().catch(() => {});
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
            const session = await getUserSession();

            sendResponse({
                pendingCount: posts.length,
                captureStats,
                syncStatus,
                backendStats,
                session,
            });
        });
        return true;
    }

    if (request.type === "GET_USER_SESSION") {
        getUserSession().then((session) => sendResponse({ session })).catch((error) => {
            sendResponse({ session: null, error: error.message });
        });
        return true;
    }

    if (request.type === "SET_USER_SESSION") {
        setUserSession(request.session || null)
            .then(() => syncCapturedPosts().catch(() => {}))
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (request.type === "LOG_OUT") {
        handleUnauthorized()
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (request.type === "OPEN_OPTIONS_PAGE") {
        chrome.runtime.openOptionsPage().then(() => sendResponse({ ok: true })).catch((error) => {
            sendResponse({ ok: false, error: error.message });
        });
        return true;
    }

    if (request.type === "HANDLE_UNAUTHORIZED") {
        handleUnauthorized()
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
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

function buildAuthHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
    };
}

function broadcastStatsRefresh(payload = {}) {
    chrome.runtime.sendMessage({
        type: "REFRESH_STATS_PANEL",
        payload,
    }, () => {
        if (chrome.runtime.lastError) {
            // No active listeners is fine.
        }
    });
}

function scheduleStatsRefreshes(payload = {}) {
    const delays = [0, 2000, 5000];

    for (const delayMs of delays) {
        setTimeout(() => {
            broadcastStatsRefresh({
                ...payload,
                delayMs,
            });
        }, delayMs);
    }
}

async function handleUnauthorized() {
    await clearUserSession();
    await setSyncStatus({
        lastSyncedAt: Date.now(),
        lastResult: "auth_required",
        pendingCount: (await getStoredPosts()).length,
    });
    clearRetryTimer();
    await chrome.runtime.openOptionsPage();
}

function readLocal(key, fallbackValue) {
    return new Promise((resolve) => {
        chrome.storage.local.get(key, (result) => {
            resolve(result[key] ?? fallbackValue);
        });
    });
}

function writeLocal(key, value) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
    });
}

syncCapturedPosts().catch(() => {});
