// Tana API Client for Web Clipper

const TANA_API_ENDPOINT = 'https://europe-west1-tagr-prod.cloudfunctions.net/addToNodeV2';
const MAX_CONTENT_LENGTH = 4500; // Leave room for overhead

/**
 * Tana API Client
 */
export class TanaClient {
  constructor(apiToken) {
    this.apiToken = apiToken;
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

    const node = this.buildNode({
      title,
      content,
      metadata,
      supertagId,
      fieldMappings,
      isSelection
    });

    const payload = {
      targetNodeId: targetNodeId || 'INBOX',
      nodes: [node]
    };

    return this.sendRequest(payload);
  }

  /**
   * Build a Tana node object
   */
  buildNode({ title, content, metadata, supertagId, fieldMappings, isSelection }) {
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
        node.children.push(this.createField(fieldMappings.author, metadata.author));
      }

      // URL
      if (metadata.url && fieldMappings.url) {
        node.children.push(this.createField(fieldMappings.url, metadata.url, 'url'));
      }

      // Publication
      if (metadata.publication && fieldMappings.publication) {
        node.children.push(this.createField(fieldMappings.publication, metadata.publication));
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
