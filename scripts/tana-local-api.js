// Tana Local API Client for Web Clipper (MCP)

const MCP_ENDPOINT = 'http://localhost:8262/mcp';
const HEALTH_ENDPOINT = 'http://localhost:8262/health';
const MAX_CONTENT_LENGTH = 4500;
const MCP_SESSION_KEY = 'mcpSessionId';

/**
 * MCP protocol transport — JSON-RPC 2.0 over HTTP
 */
class McpClient {
  constructor() {
    this.endpoint = MCP_ENDPOINT;
    this.healthEndpoint = HEALTH_ENDPOINT;
    this.sessionId = null;
    this.requestId = 0;
  }

  /**
   * Initialize MCP session with the Tana Local API server.
   * This may trigger a one-time approval modal in Tana Desktop.
   */
  async initialize() {
    const response = await this.rawRequest('initialize', {
      protocolVersion: '2025-03-26',
      clientInfo: {
        name: 'tana-web-clipper',
        version: '2.0.0'
      },
      capabilities: {}
    });

    // Capture session ID from response header
    if (response.headers) {
      const sid = response.headers.get('Mcp-Session-Id');
      if (sid) {
        this.sessionId = sid;
        await chrome.storage.local.set({ [MCP_SESSION_KEY]: sid });
      }
    }

    // Send initialized notification
    await this.rawNotification('notifications/initialized', {});

    return response.data;
  }

  /**
   * Send a JSON-RPC request and return parsed result
   */
  async sendRequest(method, params) {
    if (!this.sessionId) {
      await this.restoreSession();
    }

    try {
      const response = await this.rawRequest(method, params);
      return response.data;
    } catch (error) {
      // If 401, re-initialize and retry once
      if (error.status === 401) {
        await this.initialize();
        const response = await this.rawRequest(method, params);
        return response.data;
      }
      throw error;
    }
  }

  /**
   * Call an MCP tool by name
   */
  async callTool(toolName, args) {
    const result = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args
    });

    // Extract text content from MCP result format
    if (result?.result?.content) {
      const textParts = result.result.content
        .filter(c => c.type === 'text')
        .map(c => c.text);
      return textParts.join('\n');
    }

    return result;
  }

  /**
   * Check if the MCP server is reachable
   */
  async checkHealth() {
    try {
      const response = await fetch(this.healthEndpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });
      return { available: response.ok };
    } catch {
      return { available: false };
    }
  }

  /**
   * Restore a previously saved MCP session, re-initialize if stale
   */
  async restoreSession() {
    const stored = await chrome.storage.local.get(MCP_SESSION_KEY);
    if (stored[MCP_SESSION_KEY]) {
      this.sessionId = stored[MCP_SESSION_KEY];
      // Validate with a lightweight call
      try {
        await this.rawRequest('ping', {});
        return;
      } catch {
        // Session stale, re-initialize
      }
    }
    await this.initialize();
  }

  /**
   * Low-level JSON-RPC request
   */
  async rawRequest(method, params) {
    this.requestId++;
    const body = {
      jsonrpc: '2.0',
      id: this.requestId,
      method,
      params
    };

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = new Error(`MCP request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`MCP error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    return { data, headers: response.headers };
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  async rawNotification(method, params) {
    const body = {
      jsonrpc: '2.0',
      method,
      params
    };

    const headers = {
      'Content-Type': 'application/json'
    };
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  }
}

/**
 * Tana Paste format builder
 * Produces %%tana%% formatted strings for import
 */
class TanaPasteBuilder {
  /**
   * Build a complete Tana Paste clip
   */
  buildClip({ title, content, metadata, tagName, tagId, fieldMappings, isSelection }) {
    const lines = ['%%tana%%'];
    const sanitizedTitle = this.sanitizeForTanaPaste(title || 'Untitled');
    const nodeName = isSelection ? `Selection from: ${sanitizedTitle}` : sanitizedTitle;

    // Main node with tag
    if (tagId) {
      lines.push(`- ${nodeName} #[[${tagName}^${tagId}]]`);
    } else {
      lines.push(`- ${nodeName}`);
    }

    // Add metadata fields
    if (fieldMappings) {
      // Author
      if (metadata.author && fieldMappings.authorFieldName) {
        const authorLines = this.formatAuthorValue(
          metadata.author,
          fieldMappings.authorType === 'reference' ? fieldMappings.authorTagName : null
        );
        if (Array.isArray(authorLines)) {
          lines.push(`  - ${fieldMappings.authorFieldName}::`);
          for (const line of authorLines) {
            lines.push(`    - ${line}`);
          }
        } else {
          lines.push(`  - ${fieldMappings.authorFieldName}:: ${authorLines}`);
        }
      }

      // URL
      if (metadata.url && fieldMappings.urlFieldName) {
        lines.push(`  - ${fieldMappings.urlFieldName}:: ${this.formatUrlValue(title, metadata.url)}`);
      }

      // Published Date
      if (metadata.publishedDate && fieldMappings.dateFieldName) {
        const dateVal = this.formatDateValue(metadata.publishedDate);
        if (dateVal) {
          lines.push(`  - ${fieldMappings.dateFieldName}:: ${dateVal}`);
        }
      }

      // Publication
      if (metadata.publication && fieldMappings.publicationFieldName) {
        const pubVal = this.formatPublicationValue(
          metadata.publication,
          fieldMappings.publicationType === 'reference' ? fieldMappings.publicationTagName : null
        );
        lines.push(`  - ${fieldMappings.publicationFieldName}:: ${pubVal}`);
      }
    }

    // Add content as child nodes
    if (content) {
      const paragraphs = Array.isArray(content) ? content : [content];
      for (const paragraph of paragraphs) {
        const sanitized = this.sanitizeForTanaPaste(paragraph);
        if (sanitized) {
          if (sanitized.length > MAX_CONTENT_LENGTH) {
            const chunks = this.chunkContent(sanitized);
            for (const chunk of chunks) {
              lines.push(`  - ${chunk}`);
            }
          } else {
            lines.push(`  - ${sanitized}`);
          }
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Format author value — supports multi-author parsing
   * Returns a string for single author or array of strings for multiple
   */
  formatAuthorValue(authorString, authorTagName) {
    const authors = this.parseAuthors(authorString);
    if (authors.length === 0) return this.sanitizeForTanaPaste(authorString);

    const formatted = authors.map(author => {
      const name = this.sanitizeForTanaPaste(author);
      if (authorTagName) {
        return `[[${name} #[[${authorTagName}]]]]`;
      }
      return name;
    });

    if (formatted.length === 1) {
      return formatted[0];
    }
    // Multiple authors: return as array for indented children
    return formatted;
  }

  /**
   * Format date as Tana date reference
   */
  formatDateValue(dateStr) {
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return `[[date:${date.toISOString().split('T')[0]}]]`;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Format URL as markdown link
   */
  formatUrlValue(title, url) {
    return `[${this.sanitizeForTanaPaste(title || url)}](${url})`;
  }

  /**
   * Format publication as reference or plain text
   */
  formatPublicationValue(name, tagName) {
    const sanitized = this.sanitizeForTanaPaste(name);
    if (tagName) {
      return `[[${sanitized} #[[${tagName}]]]]`;
    }
    return sanitized;
  }

  /**
   * Sanitize text for Tana Paste (no newlines allowed in node names)
   */
  sanitizeForTanaPaste(text) {
    return text.replace(/[\r\n]+/g, ' ').trim();
  }

  /**
   * Split content into chunks at natural break points
   */
  chunkContent(content) {
    const chunks = [];
    let remaining = content;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_CONTENT_LENGTH) {
        chunks.push(this.sanitizeForTanaPaste(remaining));
        break;
      }

      const breakPoint = this.findBreakPoint(remaining, MAX_CONTENT_LENGTH);
      chunks.push(this.sanitizeForTanaPaste(remaining.substring(0, breakPoint).trim()));
      remaining = remaining.substring(breakPoint).trim();
    }

    return chunks;
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

    // Hard cut
    return maxLength;
  }

  /**
   * Parse author string into individual authors
   */
  parseAuthors(authorString) {
    let normalized = authorString.trim();
    normalized = normalized.replace(/\s+and\s+/gi, ', ');
    normalized = normalized.replace(/\s*&\s*/g, ', ');

    return normalized
      .split(',')
      .map(author => author.trim())
      .filter(author => author.length > 0);
  }
}

/**
 * High-level Tana Local API client
 * Replaces TanaClient — no API token needed
 */
class TanaLocalClient {
  constructor() {
    this.mcp = new McpClient();
    this.builder = new TanaPasteBuilder();
  }

  /**
   * Clip content to Tana via Local API
   */
  async clip({ title, content, metadata, tagName, tagId, fieldMappings, isSelection }) {
    const tanaPaste = this.builder.buildClip({
      title,
      content,
      metadata,
      tagName,
      tagId,
      fieldMappings,
      isSelection
    });

    console.log('Tana Paste payload:', tanaPaste);

    try {
      const result = await this.mcp.callTool('import_tana_paste', { content: tanaPaste });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Test the connection to the local MCP server
   */
  async testConnection() {
    const health = await this.mcp.checkHealth();
    if (!health.available) {
      return { success: false, error: 'Tana Desktop is not running or Local API is not enabled' };
    }

    try {
      await this.mcp.initialize();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * List available workspaces
   */
  async listWorkspaces() {
    const result = await this.mcp.callTool('list_workspaces', {});
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }

  /**
   * List tags in a workspace
   */
  async listTags(workspaceId) {
    const result = await this.mcp.callTool('list_tags', { workspaceId });
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }

  /**
   * Get the field schema for a tag
   */
  async getTagSchema(tagId) {
    const result = await this.mcp.callTool('get_tag_schema', { tagId });
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }
}

export { McpClient, TanaPasteBuilder, TanaLocalClient };
export default TanaLocalClient;
