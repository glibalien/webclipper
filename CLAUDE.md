# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tana Web Clipper is a Chrome/Edge browser extension (Manifest V3) that clips web content to Tana via the Local API (MCP server on `localhost:8262`). Features intelligent metadata extraction, supertag support, auto-discovery of tags and field schemas, and author/publication deduplication via Tana Paste references. No build system — all source files are loaded directly by the browser.

## Development Workflow

There is no build step, bundler, or transpiler. To develop:

1. Open `chrome://extensions`, enable Developer mode
2. Click "Load unpacked" and select this project directory
3. After code changes, click the refresh button on the extension card in `chrome://extensions`

**Prerequisites:** Tana Desktop running with "Local API/MCP server (Alpha)" enabled in Tana Labs.

**Debugging:**
- Background service worker: right-click extension icon → "Inspect service worker"
- Content script: page DevTools console
- Popup: right-click the popup → "Inspect"

There are no automated tests. Testing is manual across various websites (news, blogs, documentation).

## Architecture

Four main components communicate via `chrome.runtime` message passing:

### `scripts/background.js` — Service Worker (Orchestrator)
Entry point. Creates context menu items on install, handles keyboard shortcut (`Ctrl+Shift+T`), routes messages between popup/content/API, manages badge notifications. Injects content script on demand via `chrome.scripting.executeScript`. Runs v1→v2 migration on update (removes old `apiToken` and `tanaNodeCache`).

### `scripts/content.js` — Content Script (DOM Extraction)
IIFE that guards against double-injection via `window.__tanaClipperInjected`. Extracts metadata using a multi-source fallback chain (Open Graph → Twitter Cards → JSON-LD → DOM selectors → URL heuristics). Extracts article content by finding article containers and filtering out 40+ ad/nav/modal selectors. Responds to messages: `getMetadata`, `getContent`, `checkSelection`.

### `scripts/tana-local-api.js` — MCP Client, Tana Paste Builder & API Client
Three classes:
- **`McpClient`**: JSON-RPC 2.0 transport for `http://localhost:8262/mcp`. Handles session initialization, auth via Tana Desktop approval modal, session persistence in `chrome.storage.local`, auto-reconnection on 401.
- **`TanaPasteBuilder`**: Generates `%%tana%%` formatted strings for import. Handles field formatting (author references with `[[Name #[[tag]]]]`, dates with `[[date:YYYY-MM-DD]]`, URL markdown links), content chunking at paragraph/sentence/word boundaries (max 4500 chars), and multi-author parsing.
- **`TanaLocalClient`**: High-level API consumed by background.js and popup.js. Methods: `clip()`, `testConnection()`, `listWorkspaces()`, `listTags()`, `getTagSchema()`. No API token needed — MCP session ID is the auth mechanism.

### `popup/popup.js` — Popup UI Controller
Loads settings from `chrome.storage.sync`, injects content script, displays metadata preview, handles clip button click, and shows status. Uses ES6 module imports from `tana-local-api.js`.

### `options/options.js` — Settings Page Controller (ES6 Module)
Connection UI (connect/test with green/red status dot), workspace selection from `list_workspaces`, tag discovery from `list_tags` with filter/search, field mapping dropdowns auto-populated from `get_tag_schema` with auto-detection by name. Author/publication fields support tagged reference mode. Saves to `chrome.storage.sync`.

## Key Technical Details

- Background script, popup, and options page use ES6 modules (`"type": "module"` in manifest/HTML)
- Content script uses IIFE pattern (not a module) since it's injected into page context
- `lib/readability.js` is a third-party article extraction library
- MCP server endpoint: `http://localhost:8262/mcp`, health check: `http://localhost:8262/health`
- Tana Paste `[[Name #[[tag]]]]` references handle deduplication automatically (no client-side cache needed)
- All async message handlers must `return true` to keep the message channel open

## Storage

- `chrome.storage.sync`: workspaceId, supertags array, field mappings with field names (synced across devices)
- `chrome.storage.local`: `mcpSessionId` for MCP session persistence (device-local)
