// background.js

const WAYBACK_API = 'https://archive.org/wayback/available?url=';
const FREE_LIMIT = 5;
const AD_RULE_IDS = [999, 1000]; // Global static rule IDs for Ad Blocking

// Hash function to convert domain strings into a unique, stable 32-bit rule ID
function getDomainHashId(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = (hash << 5) - hash + domain.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash) % 8000 + 100; // Base rule IDs range: 100 to 8100
}

// Listen for messages from popup, content.js, or reader.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'fetchArchive') {
    handleArchiveFetch(msg.url).then(sendResponse);
    return true; // Keep message port open for asynchronous response
  }
  if (msg.action === 'checkLimit') {
    checkFetchLimit().then(sendResponse);
    return true;
  }
  if (msg.action === 'incrementLimit') {
    incrementFetchCount().then(sendResponse);
    return true;
  }
  if (msg.action === 'enableGooglebot') {
    enableGooglebotSpoofing(msg.domain).then(sendResponse);
    return true;
  }
  if (msg.action === 'disableGooglebot') {
    disableGooglebotSpoofing(msg.domain).then(sendResponse);
    return true;
  }
  if (msg.action === 'getGooglebotState') {
    checkGooglebotState(msg.domain).then(sendResponse);
    return true;
  }
  if (msg.action === 'enableCookieGater') {
    enableCookieGater(msg.domain).then(sendResponse);
    return true;
  }
  if (msg.action === 'disableCookieGater') {
    disableCookieGater(msg.domain).then(sendResponse);
    return true;
  }
  if (msg.action === 'getCookieGaterState') {
    checkCookieGaterState(msg.domain).then(sendResponse);
    return true;
  }
  if (msg.action === 'setJsState') {
    setJavascriptState(msg.domain, msg.state).then(sendResponse);
    return true;
  }
  if (msg.action === 'getJsState') {
    getJavascriptState(msg.url).then(sendResponse);
    return true;
  }
  if (msg.action === 'enableAdBlocker') {
    enableGlobalAdBlocker().then(sendResponse);
    return true;
  }
  if (msg.action === 'disableAdBlocker') {
    disableGlobalAdBlocker().then(sendResponse);
    return true;
  }
  if (msg.action === 'getAdBlockerState') {
    checkAdBlockerState().then(sendResponse);
    return true;
  }
});

/**
 * Checks Wayback Machine for a snapshot and fetches the archived HTML
 */
async function handleArchiveFetch(url) {
  try {
    console.log(`[Background] Querying Wayback Machine for: ${url}`);
    
    const checkRes = await fetch(`${WAYBACK_API}${encodeURIComponent(url)}`);
    if (!checkRes.ok) {
      return { success: false, reason: `Wayback API check failed (status: ${checkRes.status})` };
    }
    
    const checkData = await checkRes.json();
    const snapshot = checkData?.archived_snapshots?.closest;
    
    if (!snapshot || !snapshot.available) {
      return { success: false, reason: 'No archived version of this page was found in the Wayback Machine.' };
    }

    const archiveUrl = snapshot.url;
    console.log(`[Background] Found archive: ${archiveUrl}. Fetching page content...`);

    const pageRes = await fetch(archiveUrl);
    if (!pageRes.ok) {
      return { success: false, reason: `Failed to fetch archived HTML from Wayback (status: ${pageRes.status})` };
    }
    
    const html = await pageRes.text();
    return { 
      success: true, 
      html: html, 
      archiveUrl: archiveUrl, 
      timestamp: snapshot.timestamp 
    };
  } catch (err) {
    console.error('[Background] Error in fetchArchive:', err);
    return { success: false, reason: `Network error: ${err.message}` };
  }
}

/**
 * Enforces usage limits for premium archive searches
 */
async function checkFetchLimit() {
  try {
    const data = await chrome.storage.local.get(['fetchCount', 'lastReset', 'isPremium']);
    const now = Date.now();
    const oneMonth = 30 * 24 * 60 * 60 * 1000;
    
    if (data.isPremium) {
      return { allowed: true, count: data.fetchCount || 0, limit: Infinity, isPremium: true };
    }

    let fetchCount = data.fetchCount || 0;
    let lastReset = data.lastReset || now;

    if (now - lastReset > oneMonth) {
      fetchCount = 0;
      lastReset = now;
      await chrome.storage.local.set({ fetchCount: 0, lastReset: now });
    }

    return {
      allowed: fetchCount < FREE_LIMIT,
      count: fetchCount,
      limit: FREE_LIMIT,
      isPremium: false
    };
  } catch (err) {
    console.error('[Background] Error checking storage limit:', err);
    return { allowed: true, count: 0, limit: FREE_LIMIT, isPremium: false };
  }
}

/**
 * Increments the user's archive fetch count
 */
async function incrementFetchCount() {
  try {
    const data = await chrome.storage.local.get(['fetchCount']);
    const newCount = (data.fetchCount || 0) + 1;
    await chrome.storage.local.set({ fetchCount: newCount });
    return { success: true, count: newCount };
  } catch (err) {
    console.error('[Background] Error incrementing limit:', err);
    return { success: false };
  }
}

/**
 * Dynamically adds a declarativeNetRequest rule for Googlebot spoofing on a specific domain
 */
async function enableGooglebotSpoofing(domain) {
  try {
    const ruleId = getDomainHashId(domain);
    console.log(`[Background] Enabling Googlebot spoofing for domain: ${domain} (Rule ID: ${ruleId})`);

    const googlebotRule = {
      id: ruleId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          {
            header: 'user-agent',
            operation: 'set',
            value: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
          },
          {
            header: 'referer',
            operation: 'set',
            value: 'https://www.google.com'
          }
        ]
      },
      condition: {
        urlFilter: `*://*.${domain}/*`,
        resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'stylesheet', 'script']
      }
    };

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId],
      addRules: [googlebotRule]
    });

    return { success: true };
  } catch (err) {
    console.error('[Background] Failed to enable Googlebot spoofing:', err);
    return { success: false, reason: err.message };
  }
}

async function disableGooglebotSpoofing(domain) {
  try {
    const ruleId = getDomainHashId(domain);
    console.log(`[Background] Disabling Googlebot spoofing for domain: ${domain} (Rule ID: ${ruleId})`);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId]
    });

    return { success: true };
  } catch (err) {
    console.error('[Background] Failed to disable Googlebot spoofing:', err);
    return { success: false, reason: err.message };
  }
}

async function checkGooglebotState(domain) {
  try {
    const ruleId = getDomainHashId(domain);
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const isActive = rules.some(rule => rule.id === ruleId);
    return { active: isActive };
  } catch (err) {
    return { active: false };
  }
}

/**
 * Cookie Gater: Strips outgoing 'cookie' and incoming 'set-cookie' headers (continuous incognito mode)
 */
async function enableCookieGater(domain) {
  try {
    const ruleId = getDomainHashId(domain) + 1; // ID Offset +1
    console.log(`[Background] Enabling Cookie Gater for domain: ${domain} (Rule ID: ${ruleId})`);

    const cookieRule = {
      id: ruleId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          {
            header: 'cookie',
            operation: 'remove'
          }
        ],
        responseHeaders: [
          {
            header: 'set-cookie',
            operation: 'remove'
          }
        ]
      },
      condition: {
        urlFilter: `*://*.${domain}/*`,
        resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'stylesheet', 'script']
      }
    };

    const blockSdkRuleId = getDomainHashId(domain) + 2; // ID Offset +2
    const blockSdkRule = {
      id: blockSdkRuleId,
      priority: 2,
      action: { type: 'block' },
      condition: {
        urlFilter: '*://*/*tinypass*|*://*/*piano-sdk*|*://*/*poool.fr*|*://*/*payswall*',
        initiatorDomains: [domain],
        resourceTypes: ['script']
      }
    };

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId, blockSdkRuleId],
      addRules: [cookieRule, blockSdkRule]
    });

    return { success: true };
  } catch (err) {
    console.error('[Background] Failed to enable Cookie Gater:', err);
    return { success: false, reason: err.message };
  }
}

async function disableCookieGater(domain) {
  try {
    const ruleId = getDomainHashId(domain) + 1;
    const blockSdkRuleId = getDomainHashId(domain) + 2;
    console.log(`[Background] Disabling Cookie Gater for domain: ${domain}`);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId, blockSdkRuleId]
    });

    return { success: true };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

async function checkCookieGaterState(domain) {
  try {
    const ruleId = getDomainHashId(domain) + 1;
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const isActive = rules.some(rule => rule.id === ruleId);
    return { active: isActive };
  } catch (err) {
    return { active: false };
  }
}

/**
 * JavaScript Blocking Settings: Enables/disables JS dynamically on a website
 */
async function setJavascriptState(domain, state) {
  try {
    console.log(`[Background] Setting JS state for domain: ${domain} to: ${state}`);
    const pattern = `*://*.${domain}/*`;
    await chrome.contentSettings.javascript.set({
      primaryPattern: pattern,
      setting: state
    });
    return { success: true };
  } catch (err) {
    console.error('[Background] Failed to set JS state:', err);
    return { success: false, reason: err.message };
  }
}

async function getJavascriptState(url) {
  try {
    const details = await chrome.contentSettings.javascript.get({
      primaryUrl: url
    });
    return { setting: details.setting };
  } catch (err) {
    console.error('[Background] Failed to get JS state:', err);
    return { setting: 'allow' };
  }
}

/**
 * Global Ad & Tracker Blocker: Terminal blockades for standard adservers & scripts
 */
async function enableGlobalAdBlocker() {
  try {
    console.log('[Background] Deploying dynamic net blockade for ad networks & tracking domains...');
    
    const rules = [
      {
        id: 999,
        priority: 3,
        action: { type: 'block' },
        condition: {
          urlFilter: '*://*.doubleclick.net/*|*://*/*googleads*|*://*.googlesyndication.com/*|*://*.adservice.google.com/*|*://*.amazon-adsystem.com/*',
          resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame']
        }
      },
      {
        id: 1000,
        priority: 3,
        action: { type: 'block' },
        condition: {
          urlFilter: '*://*.taboola.com/*|*://*.outbrain.com/*|*://*.adnxs.com/*|*://*.scorecardresearch.com/*|*://*/*.criteo.*|*://*/*facebook.net/en_US/fbevents.js*',
          resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame']
        }
      }
    ];

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: AD_RULE_IDS,
      addRules: rules
    });

    await chrome.storage.local.set({ adBlockerEnabled: true });
    return { success: true };
  } catch (err) {
    console.error('[Background] Failed to deploy Ad Blocker rules:', err);
    return { success: false, reason: err.message };
  }
}

async function disableGlobalAdBlocker() {
  try {
    console.log('[Background] Removing ad network blockade rules...');
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: AD_RULE_IDS
    });
    await chrome.storage.local.set({ adBlockerEnabled: false });
    return { success: true };
  } catch (err) {
    console.error('[Background] Failed to clear Ad Blocker rules:', err);
    return { success: false, reason: err.message };
  }
}

async function checkAdBlockerState() {
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const isActive = rules.some(rule => AD_RULE_IDS.includes(rule.id));
    return { active: isActive };
  } catch (e) {
    return { active: false };
  }
}

// Initial setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ 
    fetchCount: 0, 
    lastReset: Date.now(), 
    isPremium: false,
    adBlockerEnabled: false 
  });
  console.log('[Background] Reader Mode Pro v1.2 initialized successfully.');
});
