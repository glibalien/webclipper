// Options page script for Tana Web Clipper

class TanaClipperOptions {
  constructor() {
    this.elements = {};
    this.supertags = [];
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    await this.loadSettings();
    this.updateShortcutDisplay();
  }

  cacheElements() {
    this.elements = {
      apiToken: document.getElementById('api-token'),
      toggleToken: document.getElementById('toggle-token'),
      testConnection: document.getElementById('test-connection'),
      connectionStatus: document.getElementById('connection-status'),
      supertagsList: document.getElementById('supertags-list'),
      addSupertag: document.getElementById('add-supertag'),
      supertagTemplate: document.getElementById('supertag-template'),
      fieldAuthor: document.getElementById('field-author'),
      authorTypeText: document.getElementById('author-type-text'),
      authorTypeSupertag: document.getElementById('author-type-supertag'),
      authorSupertagGroup: document.getElementById('author-supertag-group'),
      fieldAuthorSupertag: document.getElementById('field-author-supertag'),
      fieldUrl: document.getElementById('field-url'),
      fieldPublication: document.getElementById('field-publication'),
      fieldDate: document.getElementById('field-date'),
      shortcutDisplay: document.getElementById('shortcut-display'),
      shortcutsLink: document.getElementById('shortcuts-link'),
      saveSettings: document.getElementById('save-settings'),
      saveStatus: document.getElementById('save-status')
    };
  }

  bindEvents() {
    // Toggle token visibility
    this.elements.toggleToken.addEventListener('click', () => {
      const isPassword = this.elements.apiToken.type === 'password';
      this.elements.apiToken.type = isPassword ? 'text' : 'password';
      this.elements.toggleToken.textContent = isPassword ? 'Hide' : 'Show';
    });

    // Test connection
    this.elements.testConnection.addEventListener('click', () => this.testConnection());

    // Add supertag
    this.elements.addSupertag.addEventListener('click', () => this.addSupertag());

    // Author field type toggle
    this.elements.authorTypeText.addEventListener('change', () => this.toggleAuthorSupertagField());
    this.elements.authorTypeSupertag.addEventListener('change', () => this.toggleAuthorSupertagField());

    // Shortcuts link
    this.elements.shortcutsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });

    // Save settings
    this.elements.saveSettings.addEventListener('click', () => this.saveSettings());
  }

  async loadSettings() {
    const result = await chrome.storage.sync.get([
      'apiToken',
      'supertags',
      'fieldMappings'
    ]);

    // API Token
    if (result.apiToken) {
      this.elements.apiToken.value = result.apiToken;
    }

    // Supertags
    this.supertags = result.supertags || [];
    this.renderSupertags();

    // Field mappings
    if (result.fieldMappings) {
      this.elements.fieldAuthor.value = result.fieldMappings.author || '';
      this.elements.fieldUrl.value = result.fieldMappings.url || '';
      this.elements.fieldPublication.value = result.fieldMappings.publication || '';
      this.elements.fieldDate.value = result.fieldMappings.date || '';

      // Author field type
      if (result.fieldMappings.authorFieldType === 'supertag') {
        this.elements.authorTypeSupertag.checked = true;
      } else {
        this.elements.authorTypeText.checked = true;
      }
      this.elements.fieldAuthorSupertag.value = result.fieldMappings.authorSupertagId || '';
      this.toggleAuthorSupertagField();
    }
  }

  toggleAuthorSupertagField() {
    const isSupertag = this.elements.authorTypeSupertag.checked;
    this.elements.authorSupertagGroup.style.display = isSupertag ? 'block' : 'none';
  }

  renderSupertags() {
    this.elements.supertagsList.innerHTML = '';

    this.supertags.forEach((tag, index) => {
      const template = this.elements.supertagTemplate.content.cloneNode(true);
      const item = template.querySelector('.supertag-item');

      item.dataset.index = index;
      item.querySelector('.supertag-number').textContent = `Supertag ${index + 1}`;
      item.querySelector('.supertag-name').value = tag.name || '';
      item.querySelector('.supertag-id').value = tag.id || '';

      // Bind remove button
      item.querySelector('.btn-remove').addEventListener('click', () => {
        this.removeSupertag(index);
      });

      // Bind input changes
      item.querySelector('.supertag-name').addEventListener('input', (e) => {
        this.supertags[index].name = e.target.value;
      });

      item.querySelector('.supertag-id').addEventListener('input', (e) => {
        this.supertags[index].id = e.target.value;
      });

      this.elements.supertagsList.appendChild(template);
    });

    // If no supertags, add one empty one
    if (this.supertags.length === 0) {
      this.addSupertag();
    }
  }

  addSupertag() {
    this.supertags.push({ name: '', id: '' });
    this.renderSupertags();
  }

  removeSupertag(index) {
    if (this.supertags.length <= 1) {
      alert('You must have at least one supertag configured.');
      return;
    }
    this.supertags.splice(index, 1);
    this.renderSupertags();
  }

  async testConnection() {
    const token = this.elements.apiToken.value.trim();
    if (!token) {
      this.showStatus(this.elements.connectionStatus, 'Please enter an API token', 'error');
      return;
    }

    this.elements.testConnection.disabled = true;
    this.elements.testConnection.textContent = 'Testing...';
    this.showStatus(this.elements.connectionStatus, '', '');

    try {
      // Send a minimal test request to Tana
      const response = await fetch(
        'https://europe-west1-tagr-prod.cloudfunctions.net/addToNodeV2',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            targetNodeId: 'INBOX',
            nodes: []
          })
        }
      );

      if (response.ok || response.status === 400) {
        // 400 might mean empty nodes, but auth worked
        this.showStatus(this.elements.connectionStatus, 'Connection successful!', 'success');
      } else if (response.status === 401 || response.status === 403) {
        this.showStatus(this.elements.connectionStatus, 'Invalid API token', 'error');
      } else {
        this.showStatus(this.elements.connectionStatus, `Error: ${response.status}`, 'error');
      }
    } catch (error) {
      this.showStatus(this.elements.connectionStatus, 'Connection failed', 'error');
    } finally {
      this.elements.testConnection.disabled = false;
      this.elements.testConnection.textContent = 'Test Connection';
    }
  }

  async updateShortcutDisplay() {
    try {
      const commands = await chrome.commands.getAll();
      const clipCommand = commands.find(cmd => cmd.name === 'clip-to-tana');
      if (clipCommand && clipCommand.shortcut) {
        this.elements.shortcutDisplay.textContent = clipCommand.shortcut;
      }
    } catch (error) {
      console.error('Failed to get commands:', error);
    }
  }

  async saveSettings() {
    // Validate
    const apiToken = this.elements.apiToken.value.trim();
    if (!apiToken) {
      this.showStatus(this.elements.saveStatus, 'API token is required', 'error');
      return;
    }

    // Filter out empty supertags
    const validSupertags = this.supertags.filter(tag => tag.name && tag.id);
    if (validSupertags.length === 0) {
      this.showStatus(this.elements.saveStatus, 'At least one supertag is required', 'error');
      return;
    }

    const settings = {
      apiToken,
      supertags: validSupertags,
      fieldMappings: {
        author: this.elements.fieldAuthor.value.trim(),
        authorFieldType: this.elements.authorTypeSupertag.checked ? 'supertag' : 'text',
        authorSupertagId: this.elements.fieldAuthorSupertag.value.trim(),
        url: this.elements.fieldUrl.value.trim(),
        publication: this.elements.fieldPublication.value.trim(),
        date: this.elements.fieldDate.value.trim()
      }
    };

    try {
      await chrome.storage.sync.set(settings);
      this.showStatus(this.elements.saveStatus, 'Settings saved!', 'success');

      // Clear status after 3 seconds
      setTimeout(() => {
        this.showStatus(this.elements.saveStatus, '', '');
      }, 3000);
    } catch (error) {
      this.showStatus(this.elements.saveStatus, 'Failed to save settings', 'error');
    }
  }

  showStatus(element, message, type) {
    element.textContent = message;
    element.className = 'status-inline';
    if (type) {
      element.classList.add(type);
    }
  }
}

// Initialize options page
document.addEventListener('DOMContentLoaded', () => {
  const options = new TanaClipperOptions();
  options.init();
});
