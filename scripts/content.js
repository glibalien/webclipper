// Content script for Tana Web Clipper
// Extracts page content and metadata

(function() {
  // Prevent multiple injections
  if (window.__tanaClipperInjected) return;
  window.__tanaClipperInjected = true;

  /**
   * Extract metadata from the current page
   */
  function extractMetadata() {
    const metadata = {
      title: extractTitle(),
      author: extractAuthor(),
      publication: extractPublication(),
      publishedDate: extractPublishedDate(),
      url: extractUrl(),
      description: extractDescription()
    };

    return metadata;
  }

  /**
   * Extract page title
   */
  function extractTitle() {
    // Try various sources in order of preference
    const sources = [
      () => document.querySelector('meta[property="og:title"]')?.content,
      () => document.querySelector('meta[name="twitter:title"]')?.content,
      () => document.querySelector('h1')?.textContent?.trim(),
      () => document.title
    ];

    for (const source of sources) {
      const value = source();
      if (value) return value.trim();
    }

    return document.title || 'Untitled';
  }

  /**
   * Extract author name
   */
  function extractAuthor() {
    const sources = [
      // JSON-LD first - most reliable structured data
      () => {
        const jsonLd = getJsonLd();
        if (jsonLd?.author) {
          if (typeof jsonLd.author === 'string' && !isUrl(jsonLd.author)) {
            return jsonLd.author;
          }
          if (jsonLd.author.name) return jsonLd.author.name;
          if (Array.isArray(jsonLd.author)) {
            const names = jsonLd.author
              .map(a => typeof a === 'string' ? a : a?.name)
              .filter(n => n && !isUrl(n));
            if (names.length > 0) return names.join(', ');
          }
        }
        return null;
      },

      // Meta tags - but validate they're not URLs
      () => {
        const value = document.querySelector('meta[name="author"]')?.content;
        return value && !isUrl(value) ? value : null;
      },
      () => {
        // article:author often contains URLs (e.g., NYT), try to extract name from URL path
        const value = document.querySelector('meta[property="article:author"]')?.content;
        if (!value) return null;
        if (!isUrl(value)) return value;
        // Try to extract author name from URL path like /by/author-name
        return extractAuthorFromUrl(value);
      },
      () => {
        const value = document.querySelector('meta[name="twitter:creator"]')?.content;
        // Twitter handles start with @, which is fine
        return value && !isUrl(value) ? value : null;
      },

      // Common selectors
      () => document.querySelector('[rel="author"]')?.textContent?.trim(),
      () => document.querySelector('.author-name')?.textContent?.trim(),
      () => document.querySelector('.byline')?.textContent?.trim()?.replace(/^by\s+/i, ''),
      () => document.querySelector('[itemprop="author"]')?.textContent?.trim()
    ];

    for (const source of sources) {
      try {
        const value = source();
        if (value) return cleanText(value);
      } catch (e) {
        continue;
      }
    }

    return null;
  }

  /**
   * Check if a string is a URL
   */
  function isUrl(str) {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Try to extract author name from a URL path (e.g., /by/john-doe -> John Doe)
   */
  function extractAuthorFromUrl(url) {
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(Boolean);

      // Look for patterns like /by/author-name or /author/author-name
      const byIndex = pathParts.findIndex(p => p === 'by' || p === 'author' || p === 'authors');
      if (byIndex !== -1 && pathParts[byIndex + 1]) {
        const slug = pathParts[byIndex + 1];
        // Convert slug to name: "john-doe" -> "John Doe"
        return slug
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract publication/site name
   */
  function extractPublication() {
    const sources = [
      () => document.querySelector('meta[property="og:site_name"]')?.content,

      // JSON-LD publisher
      () => {
        const jsonLd = getJsonLd();
        if (jsonLd?.publisher) {
          if (typeof jsonLd.publisher === 'string') return jsonLd.publisher;
          if (jsonLd.publisher.name) return jsonLd.publisher.name;
        }
        return null;
      },

      // Application name
      () => document.querySelector('meta[name="application-name"]')?.content,

      // Fallback to domain
      () => {
        const hostname = window.location.hostname;
        return hostname.replace(/^www\./, '');
      }
    ];

    for (const source of sources) {
      try {
        const value = source();
        if (value) return value.trim();
      } catch (e) {
        continue;
      }
    }

    return null;
  }

  /**
   * Extract published date
   */
  function extractPublishedDate() {
    const sources = [
      () => document.querySelector('meta[property="article:published_time"]')?.content,
      () => document.querySelector('meta[name="publish-date"]')?.content,
      () => document.querySelector('meta[name="date"]')?.content,
      () => document.querySelector('time[datetime]')?.getAttribute('datetime'),
      () => document.querySelector('[itemprop="datePublished"]')?.getAttribute('content'),
      () => document.querySelector('[itemprop="datePublished"]')?.getAttribute('datetime'),

      // JSON-LD
      () => {
        const jsonLd = getJsonLd();
        return jsonLd?.datePublished || jsonLd?.dateCreated;
      }
    ];

    for (const source of sources) {
      try {
        const value = source();
        if (value) {
          // Try to parse and format the date
          return formatDate(value);
        }
      } catch (e) {
        continue;
      }
    }

    return null;
  }

  /**
   * Extract canonical URL
   */
  function extractUrl() {
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    const ogUrl = document.querySelector('meta[property="og:url"]')?.content;
    return canonical || ogUrl || window.location.href;
  }

  /**
   * Extract description
   */
  function extractDescription() {
    const sources = [
      () => document.querySelector('meta[property="og:description"]')?.content,
      () => document.querySelector('meta[name="description"]')?.content,
      () => document.querySelector('meta[name="twitter:description"]')?.content
    ];

    for (const source of sources) {
      const value = source();
      if (value) return value.trim();
    }

    return null;
  }

  /**
   * Get JSON-LD structured data
   */
  function getJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');

    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);

        // Handle @graph structure
        if (data['@graph']) {
          const article = data['@graph'].find(item =>
            item['@type'] === 'Article' ||
            item['@type'] === 'NewsArticle' ||
            item['@type'] === 'BlogPosting'
          );
          if (article) return article;
        }

        // Direct article type
        if (data['@type'] === 'Article' ||
            data['@type'] === 'NewsArticle' ||
            data['@type'] === 'BlogPosting') {
          return data;
        }
      } catch (e) {
        continue;
      }
    }

    return null;
  }

  /**
   * Format date string
   */
  function formatDate(dateStr) {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;

      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch (e) {
      return dateStr;
    }
  }

  /**
   * Clean text by removing extra whitespace
   */
  function cleanText(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Check if there's a text selection
   */
  function hasSelection() {
    const selection = window.getSelection();
    return selection && selection.toString().trim().length > 0;
  }

  /**
   * Get selected content as array of paragraphs
   */
  function getSelectedContent() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return [];

    const range = selection.getRangeAt(0);
    const container = document.createElement('div');
    container.appendChild(range.cloneContents());

    // Extract as paragraphs
    return extractParagraphs(container);
  }

  /**
   * Get full article content using simple extraction
   * (Readability will be used separately if needed)
   */
  function getFullContent() {
    // Try to find article content
    const articleSelectors = [
      'article',
      '[role="main"]',
      'main',
      '.post-content',
      '.article-content',
      '.entry-content',
      '.content',
      '#content'
    ];

    for (const selector of articleSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const clone = element.cloneNode(true);
        removeUnwantedElements(clone);
        return extractParagraphs(clone);
      }
    }

    // Fallback to body, but try to exclude navigation, footer, etc.
    const body = document.body.cloneNode(true);
    removeUnwantedElements(body);
    return extractParagraphs(body);
  }

  /**
   * Extract content as an array of paragraphs
   */
  function extractParagraphs(element) {
    const paragraphs = [];

    // Find all paragraph-like elements
    const paragraphSelectors = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre';
    const elements = element.querySelectorAll(paragraphSelectors);

    elements.forEach(el => {
      // Skip if element is inside an element we'd normally remove
      if (el.closest('script, style, noscript, nav, header, footer')) return;

      const text = el.textContent?.trim();
      // Skip empty paragraphs or very short ones (likely UI elements)
      if (text && text.length > 10) {
        paragraphs.push(cleanText(text));
      }
    });

    // If no paragraphs found, fall back to text extraction
    if (paragraphs.length === 0) {
      const fullText = cleanHtmlToText(element);
      if (fullText) {
        // Split by double newlines to create paragraphs
        return fullText.split(/\n\n+/).filter(p => p.trim().length > 10);
      }
    }

    return paragraphs;
  }

  /**
   * Selectors for elements to remove from content
   */
  const REMOVE_SELECTORS = [
    // Navigation and layout
    'nav', 'header', 'footer', 'aside',
    '.nav', '.navigation', '.menu', '.sidebar',
    '.comments', '.related', '.social', '.share',

    // Scripts and styles
    'script', 'style', 'noscript', 'iframe',

    // Advertising and promotions
    '.ad', '.ads', '.advert', '.advertisement', '.advertising',
    '[class*="ad-"]', '[class*="ad_"]', '[class*="-ad"]', '[class*="_ad"]',
    '[class*="advert"]', '[class*="sponsor"]', '[class*="promo"]',
    '[id*="ad-"]', '[id*="ad_"]', '[id*="-ad"]', '[id*="_ad"]',
    '[id*="advert"]', '[id*="sponsor"]', '[id*="promo"]',
    '[data-ad]', '[data-advertisement]', '[data-ad-unit]',
    '.dfp', '.google-ad', '.googletag', '.gpt-ad',
    '.promoted', '.promotional', '.sponsored', '.sponsor-content',
    '.native-ad', '.paid-content', '.partner-content',

    // NYT specific ad selectors
    '.story-ad', '.ad-wrapper', '.ad-container', '.ad-slot',
    '[data-testid*="ad"]', '[aria-label*="advertisement"]',

    // Newsletter/subscription prompts
    '.newsletter', '.subscribe', '.subscription',
    '.paywall', '.registration-wall',
    '[class*="newsletter"]', '[class*="subscribe"]',

    // Social/sharing widgets
    '.share-tools', '.social-tools', '.sharing',

    // Modals and popups
    '.modal', '.popup', '.overlay',

    // Recommended/related content
    '.recommended', '.more-stories', '.related-articles',
    '.trending', '.popular', '.also-read'
  ];

  /**
   * Remove unwanted elements from a cloned DOM tree
   */
  function removeUnwantedElements(element) {
    REMOVE_SELECTORS.forEach(selector => {
      try {
        element.querySelectorAll(selector).forEach(el => el.remove());
      } catch (e) {
        // Invalid selector, skip
      }
    });
  }

  /**
   * Convert HTML element to clean text
   */
  function cleanHtmlToText(element) {
    // Clone to avoid modifying original
    const clone = element.cloneNode(true);

    // Remove script and style elements
    clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());

    // Get text content, preserving paragraph breaks
    let text = '';
    const walker = document.createTreeWalker(
      clone,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      null,
      false
    );

    let node;
    const blockElements = new Set([
      'P', 'DIV', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'LI', 'TR', 'BLOCKQUOTE', 'PRE', 'HR'
    ]);

    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const content = node.textContent.trim();
        if (content) {
          text += content + ' ';
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (blockElements.has(node.tagName)) {
          text = text.trim() + '\n\n';
        }
      }
    }

    // Clean up multiple newlines and spaces
    return text
      .replace(/\n{3,}/g, '\n\n')
      .replace(/ +/g, ' ')
      .trim();
  }

  /**
   * Message handler
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getMetadata') {
      sendResponse({
        metadata: extractMetadata(),
        hasSelection: hasSelection()
      });
      return true;
    }

    if (request.action === 'getContent') {
      const content = request.selectionOnly && hasSelection()
        ? getSelectedContent()
        : getFullContent();

      sendResponse({ content });
      return true;
    }

    if (request.action === 'checkSelection') {
      sendResponse({ hasSelection: hasSelection() });
      return true;
    }

    return false;
  });

})();
