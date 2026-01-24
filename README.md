# Tana Web Clipper

A Chrome/Edge browser extension for clipping web content directly to [Tana](https://tana.inc) with intelligent metadata extraction, supertag support, and smart content parsing.

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
- **Supertag Support**: Tag clipped content with your Tana supertags
- **Field Mapping**: Map metadata to specific fields in your Tana schema
- **Author/Publication Deduplication**: Smart caching prevents duplicate author and publication nodes
- **Reference Creation**: Automatically creates or references existing author/publication nodes

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

### Getting Your Tana API Token

1. Open your Tana workspace
2. Go to Settings (click your workspace name → Settings)
3. Navigate to the API section
4. Generate or copy your API token

### Configuring the Extension

1. Click the Tana Web Clipper icon in your toolbar
2. Click "Open Settings" or right-click the icon → "Options"
3. Enter your Tana API token
4. Configure at least one supertag:
   - **Display Name**: How you'll see it in the popup (e.g., "Article")
   - **Supertag ID**: The ID from Tana (found in supertag settings)

### Optional Field Mappings

Map metadata to specific fields in your Tana schema:

- **Author Field**:
  - As text: Simple text field
  - As supertag: Creates author nodes with their own supertag (enables deduplication)
- **URL Field**: Stores the source URL
- **Publication Field**:
  - As text: Simple text field
  - As supertag: Creates publication nodes with their own supertag (enables deduplication)
- **Date Field**: Stores publication date

To find field IDs in Tana:
1. Open your supertag configuration
2. Find the field you want to map
3. Copy the field ID from the field settings

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
│   └── tana-api.js         # Tana API client and node builder
├── popup/
│   ├── popup.html          # Popup UI
│   ├── popup.js            # Popup controller
│   └── popup.css           # Popup styling
└── options/
    ├── options.html        # Settings page
    ├── options.js          # Settings controller
    └── options.css         # Settings styling
```

### Key Components

#### Background Service Worker (`scripts/background.js`)
- Orchestrates clipping operations
- Handles context menu creation
- Manages keyboard shortcuts
- Coordinates between content scripts and Tana API

#### Content Script (`scripts/content.js`)
- Injected into web pages for DOM access
- Extracts metadata using multiple fallback strategies
- Identifies and extracts main article content
- Removes ads, navigation, and clutter
- Handles text selections

#### Tana API Client (`scripts/tana-api.js`)
- Builds Tana node structures
- Manages node caching for deduplication
- Handles author/publication parsing and referencing
- Chunks long content intelligently
- Communicates with Tana's cloud API

### Data Flow

```
User Action (Shortcut/Popup/Context Menu)
    ↓
Background Worker
    ↓
Content Script (extracts metadata + content)
    ↓
Tana API Client (builds node structure)
    ↓
Node Cache (deduplication check)
    ↓
Tana API (sends data)
    ↓
Response Processing (updates cache)
    ↓
User Notification (success/error)
```

### Node Caching & Deduplication

The extension implements intelligent caching to prevent duplicate author and publication nodes:

- **Cache Key Format**: `"supertagId:normalizedName"`
- **Storage**: `chrome.storage.local` for fast access
- **Behavior**:
  - First clip with "John Doe" → Creates new author node, caches ID
  - Subsequent clips with "John Doe" → References existing node
- **Benefits**: Clean Tana graph, no duplicate entities

### Content Chunking

Long content is automatically chunked at smart boundaries:
1. Paragraph breaks (preferred)
2. Line breaks
3. Sentence breaks
4. Word breaks
5. Hard cut at 4500 characters (Tana API limit)

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
| Tana API integration | `scripts/tana-api.js` |
| UI/UX | `popup/popup.html`, `popup/popup.js`, `popup/popup.css` |
| Settings | `options/options.html`, `options/options.js` |
| Background logic | `scripts/background.js` |
| Extension config | `manifest.json` |

### Testing Checklist
- [ ] Full page clipping on various sites (news, blogs, documentation)
- [ ] Selection clipping with different content types
- [ ] Image and link clipping
- [ ] Settings persistence across browser restarts
- [ ] Keyboard shortcut functionality
- [ ] Error handling (invalid API token, network errors)
- [ ] Metadata extraction on edge cases (missing authors, dates, etc.)
- [ ] Deduplication for repeat authors/publications

## API Reference

### Tana API Endpoint
```
POST https://europe-west1-tagr-prod.cloudfunctions.net/addToNodeV2
```

**Headers**:
```
Content-Type: application/json
Authorization: Bearer {your-api-token}
```

**Payload Example**:
```json
{
  "targetNodeId": "INBOX",
  "nodes": [{
    "name": "Article Title",
    "supertags": [{ "id": "supertagId" }],
    "children": [
      {
        "type": "field",
        "attributeId": "authorFieldId",
        "children": [{
          "dataType": "reference",
          "nodeId": "cached-author-node-id"
        }]
      },
      {
        "type": "field",
        "attributeId": "urlFieldId",
        "children": [{
          "name": "https://example.com/article",
          "dataType": "url"
        }]
      },
      { "name": "First paragraph content..." },
      { "name": "Second paragraph content..." }
    ]
  }]
}
```

## Permissions

The extension requests these permissions:

- **activeTab**: Access current tab content for clipping
- **storage**: Save settings and node cache
- **contextMenus**: Add right-click menu options
- **scripting**: Inject content scripts for metadata extraction
- **host_permissions**: Communicate with Tana's API endpoint

## Troubleshooting

### "Invalid API Token" Error
- Verify your token in Tana Settings → API
- Copy the token exactly (no extra spaces)
- Re-paste in extension settings

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
