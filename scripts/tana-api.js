// Tana API Client for Web Clipper

const TANA_API_ENDPOINT = 'https://europe-west1-tagr-prod.cloudfunctions.net/addToNodeV2';
const MAX_CONTENT_LENGTH = 4500; // Leave room for overhead
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
    // Normalize name for consistent matching
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

/**
 * Tana API Client
 */
export class TanaClient {
  constructor(apiToken) {
    this.apiToken = apiToken;
    this.nodeCache = new NodeCache();
  }

  /**
   * Send a clipping to Tana
   * @param {Object} options - Clipping options
   * @param {string} options.title - Title of the clipping
   * @param {string} options.content - Main content
   * @param {Object} options.metadata - Metadata fields
   * @param {string} options.supertagId - Supertag ID to apply
   * @param {Object} options.fieldMappings - Field ID mappings
   * @param {string} options.targetNodeId - Target node (INBOX, date, or node ID)
   * @param {boolean} options.isSelection - Whether this is a selection clip
   */
  async clip(options) {
    const {
      title,
      content,
      metadata,
      supertagId,
      fieldMappings,
      targetNodeId = 'INBOX',
      isSelection = false
    } = options;

    // Load node cache for deduplication
    await this.nodeCache.load();
    console.log('Loaded node cache:', this.nodeCache.cache);

    // Track nodes we're creating so we can cache their IDs from the response
    const pendingNodes = [];

    const node = this.buildNode({
      title,
      content,
      metadata,
      supertagId,
      fieldMappings,
      isSelection,
      pendingNodes
    });

    const payload = {
      targetNodeId: targetNodeId || 'INBOX',
      nodes: [node]
    };

    const result = await this.sendRequest(payload);

    // Cache any newly created node IDs from the response
    if (result.success && result.data && pendingNodes.length > 0) {
      await this.cacheCreatedNodes(result.data, pendingNodes);
    }

    return result;
  }

  /**
   * Extract and cache node IDs from API response
   */
  async cacheCreatedNodes(responseData, pendingNodes) {
    try {
      console.log('Tana API response:', JSON.stringify(responseData, null, 2));
      console.log('Pending nodes to cache:', pendingNodes);

      // Try to find node IDs in the response - structure may vary
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

  /**
   * Recursively extract all nodes with nodeId and name from response
   */
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

  /**
   * Build a Tana node object
   */
  buildNode({ title, content, metadata, supertagId, fieldMappings, isSelection, pendingNodes = [] }) {
    const sanitizedTitle = this.sanitizeNodeName(title || 'Untitled');
    const node = {
      name: isSelection ? `Selection from: ${sanitizedTitle}` : sanitizedTitle,
      children: []
    };

    // Add supertag
    if (supertagId) {
      node.supertags = [{ id: supertagId }];
    }

    // Add metadata fields
    if (fieldMappings) {
      // Author
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
          node.children.push(this.createField(fieldMappings.author, metadata.author));
        }
      }

      // URL
      if (metadata.url && fieldMappings.url) {
        node.children.push(this.createField(fieldMappings.url, metadata.url, 'url'));
      }

      // Publication
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
          node.children.push(this.createField(fieldMappings.publication, metadata.publication));
        }
      }

      // Published date
      if (metadata.publishedDate && fieldMappings.date) {
        const dateValue = this.formatDateForTana(metadata.publishedDate);
        if (dateValue) {
          node.children.push(this.createField(fieldMappings.date, dateValue, 'date'));
        }
      }
    }

    // Add content as child nodes - one node per paragraph
    // Content can be an array of paragraphs or a single string
    if (content) {
      const paragraphs = Array.isArray(content) ? content : [content];
      paragraphs.forEach(paragraph => {
        const sanitized = this.sanitizeNodeName(paragraph);
        if (sanitized) {
          // If paragraph is too long, split it
          if (sanitized.length > MAX_CONTENT_LENGTH) {
            const chunks = this.chunkContent(sanitized);
            chunks.forEach(chunk => {
              node.children.push({ name: chunk });
            });
          } else {
            node.children.push({ name: sanitized });
          }
        }
      });
    }

    return node;
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
      console.log(`Publication lookup: "${sanitizedName}" (supertag: ${publicationSupertagId}) -> cached ID: ${cachedId}`);
      console.log('Current cache:', this.nodeCache.cache);

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

  /**
   * Create a field node
   */
  createField(attributeId, value, dataType = 'plain') {
    const field = {
      type: 'field',
      attributeId,
      children: []
    };

    const sanitizedValue = this.sanitizeNodeName(value);
    if (dataType === 'url') {
      field.children.push({ dataType: 'url', name: sanitizedValue });
    } else if (dataType === 'date') {
      // Date values use dataType: 'date' with YYYY-MM-DD format
      field.children.push({ dataType: 'date', name: value });
    } else {
      field.children.push({ name: sanitizedValue });
    }

    return field;
  }

  /**
   * Format date for Tana API
   */
  formatDateForTana(dateStr) {
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        // Return simple YYYY-MM-DD format for dataType: 'date'
        return date.toISOString().split('T')[0];
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Split content into chunks that fit within Tana's limits
   */
  chunkContent(content) {
    const chunks = [];
    let remaining = content;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_CONTENT_LENGTH) {
        chunks.push(this.sanitizeNodeName(remaining));
        break;
      }

      // Find a good break point (paragraph, sentence, or word)
      let breakPoint = this.findBreakPoint(remaining, MAX_CONTENT_LENGTH);
      chunks.push(this.sanitizeNodeName(remaining.substring(0, breakPoint).trim()));
      remaining = remaining.substring(breakPoint).trim();
    }

    return chunks;
  }

  /**
   * Sanitize text for use as a Tana node name
   */
  sanitizeNodeName(text) {
    // Replace newlines with spaces - Tana API doesn't allow newlines in node names
    return text.replace(/[\r\n]+/g, ' ').trim();
  }

  /**
   * Find a good break point in text
   */
  findBreakPoint(text, maxLength) {
    // Try paragraph break
    let breakPoint = text.lastIndexOf('\n\n', maxLength);
    if (breakPoint > maxLength / 2) return breakPoint;

    // Try line break
    breakPoint = text.lastIndexOf('\n', maxLength);
    if (breakPoint > maxLength / 2) return breakPoint;

    // Try sentence break
    const sentenceEnders = ['. ', '! ', '? '];
    for (const ender of sentenceEnders) {
      breakPoint = text.lastIndexOf(ender, maxLength);
      if (breakPoint > maxLength / 2) return breakPoint + ender.length - 1;
    }

    // Try word break
    breakPoint = text.lastIndexOf(' ', maxLength);
    if (breakPoint > maxLength / 2) return breakPoint;

    // Hard cut if no good break point
    return maxLength;
  }

  /**
   * Send request to Tana API
   */
  async sendRequest(payload) {
    try {
      const response = await fetch(TANA_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 401 || response.status === 403) {
          return {
            success: false,
            error: 'Invalid API token. Please check your settings.'
          };
        }

        if (response.status === 429) {
          return {
            success: false,
            error: 'Rate limited. Please wait a moment and try again.'
          };
        }

        return {
          success: false,
          error: `API error (${response.status}): ${errorText}`
        };
      }

      const result = await response.json().catch(() => ({}));

      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: `Network error: ${error.message}`
      };
    }
  }

  /**
   * Test the API connection
   */
  async testConnection() {
    try {
      const response = await fetch(TANA_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`
        },
        body: JSON.stringify({
          targetNodeId: 'INBOX',
          nodes: []
        })
      });

      // 200 or 400 (empty nodes) both indicate auth worked
      if (response.ok || response.status === 400) {
        return { success: true };
      }

      if (response.status === 401 || response.status === 403) {
        return { success: false, error: 'Invalid API token' };
      }

      return { success: false, error: `Unexpected status: ${response.status}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

export default TanaClient;
