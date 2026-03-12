# Feeds_temperature

Chrome extension for capturing visible X posts from the timeline and storing them in `chrome.storage.local`.

## Current scope

- X / Twitter only
- Content script extracts visible posts
- Extension stores captured posts locally
- Popup shows capture status and recent posts

## Current payload

Each captured post includes:

- `platform`
- `tweetId`
- `author`
- `postedAt`
- `text`
- `media`
- `capturedAt`
- `pageUrl`

## DevTools helpers on X

The content script exposes:

- `showStoredPosts()`
- `clearStoredPosts()`
- `stopPostCapture()`

## AI Summary Prototype

The original AI summary extension has been preserved under `legacy-summary-extension/` so it can live in a separate repository.
