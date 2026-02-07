// Options page script for Tana Web Clipper (Local API)

import TanaLocalClient from '../scripts/tana-local-api.js';

class TanaClipperOptions {
  constructor() {
    this.elements = {};
    this.client = new TanaLocalClient();
    this.selectedTags = [];   // [{name, id}]
    this.allTags = [];        // full list from API
    this.tagSchemas = {};     // tagId -> schema fields
    this.workspaceId = null;
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    await this.loadSettings();
    this.updateShortcutDisplay();
    await this.checkConnection();
  }

  cacheElements() {
    this.elements = {
      connectionDot: document.getElementById('connection-dot'),
      connectionText: document.getElementById('connection-text'),
      connectBtn: document.getElementById('connect-btn'),
      testConnection: document.getElementById('test-connection'),
      connectionStatus: document.getElementById('connection-status'),
      workspaceSection: document.getElementById('workspace-section'),
      workspaceSelect: document.getElementById('workspace-select'),
      refreshWorkspaces: document.getElementById('refresh-workspaces'),
      tagsSection: document.getElementById('tags-section'),
      tagFilter: document.getElementById('tag-filter'),
      tagsList: document.getElementById('tags-list'),
      refreshTags: document.getElementById('refresh-tags'),
      fieldMappingsSection: document.getElementById('field-mappings-section'),
      fieldMappingsContainer: document.getElementById('field-mappings-container'),
      shortcutDisplay: document.getElementById('shortcut-display'),
      shortcutsLink: document.getElementById('shortcuts-link'),
      saveSettings: document.getElementById('save-settings'),
      saveStatus: document.getElementById('save-status')
    };
  }

  bindEvents() {
    this.elements.connectBtn.addEventListener('click', () => this.connect());
    this.elements.testConnection.addEventListener('click', () => this.testConnection());
    this.elements.refreshWorkspaces.addEventListener('click', () => this.loadWorkspaces());
    this.elements.refreshTags.addEventListener('click', () => this.loadTags());
    this.elements.tagFilter.addEventListener('input', () => this.filterTags());

    this.elements.workspaceSelect.addEventListener('change', () => {
      this.workspaceId = this.elements.workspaceSelect.value;
      if (this.workspaceId) {
        this.loadTags();
      }
    });

    this.elements.shortcutsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });

    this.elements.saveSettings.addEventListener('click', () => this.saveSettings());
  }

  async loadSettings() {
    const result = await chrome.storage.sync.get([
      'workspaceId',
      'supertags',
      'fieldMappings'
    ]);

    this.workspaceId = result.workspaceId || null;
    this.selectedTags = result.supertags || [];

    // Restore field mappings into tagSchemas for later rendering
    if (result.fieldMappings) {
      this.savedFieldMappings = result.fieldMappings;
    }
  }

  // --- Connection ---

  async checkConnection() {
    const health = await this.client.mcp.checkHealth();
    if (health.available) {
      try {
        await this.client.mcp.restoreSession();
        this.setConnected(true);
        await this.loadWorkspaces();
      } catch {
        this.setConnected(false);
      }
    } else {
      this.setConnected(false);
    }
  }

  async connect() {
    this.elements.connectBtn.disabled = true;
    this.elements.connectBtn.textContent = 'Connecting...';
    this.showStatus(this.elements.connectionStatus, '', '');

    try {
      const health = await this.client.mcp.checkHealth();
      if (!health.available) {
        this.showStatus(this.elements.connectionStatus,
          'Tana Desktop is not running or Local API is not enabled', 'error');
        return;
      }

      this.showStatus(this.elements.connectionStatus,
        'Waiting for approval in Tana Desktop...', '');
      await this.client.mcp.initialize();
      this.setConnected(true);
      this.showStatus(this.elements.connectionStatus, 'Connected!', 'success');
      await this.loadWorkspaces();
    } catch (error) {
      this.setConnected(false);
      this.showStatus(this.elements.connectionStatus,
        `Connection failed: ${error.message}`, 'error');
    } finally {
      this.elements.connectBtn.disabled = false;
      this.elements.connectBtn.textContent = 'Connect to Tana';
    }
  }

  async testConnection() {
    this.elements.testConnection.disabled = true;
    this.elements.testConnection.textContent = 'Testing...';
    this.showStatus(this.elements.connectionStatus, '', '');

    try {
      const result = await this.client.testConnection();
      if (result.success) {
        this.setConnected(true);
        this.showStatus(this.elements.connectionStatus, 'Connection successful!', 'success');
      } else {
        this.setConnected(false);
        this.showStatus(this.elements.connectionStatus, result.error, 'error');
      }
    } catch (error) {
      this.setConnected(false);
      this.showStatus(this.elements.connectionStatus, error.message, 'error');
    } finally {
      this.elements.testConnection.disabled = false;
      this.elements.testConnection.textContent = 'Test Connection';
    }
  }

  setConnected(connected) {
    this.elements.connectionDot.className = `connection-dot ${connected ? 'connected' : 'disconnected'}`;
    this.elements.connectionText.textContent = connected ? 'Connected' : 'Not connected';

    // Show/hide dependent sections
    this.elements.workspaceSection.style.display = connected ? '' : 'none';
  }

  // --- Workspaces ---

  async loadWorkspaces() {
    this.elements.workspaceSelect.innerHTML = '<option value="">Loading...</option>';

    try {
      const workspaces = await this.client.listWorkspaces();
      this.elements.workspaceSelect.innerHTML = '<option value="">Select a workspace</option>';

      if (Array.isArray(workspaces)) {
        for (const ws of workspaces) {
          const option = document.createElement('option');
          option.value = ws.id;
          option.textContent = ws.name;
          this.elements.workspaceSelect.appendChild(option);
        }
      }

      // Restore saved workspace
      if (this.workspaceId) {
        this.elements.workspaceSelect.value = this.workspaceId;
      }

      // If workspace selected, load tags
      if (this.elements.workspaceSelect.value) {
        this.workspaceId = this.elements.workspaceSelect.value;
        await this.loadTags();
      }
    } catch (error) {
      this.elements.workspaceSelect.innerHTML = '<option value="">Failed to load workspaces</option>';
      console.error('Failed to load workspaces:', error);
    }
  }

  // --- Tags ---

  async loadTags() {
    if (!this.workspaceId) return;

    this.elements.tagsSection.style.display = '';
    this.elements.tagsList.innerHTML = '<div class="tags-loading">Loading tags...</div>';

    try {
      const tags = await this.client.listTags(this.workspaceId);
      this.allTags = Array.isArray(tags) ? tags : [];
      this.renderTags();
    } catch (error) {
      this.elements.tagsList.innerHTML = '<div class="tags-loading">Failed to load tags</div>';
      console.error('Failed to load tags:', error);
    }
  }

  renderTags() {
    const filter = this.elements.tagFilter.value.toLowerCase();
    const filtered = filter
      ? this.allTags.filter(t => t.name.toLowerCase().includes(filter))
      : this.allTags;

    this.elements.tagsList.innerHTML = '';

    if (filtered.length === 0) {
      this.elements.tagsList.innerHTML = '<div class="tags-loading">No tags found</div>';
      return;
    }

    for (const tag of filtered) {
      const isSelected = this.selectedTags.some(t => t.id === tag.id);
      const item = document.createElement('label');
      item.className = `tag-item${isSelected ? ' selected' : ''}`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isSelected;
      checkbox.value = tag.id;
      checkbox.addEventListener('change', () => this.onTagToggle(tag, checkbox.checked));

      const name = document.createElement('span');
      name.className = 'tag-name';
      name.textContent = tag.name;

      item.appendChild(checkbox);
      item.appendChild(name);
      this.elements.tagsList.appendChild(item);
    }
  }

  filterTags() {
    this.renderTags();
  }

  async onTagToggle(tag, checked) {
    if (checked) {
      if (!this.selectedTags.some(t => t.id === tag.id)) {
        this.selectedTags.push({ name: tag.name, id: tag.id });
      }
    } else {
      this.selectedTags = this.selectedTags.filter(t => t.id !== tag.id);
    }

    this.renderTags();
    await this.loadFieldMappings();
  }

  // --- Field Mappings ---

  async loadFieldMappings() {
    if (this.selectedTags.length === 0) {
      this.elements.fieldMappingsSection.style.display = 'none';
      return;
    }

    this.elements.fieldMappingsSection.style.display = '';
    this.elements.fieldMappingsContainer.innerHTML = '<div class="tags-loading">Loading field schemas...</div>';

    // Fetch schemas for all selected tags
    for (const tag of this.selectedTags) {
      if (!this.tagSchemas[tag.id]) {
        try {
          this.tagSchemas[tag.id] = await this.client.getTagSchema(tag.id);
        } catch (error) {
          console.error(`Failed to load schema for ${tag.name}:`, error);
          this.tagSchemas[tag.id] = { fields: [] };
        }
      }
    }

    this.renderFieldMappings();
  }

  renderFieldMappings() {
    this.elements.fieldMappingsContainer.innerHTML = '';

    // Collect all unique fields across selected tags
    const allFields = [];
    for (const tag of this.selectedTags) {
      const schema = this.tagSchemas[tag.id];
      if (schema && Array.isArray(schema.fields)) {
        for (const field of schema.fields) {
          if (!allFields.some(f => f.name === field.name)) {
            allFields.push(field);
          }
        }
      } else if (schema && Array.isArray(schema)) {
        // Schema might be a flat array of fields
        for (const field of schema) {
          if (!allFields.some(f => f.name === field.name)) {
            allFields.push(field);
          }
        }
      }
    }

    const metadataFields = [
      { key: 'authorFieldName', label: 'Author', hasRefType: true, refTypeKey: 'authorType', refTagKey: 'authorTagName' },
      { key: 'urlFieldName', label: 'URL', hasRefType: false },
      { key: 'dateFieldName', label: 'Published Date', hasRefType: false },
      { key: 'publicationFieldName', label: 'Publication', hasRefType: true, refTypeKey: 'publicationType', refTagKey: 'publicationTagName' }
    ];

    const saved = this.savedFieldMappings || {};

    for (const meta of metadataFields) {
      const group = document.createElement('div');
      group.className = 'field-mapping-group';

      const label = document.createElement('label');
      label.textContent = meta.label;
      group.appendChild(label);

      const select = document.createElement('select');
      select.dataset.mappingKey = meta.key;

      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = '(none)';
      select.appendChild(noneOpt);

      for (const field of allFields) {
        const opt = document.createElement('option');
        opt.value = field.name;
        opt.textContent = field.name;
        select.appendChild(opt);
      }

      // Auto-detect or restore saved value
      const savedVal = saved[meta.key] || '';
      if (savedVal && allFields.some(f => f.name === savedVal)) {
        select.value = savedVal;
      } else {
        // Auto-detect by name
        const autoDetected = this.autoDetectField(meta.key, allFields);
        if (autoDetected) select.value = autoDetected;
      }

      group.appendChild(select);

      // Reference type toggle for author/publication
      if (meta.hasRefType) {
        const refRow = document.createElement('div');
        refRow.className = 'ref-type-row';

        const refLabel = document.createElement('label');
        refLabel.className = 'checkbox-label';

        const refCheckbox = document.createElement('input');
        refCheckbox.type = 'checkbox';
        refCheckbox.dataset.refTypeKey = meta.refTypeKey;
        refCheckbox.checked = (saved[meta.refTypeKey] === 'reference');

        const refSpan = document.createElement('span');
        refSpan.textContent = 'Create as tagged reference';

        refLabel.appendChild(refCheckbox);
        refLabel.appendChild(refSpan);
        refRow.appendChild(refLabel);

        const tagInput = document.createElement('input');
        tagInput.type = 'text';
        tagInput.dataset.refTagKey = meta.refTagKey;
        tagInput.placeholder = `Tag name (e.g., ${meta.key === 'authorFieldName' ? 'person' : 'publication'})`;
        tagInput.value = saved[meta.refTagKey] || '';
        tagInput.style.display = refCheckbox.checked ? '' : 'none';

        refCheckbox.addEventListener('change', () => {
          tagInput.style.display = refCheckbox.checked ? '' : 'none';
        });

        refRow.appendChild(tagInput);
        group.appendChild(refRow);
      }

      this.elements.fieldMappingsContainer.appendChild(group);
    }
  }

  autoDetectField(mappingKey, fields) {
    const names = fields.map(f => f.name.toLowerCase());
    const fieldNames = fields.map(f => f.name);

    const matchers = {
      authorFieldName: ['author', 'authors', 'writer', 'by'],
      urlFieldName: ['url', 'link', 'source url', 'web'],
      dateFieldName: ['date', 'published', 'published date', 'publish date', 'created'],
      publicationFieldName: ['publication', 'source', 'publisher', 'site']
    };

    const patterns = matchers[mappingKey] || [];
    for (const pattern of patterns) {
      const idx = names.indexOf(pattern);
      if (idx !== -1) return fieldNames[idx];
    }
    return null;
  }

  // --- Save ---

  async saveSettings() {
    // Gather field mappings from DOM
    const fieldMappings = {};
    const selects = this.elements.fieldMappingsContainer.querySelectorAll('select[data-mapping-key]');
    for (const sel of selects) {
      fieldMappings[sel.dataset.mappingKey] = sel.value;
    }

    const refCheckboxes = this.elements.fieldMappingsContainer.querySelectorAll('input[data-ref-type-key]');
    for (const cb of refCheckboxes) {
      fieldMappings[cb.dataset.refTypeKey] = cb.checked ? 'reference' : 'text';
    }

    const tagInputs = this.elements.fieldMappingsContainer.querySelectorAll('input[data-ref-tag-key]');
    for (const input of tagInputs) {
      fieldMappings[input.dataset.refTagKey] = input.value.trim();
    }

    if (this.selectedTags.length === 0) {
      this.showStatus(this.elements.saveStatus, 'Select at least one tag', 'error');
      return;
    }

    const settings = {
      workspaceId: this.workspaceId || '',
      supertags: this.selectedTags,
      fieldMappings
    };

    try {
      await chrome.storage.sync.set(settings);
      this.savedFieldMappings = fieldMappings;
      this.showStatus(this.elements.saveStatus, 'Settings saved!', 'success');
      setTimeout(() => this.showStatus(this.elements.saveStatus, '', ''), 3000);
    } catch (error) {
      this.showStatus(this.elements.saveStatus, 'Failed to save settings', 'error');
    }
  }

  // --- Helpers ---

  async updateShortcutDisplay() {
    try {
      const commands = await chrome.commands.getAll();
      const clipCommand = commands.find(cmd => cmd.name === 'clip-to-tana');
      if (clipCommand?.shortcut) {
        this.elements.shortcutDisplay.textContent = clipCommand.shortcut;
      }
    } catch (error) {
      console.error('Failed to get commands:', error);
    }
  }

  showStatus(element, message, type) {
    element.textContent = message;
    element.className = 'status-inline';
    if (type) element.classList.add(type);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const options = new TanaClipperOptions();
  options.init();
});
