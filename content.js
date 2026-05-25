// content.js

const PAYWALL_SIGNALS = {
  overlaySelectors: [
    '[class*="paywall"]', '[id*="paywall"]',
    '[class*="subscribe-wall"]', '[class*="meter-wall"]',
    '[class*="piano-"]', '[class*="tp-modal"]', '[class*="tp-backdrop"]',
    '[class*="pv-global"]',
    '[class*="reg-wall"]', '[class*="regwall"]',
    '[class*="modal--subscription"]', '[class*="subscription-modal"]',
    '[class*="article-paywall"]',
    '[class*="dynamic-paywall"]',
    '[id*="gate-unit"]',
    '#gateway-content',
    '.subscription-gate',
    '.paywall-overlay',
    '.fc-ab-root'
  ],
  blurSelectors: [
    '[class*="article-body"] [style*="filter: blur"]',
    '[class*="article-content"][style*="overflow: hidden"]',
    '[class*="article-body"][style*="max-height"]',
    '[style*="filter: blur"]',
    '.blurred-content',
    '.paywall-blur'
  ],
  meteredPatterns: [
    /you have \d+ (free )?article/i,
    /subscribe to continue/i,
    /your free articles are used/i,
    /this story is for subscribers/i,
    /already a subscriber/i,
    /create a free account/i,
    /support independent journalism/i,
    /read the full article/i
  ]
};

// State trackers for Ad Blocker
var adBlockerActive = false;

// Read state from storage
chrome.storage.local.get(['adBlockerEnabled'], (res) => {
  if (res && res.adBlockerEnabled) {
    adBlockerActive = true;
    console.log('[Content] Ad & Tracker Blocker active. Deploying DOM ad purger...');
    purgeAdElements();
    // Perform a periodic sweep every 3 seconds to clear lazy-loaded frames
    setInterval(purgeAdElements, 3000);
  }
});

/**
 * Visual Ad Purger: Locates and drops visual banner containers, sponsored placements, and scripts
 */
function purgeAdElements() {
  if (!adBlockerActive) return;

  const adSelectors = [
    'ins.adsbygoogle',
    'iframe[id*="google_ads"]',
    'iframe[src*="doubleclick"]',
    '[class*="ad-unit"]', '[class*="adunit"]',
    '[class*="ad-box"]', '[class*="adbox"]',
    '[class*="ad-wrapper"]', '[class*="adwrapper"]',
    '[class*="ad-container"]', '[class*="adcontainer"]',
    '[class*="advertisement"]', '[class*="ad-banner"]',
    '[class*="sponsored-card"]', '[class*="sponsored-post"]',
    '[id*="google_ads"]', '[id*="div-gpt-ad"]',
    '[class*="outbrain"]', '[class*="taboola"]',
    '.ad-placement', '.ad-anchor', '.ad-slot',
    '#sponsored-links', '.sponsored-links'
  ];

  adSelectors.forEach(sel => {
    try {
      const ads = document.querySelectorAll(sel);
      ads.forEach(ad => {
        ad.remove();
      });
    } catch (e) {}
  });
}

/**
 * Scans the current DOM to detect paywalls
 */
function detectPaywall() {
  for (const sel of PAYWALL_SIGNALS.overlaySelectors) {
    try {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        return { type: 'overlay', selector: sel, element: el };
      }
    } catch (e) {}
  }

  for (const sel of PAYWALL_SIGNALS.blurSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        return { type: 'blur', selector: sel, element: el };
      }
    } catch (e) {}
  }

  const docStyle = window.getComputedStyle(document.documentElement);
  const bodyStyle = window.getComputedStyle(document.body);
  const isLocked = docStyle.overflow === 'hidden' || bodyStyle.overflow === 'hidden' || 
                   docStyle.position === 'fixed' || bodyStyle.position === 'fixed';

  if (isLocked) {
    const text = document.body.innerText.substring(0, 5000);
    for (const pattern of PAYWALL_SIGNALS.meteredPatterns) {
      if (pattern.test(text)) {
        return { type: 'lock', reason: 'Overflow lock with subscribe terms' };
      }
    }
  }

  const bodyText = document.body.innerText;
  for (const pattern of PAYWALL_SIGNALS.meteredPatterns) {
    if (pattern.test(bodyText) && bodyText.length < 15000) {
      return { type: 'metered', pattern: pattern.toString() };
    }
  }

  return null;
}

/**
 * Checks if an element is visible in the viewport
 */
function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.height > 20 && 
         rect.width > 20 && 
         style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         parseFloat(style.opacity) > 0.1;
}

/**
 * Removes typical overlays and resets viewport scroll locks
 */
function trySoftRemoval(detection) {
  let actionsTaken = false;
  console.log('[Content] Initiating soft paywall removal...', detection);

  PAYWALL_SIGNALS.overlaySelectors.forEach(sel => {
    try {
      const elements = document.querySelectorAll(sel);
      elements.forEach(el => {
        el.remove();
        actionsTaken = true;
      });
    } catch (e) {}
  });

  const allDivs = document.querySelectorAll('div');
  allDivs.forEach(div => {
    const style = window.getComputedStyle(div);
    const zIndex = parseInt(style.zIndex);
    if (zIndex > 999 && (
      div.className.includes('paywall') || 
      div.className.includes('modal') || 
      div.className.includes('subscribe') ||
      div.className.includes('overlay') ||
      div.id.includes('paywall') ||
      div.id.includes('modal')
    )) {
      div.remove();
      actionsTaken = true;
    }
  });

  const unlockStyles = (el) => {
    if (!el) return;
    const style = window.getComputedStyle(el);
    if (style.overflow === 'hidden' || style.overflowY === 'hidden') {
      el.style.setProperty('overflow', 'auto', 'important');
      el.style.setProperty('overflow-y', 'auto', 'important');
      actionsTaken = true;
    }
    if (style.position === 'fixed') {
      el.style.setProperty('position', 'relative', 'important');
      actionsTaken = true;
    }
  };
  unlockStyles(document.documentElement);
  unlockStyles(document.body);

  const article = findArticleContent();
  if (article) {
    unclampElement(article);
    actionsTaken = true;
  }

  const allElements = document.querySelectorAll('*');
  allElements.forEach(el => {
    const style = window.getComputedStyle(el);
    if (style.filter && style.filter.includes('blur')) {
      el.style.setProperty('filter', 'none', 'important');
      actionsTaken = true;
    }
    if (style.webkitMaskImage && style.webkitMaskImage !== 'none') {
      el.style.setProperty('webkit-mask-image', 'none', 'important');
      actionsTaken = true;
    }
    if (el.style.maxHeight && el.style.maxHeight !== 'none') {
      el.style.setProperty('max-height', 'none', 'important');
      actionsTaken = true;
    }
  });

  // Also clean visual ads if bypass is forced
  if (adBlockerActive) {
    purgeAdElements();
  }

  return actionsTaken;
}

/**
 * Resets all styling attributes causing clamp/fade effects
 */
function unclampElement(el) {
  if (!el) return;
  el.style.setProperty('filter', 'none', 'important');
  el.style.setProperty('max-height', 'none', 'important');
  el.style.setProperty('height', 'auto', 'important');
  el.style.setProperty('overflow', 'visible', 'important');
  el.style.setProperty('webkit-mask-image', 'none', 'important');
  el.style.setProperty('mask-image', 'none', 'important');
  el.style.setProperty('opacity', '1', 'important');
  
  Array.from(el.children).forEach(child => {
    const style = window.getComputedStyle(child);
    if (style.overflow === 'hidden' || style.maxHeight !== 'none') {
      child.style.setProperty('max-height', 'none', 'important');
      child.style.setProperty('overflow', 'visible', 'important');
    }
  });
}

/**
 * Locates the main article text block based on semantic tags
 */
function findArticleContent() {
  const selectors = [
    'article',
    '[class*="article-body"]',
    '[class*="article-content"]',
    '[class*="post-content"]',
    '[class*="story-content"]',
    '[class*="story-body"]',
    'main',
    '#article-content',
    '#story-content'
  ];

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch (e) {}
  }

  let bestCandidate = null;
  let maxParagraphs = 0;
  const divs = document.querySelectorAll('div');
  divs.forEach(div => {
    const pCount = div.querySelectorAll('p').length;
    if (pCount > maxParagraphs) {
      maxParagraphs = pCount;
      bestCandidate = div;
    }
  });

  return bestCandidate || document.body;
}

/**
 * Advanced Feature: Scans `<script type="application/ld+json">` blocks
 * to locate the complete hidden article body, rebuilding structured HTML paragraphs.
 */
function extractJsonLdContent() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  
  for (const script of scripts) {
    try {
      const json = JSON.parse(script.innerText);
      const items = Array.isArray(json) ? json : [json];
      
      for (const item of items) {
        const elements = [];
        if (item['@graph'] && Array.isArray(item['@graph'])) {
          elements.push(...item['@graph']);
        } else {
          elements.push(item);
        }
        
        for (const el of elements) {
          if (el.articleBody && typeof el.articleBody === 'string' && el.articleBody.length > 50) {
            console.log(`[Content] Found hidden articleBody in JSON-LD (${el.articleBody.length} characters)`);
            
            const paragraphTags = el.articleBody
              .split(/\n+/)
              .map(p => p.trim())
              .filter(p => p.length > 0)
              .map(p => `<p>${escapeHtml(p)}</p>`)
              .join('');
              
            return {
              title: el.headline || el.name || '',
              author: el.author?.name || el.author?.[0]?.name || '',
              publishDate: el.datePublished || el.dateCreated || '',
              content: paragraphTags
            };
          }
        }
      }
    } catch (err) {
      // Ignore
    }
  }
  return null;
}

/**
 * Escapes raw content properties safely
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Extracts metadata and clean HTML content for Reader Mode representation
 */
function extractArticle() {
  let title =
    document.querySelector('h1')?.innerText ||
    document.querySelector('meta[property="og:title"]')?.content ||
    document.querySelector('meta[name="twitter:title"]')?.content ||
    document.title;

  let author =
    document.querySelector('[class*="author-name"]')?.innerText ||
    document.querySelector('[rel="author"]')?.innerText ||
    document.querySelector('meta[name="author"]')?.content ||
    document.querySelector('meta[property="article:author"]')?.content ||
    '';

  let publishDate =
    document.querySelector('time')?.getAttribute('datetime') ||
    document.querySelector('meta[property="article:published_time"]')?.content ||
    document.querySelector('meta[name="publish-date"]')?.content ||
    '';

  const articleEl = findArticleContent();
  let rawContent = articleEl ? articleEl.innerHTML : document.body.innerHTML;
  let isJsonMinerUsed = false;

  const visualLength = articleEl ? articleEl.innerText.length : 0;
  const isPaywalled = detectPaywall() !== null;

  if (isPaywalled || visualLength < 1500) {
    const mined = extractJsonLdContent();
    if (mined) {
      const cleanRawContent = rawContent
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

      if (isPaywalled || mined.content.length > cleanRawContent.length + 50) {
        console.log(`[Content] Overriding short visual DOM with complete mined JSON-LD.`);
        rawContent = mined.content;
        isJsonMinerUsed = true;
        if (mined.title) title = mined.title;
        if (mined.author) author = mined.author;
        if (mined.publishDate) publishDate = mined.publishDate;
      }
    }
  }

  return { 
    title: (title || '').trim(), 
    author: (author || '').trim(), 
    publishDate: (publishDate || '').trim(), 
    content: rawContent, 
    url: typeof location !== 'undefined' ? location.href : '',
    isJsonMinerUsed: isJsonMinerUsed
  };
}

// Set up a dynamic observer to automatically strip injected overlays
let observer = null;
function startObserver() {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    const paywall = detectPaywall();
    if (paywall && (paywall.type === 'overlay' || paywall.type === 'blur')) {
      console.log('[Content] Injected paywall detected by Observer, executing cleanup.');
      trySoftRemoval(paywall);
    }
    
    // Sweep ads dynamically as DOM shifts
    if (adBlockerActive) {
      purgeAdElements();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  console.log('[Content] Paywall mutation observer started.');
}

// Listen for messages from popup or reader actions
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scan') {
    const detection = detectPaywall();
    sendResponse({ detection, article: extractArticle() });
  }
  else if (msg.action === 'softRemove') {
    const detection = detectPaywall() || { type: 'forced' };
    const success = trySoftRemoval(detection);
    startObserver();
    sendResponse({ success });
  }
  else if (msg.action === 'extract') {
    sendResponse({ article: extractArticle() });
  }
  return true;
});

// Auto-run initial quick scroll checks on load
setTimeout(() => {
  const paywall = detectPaywall();
  if (paywall && (paywall.type === 'overlay' || paywall.type === 'blur')) {
    console.log('[Content] Found static paywall page, start observer.');
    startObserver();
  }
  
  if (adBlockerActive) {
    purgeAdElements();
  }
}, 1500);
