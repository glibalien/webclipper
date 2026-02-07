// Popup script for Tana Web Clipper

import { TanaClient } from '../scripts/tana-api.js';

class TanaClipperPopup {
  constructor() {
    this.elements = {};
    this.metadata = null;
    this.hasSelection = false;
    this.settings = null;
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

      // Use TanaClient to build payload and send to API
      const client = new TanaClient(this.settings.apiToken);
      const supertagId = this.elements.supertagSelect.value;

      const result = await client.clip({
        title: this.metadata.title,
        content: contentResponse.content,
        metadata: this.metadata,
        supertagId,
        fieldMappings: this.settings.fieldMappings,
        isSelection: clipSelectionOnly
      });

      if (result.success) {
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
