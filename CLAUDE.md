# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tana Web Clipper is a Chrome/Edge browser extension (Manifest V3) that clips web content to Tana with intelligent metadata extraction, supertag support, and author/publication deduplication. No build system — all source files are loaded directly by the browser.

## Development Workflow

There is no build step, bundler, or transpiler. To develop:

1. Open `chrome://extensions`, enable Developer mode
2. Click "Load unpacked" and select this project directory
3. After code changes, click the refresh button on the extension card in `chrome://extensions`

**Debugging:**
- Background service worker: right-click extension icon → "Inspect service worker"
- Content script: page DevTools console
- Popup: right-click the popup → "Inspect"

There are no automated tests. Testing is manual across various websites (news, blogs, documentation).

## Architecture

Four main components communicate via `chrome.runtime` message passing:

### `scripts/background.js` — Service Worker (Orchestrator)
Entry point. Creates context menu items on install, handles keyboard shortcut (`Ctrl+Shift+T`), routes messages between popup/content/API, manages badge notifications. Injects content script on demand via `chrome.scripting.executeScript`.

### `scripts/content.js` — Content Script (DOM Extraction)
IIFE that guards against double-injection via `window.__tanaClipperInjected`. Extracts metadata using a multi-source fallback chain (Open Graph → Twitter Cards → JSON-LD → DOM selectors → URL heuristics). Extracts article content by finding article containers and filtering out 40+ ad/nav/modal selectors. Responds to messages: `getMetadata`, `getContent`, `checkSelection`.

### `scripts/tana-api.js` — API Client & Node Builder
Exports `TanaClient` class and `NodeCache`. Builds node payloads for the Tana API (`POST /addToNodeV2` with Bearer auth). Handles field mapping (text, URL, date, reference types), content chunking at paragraph/sentence/word boundaries (max 4500 chars per chunk), multi-author parsing ("Author1, Author2 and Author3"), and node deduplication via a normalized cache stored in `chrome.storage.local`.

### `popup/popup.js` — Popup UI Controller
Loads settings from `chrome.storage.sync`, injects content script, displays metadata preview, handles clip button click, and shows status. Uses ES6 module imports from `tana-api.js`.

### `options/options.js` — Settings Page Controller
Manages API token, supertag list (name + ID pairs), and field mappings (author, publication, URL, date). Author/publication fields can be plain text or supertag-backed with deduplication. Saves to `chrome.storage.sync`.

## Key Technical Details

- Background script and popup use ES6 modules (`"type": "module"` in manifest)
- Content script uses IIFE pattern (not a module) since it's injected into page context
- `lib/readability.js` is a third-party article extraction library
- Node cache keys are `"supertagId:normalizedName"` (lowercased, trimmed)
- API endpoint: `https://europe-west1-tagr-prod.cloudfunctions.net/addToNodeV2`
- All async message handlers must `return true` to keep the message channel open

## Storage

- `chrome.storage.sync`: API token, supertags array, field mappings (synced across devices)
- `chrome.storage.local`: `tanaNodeCache` for author/publication deduplication (device-local)
