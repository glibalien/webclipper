# Tana Web Clipper

A Chrome/Edge browser extension for clipping web content directly to [Tana](https://tana.inc) via the Local API (MCP server). Features intelligent metadata extraction, auto-discovered supertags and field schemas, and smart content parsing.

## Features

### Multiple Clipping Methods
- **Full Page Clipping**: Capture entire articles with automatic content detection
- **Selection Clipping**: Clip only the text you've selected
- **Image Clipping**: Save images with source attribution
- **Link Clipping**: Save links with contextual information
- **Keyboard Shortcut**: Quick clip with `Ctrl+Shift+T` (Mac: `Command+Shift+T`)

### Intelligent Metadata Extraction
The extension automatically extracts rich metadata from web pages:
- **Title**: From Open Graph, Twitter Cards, H1 tags, or document title
- **Author**: From JSON-LD, meta tags, article bylines, or author links
- **Publication**: From site name, publisher info, or domain
- **Publication Date**: From article metadata or structured data
- **URL**: Canonical URL or current page location
- **Description**: From Open Graph or meta description tags

### Smart Content Processing
- **Article Detection**: Automatically identifies main content area
- **Ad/Clutter Removal**: Strips ads, navigation, comments, and promotional content (40+ patterns)
- **Content Chunking**: Intelligently splits long content at paragraph, sentence, or word boundaries
- **Selection Preservation**: Respects user selections for precise clipping

### Tana Integration
- **Local API**: Connects to Tana Desktop's MCP server — no cloud API token needed
- **Auto-Discovery**: Automatically loads workspaces, tags, and field schemas from your Tana graph
- **Supertag Support**: Tag clipped content with your Tana supertags
- **Field Mapping**: Map metadata to fields auto-populated from tag schemas
- **Author/Publication Deduplication**: Tana Paste `[[references]]` prevent duplicate nodes automatically
- **Reference Creation**: Optionally creates tagged references for authors and publications

## Installation

### From Chrome Web Store (Recommended)

Install the extension directly from the Chrome Web Store:

**[Install Tana Web Clipper](https://chromewebstore.google.com/detail/tana-web-clipper/hjbhjaijfplenhlgdclaffmiilcjefbb)**

1. Click the link above
2. Click "Add to Chrome" (or "Add to Edge" if using Microsoft Edge)
3. Confirm by clicking "Add extension"
4. The Tana Web Clipper icon will appear in your toolbar

### Manual Installation (For Development)
1. Clone this repository:
   ```bash
   git clone https://github.com/iamactionbarry/webclipper.git
   cd webclipper
   ```

2. Open Chrome/Edge and navigate to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`

3. Enable "Developer mode" (toggle in top-right corner)

4. Click "Load unpacked" and select the `webclipper` directory

5. The Tana Web Clipper icon should now appear in your toolbar

## Setup

### Prerequisites

1. **Tana Desktop** must be running
2. Enable **"Local API/MCP server (Alpha)"** in Tana Labs (Settings → Tana Labs)

### Connecting the Extension

1. Click the Tana Web Clipper icon → "Open Settings" (or right-click the icon → "Options")
2. Click **"Connect to Tana"** — Tana Desktop will show an approval prompt
3. Once connected, a green dot indicates the connection is active
4. Select your **workspace** from the dropdown
5. Check the **tags** you want available when clipping (e.g., "Article", "Bookmark")
6. **Field mappings** are auto-populated from tag schemas — adjust if needed

### Field Mappings

The extension auto-detects fields by name from your tag schemas:

- **Author**: Can be plain text or a tagged reference (e.g., `#person`) for automatic deduplication
- **URL**: Stored as a markdown link
- **Publication**: Can be plain text or a tagged reference (e.g., `#publication`)
- **Date**: Stored as a Tana date reference

## Usage

### Quick Clip
1. Navigate to any web page
2. Press `Ctrl+Shift+T` (Mac: `Command+Shift+T`)
3. The page (or selected text) will be clipped to your Tana inbox

### Using the Popup
1. Click the Tana Web Clipper icon
2. Review the extracted metadata
3. Select a supertag (if multiple are configured)
4. Click "Clip to Tana"

### Context Menu Options
Right-click on a page to access:
- "Clip page to Tana" - Clip entire page
- "Clip selection to Tana" - Clip only selected text
- "Clip image to Tana" - Clip image with source (right-click on image)
- "Clip link to Tana" - Clip link with context (right-click on link)

## Architecture

### Project Structure

```
webclipper/
├── manifest.json           # Extension configuration (Manifest V3)
├── icons/                  # Extension icons (16px, 48px, 128px)
├── lib/
│   └── readability.js      # Article extraction library
├── scripts/
│   ├── background.js       # Background service worker
│   ├── content.js          # Content extraction and metadata parsing
│   └── tana-local-api.js   # MCP client, Tana Paste builder, API client
├── popup/
│   ├── popup.html          # Popup UI
│   ├── popup.js            # Popup controller
│   └── popup.css           # Popup styling
└── options/
    ├── options.html        # Settings page
    ├── options.js          # Settings controller (ES6 module)
    └── options.css         # Settings styling
```

### Key Components

#### Background Service Worker (`scripts/background.js`)
- Orchestrates clipping operations
- Handles context menu creation
- Manages keyboard shortcuts
- Coordinates between content scripts and Tana Local API
- Runs v1→v2 migration on update

#### Content Script (`scripts/content.js`)
- Injected into web pages for DOM access
- Extracts metadata using multiple fallback strategies
- Identifies and extracts main article content
- Removes ads, navigation, and clutter
- Handles text selections

#### Tana Local API Client (`scripts/tana-local-api.js`)
Three classes:
- **`McpClient`**: JSON-RPC 2.0 transport for `localhost:8262/mcp`. Handles session initialization, auth via Tana Desktop approval, session persistence, and auto-reconnection.
- **`TanaPasteBuilder`**: Generates `%%tana%%` formatted strings. Handles field formatting (author/publication references, dates, URLs), content chunking, and multi-author parsing.
- **`TanaLocalClient`**: High-level API — `clip()`, `testConnection()`, `listWorkspaces()`, `listTags()`, `getTagSchema()`.

### Data Flow

```
User Action (Shortcut/Popup/Context Menu)
    ↓
Background Worker
    ↓
Content Script (extracts metadata + content)
    ↓
TanaPasteBuilder (generates %%tana%% format)
    ↓
McpClient (sends via MCP to Tana Desktop)
    ↓
User Notification (success/error)
```

### Deduplication via Tana Paste

The extension uses Tana Paste's `[[Name #[[tag]]]]` reference syntax for automatic deduplication:

- When you clip an article by "John Doe", the Tana Paste output includes `[[John Doe #[[person]]]]`
- Tana automatically finds an existing "John Doe" node with the `#person` tag, or creates a new one
- No client-side cache needed — deduplication is handled natively by Tana

### Content Chunking

Long content is automatically chunked at smart boundaries:
1. Paragraph breaks (preferred)
2. Line breaks
3. Sentence breaks
4. Word breaks
5. Hard cut at 4500 characters (Tana limit)

### Metadata Extraction Strategy

The extension uses a comprehensive fallback strategy for each metadata field:

**Title**: `og:title` → `twitter:title` → `<h1>` → `document.title`

**Author**: JSON-LD → meta tags → `article:author` → `twitter:creator` → `rel="author"` → CSS selectors (`.author`, `.byline`, etc.)

**Publication**: `og:site_name` → JSON-LD publisher → `application-name` → domain name

**Date**: `article:published_time` → `publish-date` → `<time datetime>` → JSON-LD → structured data

**URL**: `<link rel="canonical">` → `og:url` → `window.location.href`

**Description**: `og:description` → `meta[name="description"]` → `twitter:description`

## Development

### Prerequisites
- Chrome or Edge browser
- Tana Desktop with Local API enabled
- Basic understanding of browser extensions and JavaScript

### Local Development
1. Make changes to the code
2. Go to `chrome://extensions`
3. Click the refresh icon on the Tana Web Clipper card
4. Test your changes

### Debugging
- **Background Script**: Right-click extension icon → "Inspect service worker"
- **Content Script**: Open DevTools on any page, check Console for errors
- **Popup**: Right-click popup → "Inspect"

### Key Files to Modify

| Feature | Files to Edit |
|---------|---------------|
| Metadata extraction | `scripts/content.js` |
| Tana API integration | `scripts/tana-local-api.js` |
| UI/UX | `popup/popup.html`, `popup/popup.js`, `popup/popup.css` |
| Settings | `options/options.html`, `options/options.js` |
| Background logic | `scripts/background.js` |
| Extension config | `manifest.json` |

### Testing Checklist
- [ ] Connection: Options page shows green "Connected" status
- [ ] Auto-discovery: Workspace dropdown populates; tag list populates and is filterable
- [ ] Full page clipping on various sites (news, blogs, documentation)
- [ ] Selection clipping with different content types
- [ ] Image and link clipping
- [ ] Settings persistence across browser restarts
- [ ] Keyboard shortcut functionality
- [ ] Error handling (Tana not running, no tags configured)
- [ ] Metadata extraction on edge cases (missing authors, dates, etc.)
- [ ] Deduplication for repeat authors/publications

## API Reference

### Tana Local API (MCP)

The extension communicates with Tana Desktop's MCP server via JSON-RPC 2.0:

**Endpoint**: `http://localhost:8262/mcp`
**Health Check**: `http://localhost:8262/health`

**MCP Tools Used**:
- `import_tana_paste` — Import content in Tana Paste format
- `list_workspaces` — Get available workspaces
- `list_tags` — Get tags in a workspace
- `get_tag_schema` — Get field schema for a tag

**Tana Paste Example**:
```
%%tana%%
- Article Title #[[Article^tagId]]
  - Author:: [[John Smith #[[person]]]]
  - URL:: [Article Title](https://example.com/article)
  - Published Date:: [[date:2024-01-15]]
  - Publication:: [[NYT #[[publication]]]]
  - First paragraph of content
  - Second paragraph of content
```

## Permissions

The extension requests these permissions:

- **activeTab**: Access current tab content for clipping
- **storage**: Save settings and MCP session
- **contextMenus**: Add right-click menu options
- **scripting**: Inject content scripts for metadata extraction
- **host_permissions**: Communicate with Tana's Local API on `localhost:8262`

## Troubleshooting

### "Not Connected" Status
- Make sure Tana Desktop is running
- Enable "Local API/MCP server (Alpha)" in Tana Labs (Settings → Tana Labs)
- Click "Connect to Tana" and approve the connection in the Tana Desktop prompt

### Content Not Clipping Correctly
- Try using selection mode (select text before clipping)
- Some sites have unusual HTML structure that may not be parsed correctly
- Check the browser console for errors

### Metadata Missing
- Not all sites include complete metadata
- The extension uses fallbacks, but some data may be unavailable
- You can manually edit nodes in Tana after clipping

### Extension Not Appearing
- Make sure Developer Mode is enabled
- Try reloading the extension
- Check for errors in `chrome://extensions`

### Upgrading from v1 (Cloud API)
- The extension automatically removes old settings (`apiToken`, `tanaNodeCache`) on update
- You'll need to connect to Tana via the Local API and re-select your tags in settings

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built for the [Tana](https://tana.inc) community
- Uses metadata extraction strategies inspired by various web parsing libraries
- Content extraction enhanced with clutter detection patterns

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

---

**Note**: This extension is not officially affiliated with Tana. It's a community-built tool to enhance the Tana experience.
