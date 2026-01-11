/**
 * Simplified Readability implementation for Tana Web Clipper
 * Based on common article extraction patterns
 */

(function(global) {
  'use strict';

  // Elements that are unlikely to contain main content
  const UNLIKELY_CANDIDATES = /banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-hierarchical|navigation|masthead|media-credit/i;

  // Elements that might contain main content
  const OK_MAYBE_CANDIDATES = /and|article|body|column|content|main|shadow/i;

  // Positive indicators for content
  const POSITIVE_PATTERNS = /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i;

  // Negative indicators for content
  const NEGATIVE_PATTERNS = /hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i;

  class Readability {
    constructor(doc, options = {}) {
      this._doc = doc;
      this._options = {
        charThreshold: options.charThreshold || 500,
        classesToPreserve: options.classesToPreserve || ['page'],
        ...options
      };
    }

    parse() {
      // Clone the document to avoid modifying the original
      const doc = this._doc.cloneNode(true);

      // Remove script, style, and other non-content elements
      this._removeUnwantedElements(doc);

      // Try to find the article content
      const article = this._grabArticle(doc);

      if (!article) {
        return null;
      }

      // Get metadata
      const metadata = this._getArticleMetadata(this._doc);

      return {
        title: metadata.title,
        byline: metadata.byline,
        content: article.innerHTML,
        textContent: article.textContent,
        length: article.textContent.length,
        excerpt: metadata.excerpt,
        siteName: metadata.siteName
      };
    }

    _removeUnwantedElements(doc) {
      const tagsToRemove = [
        'script', 'style', 'noscript', 'iframe', 'form',
        'svg', 'canvas', 'button', 'input', 'select', 'textarea'
      ];

      tagsToRemove.forEach(tag => {
        const elements = doc.querySelectorAll(tag);
        elements.forEach(el => el.remove());
      });

      // Remove hidden elements
      const hidden = doc.querySelectorAll('[hidden], [style*="display: none"], [style*="display:none"]');
      hidden.forEach(el => el.remove());
    }

    _grabArticle(doc) {
      // Try semantic elements first
      const semanticSelectors = [
        'article',
        '[role="main"]',
        'main',
        '.post-content',
        '.article-content',
        '.article-body',
        '.entry-content',
        '.story-body',
        '.post-body',
        '#article-body',
        '.content-body'
      ];

      for (const selector of semanticSelectors) {
        const element = doc.querySelector(selector);
        if (element && this._getTextLength(element) > this._options.charThreshold) {
          return this._cleanArticle(element);
        }
      }

      // Score candidates
      const candidates = this._getCandidates(doc);

      if (candidates.length === 0) {
        // Fallback: return body content
        const body = doc.body;
        if (body) {
          return this._cleanArticle(body);
        }
        return null;
      }

      // Sort by score and return the best candidate
      candidates.sort((a, b) => b.score - a.score);
      return this._cleanArticle(candidates[0].element);
    }

    _getCandidates(doc) {
      const candidates = [];
      const elements = doc.querySelectorAll('div, section, article, p');

      elements.forEach(element => {
        const score = this._scoreElement(element);
        if (score > 0) {
          candidates.push({ element, score });
        }
      });

      return candidates;
    }

    _scoreElement(element) {
      let score = 0;
      const className = element.className || '';
      const id = element.id || '';
      const tagName = element.tagName.toLowerCase();

      // Check for unlikely candidates
      if (UNLIKELY_CANDIDATES.test(className + ' ' + id)) {
        if (!OK_MAYBE_CANDIDATES.test(className + ' ' + id)) {
          return 0;
        }
      }

      // Positive patterns
      if (POSITIVE_PATTERNS.test(className + ' ' + id)) {
        score += 25;
      }

      // Negative patterns
      if (NEGATIVE_PATTERNS.test(className + ' ' + id)) {
        score -= 25;
      }

      // Tag bonuses
      if (tagName === 'article') score += 50;
      if (tagName === 'section') score += 10;
      if (tagName === 'div') score += 5;

      // Text content scoring
      const textLength = this._getTextLength(element);
      if (textLength > 100) score += Math.min(textLength / 100, 50);

      // Paragraph density
      const paragraphs = element.querySelectorAll('p');
      score += paragraphs.length * 3;

      // Link density penalty
      const linkDensity = this._getLinkDensity(element);
      if (linkDensity > 0.5) score -= 50;

      return score;
    }

    _getTextLength(element) {
      return element.textContent.trim().length;
    }

    _getLinkDensity(element) {
      const textLength = this._getTextLength(element);
      if (textLength === 0) return 1;

      const links = element.querySelectorAll('a');
      let linkLength = 0;
      links.forEach(link => {
        linkLength += link.textContent.length;
      });

      return linkLength / textLength;
    }

    _cleanArticle(article) {
      const clone = article.cloneNode(true);

      // Remove unwanted elements
      const removeSelectors = [
        'nav', 'header', 'footer', 'aside',
        '.nav', '.navigation', '.menu', '.sidebar',
        '.comments', '.comment', '.related', '.social', '.share',
        '.ad', '.ads', '.advertisement',
        '[role="navigation"]', '[role="complementary"]'
      ];

      removeSelectors.forEach(selector => {
        clone.querySelectorAll(selector).forEach(el => el.remove());
      });

      return clone;
    }

    _getArticleMetadata(doc) {
      const metadata = {
        title: '',
        byline: '',
        excerpt: '',
        siteName: ''
      };

      // Title
      const ogTitle = doc.querySelector('meta[property="og:title"]');
      const twitterTitle = doc.querySelector('meta[name="twitter:title"]');
      metadata.title = (ogTitle?.content || twitterTitle?.content || doc.title || '').trim();

      // Byline/Author
      const authorMeta = doc.querySelector('meta[name="author"]');
      const articleAuthor = doc.querySelector('meta[property="article:author"]');
      metadata.byline = (authorMeta?.content || articleAuthor?.content || '').trim();

      // Excerpt
      const description = doc.querySelector('meta[name="description"]');
      const ogDescription = doc.querySelector('meta[property="og:description"]');
      metadata.excerpt = (description?.content || ogDescription?.content || '').trim();

      // Site name
      const ogSiteName = doc.querySelector('meta[property="og:site_name"]');
      metadata.siteName = (ogSiteName?.content || '').trim();

      return metadata;
    }
  }

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Readability;
  } else {
    global.Readability = Readability;
  }

})(typeof window !== 'undefined' ? window : this);
