const CAPTURE_STORAGE_KEY = "captured_posts";

function formatTime(timestamp) {
    if (!timestamp) return "No posts captured yet";
    return new Date(timestamp).toLocaleString();
}

function renderPosts(posts) {
    const list = document.getElementById("post-list");
    if (posts.length === 0) {
        list.textContent = "No captured posts yet.";
        return;
    }

    list.textContent = posts
        .slice(-10)
        .reverse()
        .map((post) => {
            const author = post.author?.handle || post.author?.name || "unknown";
            return `${author} | ${post.tweetId}\n${post.text}`;
        })
        .join("\n\n");
}

async function loadPopupState() {
    const result = await chrome.storage.local.get([CAPTURE_STORAGE_KEY]);
    const posts = result[CAPTURE_STORAGE_KEY] || [];
    document.getElementById("capture-count").textContent = String(posts.length);
    document.getElementById("last-captured").textContent = formatTime(
        posts.length ? posts[posts.length - 1].capturedAt : null
    );
    renderPosts(posts);
}

document.getElementById("refresh-button").addEventListener("click", loadPopupState);

document.getElementById("clear-button").addEventListener("click", async () => {
    await chrome.storage.local.set({ [CAPTURE_STORAGE_KEY]: [] });
    await loadPopupState();
});

loadPopupState();
