chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get(["genminiApiKey"], (result) => { //2 storages: local for device only, sync for account
        if (!result.genminiApiKey) {
            chrome.tabs.create({ url: "options.html" });
        }
    });
});