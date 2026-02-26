let postLists = new Map();

const tweetIdRegex = /\/status\/([0-9]+)/;

function extractTweetId(tweetDOM) {
    const links = tweetDOM.querySelectorAll("a[href*='status']");
    for (let i = 0; i < links.length; i++) {
        const match = links[i].href.match(tweetIdRegex);
        if (match !== null) {
            return match[1];
        }
    }
    return null;
}

function addArticlesToPostLists() {
    const articles = document.querySelectorAll("article")
    articles.forEach((article) => {
        if (!isInViewport(article)) return;
        const tweetId = extractTweetId(article);
        if (!tweetId) return;
        if (postLists.has(tweetId)) return;
        postLists.set(tweetId, { text: getTweetText(article) });
        console.log(`Tweet ID: ${tweetId}, Text: ${postLists.get(tweetId).text}`);
    });
}

function getTweetText(tweetArticle) {
    const node = tweetArticle.querySelector('div[data-testid="tweetText"]');
    return node ? node.innerText : "";
}

function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
        rect.left < (window.innerWidth || document.documentElement.clientWidth)
    );
}

let updateTimerId = null;
let started = false;
function start3sTimmer() {
    if (started) return;
    started = true;
    addArticlesToPostLists()
    updateTimerId = setInterval(() => {
        addArticlesToPostLists()
    }, 500);
}

start3sTimmer();


