function formatTime(timestamp) {
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

            resolve(response || { pendingCount: 0, captureStats: null, syncStatus: null, backendStats: null, session: null });
        });
    });
}

function formatSyncStatus(syncStatus) {
    if (!syncStatus) return "No sync attempts yet";

    const result = syncStatus.lastResult || "unknown";
    const pendingCount = syncStatus.pendingCount ?? 0;
    const syncedCount = syncStatus.lastBatchSyncedCount ?? 0;

    if (result === "success") return `Success | last batch ${syncedCount} | pending ${pendingCount}`;
    if (result === "error") return `Error | pending ${pendingCount}`;
    if (result === "idle") return "Idle | no pending posts";
    if (result === "auth_required") return "Sign in required";
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
    const session = captureStatus.session || null;

    if (!session?.token) {
        document.getElementById("account-name").textContent = "Sign in required";
        document.getElementById("account-meta").textContent = "Opening account setup…";
        document.getElementById("capture-count").textContent = String(captureStatus.pendingCount ?? 0);
        document.getElementById("uploaded-count").textContent = "Unavailable";
        document.getElementById("sync-status").textContent = "Sign in required";
        document.getElementById("backend-meta").textContent = "Your account page is opening so you can enter or create an access code.";
        document.getElementById("post-list").textContent = "Connect your account to view backend posts.";

        chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
        return;
    }

    document.getElementById("account-name").textContent = session?.username || "Not signed in";
    document.getElementById("account-meta").textContent = session?.userId
        ? `Account #${session.userId}`
        : "Open settings to enter or create an access code.";

    document.getElementById("capture-count").textContent = String(captureStatus.pendingCount ?? 0);
    document.getElementById("uploaded-count").textContent = backendStats.count == null ? "Unavailable" : String(backendStats.count);
    document.getElementById("sync-status").textContent = formatSyncStatus(captureStatus.syncStatus);

    document.getElementById("backend-meta").textContent = backendStats.ok === false
        ? `Backend unavailable: ${backendStats.error}`
        : `Last sync: ${formatTime(captureStatus.syncStatus?.lastSyncedAt)} | Last upload: ${formatTime(captureStats.lastUploadedAt)}`;

    renderPosts(backendStats.recentPosts || []);
}

document.getElementById("refresh-button").addEventListener("click", loadPopupState);
document.getElementById("settings-button").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
});

loadPopupState();
