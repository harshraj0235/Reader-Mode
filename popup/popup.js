// popup.js

const btnSoft = document.getElementById('btn-soft');
const btnArchive = document.getElementById('btn-archive');
const btnReader = document.getElementById('btn-reader');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

const quotaContainer = document.getElementById('quota-container');
const quotaValue = document.getElementById('quota-value');
const quotaBarFill = document.getElementById('quota-bar-fill');

const upgradeBanner = document.getElementById('upgrade-banner');
const upgradeBtn = document.getElementById('upgrade-btn');
const premiumBadge = document.getElementById('premium-badge');

// Advanced Ultimate Bypass Controls
const toggleGooglebot = document.getElementById('toggle-googlebot');
const toggleCookies = document.getElementById('toggle-cookies');
const toggleJs = document.getElementById('toggle-js');
const toggleAds = document.getElementById('toggle-ads');

const btnArchiveIs = document.getElementById('btn-archive-is');
const btnGoogleCache = document.getElementById('btn-google-cache');

let activeTab = null;
let activeDomain = '';

// Initialize popup on open
document.addEventListener('DOMContentLoaded', async () => {
  try {
    activeTab = await getActiveTab();
    if (!activeTab || !activeTab.url || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('edge://') || activeTab.url.startsWith('about:')) {
      updateStatus('idle', 'Extension unavailable on this page.');
      disableAllControls();
      updateQuotaUI();
      return;
    }

    // Extract active base domain
    activeDomain = extractBaseDomain(activeTab.url);
    console.log(`[Popup] Active page domain: ${activeDomain}`);

    // 1. Initial page paywall scan
    scanPage();

    // 2. Load quota and premium levels
    updateQuotaUI();

    // 3. Load active bypass switches states
    loadBypassSwitchesStates();

    // 4. Bind advanced event actions
    setupAdvancedListeners();

  } catch (err) {
    console.error('[Popup] Init error:', err);
    updateStatus('error', 'Error scanning current tab.');
  }
});

/**
 * Disables buttons for non-web pages
 */
function disableAllControls() {
  btnReader.disabled = true;
  btnArchive.disabled = true;
  btnSoft.disabled = true;
  toggleGooglebot.disabled = true;
  toggleCookies.disabled = true;
  toggleJs.disabled = true;
  toggleAds.disabled = true;
  btnArchiveIs.disabled = true;
  btnGoogleCache.disabled = true;
}

/**
 * Extracts base domain from full URL
 */
function extractBaseDomain(urlString) {
  try {
    const url = new URL(urlString);
    const parts = url.hostname.split('.');
    if (parts.length > 2) {
      return parts.slice(-2).join('.');
    }
    return url.hostname;
  } catch (e) {
    return '';
  }
}

/**
 * Gets the current active browser tab
 */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Updates status indicator and descriptor message
 */
function updateStatus(type, text) {
  statusDot.className = `pulse-indicator ${type}`;
  statusText.textContent = text;
}

/**
 * Contacts the tab content script to run paywall checks
 */
async function scanPage() {
  updateStatus('info', 'Analyzing page layout and styles...');
  try {
    chrome.tabs.sendMessage(activeTab.id, { action: 'scan' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Popup] Content script not loaded yet:', chrome.runtime.lastError.message);
        updateStatus('warn', 'Content script loading. Please refresh the page.');
        return;
      }

      if (response && response.article?.isJsonMinerUsed) {
        updateStatus('ok', 'Hidden article extracted from JSON-LD metadata!');
        btnSoft.disabled = true;
      } else if (response && response.detection) {
        const type = response.detection.type;
        const detail = type === 'overlay' ? 'Subscription Overlay' : 
                       type === 'blur' ? 'Blurred Content' : 
                       type === 'lock' ? 'Body Scroll Lock' : 'Metered Gate';
        
        updateStatus('warn', `${detail} detected. Soft bypass ready.`);
        btnSoft.disabled = false;
      } else {
        updateStatus('ok', 'No paywall detected — Reader Mode available.');
        btnSoft.disabled = true;
      }
    });
  } catch (e) {
    updateStatus('error', 'Unable to reach page content script.');
  }
}

/**
 * Queries and updates the state of all four bypass toggles on popup load
 */
function loadBypassSwitchesStates() {
  if (!activeDomain) return;

  // 1. Check Googlebot Spoof state
  chrome.runtime.sendMessage({ action: 'getGooglebotState', domain: activeDomain }, (res) => {
    if (!chrome.runtime.lastError && res) {
      toggleGooglebot.checked = res.active;
    }
  });

  // 2. Check Cookie Gater state
  chrome.runtime.sendMessage({ action: 'getCookieGaterState', domain: activeDomain }, (res) => {
    if (!chrome.runtime.lastError && res) {
      toggleCookies.checked = res.active;
    }
  });

  // 3. Check JavaScript Block state
  chrome.runtime.sendMessage({ action: 'getJsState', url: activeTab.url }, (res) => {
    if (!chrome.runtime.lastError && res) {
      toggleJs.checked = (res.setting === 'block');
    }
  });

  // 4. Check Global Ad Blocker state
  chrome.runtime.sendMessage({ action: 'getAdBlockerState' }, (res) => {
    if (!chrome.runtime.lastError && res) {
      toggleAds.checked = res.active;
    }
  });
}

/**
 * Binds click events for advanced controllers
 */
function setupAdvancedListeners() {
  // Toggle: Googlebot simulation
  toggleGooglebot.addEventListener('change', () => {
    const isChecked = toggleGooglebot.checked;
    updateStatus('info', isChecked ? 'Enabling Googlebot Spoofing...' : 'Disabling Googlebot Spoofing...');
    
    const action = isChecked ? 'enableGooglebot' : 'disableGooglebot';
    chrome.runtime.sendMessage({ action: action, domain: activeDomain }, (res) => {
      if (!chrome.runtime.lastError && res && res.success) {
        updateStatus('ok', isChecked ? 'Googlebot enabled. Reloading page...' : 'Googlebot disabled. Reloading page...');
        triggerActiveTabReload();
      } else {
        toggleGooglebot.checked = !isChecked;
        updateStatus('error', 'Failed to register network headers.');
      }
    });
  });

  // Toggle: Cookie Gater
  toggleCookies.addEventListener('change', () => {
    const isChecked = toggleCookies.checked;
    updateStatus('info', isChecked ? 'Enabling Anti-Meter Cookie Gater...' : 'Disabling Cookie Gater...');
    
    const action = isChecked ? 'enableCookieGater' : 'disableCookieGater';
    chrome.runtime.sendMessage({ action: action, domain: activeDomain }, (res) => {
      if (!chrome.runtime.lastError && res && res.success) {
        updateStatus('ok', isChecked ? 'Cookies blocked. Reloading page...' : 'Cookies allowed. Reloading page...');
        
        if (isChecked) {
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => {
              try {
                localStorage.clear();
                sessionStorage.clear();
                console.log('[Content] Storage reset.');
              } catch (e) {}
            }
          });
        }
        
        triggerActiveTabReload();
      } else {
        toggleCookies.checked = !isChecked;
        updateStatus('error', 'Failed to configure cookie blocks.');
      }
    });
  });

  // Toggle: JavaScript blocking setting
  toggleJs.addEventListener('change', () => {
    const isChecked = toggleJs.checked;
    updateStatus('info', isChecked ? 'Blocking JavaScript execution...' : 'Allowing JavaScript execution...');
    
    const state = isChecked ? 'block' : 'allow';
    chrome.runtime.sendMessage({ action: 'setJsState', domain: activeDomain, state: state }, (res) => {
      if (!chrome.runtime.lastError && res && res.success) {
        updateStatus('ok', isChecked ? 'JS blocked on domain. Reloading page...' : 'JS allowed on domain. Reloading page...');
        triggerActiveTabReload();
      } else {
        toggleJs.checked = !isChecked;
        updateStatus('error', 'Failed to update content settings.');
      }
    });
  });

  // Toggle: Global Ad & Tracker Blocker
  toggleAds.addEventListener('change', () => {
    const isChecked = toggleAds.checked;
    updateStatus('info', isChecked ? 'Enabling Ad & Tracker Blocker...' : 'Disabling Ad Blocker...');
    
    const action = isChecked ? 'enableAdBlocker' : 'disableAdBlocker';
    chrome.runtime.sendMessage({ action: action }, (res) => {
      if (!chrome.runtime.lastError && res && res.success) {
        updateStatus('ok', isChecked ? 'Ad Blocker active. Reloading page...' : 'Ad Blocker disabled. Reloading page...');
        triggerActiveTabReload();
      } else {
        toggleAds.checked = !isChecked;
        updateStatus('error', 'Failed to update Ad Blocker rules.');
      }
    });
  });

  // Archive.today Search
  btnArchiveIs.addEventListener('click', () => {
    const archiveIsUrl = `https://archive.today/newest/${encodeURIComponent(activeTab.url)}`;
    chrome.tabs.create({ url: archiveIsUrl });
    window.close();
  });

  // Google Web Cache Redirect
  btnGoogleCache.addEventListener('click', () => {
    const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(activeTab.url)}&strip=1`;
    chrome.tabs.create({ url: cacheUrl });
    window.close();
  });
}

/**
 * Triggers active tab reload after a tiny delay and closes the popup
 */
function triggerActiveTabReload() {
  setTimeout(() => {
    chrome.tabs.reload(activeTab.id);
    window.close();
  }, 900);
}

/**
 * Refreshes the usage quota meter
 */
async function updateQuotaUI() {
  chrome.runtime.sendMessage({ action: 'checkLimit' }, (res) => {
    if (chrome.runtime.lastError || !res) return;

    if (res.isPremium) {
      quotaContainer.style.display = 'none';
      upgradeBanner.style.display = 'none';
      premiumBadge.style.display = 'flex';
    } else {
      quotaContainer.style.display = 'flex';
      premiumBadge.style.display = 'none';
      
      const count = res.count;
      const limit = res.limit;
      quotaValue.textContent = `${count} / ${limit} used`;
      
      const percent = Math.min((count / limit) * 100, 100);
      quotaBarFill.style.width = `${percent}%`;

      if (percent >= 100) {
        quotaBarFill.style.background = 'var(--color-error)';
        upgradeBanner.style.display = 'flex';
        btnArchive.disabled = true;
      } else {
        upgradeBanner.style.display = 'none';
        if (activeTab && activeTab.url && !activeTab.url.startsWith('chrome:')) {
          btnArchive.disabled = false;
        }
      }
    }
  });
}

// Trigger soft paywall bypass on current tab
btnSoft.addEventListener('click', () => {
  updateStatus('info', 'Injecting style overrides...');
  chrome.tabs.sendMessage(activeTab.id, { action: 'softRemove' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      updateStatus('error', 'Bypass injector failed. Try archive fetch.');
      return;
    }

    if (response.success) {
      updateStatus('ok', 'Bypass applied! Banners removed, scroll unlocked.');
      btnSoft.disabled = true;
    } else {
      updateStatus('warn', 'Soft removal was ineffective. Content may be server-blocked.');
    }
  });
});

// Launch Wayback Machine Archive Query
btnArchive.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'checkLimit' }, (limitRes) => {
    if (!limitRes.allowed) {
      upgradeBanner.style.display = 'flex';
      updateStatus('error', 'Free lookup limit reached.');
      return;
    }

    updateStatus('info', 'Searching Wayback Machine snapshots...');
    btnArchive.disabled = true;
    btnReader.disabled = true;
    btnSoft.disabled = true;

    chrome.runtime.sendMessage({ action: 'fetchArchive', url: activeTab.url }, (res) => {
      btnArchive.disabled = false;
      btnReader.disabled = false;
      updateQuotaUI();

      if (!res || !res.success) {
        updateStatus('error', res?.reason || 'Archive search timed out.');
        return;
      }

      updateStatus('ok', 'Archived version found! Launching...');

      chrome.runtime.sendMessage({ action: 'incrementLimit' }, () => {
        chrome.storage.local.set({
          archiveHtml: res.html,
          archiveUrl: res.archiveUrl,
          archiveTimestamp: res.timestamp,
          originalUrl: activeTab.url,
          currentArticle: null
        }, () => {
          chrome.tabs.create({ url: chrome.runtime.getURL('reader/reader.html?source=archive') });
          window.close();
        });
      });
    });
  });
});

// Open clean reader view using extracted DOM
btnReader.addEventListener('click', () => {
  updateStatus('info', 'Extracting article markup...');
  chrome.tabs.sendMessage(activeTab.id, { action: 'extract' }, (res) => {
    if (chrome.runtime.lastError || !res || !res.article) {
      updateStatus('error', 'Failed to extract clean article nodes.');
      return;
    }

    chrome.storage.local.set({
      currentArticle: res.article,
      archiveHtml: null,
      originalUrl: activeTab.url
    }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('reader/reader.html?source=live') });
      window.close();
    });
  });
});

// Mock Stripe Premium billing upgrade
upgradeBtn.addEventListener('click', async () => {
  updateStatus('info', 'Initializing Stripe checkout...');
  upgradeBtn.textContent = 'Processing...';
  upgradeBtn.disabled = true;

  setTimeout(() => {
    chrome.storage.local.set({ isPremium: true }, () => {
      updateStatus('ok', '👑 Payment successful! Reader Mode Pro activated.');
      updateQuotaUI();
      if (activeTab && activeTab.url && !activeTab.url.startsWith('chrome:')) {
        btnArchive.disabled = false;
      }
    });
  }, 1500);
});
