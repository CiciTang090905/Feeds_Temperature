document.addEventListener("DOMContentLoaded", async () => {
    const result = await chrome.storage.local.get(["captured_posts"]);
    const posts = result.captured_posts || [];
    document.getElementById("post-count").textContent = String(posts.length);
});
