const CAPTURE_STORAGE_KEY = "captured_posts";

chrome.runtime.onInstalled.addListener(() => {
    console.log("Feeds_temperature extension installed");
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "GET_CAPTURE_STATUS") {
        chrome.storage.local.get(CAPTURE_STORAGE_KEY, (result) => {
            const posts = result[CAPTURE_STORAGE_KEY] || [];
            sendResponse({
                count: posts.length,
                lastCapturedAt: posts.length ? posts[posts.length - 1].capturedAt : null,
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
});
