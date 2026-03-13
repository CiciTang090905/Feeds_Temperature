const CAPTURE_STORAGE_KEY = "captured_posts";

function formatTime(timestamp) {
    if (!timestamp) return "No posts captured yet";
    return new Date(timestamp).toLocaleString();
}

function formatShortTime(timestamp) {
    if (!timestamp) return "Never";
    return new Date(timestamp).toLocaleString();
}

function getCaptureStatus() {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "GET_CAPTURE_STATUS" }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            resolve(response || { pendingCount: 0, captureStats: null, syncStatus: null, backendStats: null });
        });
    });
}

function formatSyncStatus(syncStatus) {
    if (!syncStatus) return "No sync attempts yet";

    const result = syncStatus.lastResult || "unknown";
    const pendingCount = syncStatus.pendingCount ?? 0;
    const syncedCount = syncStatus.lastBatchSyncedCount ?? 0;

    if (result === "success") {
        return `Success | last batch ${syncedCount} | pending ${pendingCount}`;
    }

    if (result === "error") {
        return `Error | pending ${pendingCount}`;
    }

    if (result === "idle") {
        return "Idle | no pending posts";
    }

    return result;
}

function renderPosts(posts) {
    const list = document.getElementById("post-list");
    if (posts.length === 0) {
        list.textContent = "No backend posts yet.";
        return;
    }

    list.textContent = posts
        .map((post) => {
            const author = post.author?.handle || post.author?.name || "unknown";
            return `${author} | ${post.tweetId}\n${post.text}`;
        })
        .join("\n\n");
}

async function loadPopupState() {
    const captureStatus = await getCaptureStatus();
    const captureStats = captureStatus.captureStats || {};
    const backendStats = captureStatus.backendStats || {};
    document.getElementById("capture-count").textContent = String(captureStatus.pendingCount ?? 0);
    document.getElementById("uploaded-count").textContent = backendStats.count == null ? "Unavailable" : String(backendStats.count);
    document.getElementById("last-captured").textContent = formatTime(
        captureStats.lastCapturedAt
    );
    document.getElementById("sync-status").textContent = formatSyncStatus(captureStatus.syncStatus);
    document.getElementById("backend-meta").textContent = backendStats.ok === false
        ? `Backend unavailable: ${backendStats.error}`
        : `Last sync: ${formatShortTime(captureStatus.syncStatus?.lastSyncedAt)} | Last upload: ${formatShortTime(captureStats.lastUploadedAt)}`;
    renderPosts(backendStats.recentPosts || []);
}

document.getElementById("refresh-button").addEventListener("click", loadPopupState);

loadPopupState();
