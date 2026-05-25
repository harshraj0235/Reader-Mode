// reader.js

const scrollTracker = document.getElementById('scroll-tracker');
const controlPanel = document.getElementById('control-panel');
const panelTrigger = document.getElementById('panel-trigger');
const btnDownload = document.getElementById('btn-download');

// DOM placeholders
const artTitle = document.getElementById('article-title');
const artAuthor = document.getElementById('article-author');
const artBody = document.getElementById('article-body');
const readTime = document.getElementById('read-time');
const sourceBadge = document.getElementById('source-badge');
const archiveBadge = document.getElementById('archive-badge');
const originalLink = document.getElementById('original-link');

const archiveDateBlock = document.getElementById('archive-date-block');
const archiveDateSeparator = document.getElementById('archive-date-separator');
const archiveDate = document.getElementById('archive-date');

// Font adjustments state
let currentFontSize = 18;
const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 30;

// TTS Narrator Engine State
const synth = window.speechSynthesis;
let ttsPlayBtn = document.getElementById('tts-play');
let ttsStopBtn = document.getElementById('tts-stop');
let ttsSpeed = document.getElementById('tts-speed');
let ttsVoice = document.getElementById('tts-voice');
let ttsTicker = document.getElementById('tts-ticker');

let isTtsPlaying = false;
let isTtsPaused = false;
let ttsParagraphs = [];
let activeParagraphIndex = -1;
let activeUtterance = null;
let voices = [];

// Teleprompter Auto-Scroll State
const toggleAutoScroll = document.getElementById('toggle-autoscroll');
const scrollSpeed = document.getElementById('scroll-speed');
const teleSpeedRow = document.getElementById('tele-speed-row');
let isAutoScrolling = false;

// Initialize Reader View
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize floating panel trigger events
  panelTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    controlPanel.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!controlPanel.contains(e.target)) {
      controlPanel.classList.remove('open');
    }
  });

  // 2. Load persistent styling setups
  await loadPersistentStyles();

  // 3. Bind styling control listeners
  setupStyleListeners();

  // 4. Compile article content
  await renderArticle();

  // 5. Initialize TTS Speech engines
  setupSpeechEngine();

  // 6. Initialize Teleprompter controllers
  setupTeleprompter();

  // 7. Initialize scroll progress tracker
  window.addEventListener('scroll', updateScrollTracker);
});

/**
 * Loads preferences from storage and applies them to the document body
 */
async function loadPersistentStyles() {
  const prefs = await chrome.storage.local.get([
    'readerTheme',
    'readerFont',
    'readerFontSize',
    'readerWidth'
  ]);

  // Set Theme
  const theme = prefs.readerTheme || 'nordic';
  document.body.className = document.body.className.replace(/\btheme-\S+/g, '');
  document.body.classList.add(`theme-${theme}`);
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.theme === theme);
  });

  // Set Font family
  const font = prefs.readerFont || 'sans';
  document.body.className = document.body.className.replace(/\bfont-\S+/g, '');
  document.body.classList.add(`font-${font}`);
  document.querySelectorAll('[id^="font-"]').forEach(btn => {
    btn.classList.toggle('active', btn.id === `font-${font}`);
  });

  // Set Column Width
  const width = prefs.readerWidth || 'medium';
  document.body.className = document.body.className.replace(/\bwidth-\S+/g, '');
  document.body.classList.add(`width-${width}`);
  document.querySelectorAll('[id^="width-"]').forEach(btn => {
    btn.classList.toggle('active', btn.id === `width-${width}`);
  });

  // Set Font Size
  currentFontSize = prefs.readerFontSize || 18;
  applyFontSize(currentFontSize);
}

/**
 * Registers click events for setting controllers
 */
function setupStyleListeners() {
  // Theme selection
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.addEventListener('click', async () => {
      const theme = sw.dataset.theme;
      document.body.className = document.body.className.replace(/\btheme-\S+/g, '');
      document.body.classList.add(`theme-${theme}`);
      
      document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      
      await chrome.storage.local.set({ readerTheme: theme });
    });
  });

  // Font family selection
  const fontOptions = ['sans', 'serif', 'mono'];
  fontOptions.forEach(f => {
    const btn = document.getElementById(`font-${f}`);
    if (btn) {
      btn.addEventListener('click', async () => {
        document.body.className = document.body.className.replace(/\bfont-\S+/g, '');
        document.body.classList.add(`font-${f}`);
        
        document.querySelectorAll('[id^="font-"]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        await chrome.storage.local.set({ readerFont: f });
      });
    }
  });

  // Column width selection
  const widthOptions = ['narrow', 'medium', 'wide'];
  widthOptions.forEach(w => {
    const btn = document.getElementById(`width-${w}`);
    if (btn) {
      btn.addEventListener('click', async () => {
        document.body.className = document.body.className.replace(/\bwidth-\S+/g, '');
        document.body.classList.add(`width-${w}`);
        
        document.querySelectorAll('[id^="width-"]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        await chrome.storage.local.set({ readerWidth: w });
      });
    }
  });

  // Font size adjustments
  document.getElementById('size-dec').addEventListener('click', () => {
    if (currentFontSize > MIN_FONT_SIZE) {
      currentFontSize -= 2;
      applyFontSize(currentFontSize);
      chrome.storage.local.set({ readerFontSize: currentFontSize });
    }
  });

  document.getElementById('size-inc').addEventListener('click', () => {
    if (currentFontSize < MAX_FONT_SIZE) {
      currentFontSize += 2;
      applyFontSize(currentFontSize);
      chrome.storage.local.set({ readerFontSize: currentFontSize });
    }
  });

  // Download stand-alone clean HTML
  btnDownload.addEventListener('click', saveArticleOffline);
}

/**
 * Applies text scaling values dynamically
 */
function applyFontSize(size) {
  artBody.style.setProperty('--body-size', `${size}px`);
  document.getElementById('size-val').textContent = `${size}px`;
}

/**
 * Extracts and displays content from Storage, parsing HTML if loaded from Archive
 */
async function renderArticle() {
  const urlParams = new URLSearchParams(window.location.search);
  const source = urlParams.get('source') || 'live';

  try {
    const stored = await chrome.storage.local.get([
      'currentArticle',
      'archiveHtml',
      'archiveUrl',
      'archiveTimestamp',
      'originalUrl'
    ]);

    let title = '';
    let author = 'Unknown author';
    let rawContent = '';
    let origUrl = stored.originalUrl || '#';

    if (source === 'archive' && stored.archiveHtml) {
      archiveBadge.style.display = 'inline-block';
      sourceBadge.style.display = 'none';

      if (stored.archiveTimestamp) {
        archiveDateBlock.style.display = 'block';
        archiveDateSeparator.style.display = 'block';
        archiveDate.textContent = formatWaybackDate(stored.archiveTimestamp);
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(stored.archiveHtml, 'text/html');

      const reader = new Readability(doc);
      const article = reader.parse();

      if (article) {
        title = article.title;
        author = article.byline || 'Wayback Contributor';
        rawContent = article.content;
      } else {
        throw new Error('Readability failed to parse archived page nodes.');
      }
    } else if (stored.currentArticle) {
      archiveBadge.style.display = 'none';
      sourceBadge.style.display = 'inline-block';

      const live = stored.currentArticle;
      title = live.title;
      author = live.author || 'Author Unknown';
      
      if (live.isJsonMinerUsed) {
        sourceBadge.textContent = "Deep Mined JSON-LD";
        sourceBadge.style.setProperty('background', 'rgba(6, 182, 212, 0.12)', 'important');
        sourceBadge.style.setProperty('color', '#06b6d4', 'important');
        sourceBadge.style.setProperty('border-color', '#06b6d4', 'important');
      } else {
        sourceBadge.textContent = "Live View";
        sourceBadge.style.removeProperty('background');
        sourceBadge.style.removeProperty('color');
        sourceBadge.style.removeProperty('border-color');
      }
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(live.content, 'text/html');
      const reader = new Readability(doc);
      const parsed = reader.parse();
      
      rawContent = parsed ? parsed.content : live.content;
    } else {
      updateStatusDisplay('Empty Article', 'No parsed article content was detected in storage.', true);
      return;
    }

    const cleanContent = DOMPurify.sanitize(rawContent, {
      ALLOWED_TAGS: [
        'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'br', 'hr',
        'blockquote', 'cite', 'pre', 'code', 'table', 'thead', 'tbody',
        'tr', 'th', 'td', 'ul', 'ol', 'li', 'span', 'strong', 'em', 'figure', 'figcaption'
      ],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'colspan', 'rowspan']
    });

    artTitle.textContent = title;
    document.title = `${title} | Immersive Reader`;
    artAuthor.textContent = author;
    artBody.innerHTML = cleanContent;
    originalLink.href = origUrl;

    const textLength = artBody.innerText.trim().split(/\s+/).length;
    const minutes = Math.max(Math.ceil(textLength / 200), 1);
    readTime.textContent = `${minutes} min read`;

    artBody.querySelectorAll('a').forEach(link => {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    });

  } catch (err) {
    console.error('[Reader] Parsing exception:', err);
    updateStatusDisplay('Failed to parse content', `We encountered an issue styling this page: ${err.message}`, true);
  }
}

/**
 * Formats Wayback Machine timestamp strings to readable calendar dates
 */
function formatWaybackDate(timestamp) {
  if (timestamp.length < 8) return timestamp;
  const year = timestamp.substring(0, 4);
  const month = parseInt(timestamp.substring(4, 6)) - 1;
  const day = timestamp.substring(6, 8);
  
  const date = new Date(year, month, day);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Alters status displays when compiling
 */
function updateStatusDisplay(heading, desc, isError = false) {
  artTitle.textContent = heading;
  artBody.innerHTML = `
    <div class="loader-container">
      <div style="font-size: 40px">${isError ? '⚠️' : 'ℹ️'}</div>
      <p style="text-align: center; max-width: 400px; line-height: 1.6">${desc}</p>
    </div>
  `;
  readTime.textContent = 'N/A';
  artAuthor.textContent = 'Unknown';
}

/**
 * Updates progress bar at top relative to scroll values
 */
function updateScrollTracker() {
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = document.documentElement.clientHeight;

  const totalScroll = scrollHeight - clientHeight;
  const percent = totalScroll > 0 ? (scrollTop / totalScroll) * 100 : 0;
  
  scrollTracker.style.width = `${percent}%`;
}

/**
 * Binds browser SpeechSynthesis bindings
 */
function setupSpeechEngine() {
  if (!('speechSynthesis' in window)) {
    ttsTicker.textContent = '⚠️ Speech synthesis is unsupported on this browser.';
    ttsPlayBtn.disabled = true;
    return;
  }

  // Populate voice options
  loadVoices();
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = loadVoices;
  }

  // Playback Control click bindings
  ttsPlayBtn.addEventListener('click', () => {
    if (isTtsPlaying) {
      if (isTtsPaused) {
        resumeSpeech();
      } else {
        pauseSpeech();
      }
    } else {
      startSpeech();
    }
  });

  ttsStopBtn.addEventListener('click', stopSpeech);

  // Restart speech immediately if configuration changes during read
  ttsSpeed.addEventListener('change', () => {
    if (isTtsPlaying && !isTtsPaused) {
      restartSpeechFromActive();
    }
  });

  ttsVoice.addEventListener('change', () => {
    if (isTtsPlaying && !isTtsPaused) {
      restartSpeechFromActive();
    }
  });
}

/**
 * Loads available Speech voices into Select list
 */
function loadVoices() {
  voices = synth.getVoices();
  ttsVoice.innerHTML = '';
  
  // Prioritize high quality English voices or OS default, then list others
  voices.forEach((voice, i) => {
    const option = document.createElement('option');
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.lang})`;
    if (voice.default) {
      option.selected = true;
    }
    ttsVoice.appendChild(option);
  });
  
  if (voices.length === 0) {
    const option = document.createElement('option');
    option.value = "";
    option.textContent = "Default System Voice";
    ttsVoice.appendChild(option);
  }
}

/**
 * Begins narrating article paragraph by paragraph
 */
function startSpeech() {
  ttsParagraphs = Array.from(artBody.querySelectorAll('p'));
  if (ttsParagraphs.length === 0) {
    ttsTicker.textContent = '❌ No read paragraphs found to narrate.';
    return;
  }

  isTtsPlaying = true;
  isTtsPaused = false;
  ttsPlayBtn.innerHTML = '<span class="tts-play-icon">⏸</span>';
  ttsPlayBtn.title = 'Pause Narration';
  ttsStopBtn.disabled = false;

  activeParagraphIndex = 0;
  playParagraph(activeParagraphIndex);
}

/**
 * Speaks the paragraph at target index
 */
function playParagraph(index) {
  if (index >= ttsParagraphs.length || index < 0) {
    stopSpeech();
    return;
  }

  activeParagraphIndex = index;
  
  // Clear previous highlighted styles, set new
  ttsParagraphs.forEach(p => p.classList.remove('tts-highlight'));
  const activeParagraph = ttsParagraphs[index];
  activeParagraph.classList.add('tts-highlight');

  // Centering dynamic viewport highlight (LUXURY UX DESIGN)
  activeParagraph.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Compile Speech Utterance
  const text = activeParagraph.innerText;
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Set speed
  utterance.rate = parseFloat(ttsSpeed.value);

  // Set voice
  const selectedVoiceName = ttsVoice.value;
  const selectedVoice = voices.find(v => v.name === selectedVoiceName);
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  // Bind callback end events
  utterance.onend = () => {
    if (isTtsPlaying && !isTtsPaused) {
      playParagraph(index + 1);
    }
  };

  utterance.onerror = (e) => {
    console.error('Speech synthesis utterance error:', e);
    // Move on gracefully
    if (isTtsPlaying && !isTtsPaused) {
      playParagraph(index + 1);
    }
  };

  // Speaks
  activeUtterance = utterance;
  ttsTicker.textContent = `🔊 Narrating paragraph ${index + 1} of ${ttsParagraphs.length}...`;
  synth.speak(utterance);
}

/**
 * Pauses active speech narration
 */
function pauseSpeech() {
  synth.pause();
  isTtsPaused = true;
  ttsPlayBtn.innerHTML = '<span class="tts-play-icon">▶</span>';
  ttsPlayBtn.title = 'Resume Narration';
  ttsTicker.textContent = '⏸ Narration paused.';
}

/**
 * Resumes paused speech narration
 */
function resumeSpeech() {
  synth.resume();
  isTtsPaused = false;
  ttsPlayBtn.innerHTML = '<span class="tts-play-icon">⏸</span>';
  ttsPlayBtn.title = 'Pause Narration';
  ttsTicker.textContent = `🔊 Narrating paragraph ${activeParagraphIndex + 1} of ${ttsParagraphs.length}...`;
}

/**
 * Completely stops and cancels speech narration
 */
function stopSpeech() {
  synth.cancel();
  isTtsPlaying = false;
  isTtsPaused = false;
  
  ttsPlayBtn.innerHTML = '<span class="tts-play-icon">▶</span>';
  ttsPlayBtn.title = 'Play Text-to-Speech';
  ttsStopBtn.disabled = true;
  
  // Clear highlighting elements
  ttsParagraphs.forEach(p => p.classList.remove('tts-highlight'));
  activeParagraphIndex = -1;
  activeUtterance = null;
  ttsTicker.textContent = '🔊 Speech synthesis stopped. Ready to narrate.';
}

/**
 * Clears active sound stream and immediately re-triggers from current index to update rates/voices hot-swaps
 */
function restartSpeechFromActive() {
  if (activeParagraphIndex !== -1) {
    synth.cancel();
    playParagraph(activeParagraphIndex);
  }
}

/**
 * Sets up the 60FPS Hardware-Accelerated Auto-Scroll Engine
 */
function setupTeleprompter() {
  toggleAutoScroll.addEventListener('change', () => {
    const isChecked = toggleAutoScroll.checked;
    if (isChecked) {
      teleSpeedRow.style.display = 'flex';
      startAutoScroll();
    } else {
      teleSpeedRow.style.display = 'none';
      stopAutoScroll();
    }
  });

  // Slider adjustments immediately recalibrate scroll loop frame rates
  scrollSpeed.addEventListener('input', () => {
    if (isAutoScrolling) {
      stopAutoScroll();
      startAutoScroll();
    }
  });
}

/**
 * Initiates the 60FPS smooth requestAnimationFrame scrolling loop
 */
function startAutoScroll() {
  isAutoScrolling = true;
  
  function scrollFrame() {
    if (!isAutoScrolling) return;
    
    const speedVal = parseInt(scrollSpeed.value);
    
    // Calculates step factor: 1 leads to 0.15px/frame; 10 leads to 1.5px/frame
    const step = speedVal * 0.15;
    
    window.scrollBy(0, step);
    
    // Check if we hit the bottom, stop automatically
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;
    
    if (scrollTop + clientHeight >= scrollHeight - 2) {
      toggleAutoScroll.checked = false;
      teleSpeedRow.style.display = 'none';
      stopAutoScroll();
      return;
    }
    
    requestAnimationFrame(scrollFrame);
  }
  
  requestAnimationFrame(scrollFrame);
}

/**
 * Stops auto-scrolling loop
 */
function stopAutoScroll() {
  isAutoScrolling = false;
}

/**
 * Compiles a self-contained, fully formatted HTML file representing the article and downloads it
 */
async function saveArticleOffline() {
  const title = artTitle.textContent;
  const author = artAuthor.textContent;
  const sourceText = archiveBadge.style.display !== 'none' ? 'Archived View' : 'Live View';
  const originalUrl = originalLink.href;
  const readDuration = readTime.textContent;
  
  const bodyClasses = Array.from(document.body.classList).join(' ');
  const cleanBodyHTML = artBody.innerHTML;

  let stylesText = '';
  try {
    const res = await fetch(chrome.runtime.getURL('reader/reader.css'));
    stylesText = await res.text();
  } catch (e) {
    console.error('Failed to bundle stylesheets:', e);
    stylesText = `body { padding: 40px; font-family: sans-serif; background-color: #0f172a; color: #cbd5e1; }`;
  }

  const offlineHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Offline Reader Pro</title>
  <style>
    ${stylesText}
    .control-panel, .scroll-tracker, .tts-console-card {
      display: none !important;
    }
    body {
      display: flex;
      justify-content: center;
      padding: 0;
    }
  </style>
</head>
<body class="${bodyClasses}">
  <main class="reader-container">
    <header class="article-header">
      <div class="badge-row">
        <span class="badge badge-source">${sourceText} (Downloaded)</span>
      </div>
      <h1 class="article-title">${title}</h1>
      <div class="meta-row">
        <div class="author-block">
          <span class="meta-label">BYLINE</span>
          <span class="meta-value">${author}</span>
        </div>
        <div class="meta-separator"></div>
        <div class="time-block">
          <span class="meta-label">READ TIME</span>
          <span class="meta-value">${readDuration}</span>
        </div>
      </div>
      <div class="link-block" style="margin-top: 15px;">
        <a href="${originalUrl}" class="original-link" target="_blank">View Original Source URL ↗</a>
      </div>
    </header>
    <article class="article-body">
      ${cleanBodyHTML}
    </article>
  </main>
</body>
</html>`;

  try {
    const blob = new Blob([offlineHTML], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const cleanFilename = title.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50) + '_reader.html';
    
    const a = document.createElement('a');
    a.href = url;
    a.download = cleanFilename;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    
    console.log('[Reader] Offline page generated successfully.');
  } catch (err) {
    console.error('[Reader] Download execution failed:', err);
    alert('Failed to generate offline file download: ' + err.message);
  }
}
