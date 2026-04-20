const CAPTURE_STORAGE_KEY = "captured_posts";
const CAPTURE_STATS_KEY = "capture_stats";
const SYNC_STATUS_KEY = "capture_sync_status";
const USER_SESSION_KEY = "user_session";
const USER_PROFILE_KEY = "user_profile";
const BACKEND_BATCH_URL = "http://34.207.146.239/api/posts/batch";
const BACKEND_POSTS_URL = "http://34.207.146.239/api/posts";
const BACKEND_STATS_URL = "http://34.207.146.239/api/posts/stats";
const BACKEND_AUTO_LOGIN_URL = "http://34.207.146.239/api/users/auto-login";
const MAX_BATCH_SIZE = 15;
const SYNC_RETRY_INTERVAL_MS = 5000;

let syncInProgress = false;
let retryTimer = null;

chrome.runtime.onInstalled.addListener(() => {
    console.log("Feeds_temperature extension installed");
    ensureAuthenticated().catch((error) => {
        console.warn("Initial authentication failed:", error.message);
    });
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

async function getGoogleIdentity() {
    const profile = await new Promise((resolve, reject) => {
        chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            resolve(result || {});
        });
    });

    const email = String(profile.email || "").trim();
    const id = String(profile.id || "").trim();

    if (!id || !email) {
        return null;
    }

    const identity = { email, id };
    await writeSync(USER_PROFILE_KEY, identity);
    return identity;
}

async function ensureAuthenticated() {
    const identity = await getGoogleIdentity();
    if (!identity) {
        await clearStoredSession();
        return null;
    }

    const response = await fetch(BACKEND_AUTO_LOGIN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            googleId: identity.id,
            email: identity.email,
        }),
    });

    if (!response.ok) {
        throw new Error(`Backend responded with ${response.status}`);
    }

    const data = await response.json();
    const session = {
        userId: data.userId,
        username: data.username,
        email: data.email || identity.email,
        googleId: identity.id,
    };
    await writeSync(USER_SESSION_KEY, session);
    return session;
}

async function getUserSession() {
    const session = await readSync(USER_SESSION_KEY, null);
    if (session?.googleId) {
        return session;
    }

    return ensureAuthenticated();
}

async function clearStoredSession() {
    await removeLocal(USER_SESSION_KEY);
    await removeSync(USER_SESSION_KEY);
    await removeSync(USER_PROFILE_KEY);
}

async function fetchBackendPostStats() {
    const session = await getUserSession();
    if (!session?.googleId) {
        return {
            ok: false,
            count: null,
            recentPosts: [],
            error: "Sign into Chrome to use Feed Temperature",
            unauthorized: true,
        };
    }

    try {
        const response = await fetch(BACKEND_POSTS_URL, {
            headers: buildAuthHeaders(session.googleId),
        });

        if (response.status === 401) {
            await handleUnauthorized();
            return {
                ok: false,
                count: null,
                recentPosts: [],
                error: "Sign into Chrome to use Feed Temperature",
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

async function fetchBackendDashboardStats() {
    const session = await getUserSession();
    if (!session?.googleId) {
        return {
            ok: false,
            stats: null,
            error: "Sign into Chrome to use Feed Temperature",
            unauthorized: true,
        };
    }

    try {
        const response = await fetch(BACKEND_STATS_URL, {
            headers: buildAuthHeaders(session.googleId),
        });

        if (response.status === 401) {
            await handleUnauthorized();
            return {
                ok: false,
                stats: null,
                error: "Sign into Chrome to use Feed Temperature",
                unauthorized: true,
            };
        }

        if (!response.ok) {
            throw new Error(`Backend responded with ${response.status}`);
        }

        const stats = await response.json();
        return {
            ok: true,
            stats,
        };
    } catch (error) {
        return {
            ok: false,
            stats: null,
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
        if (!session?.googleId) {
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
                ...buildAuthHeaders(session.googleId),
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ posts: batch }),
        });

        if (response.status === 401) {
            await handleUnauthorized();
            throw new Error("Sign into Chrome to use Feed Temperature");
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
        if (error.message !== "Sign into Chrome to use Feed Temperature") {
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
            const dashboardStats = await fetchBackendDashboardStats();
            const session = await getUserSession();

            sendResponse({
                pendingCount: posts.length,
                captureStats,
                syncStatus,
                backendStats,
                dashboardStats,
                session,
            });
        });
        return true;
    }

    if (request.type === "CLEAR_SESSION") {
        clearStoredSession()
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (request.type === "ENSURE_AUTHENTICATED") {
        ensureAuthenticated()
            .then((session) => sendResponse({ ok: Boolean(session), session }))
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
            .then((stats) => {
                const updatedStats = {
                    ...stats,
                    totalCapturedCount: (stats.totalCapturedCount || 0) + (request.capturedCount || 0),
                    lastCapturedAt: request.lastCapturedAt || stats.lastCapturedAt,
                };

                return setCaptureStats(updatedStats).then(async () => {
                    const pendingCount = (await getStoredPosts()).length;
                    broadcastStatsRefresh({
                        reason: "capture_activity",
                        capturedCount: request.capturedCount || 0,
                        pendingCount,
                        totalCapturedCount: updatedStats.totalCapturedCount,
                    });
                });
            })
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

function buildAuthHeaders(googleId) {
    return {
        Authorization: `Bearer ${googleId}`,
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
    await clearStoredSession();
    await setSyncStatus({
        lastSyncedAt: Date.now(),
        lastResult: "auth_required",
        pendingCount: (await getStoredPosts()).length,
    });
    clearRetryTimer();
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

function removeLocal(key) {
    return new Promise((resolve) => {
        chrome.storage.local.remove([key], resolve);
    });
}

function readSync(key, fallbackValue) {
    if (!chrome.storage.sync) {
        return Promise.resolve(fallbackValue);
    }

    return new Promise((resolve) => {
        chrome.storage.sync.get(key, (result) => {
            resolve(result[key] ?? fallbackValue);
        });
    });
}

function writeSync(key, value) {
    if (!chrome.storage.sync) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        chrome.storage.sync.set({ [key]: value }, resolve);
    });
}

function removeSync(key) {
    if (!chrome.storage.sync) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        chrome.storage.sync.remove([key], resolve);
    });
}

syncCapturedPosts().catch(() => {});
