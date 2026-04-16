/**
 * twitter.js — VidSnap extractor for Twitter / X (v3.0)
 *
 * Strategy: Uses Twitter's public syndication API via the background
 * service worker (bypasses CORS). Falls back to inline script scraping
 * and network interception.
 *
 * Flow:
 *   1. User clicks ⬇ VidSnap button
 *   2. Content script sends { action: 'fetchTwitterVideo', tweetId } to SW
 *   3. SW fetches cdn.syndication.twimg.com/tweet-result?id=TWEET_ID
 *   4. SW returns parsed mp4 variants (sorted by bitrate)
 *   5. Quality popup shown → user picks → download triggered
 *
 * Exports: { detect, extractVideoUrl, injectButton }
 */

'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────────

function waitForBody(fn) {
  if (document.body) { fn(); return; }
  var id = setInterval(function () { if (document.body) { clearInterval(id); fn(); } }, 100);
}

function getTweetId() {
  // Try current URL first
  var match = location.pathname.match(/status\/(\d+)/);
  if (match) return match[1];
  // Try internal/temporary links
  match = location.pathname.match(/i\/status\/(\d+)/);
  if (match) return match[1];
  // Try embedded tweet links
  var links = document.querySelectorAll('a[href*="/status/"]');
  for (var i = 0; i < links.length; i++) {
    var m = links[i].href.match(/status\/(\d+)/);
    if (m) return m[1];
  }
  return null;
}

// ── Core API ─────────────────────────────────────────────────────────────────

function detect() {
  return location.hostname.includes('twitter.com') || location.hostname.includes('x.com') || location.hostname.includes('mobile.twitter.com');
}

/**
 * Extract video URL via the service worker syndication API.
 * Returns a Promise of quality options array.
 */
function extractVideoUrl() {
  var tweetId = getTweetId();
  if (!tweetId) {
    return Promise.reject(new Error('Could not find tweet ID in the page URL.'));
  }

  if (!chrome.runtime || !chrome.runtime.sendMessage) {
    return Promise.reject(new Error('Extension context lost. Please refresh the page and try again.'));
  }

  return new Promise(function (resolve, reject) {
    // Add timeout to prevent hanging forever
    var timeout = setTimeout(function () {
      reject(new Error('Request timed out. Please try again.'));
    }, 15000);

    chrome.runtime.sendMessage(
      { action: 'fetchTwitterVideo', tweetId: tweetId },
      function (response) {
        clearTimeout(timeout);
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || response.error) {
          reject(new Error((response && response.error) || 'Failed to fetch video data from Twitter.'));
          return;
        }
        if (!response.variants || response.variants.length === 0) {
          reject(new Error('No video found in this tweet.'));
          return;
        }

        // Build quality options from variants - sort by bitrate descending
        var sortedVariants = response.variants.slice().sort(function (a, b) {
          return (b.bitrate || 0) - (a.bitrate || 0);
        });

        var options = sortedVariants.map(function (v, idx) {
          var label, quality;
          var height = v.height || 0;
          var bitrate = v.bitrate || 0;

          // Try height first, then infer quality from bitrate if height is unavailable
          if (height >= 1080) { label = '✨ Full HD 1080p'; quality = 'best'; }
          else if (height >= 720) { label = '🎬 HD 720p'; quality = 'hd'; }
          else if (height >= 480) { label = '📱 SD 480p'; quality = 'sd'; }
          else if (height >= 360) { label = '📱 SD 360p'; quality = 'sd'; }
          else if (bitrate > 0) {
            // Syndication API often returns bitrate but no height — infer from bitrate
            if (bitrate >= 5000000) { label = '✨ Best Quality (' + Math.round(bitrate / 1000) + 'k)'; quality = 'best'; }
            else if (bitrate >= 2000000) { label = '🎬 HD (' + Math.round(bitrate / 1000) + 'k)'; quality = 'hd'; }
            else if (bitrate >= 800000) { label = '📱 SD (' + Math.round(bitrate / 1000) + 'k)'; quality = 'sd'; }
            else { label = '📱 Low (' + Math.round(bitrate / 1000) + 'k)'; quality = 'sd'; }
          }
          else { label = '📥 Download'; quality = 'best'; }
          return { label: label, quality: quality, url: v.url, bitrate: bitrate, height: height };
        });

        resolve({ options: options, thumbnail: response.thumbnail });
      }
    );
  });
}

// ── Button Injection ─────────────────────────────────────────────────────────

function injectButton() {
  if (!window.__vidsnap || !window.__vidsnap.createDownloadButton) {
    setTimeout(injectButton, 300);
    return;
  }

  var VS = window.__vidsnap;
  var injected = new WeakSet();

  function addButtonTo(container) {
    if (!container || injected.has(container)) return;
    injected.add(container);

    var pos = getComputedStyle(container).position;
    if (pos === 'static' || pos === '') container.style.position = 'relative';

    var btn = VS.createDownloadButton('⬇ VidSnap');
    btn.style.cssText += ';position:absolute!important;bottom:50px!important;right:14px!important;top:auto!important;left:auto!important;opacity:1!important;transform:none!important;z-index:999999!important;';
    btn.classList.add('visible');
    container.appendChild(btn);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var origHTML = btn.innerHTML;
      btn.textContent = '⏳ Fetching video…';

      extractVideoUrl().then(function (result) {
        btn.innerHTML = origHTML;
        var options = result.options;

        if (options.length === 1) {
          // Single option → download directly
          var chosen = options[0];
          var tweetId = getTweetId() || Date.now();
          VS.triggerDownload({
            url: chosen.url,
            filename: 'twitter_' + tweetId + '.mp4',
            platform: 'twitter',
            thumbnail: result.thumbnail,
          });
        } else {
          // Show quality popup — use unique keys per option to avoid duplicate quality collisions
          VS.showQualityPopup(btn, options.map(function (o, i) {
            return { label: o.label, quality: 'q' + i };
          }), function (selectedKey) {
            var idx = parseInt(selectedKey.replace('q', ''), 10) || 0;
            var chosen = options[idx] || options[0];
            var tweetId = getTweetId() || Date.now();
            VS.triggerDownload({
              url: chosen.url,
              filename: 'twitter_' + tweetId + '.mp4',
              platform: 'twitter',
              thumbnail: result.thumbnail,
            });
          });
        }
      }).catch(function (err) {
        console.error('[VidSnap Twitter]', err);
        btn.innerHTML = origHTML;
        VS.showErrorToast(err.message || 'Could not extract video.');
      });
    });
  }

  function tryInject() {
    document.querySelectorAll('[data-testid="videoPlayer"]').forEach(function (el) { addButtonTo(el); });
    document.querySelectorAll('[data-testid="videoComponent"]').forEach(function (el) { addButtonTo(el); });
    document.querySelectorAll('video').forEach(function (video) {
      var el = video.parentElement;
      for (var i = 0; i < 8 && el; i++) {
        var rect = el.getBoundingClientRect();
        if (rect.width > 150 && rect.height > 100) { addButtonTo(el); return; }
        el = el.parentElement;
      }
    });
  }

  tryInject();
  setTimeout(tryInject, 1000);
  setTimeout(tryInject, 2500);
  setTimeout(tryInject, 5000);

  var observer = new MutationObserver(function () { tryInject(); });
  observer.observe(document.body, { childList: true, subtree: true });

  // SPA navigation
  var lastUrl = location.href;
  setInterval(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(tryInject, 1500);
      setTimeout(tryInject, 3000);
    }
  }, 1000);
}

// ── Init ─────────────────────────────────────────────────────────────────────

window.__vidsnap_twitter = { detect: detect, extractVideoUrl: extractVideoUrl, injectButton: injectButton };

if (detect()) {
  waitForBody(function () { injectButton(); });
}
