// Background service worker for Tana Web Clipper

import TanaLocalClient from './tana-local-api.js';

/**
 * Create context menu items on extension install, run migration on update
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  // Create context menu for page clipping
  chrome.contextMenus.create({
    id: 'clip-page-to-tana',
    title: 'Clip page to Tana',
    contexts: ['page']
  });

  // Create context menu for selection clipping
  chrome.contextMenus.create({
    id: 'clip-selection-to-tana',
    title: 'Clip selection to Tana',
    contexts: ['selection']
  });

  // Create context menu for image clipping
  chrome.contextMenus.create({
    id: 'clip-image-to-tana',
    title: 'Clip image to Tana',
    contexts: ['image']
  });

  // Create context menu for link clipping
  chrome.contextMenus.create({
    id: 'clip-link-to-tana',
    title: 'Clip link to Tana',
    contexts: ['link']
  });

  // v1 -> v2 migration: clean up old storage keys
  if (details.reason === 'update') {
    await chrome.storage.local.remove(['tanaNodeCache']);
    await chrome.storage.sync.remove(['apiToken']);
  }
});

/**
 * Handle context menu clicks
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case 'clip-page-to-tana':
      await clipPage(tab, false);
      break;
    case 'clip-selection-to-tana':
      await clipPage(tab, true);
      break;
    case 'clip-image-to-tana':
      await clipImage(tab, info.srcUrl);
      break;
    case 'clip-link-to-tana':
      await clipLink(tab, info.linkUrl, info.selectionText);
      break;
  }
});

/**
 * Handle keyboard shortcut
 */
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'clip-to-tana') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      // Check if there's a selection first
      await injectContentScript(tab.id);
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'checkSelection' });
        await clipPage(tab, response?.hasSelection || false);
      } catch {
        // If content script not responding, clip full page
        await clipPage(tab, false);
      }
    }
  }
});

/**
 * Inject content script if not already present
 */
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['scripts/content.js']
    });
  } catch (error) {
    console.log('Content script injection:', error.message);
  }
}

/**
 * Get settings and the first tag's name + id
 */
async function getClipSettings() {
  const settings = await chrome.storage.sync.get([
    'supertags',
    'fieldMappings'
  ]);

  if (!settings.supertags?.length) {
    return null;
  }

  return {
    tagId: settings.supertags[0].id,
    tagName: settings.supertags[0].name,
    fieldMappings: settings.fieldMappings
  };
}

/**
 * Clip the current page
 */
async function clipPage(tab, selectionOnly) {
  try {
    const clipSettings = await getClipSettings();
    if (!clipSettings) {
      showNotification('Setup Required', 'Please connect to Tana and select tags in settings.');
      chrome.runtime.openOptionsPage();
      return;
    }

    // Inject content script
    await injectContentScript(tab.id);

    // Get metadata
    const metadataResponse = await chrome.tabs.sendMessage(tab.id, { action: 'getMetadata' });

    if (!metadataResponse?.metadata) {
      showNotification('Error', 'Could not extract page metadata.');
      return;
    }

    // Get content
    const contentResponse = await chrome.tabs.sendMessage(tab.id, {
      action: 'getContent',
      selectionOnly: selectionOnly && metadataResponse.hasSelection
    });

    if (!contentResponse?.content) {
      showNotification('Error', 'Could not extract page content.');
      return;
    }

    // Send to Tana via Local API
    const client = new TanaLocalClient();
    const result = await client.clip({
      title: metadataResponse.metadata.title,
      content: contentResponse.content,
      metadata: metadataResponse.metadata,
      tagId: clipSettings.tagId,
      tagName: clipSettings.tagName,
      fieldMappings: clipSettings.fieldMappings,
      isSelection: selectionOnly && metadataResponse.hasSelection
    });

    if (result.success) {
      showNotification('Success', 'Clipped to Tana!');
    } else {
      showNotification('Error', result.error || 'Failed to clip to Tana.');
    }
  } catch (error) {
    console.error('Clip error:', error);
    showNotification('Error', error.message || 'An error occurred.');
  }
}

/**
 * Clip an image
 */
async function clipImage(tab, imageUrl) {
  try {
    const clipSettings = await getClipSettings();
    if (!clipSettings) {
      showNotification('Setup Required', 'Please connect to Tana and select tags in settings.');
      chrome.runtime.openOptionsPage();
      return;
    }

    // Inject and get metadata
    await injectContentScript(tab.id);
    const metadataResponse = await chrome.tabs.sendMessage(tab.id, { action: 'getMetadata' });
    const metadata = metadataResponse?.metadata || { title: tab.title, url: tab.url };

    // Create content with image link
    const content = `![Image](${imageUrl})\n\nSource: ${tab.url}`;

    const client = new TanaLocalClient();
    const result = await client.clip({
      title: `Image from: ${metadata.title}`,
      content,
      metadata: { ...metadata, url: tab.url },
      tagId: clipSettings.tagId,
      tagName: clipSettings.tagName,
      fieldMappings: clipSettings.fieldMappings,
      isSelection: true
    });

    if (result.success) {
      showNotification('Success', 'Image clipped to Tana!');
    } else {
      showNotification('Error', result.error || 'Failed to clip image.');
    }
  } catch (error) {
    console.error('Clip image error:', error);
    showNotification('Error', error.message || 'An error occurred.');
  }
}

/**
 * Clip a link
 */
async function clipLink(tab, linkUrl, linkText) {
  try {
    const clipSettings = await getClipSettings();
    if (!clipSettings) {
      showNotification('Setup Required', 'Please connect to Tana and select tags in settings.');
      chrome.runtime.openOptionsPage();
      return;
    }

    // Inject and get metadata
    await injectContentScript(tab.id);
    const metadataResponse = await chrome.tabs.sendMessage(tab.id, { action: 'getMetadata' });
    const pageMetadata = metadataResponse?.metadata || { title: tab.title, url: tab.url };

    // Create content with link
    const content = `[${linkText || linkUrl}](${linkUrl})\n\nFound on: ${tab.url}`;

    const client = new TanaLocalClient();
    const result = await client.clip({
      title: linkText || linkUrl,
      content,
      metadata: {
        ...pageMetadata,
        url: linkUrl
      },
      tagId: clipSettings.tagId,
      tagName: clipSettings.tagName,
      fieldMappings: clipSettings.fieldMappings,
      isSelection: true
    });

    if (result.success) {
      showNotification('Success', 'Link clipped to Tana!');
    } else {
      showNotification('Error', result.error || 'Failed to clip link.');
    }
  } catch (error) {
    console.error('Clip link error:', error);
    showNotification('Error', error.message || 'An error occurred.');
  }
}

/**
 * Show a notification badge
 */
function showNotification(title, message) {
  // Use badge for quick feedback
  const isSuccess = title === 'Success';

  chrome.action.setBadgeText({ text: isSuccess ? '\u2713' : '!' });
  chrome.action.setBadgeBackgroundColor({
    color: isSuccess ? '#22c55e' : '#ef4444'
  });

  // Clear badge after 3 seconds
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 3000);

  // Also log for debugging
  console.log(`${title}: ${message}`);
}

/**
 * Handle messages from popup/content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'clipFromPopup') {
    handlePopupClip(request).then(sendResponse);
    return true; // Async response
  }
});

/**
 * Handle clip request from popup
 */
async function handlePopupClip(request) {
  try {
    const settings = await chrome.storage.sync.get(['fieldMappings', 'supertags']);
    const tag = settings.supertags?.[0] || {};

    const client = new TanaLocalClient();
    return await client.clip({
      title: request.title,
      content: request.content,
      metadata: request.metadata,
      tagId: request.tagId || tag.id,
      tagName: request.tagName || tag.name,
      fieldMappings: settings.fieldMappings,
      isSelection: request.isSelection
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}
