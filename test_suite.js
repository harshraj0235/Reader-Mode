// test_suite.js
// Automated Test Suite for Reader Mode Pro Extension

const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('====================================================');
console.log('   Reader Mode Pro - Automated Scenario Test Suite  ');
console.log('====================================================\n');

// Mock HTML Document parser and elements for testing
class MockElement {
  constructor(tagName, className = '', id = '') {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.id = id;
    this.style = {
      setProperty(name, val, priority) {
        const camel = name.replace(/-([a-z])/g, g => g[1].toUpperCase());
        this[name] = val;
        this[camel] = val;
      },
      removeProperty(name) {
        const camel = name.replace(/-([a-z])/g, g => g[1].toUpperCase());
        delete this[name];
        delete this[camel];
      }
    };
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.innerText = '';
    this.innerHTML = '';
  }

  getBoundingClientRect() {
    return {
      width: this.style.width ? parseInt(this.style.width) : 100,
      height: this.style.height ? parseInt(this.style.height) : 100,
      top: 0,
      left: 0
    };
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === 'style') {
      const parts = String(val).split(';');
      parts.forEach(p => {
        const [k, v] = p.split(':');
        if (k && v) this.style.setProperty(k.trim(), v.trim());
      });
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
  }

  querySelectorAll(sel) {
    const matches = [];
    const traverse = (node) => {
      if (node.matchesSelector && node.matchesSelector(sel)) {
        matches.push(node);
      }
      node.children.forEach(traverse);
    };
    traverse(this);
    return matches;
  }

  querySelector(sel) {
    const res = this.querySelectorAll(sel);
    return res.length > 0 ? res[0] : null;
  }

  matchesSelector(sel) {
    let tagName = '';
    let rest = sel;
    const tagMatch = sel.match(/^([a-zA-Z0-9\-]+)/);
    if (tagMatch) {
      tagName = tagMatch[1];
      rest = sel.substring(tagName.length);
    }

    if (tagName && this.tagName.toLowerCase() !== tagName.toLowerCase()) {
      return false;
    }

    if (!rest) {
      return true;
    }

    if (rest.startsWith('.')) {
      return this.className.includes(rest.substring(1));
    }

    if (rest.startsWith('#')) {
      return this.id === rest.substring(1);
    }

    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.substring(1, rest.length - 1);
      if (inner.includes('*=')) {
        const [attr, rawVal] = inner.split('*=');
        const val = rawVal.replace(/^"|"$/g, '');
        let attrVal = '';
        if (attr === 'class') attrVal = this.className;
        else if (attr === 'id') attrVal = this.id;
        else if (attr === 'style') {
          attrVal = Array.from(this.attributes.entries())
            .filter(([k]) => k === 'style')
            .map(([, v]) => v)
            .join('');
        } else {
          attrVal = this.getAttribute(attr) || '';
        }
        return attrVal.includes(val);
      } else if (inner.includes('=')) {
        const [attr, rawVal] = inner.split('=');
        const val = rawVal.replace(/^"|"$/g, '');
        let attrVal = '';
        if (attr === 'class') attrVal = this.className;
        else if (attr === 'id') attrVal = this.id;
        else {
          attrVal = this.getAttribute(attr) || '';
        }
        return attrVal === val;
      }
    }

    return false;
  }
}

// Global Document Mocks
const mockDocument = {
  title: 'Test Document Title',
  documentElement: new MockElement('html'),
  body: new MockElement('body'),
  createElement(tag) {
    return new MockElement(tag);
  },
  querySelector(sel) {
    if (sel === 'article') return this.body.querySelector('article') || null;
    return this.body.querySelector(sel);
  },
  querySelectorAll(sel) {
    return this.body.querySelectorAll(sel);
  }
};
mockDocument.documentElement.appendChild(mockDocument.body);

// Global Window Mocks
const mockWindow = {
  getComputedStyle(el) {
    return {
      display: el.style.display || 'block',
      visibility: el.style.visibility || 'visible',
      overflow: el.style.overflow || 'visible',
      overflowY: el.style.overflowY || 'visible',
      position: el.style.position || 'static',
      filter: el.style.filter || 'none',
      webkitMaskImage: el.style.webkitMaskImage || 'none',
      opacity: el.style.opacity || '1'
    };
  }
};

// Chrome Extension APIs mock
const mockChrome = {
  runtime: {
    lastError: null,
    onInstalled: {
      addListener(fn) {
        // Mock handler for initial installation event
        console.log('  [Chrome Mock] runtime.onInstalled registered.');
      }
    },
    onMessage: {
      listeners: [],
      addListener(fn) {
        this.listeners.push(fn);
      }
    },
    sendMessage(msg, callback) {
      // Simulate background responding back to popup/content
      console.log(`  [Chrome Mock] sendMessage action: "${msg.action}"`);
      setTimeout(() => {
        if (backgroundMsgHandler) {
          backgroundMsgHandler(msg, callback);
        }
      }, 5);
    }
  },
  declarativeNetRequest: {
    rules: [],
    async updateDynamicRules(options) {
      if (options.removeRuleIds) {
        this.rules = this.rules.filter(r => !options.removeRuleIds.includes(r.id));
      }
      if (options.addRules) {
        this.rules.push(...options.addRules);
      }
      console.log(`  [DNR Mock] updateDynamicRules: Added ${options.addRules?.length || 0}, Removed ${options.removeRuleIds?.length || 0}`);
    },
    async getDynamicRules() {
      return this.rules;
    }
  },
  contentSettings: {
    javascript: {
      settings: new Map(),
      async set(details) {
        this.settings.set(details.primaryPattern, details.setting);
        console.log(`  [ContentSettings Mock] Set JS block for pattern "${details.primaryPattern}" to "${details.setting}"`);
      },
      async get(details) {
        // Simple mock matching
        for (const [pattern, setting] of this.settings.entries()) {
          const domain = pattern.replace(/\*:\/\/\*\./, '').replace(/\/\*/, '');
          if (details.primaryUrl.includes(domain)) {
            return { setting };
          }
        }
        return { setting: 'allow' };
      }
    }
  },
  storage: {
    local: {
      store: new Map(),
      get(keys, callback) {
        const res = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => {
          res[k] = this.store.get(k);
        });
        if (callback) callback(res);
        return Promise.resolve(res);
      },
      set(items, callback) {
        for (const [k, v] of Object.entries(items)) {
          this.store.set(k, v);
        }
        if (callback) callback();
        return Promise.resolve();
      }
    }
  }
};

// Loader and binding helpers for Content.js and Background.js
let contentSandbox = {};
let backgroundSandbox = {};
let backgroundMsgHandler = null;

function loadContentScript() {
  const contentCode = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf-8');
  
  // Expose mock globals to context
  const context = {
    document: mockDocument,
    window: mockWindow,
    chrome: mockChrome,
    console: { log: console.log, warn: console.warn, error: console.error },
    setTimeout,
    setInterval,
    MutationObserver: class {
      constructor(fn) { this.fn = fn; }
      observe() {}
    }
  };

  // Compile and run in VM context to capture globally declared functions
  const sandbox = vm.createContext(context);
  vm.runInContext(contentCode, sandbox);
  contentSandbox = sandbox;
}

function loadBackgroundScript() {
  const backgroundCode = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf-8');
  
  const context = {
    chrome: mockChrome,
    console: { log: console.log, warn: console.warn, error: console.error },
    fetch: async (url) => {
      // Mock fetch responses for Wayback queries
      console.log(`  [Fetch Mock] Requesting URL: ${url}`);
      if (url.includes('archive.org/wayback/available')) {
        return {
          ok: true,
          json: async () => ({
            archived_snapshots: {
              closest: {
                available: true,
                url: 'https://web.archive.org/web/20210519120000/http://example.com/article',
                timestamp: '20210519120000'
              }
            }
          })
        };
      } else if (url.includes('web.archive.org/web/')) {
        return {
          ok: true,
          text: async () => '<html><body><article><h1>Wayback Article Content</h1><p>Sanitized text here</p></article></body></html>'
        };
      }
      return { ok: false };
    },
    setTimeout,
    setInterval
  };

  const sandbox = vm.createContext(context);
  vm.runInContext(backgroundCode, sandbox);
  backgroundSandbox = sandbox;
  
  // Set the message router to invoke background listeners
  const bgListeners = mockChrome.runtime.onMessage.listeners;
  backgroundMsgHandler = async (msg, sendResponse) => {
    for (const listener of bgListeners) {
      listener(msg, {}, sendResponse);
    }
  };
}

// Initialize Mocks
loadContentScript();
loadBackgroundScript();

// Active unit testing assertions
function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ [FAIL] ${message}`);
    process.exit(1);
  } else {
    console.log(`  ✅ [PASS] ${message}`);
  }
}

// ============================================================================
// TEST SCENARIOS EXECUTION
// ============================================================================

(async () => {
  // Clear mock body first
  mockDocument.body.children = [];
  mockDocument.documentElement.style.overflow = 'hidden';
  mockDocument.body.style.overflow = 'hidden';

  // ----------------------------------------------------
  console.log('----------------------------------------------------');
  console.log('Scenario 1: Soft Paywall Scanner (Overlay Modal)');
  console.log('----------------------------------------------------');
  
  // Setup overlay payload inside mock body
  const overlay = new MockElement('div', 'tp-modal-backdrop paywall-overlay', 'piano-gate');
  overlay.style.display = 'block';
  overlay.style.opacity = '1';
  overlay.innerText = 'Subscribe to continue reading!';
  mockDocument.body.appendChild(overlay);

  // Assert scanner detects overlay paywall
  const detection1 = contentSandbox.detectPaywall();
  assert(detection1 !== null, 'Paywall element scanned successfully.');
  assert(detection1.type === 'overlay', 'Correctly identified type: overlay paywall.');
  assert(detection1.selector === '[class*="paywall"]', 'Correctly matched class overlay query filter.');

  // Run soft unblocker
  const success1 = contentSandbox.trySoftRemoval(detection1);
  console.log('  [Debug] HTML Overflow after unblock:', mockDocument.documentElement.style.overflow);
  console.log('  [Debug] Body Overflow after unblock:', mockDocument.body.style.overflow);
  assert(success1 === true, 'Soft unblock injector reported positive execution.');
  assert(mockDocument.body.querySelector('#piano-gate') === null, 'Subscriber overlay was deleted from document.');
  assert(mockDocument.documentElement.style.overflow === 'auto', 'Lock on HTML overflow successfully unlocked to auto.');
  assert(mockDocument.body.style.overflow === 'auto' || mockDocument.body.style.overflow === 'visible', 'Lock on Body overflow successfully unlocked to scrollable.');


  // ----------------------------------------------------
  console.log('\n----------------------------------------------------');
  console.log('Scenario 2: Soft Paywall Scanner (Blur Filter & Clamped Heights)');
  console.log('----------------------------------------------------');

  mockDocument.body.children = [];
  const article = new MockElement('article', 'article-body blurred-content');
  article.style.filter = 'blur(6px)';
  article.style.maxHeight = '200px';
  article.style.overflow = 'hidden';
  mockDocument.body.appendChild(article);

  // Assert scanner detects height clamps & blurs
  const detection2 = contentSandbox.detectPaywall();
  assert(detection2 !== null, 'Blur paywall scanned successfully.');
  assert(detection2.type === 'blur', 'Correctly identified type: blur paywall.');

  // Run unblurer
  const success2 = contentSandbox.trySoftRemoval(detection2);
  assert(success2 === true, 'Soft blur unblock reported positive execution.');
  assert(article.style.filter === 'none', 'Blur filter reset to none.');
  assert(article.style.maxHeight === 'none', 'Height clamp constraint expanded to none.');
  assert(article.style.overflow === 'visible', 'Element overflow reset to visible.');


  // ----------------------------------------------------
  console.log('\n----------------------------------------------------');
  console.log('Scenario 3: JSON-LD Metadata Deep Miner Fallback');
  console.log('----------------------------------------------------');

  mockDocument.body.children = [];
  
  // Set visual DOM representing clamped paywalled paragraph (extremely short)
  const shortText = new MockElement('article', 'post-content');
  shortText.innerText = 'Only the first few words of the article are displayed...';
  mockDocument.body.appendChild(shortText);

  // Inject hidden script carrying complete full-text indexation
  const schemaScript = new MockElement('script');
  schemaScript.setAttribute('type', 'application/ld+json');
  schemaScript.innerText = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": "Dynamic SEO Miner Test",
    "author": { "@type": "Person", "name": "Antigravity Devs" },
    "articleBody": "First complete paragraph text.\nSecond paragraph content.\nThird paragraph index.\nFourth paragraph contains even more rich validation content to confirm deep miner capability."
  });
  mockDocument.body.appendChild(schemaScript);

  // Assert metadata deep miner successfully extracts hidden body
  const articleData = contentSandbox.extractArticle();
  assert(articleData.title === 'Dynamic SEO Miner Test', 'Extracted headline matching metadata schema.');
  assert(articleData.author === 'Antigravity Devs', 'Extracted author matching metadata schema.');
  assert(articleData.isJsonMinerUsed === true, 'JSON-LD deep content miner flag activated (isJsonMinerUsed: true).');
  assert(articleData.content.includes('<p>First complete paragraph text.</p>'), 'Reconstituted text formatted into HTML paragraphs.');
  assert(articleData.content.length > 100, 'Recovered full-text is significantly larger than visual cut-off.');


  // ----------------------------------------------------
  console.log('\n----------------------------------------------------');
  console.log('Scenario 4: Visual Ad & Tracker Purging');
  console.log('----------------------------------------------------');

  mockDocument.body.children = [];
  
  // Setup ad containers
  const bannerAd = new MockElement('ins', 'adsbygoogle');
  bannerAd.innerText = 'Google Banner Advertisements';
  mockDocument.body.appendChild(bannerAd);

  const sponsoredBox = new MockElement('div', 'sponsored-post sponsored-links');
  sponsoredBox.innerText = 'Taboola/Outbrain sponsored grids';
  mockDocument.body.appendChild(sponsoredBox);

  // Activate ad blocker and purge
  contentSandbox.adBlockerActive = true;
  contentSandbox.purgeAdElements();

  assert(mockDocument.body.querySelector('ins.adsbygoogle') === null, 'Google ad banner dropped successfully.');
  assert(mockDocument.body.querySelector('.sponsored-links') === null, 'Sponsored placement boxes dropped successfully.');


  // ----------------------------------------------------
  console.log('\n----------------------------------------------------');
  console.log('Scenario 5: Background Dynamic Rules & Settings Handles');
  console.log('----------------------------------------------------');

  // Helper to wait for the background script message resolution
  function sendBackgroundMessage(msg) {
    return new Promise((resolve) => {
      backgroundMsgHandler(msg, (res) => {
        resolve(res);
      });
    });
  }

  // Query background limits proxy
  const quotaInfo = await sendBackgroundMessage({ action: 'checkLimit' });
  assert(quotaInfo !== null && quotaInfo.allowed === true, 'Quota check allowed on initial extension setup.');

  // Enable Googlebot Spoofing for active domain
  const botEnabled = await sendBackgroundMessage({ action: 'enableGooglebot', domain: 'nytimes.com' });
  assert(botEnabled && botEnabled.success === true, 'Googlebot dynamic rule request reported successfully.');

  // Validate rule registration
  let registeredRules = await mockChrome.declarativeNetRequest.getDynamicRules();
  assert(registeredRules.length > 0, 'Googlebot spoof network rule registered in DeclarativeNetRequest list.');
  assert(registeredRules[0].condition.urlFilter === '*://*.nytimes.com/*', 'Rule matches nytimes.com subdomain filters.');
  assert(registeredRules[0].action.requestHeaders[0].value.includes('Googlebot'), 'Rule rewrites User-Agent header value to Googlebot.');

  // Enable Cookie Gater (Incognito simulator)
  const cookieGaterEnabled = await sendBackgroundMessage({ action: 'enableCookieGater', domain: 'medium.com' });
  assert(cookieGaterEnabled && cookieGaterEnabled.success === true, 'Cookie Gater dynamic rule request reported successfully.');

  registeredRules = await mockChrome.declarativeNetRequest.getDynamicRules();
  const cookieRule = registeredRules.find(r => r.id === (registeredRules[0].id + 1) || r.action.requestHeaders?.[0]?.header === 'cookie');
  assert(cookieRule !== undefined, 'Cookie Gater request header stripping rule registered.');
  assert(cookieRule.action.requestHeaders[0].operation === 'remove', 'Cookie rule strips outbound request Cookie header.');
  assert(cookieRule.action.responseHeaders[0].operation === 'remove', 'Cookie rule strips inbound response Set-Cookie header.');

  // Enable site-specific JS block rules
  const jsBlocked = await sendBackgroundMessage({ action: 'setJsState', domain: 'bloomberg.com', state: 'block' });
  assert(jsBlocked && jsBlocked.success === true, 'JS Block state setting successfully dispatched.');
  
  const jsState = await sendBackgroundMessage({ action: 'getJsState', url: 'https://www.bloomberg.com/news/article' });
  assert(jsState && jsState.setting === 'block', 'JS Gater setting correctly queries block for bloomberg.com domains.');

  console.log('\n====================================================');
  console.log('   🎉 ALL SCENARIOS COMPLETED AND SUCCESSFULLY PASSED!');
  console.log('====================================================');
})();
