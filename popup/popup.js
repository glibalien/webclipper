// Popup script for Tana Web Clipper

const NODE_CACHE_KEY = 'tanaNodeCache';

/**
 * Node cache for deduplicating supertag instances (publications, authors)
 * Maps "supertagId:normalizedName" -> nodeId
 */
class NodeCache {
  constructor() {
    this.cache = null;
  }

  async load() {
    if (this.cache !== null) return;
    const result = await chrome.storage.local.get(NODE_CACHE_KEY);
    this.cache = result[NODE_CACHE_KEY] || {};
  }

  async save() {
    await chrome.storage.local.set({ [NODE_CACHE_KEY]: this.cache });
  }

  getCacheKey(supertagId, name) {
    return `${supertagId}:${name.toLowerCase().trim()}`;
  }

  get(supertagId, name) {
    const key = this.getCacheKey(supertagId, name);
    return this.cache[key] || null;
  }

  set(supertagId, name, nodeId) {
    const key = this.getCacheKey(supertagId, name);
    this.cache[key] = nodeId;
  }
}

class TanaClipperPopup {
  constructor() {
    this.elements = {};
    this.metadata = null;
    this.hasSelection = false;
    this.settings = null;
    this.nodeCache = new NodeCache();
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    await this.loadSettings();

    if (!this.isConfigured()) {
      this.showSetupRequired();
      return;
    }

    this.showMainContent();
    await this.loadPageData();
  }

  cacheElements() {
    this.elements = {
      setupRequired: document.getElementById('setup-required'),
      mainContent: document.getElementById('main-content'),
      openSettings: document.getElementById('open-settings'),
      previewTitle: document.getElementById('preview-title'),
      previewAuthor: document.getElementById('preview-author'),
      previewPublication: document.getElementById('preview-publication'),
      previewDate: document.getElementById('preview-date'),
      previewUrl: document.getElementById('preview-url'),
      clipSelection: document.getElementById('clip-selection'),
      selectionStatus: document.getElementById('selection-status'),
      supertagSelect: document.getElementById('supertag-select'),
      clipBtn: document.getElementById('clip-btn'),
      btnText: document.querySelector('.btn-text'),
      btnLoading: document.querySelector('.btn-loading'),
      statusMessage: document.getElementById('status-message')
    };
  }

  bindEvents() {
    this.elements.openSettings.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    this.elements.clipBtn.addEventListener('click', () => this.clipToTana());
  }

  async loadSettings() {
    const result = await chrome.storage.sync.get([
      'apiToken',
      'supertags',
      'fieldMappings'
    ]);
    this.settings = result;

    // Populate supertag dropdown
    if (result.supertags && result.supertags.length > 0) {
      this.elements.supertagSelect.innerHTML = '<option value="">None</option>';
      result.supertags.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag.id;
        option.textContent = tag.name;
        this.elements.supertagSelect.appendChild(option);
      });
      // Select first supertag by default
      if (result.supertags[0]) {
        this.elements.supertagSelect.value = result.supertags[0].id;
      }
    }
  }

  isConfigured() {
    return this.settings?.apiToken &&
           this.settings?.supertags?.length > 0 &&
           this.settings?.supertags[0]?.id;
  }

  showSetupRequired() {
    this.elements.setupRequired.classList.remove('hidden');
    this.elements.mainContent.classList.add('hidden');
  }

  showMainContent() {
    this.elements.setupRequired.classList.add('hidden');
    this.elements.mainContent.classList.remove('hidden');
  }

  async loadPageData() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Inject content script and get page data
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['scripts/content.js']
      });

      // Request metadata from content script
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getMetadata' });

      if (response) {
        this.metadata = response.metadata;
        this.hasSelection = response.hasSelection;
        this.updatePreview();
      }
    } catch (error) {
      console.error('Failed to load page data:', error);
      this.elements.previewTitle.textContent = 'Unable to load page data';
    }
  }

  updatePreview() {
    if (!this.metadata) return;

    this.elements.previewTitle.textContent = this.metadata.title || 'Untitled';
    this.elements.previewAuthor.textContent = this.metadata.author || '-';
    this.elements.previewPublication.textContent = this.metadata.publication || '-';
    this.elements.previewDate.textContent = this.metadata.publishedDate || '-';
    this.elements.previewUrl.textContent = this.metadata.url || '-';
    this.elements.previewUrl.title = this.metadata.url || '';

    // Update selection status
    if (this.hasSelection) {
      this.elements.selectionStatus.textContent = 'Selection detected';
      this.elements.selectionStatus.classList.add('has-selection');
      this.elements.clipSelection.checked = true;
      this.elements.clipSelection.disabled = false;
    } else {
      this.elements.selectionStatus.textContent = 'No selection';
      this.elements.selectionStatus.classList.remove('has-selection');
      this.elements.clipSelection.checked = false;
      this.elements.clipSelection.disabled = true;
    }
  }

  async clipToTana() {
    if (!this.metadata) {
      this.showStatus('No page data available', 'error');
      return;
    }

    this.setLoading(true);
    this.hideStatus();

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const clipSelectionOnly = this.elements.clipSelection.checked && this.hasSelection;

      // Get content from page
      const contentResponse = await chrome.tabs.sendMessage(tab.id, {
        action: 'getContent',
        selectionOnly: clipSelectionOnly
      });

      if (!contentResponse || !contentResponse.content || contentResponse.content.length === 0) {
        throw new Error('Failed to extract content from page');
      }

      // Load node cache for deduplication
      await this.nodeCache.load();
      console.log('Loaded node cache:', this.nodeCache.cache);

      // Track nodes we're creating so we can cache their IDs from the response
      const pendingNodes = [];

      // Build payload
      const supertagId = this.elements.supertagSelect.value;
      const payload = this.buildTanaPayload(
        this.metadata,
        contentResponse.content,
        supertagId,
        clipSelectionOnly,
        pendingNodes
      );

      // Send to Tana
      const result = await this.sendToTana(payload);

      if (result.success) {
        // Cache any newly created node IDs from the response
        if (result.data && pendingNodes.length > 0) {
          await this.cacheCreatedNodes(result.data, pendingNodes);
        }
        this.showStatus('Clipped to Tana successfully!', 'success');
      } else {
        throw new Error(result.error || 'Failed to clip to Tana');
      }
    } catch (error) {
      console.error('Clip error:', error);
      this.showStatus(error.message, 'error');
    } finally {
      this.setLoading(false);
    }
  }

  async cacheCreatedNodes(responseData, pendingNodes) {
    try {
      console.log('Tana API response:', JSON.stringify(responseData, null, 2));
      console.log('Pending nodes to cache:', pendingNodes);

      const foundIds = this.extractNodeIds(responseData, []);
      console.log('Extracted node IDs:', foundIds);

      for (const found of foundIds) {
        if (found.id && found.name) {
          const pending = pendingNodes.find(
            p => p.name.toLowerCase() === found.name.toLowerCase()
          );
          if (pending) {
            console.log(`Caching: ${pending.name} -> ${found.id}`);
            this.nodeCache.set(pending.supertagId, pending.name, found.id);
          }
        }
      }

      await this.nodeCache.save();
      console.log('Cache after save:', this.nodeCache.cache);
    } catch (e) {
      console.error('Failed to cache node IDs:', e);
    }
  }

  extractNodeIds(obj, results = []) {
    if (!obj || typeof obj !== 'object') return results;
    // Tana API returns nodeId, not id
    if (obj.nodeId && obj.name) {
      results.push({ id: obj.nodeId, name: obj.name });
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.extractNodeIds(item, results);
      }
    } else {
      for (const key of Object.keys(obj)) {
        this.extractNodeIds(obj[key], results);
      }
    }
    return results;
  }

  buildTanaPayload(metadata, content, supertagId, isSelection, pendingNodes = []) {
    const title = this.sanitizeNodeName(metadata.title || 'Untitled');
    const node = {
      name: isSelection ? `Selection from: ${title}` : title,
      children: []
    };

    // Add supertag if configured
    if (supertagId) {
      node.supertags = [{ id: supertagId }];
    }

    // Add field mappings if configured
    const fieldMappings = this.settings.fieldMappings || {};

    if (metadata.author && fieldMappings.author) {
      if (fieldMappings.authorFieldType === 'supertag' && fieldMappings.authorSupertagId) {
        node.children.push(this.createAuthorField(
          fieldMappings.author,
          metadata.author,
          fieldMappings.authorSupertagId,
          pendingNodes
        ));
      } else {
        // Plain text author field
        node.children.push({
          type: 'field',
          attributeId: fieldMappings.author,
          children: [{ name: this.sanitizeNodeName(metadata.author) }]
        });
      }
    }

    if (metadata.url && fieldMappings.url) {
      node.children.push({
        type: 'field',
        attributeId: fieldMappings.url,
        children: [{ dataType: 'url', name: metadata.url }]
      });
    }

    if (metadata.publication && fieldMappings.publication) {
      if (fieldMappings.publicationFieldType === 'supertag' && fieldMappings.publicationSupertagId) {
        node.children.push(this.createPublicationField(
          fieldMappings.publication,
          metadata.publication,
          fieldMappings.publicationSupertagId,
          pendingNodes
        ));
      } else {
        // Plain text publication field
        node.children.push({
          type: 'field',
          attributeId: fieldMappings.publication,
          children: [{ name: this.sanitizeNodeName(metadata.publication) }]
        });
      }
    }

    if (metadata.publishedDate && fieldMappings.date) {
      // Format date for Tana - use dataType: 'date' with simple YYYY-MM-DD format
      const dateStr = this.formatDateForTana(metadata.publishedDate);
      if (dateStr) {
        node.children.push({
          type: 'field',
          attributeId: fieldMappings.date,
          children: [{ dataType: 'date', name: dateStr }]
        });
      }
    }

    // Add content as child nodes - one node per paragraph
    // Content is now an array of paragraphs from the content script
    const paragraphs = Array.isArray(content) ? content : [content];
    paragraphs.forEach(paragraph => {
      const sanitized = this.sanitizeNodeName(paragraph);
      if (sanitized) {
        // If paragraph is too long, split it
        if (sanitized.length > 4000) {
          const chunks = this.chunkContent(sanitized, 4000);
          chunks.forEach(chunk => {
            node.children.push({ name: chunk });
          });
        } else {
          node.children.push({ name: sanitized });
        }
      }
    });

    const payload = {
      targetNodeId: 'INBOX',
      nodes: [node]
    };

    console.log('Full payload being sent:', JSON.stringify(payload, null, 2));
    return payload;
  }

  formatDateForTana(dateStr) {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return null;
      // Return simple YYYY-MM-DD format for dataType: 'date'
      return date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }

  chunkContent(content, maxLength) {
    const chunks = [];
    let remaining = content;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(this.sanitizeNodeName(remaining));
        break;
      }

      // Find a good break point
      let breakPoint = remaining.lastIndexOf('\n', maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = remaining.lastIndexOf(' ', maxLength);
      }
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength;
      }

      chunks.push(this.sanitizeNodeName(remaining.substring(0, breakPoint)));
      remaining = remaining.substring(breakPoint).trim();
    }

    return chunks;
  }

  sanitizeNodeName(text) {
    // Replace newlines with spaces - Tana API doesn't allow newlines in node names
    return text.replace(/[\r\n]+/g, ' ').trim();
  }

  /**
   * Parse author string into individual authors
   * Handles comma-separated, "and"-separated, and ampersand-separated lists
   */
  parseAuthors(authorString) {
    // Normalize the string
    let normalized = authorString.trim();

    // Replace " and " and " & " with commas for consistent splitting
    normalized = normalized.replace(/\s+and\s+/gi, ', ');
    normalized = normalized.replace(/\s*&\s*/g, ', ');

    // Split by comma and clean up
    const authors = normalized
      .split(',')
      .map(author => author.trim())
      .filter(author => author.length > 0);

    return authors;
  }

  /**
   * Create an author field with supertag instances
   * Uses cached node IDs when available to avoid duplicates
   */
  createAuthorField(attributeId, authorValue, authorSupertagId, pendingNodes = []) {
    const field = {
      type: 'field',
      attributeId,
      children: []
    };

    const authors = this.parseAuthors(authorValue);

    for (const author of authors) {
      const sanitizedName = this.sanitizeNodeName(author);
      if (sanitizedName) {
        // Check cache for existing node ID
        const cachedId = this.nodeCache.get(authorSupertagId, sanitizedName);

        if (cachedId) {
          // Reference existing node using dataType: "reference"
          field.children.push({ dataType: 'reference', id: cachedId });
        } else {
          // Create new node with supertag, track for caching
          field.children.push({
            name: sanitizedName,
            supertags: [{ id: authorSupertagId }]
          });
          pendingNodes.push({ name: sanitizedName, supertagId: authorSupertagId });
        }
      }
    }

    // If no valid authors were parsed, fall back to plain text
    if (field.children.length === 0) {
      const sanitizedValue = this.sanitizeNodeName(authorValue);
      field.children.push({ name: sanitizedValue });
    }

    return field;
  }

  /**
   * Create a publication field with supertag instance
   * Uses cached node ID when available to avoid duplicates
   */
  createPublicationField(attributeId, publicationValue, publicationSupertagId, pendingNodes = []) {
    const field = {
      type: 'field',
      attributeId,
      children: []
    };

    const sanitizedName = this.sanitizeNodeName(publicationValue);
    if (sanitizedName) {
      // Check cache for existing node ID
      const cachedId = this.nodeCache.get(publicationSupertagId, sanitizedName);
      console.log(`Publication lookup: "${sanitizedName}" -> cached ID: ${cachedId}`);

      if (cachedId) {
        // Reference existing node using dataType: "reference"
        console.log(`Using cached publication node: ${cachedId}`);
        field.children.push({ dataType: 'reference', id: cachedId });
      } else {
        // Create new node with supertag, track for caching
        console.log(`Creating new publication node: ${sanitizedName}`);
        field.children.push({
          name: sanitizedName,
          supertags: [{ id: publicationSupertagId }]
        });
        pendingNodes.push({ name: sanitizedName, supertagId: publicationSupertagId });
      }
    }

    // If sanitization resulted in empty string, fall back to plain text
    if (field.children.length === 0) {
      field.children.push({ name: publicationValue });
    }

    return field;
  }

  async sendToTana(payload) {
    const response = await fetch(
      'https://europe-west1-tagr-prod.cloudfunctions.net/addToNodeV2',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.settings.apiToken}`
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json().catch(() => ({}));
    return { success: true, data };
  }

  setLoading(loading) {
    this.elements.clipBtn.disabled = loading;
    this.elements.btnText.classList.toggle('hidden', loading);
    this.elements.btnLoading.classList.toggle('hidden', !loading);
  }

  showStatus(message, type) {
    this.elements.statusMessage.textContent = message;
    this.elements.statusMessage.className = `status-message ${type}`;
    this.elements.statusMessage.classList.remove('hidden');
  }

  hideStatus() {
    this.elements.statusMessage.classList.add('hidden');
  }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  const popup = new TanaClipperPopup();
  popup.init();
});
