/**
 * linkedin.js — VidSnap extractor for LinkedIn (v2.0)
 *
 * Extraction strategy (click-time, in order):
 * 1. Scrape inline <script> tags for media.licdn.com / dms.licdn.com mp4 URLs
 * 2. Read video element src directly (some LinkedIn players use direct URLs)
 * 3. Use intercepted fetch/XHR URLs from MAIN-world interceptor
 * 4. Parse og:video meta tag
 *
 * Exports: { detect, extractVideoUrl, injectButton }
 */

'use strict';

// ── Captured URLs (posted from MAIN world linkedin-interceptor.js) ───────────
// capturedLiUrls is an ordered array: index 0 = highest bitrate (best quality)

var capturedLiUrls = [];
var capturedLiUrlSet = new Set();

window.addEventListener('message', function (e) {
    if (e.data && e.data.source === 'vidsnap-li' && Array.isArray(e.data.urls)) {
        e.data.urls.forEach(function (u) {
            if (!capturedLiUrlSet.has(u)) {
                capturedLiUrlSet.add(u);
                capturedLiUrls.push(u);
            }
        });
    }
});

// ── Extraction methods ───────────────────────────────────────────────────────

function waitForBody(fn) {
    if (document.body) { fn(); return; }
    var id = setInterval(function () { if (document.body) { clearInterval(id); fn(); } }, 100);
}

/** Scrape inline scripts for licdn.com mp4 URLs */
function scrapeInlineScripts() {
    var urls = new Set();
    document.querySelectorAll('script:not([src])').forEach(function (script) {
        var text = script.textContent || '';
        if (text.length < 50) return;

        // Match various LinkedIn CDN patterns
        var re = /https?:\/\/[\w.-]*licdn\.com[\/\w.-]*[^\s"'\\><]+\.mp4[^\s"'\\><]*/g;
        var re2 = /https?:\/\/[\w.-]*media\.licdn\.com[\/\w.-]*[^\s"'\\><]+\.mp4[^\s"'\\><]*/g;
        var re3 = /https?:\/\/[\w.-]*dms\.licdn\.com[\/\w.-]*[^\s"'\\><]+\.mp4[^\s"'\\><]*/g;

        var match;
        while ((match = re.exec(text)) !== null) urls.add(match[0].replace(/\\\//g, '/').replace(/\\u002F/g, '/').replace(/&amp;/g, '&'));
        while ((match = re2.exec(text)) !== null) urls.add(match[0].replace(/\\\//g, '/').replace(/\\u002F/g, '/').replace(/&amp;/g, '&'));
        while ((match = re3.exec(text)) !== null) urls.add(match[0].replace(/\\\//g, '/').replace(/\\u002F/g, '/').replace(/&amp;/g, '&'));
    });
    return Array.from(urls);
}

/** Read video elements directly */
function scanVideoElements() {
    var urls = [];
    document.querySelectorAll('video').forEach(function (v) {
        // Non-blob direct src
        var src = v.src || v.currentSrc || '';
        if (src && src.indexOf('blob:') === -1 && src.indexOf('http') === 0) {
            urls.push(src);
        }
        v.querySelectorAll('source').forEach(function (s) {
            if (s.src && s.src.indexOf('blob:') === -1 && s.src.indexOf('http') === 0) urls.push(s.src);
        });
        // Scan all data-* attributes for video URLs (skip poster/thumbnail attributes)
        Array.from(v.attributes).forEach(function (attr) {
            if (attr.name === 'poster' || attr.name === 'data-poster') return;
            if (attr.value && attr.value.indexOf('licdn.com') !== -1 && attr.value.indexOf('videocover') === -1) urls.push(attr.value);
        });
    });
    // Check data-sources attribute on any element
    document.querySelectorAll('[data-sources]').forEach(function (el) {
        try {
            JSON.parse(el.dataset.sources).forEach(function (s) { if (s.src) urls.push(s.src); });
        } catch (e) { }
    });
    // Check LinkedIn's specific video container attributes
    document.querySelectorAll('[data-sources-list], [data-media-url], [data-video-url]').forEach(function (el) {
        ['data-sources-list', 'data-media-url', 'data-video-url'].forEach(function (attr) {
            var val = el.getAttribute(attr);
            if (val && val.indexOf('http') === 0) urls.push(val);
        });
    });
    return urls;
}

/** Check og:video meta tag */
function checkOgVideo() {
    var og = document.querySelector('meta[property="og:video"]') || document.querySelector('meta[property="og:video:url"]');
    return og && og.content ? [og.content] : [];
}

// ── Core API ─────────────────────────────────────────────────────────────────

function detect() { return location.hostname.indexOf('linkedin.com') !== -1; }

function extractVideoUrl() {
    var seen = new Set();
    var unique = [];

    function isActualVideoUrl(u) {
        if (!u) return false;
        var lower = u.toLowerCase();
        // Reject cover images, thumbnails, profile photos, and image files
        if (lower.indexOf('videocover') !== -1) return false;
        if (lower.indexOf('/image/') !== -1) return false;
        if (lower.indexOf('/profilephoto/') !== -1) return false;
        if (lower.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/)) return false;
        return true;
    }

    function add(u) {
        if (!u || u.indexOf('http') !== 0 || seen.has(u)) return;
        if (!isActualVideoUrl(u)) return;
        seen.add(u);
        unique.push(u);
    }

    // Method 1: intercepted URLs (best quality first — already sorted by bitrate)
    capturedLiUrls.forEach(add);

    // Method 2: video elements (direct src)
    scanVideoElements().forEach(add);

    // Method 3: inline scripts
    scrapeInlineScripts().forEach(add);

    // Method 4: og:video
    checkOgVideo().forEach(add);

    if (!unique.length) return null; // Return null so polling in tryExtract can retry
    return unique;
}

// ── Button Injection ─────────────────────────────────────────────────────────

function injectButton() {
    if (!window.__vidsnap || !window.__vidsnap.createDownloadButton) { setTimeout(injectButton, 300); return; }
    var VS = window.__vidsnap;
    var injected = new WeakSet();

    // Buttons are appended to document.body and positioned via getBoundingClientRect
    // so LinkedIn's internal overlay elements cannot intercept clicks.
    var btnMap = new WeakMap(); // container → btn

    function positionBtn(btn, container) {
        var rect = container.getBoundingClientRect();
        btn.style.top = (rect.bottom + window.scrollY - 48) + 'px';
        btn.style.left = (rect.right + window.scrollX - btn.offsetWidth - 12) + 'px';
    }

    function addButtonTo(container) {
        if (!container || injected.has(container)) return;
        injected.add(container);

        var btn = VS.createDownloadButton('⬇ VidSnap');
        // Attach to body with fixed stacking, positioned over the container
        btn.style.cssText = [
            'position:absolute',
            'z-index:2147483647',
            'pointer-events:all',
            'opacity:1',
            'transform:none',
            'cursor:pointer',
            'display:inline-flex',
            'align-items:center',
            'gap:6px',
            'padding:7px 14px',
            'background:rgba(15,15,15,0.85)',
            'backdrop-filter:blur(8px)',
            'color:#fff',
            'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
            'font-size:13px',
            'font-weight:600',
            'border:1px solid rgba(255,255,255,0.18)',
            'border-radius:20px',
            'box-shadow:0 4px 20px rgba(0,0,0,0.5)',
            'white-space:nowrap',
            'user-select:none',
        ].join('!important;') + '!important';
        btn.classList.add('visible');
        btn._vsContainer = container;
        document.body.appendChild(btn);
        btnMap.set(container, btn);

        // Position on top of container
        positionBtn(btn, container);

        btn.addEventListener('click', function (e) {
            e.stopPropagation(); e.preventDefault();
            var origHTML = btn.innerHTML;
            btn.textContent = '⏳ Fetching video…';

            // Poll for URLs — the interceptor may still be waiting for the API response
            var attempts = 0;
            var maxAttempts = 15; // 3 seconds total
            function tryExtract() {
                attempts++;
                var urls;
                try { urls = extractVideoUrl(); } catch (err) { urls = null; }

                if (urls && urls.length) {
                    btn.innerHTML = origHTML;
                    var qualityLabels = ['HD (Best)', 'SD (Medium)', 'Low Quality'];
                    var qualityKeys = ['best', 'hd', 'sd'];
                    var options = urls.slice(0, 3).map(function (_, i) {
                        return { label: qualityLabels[i] || ('Option ' + (i + 1)), quality: qualityKeys[i] || 'sd' };
                    });
                    VS.showQualityPopup(btn, options, function (q) {
                        var idx = qualityKeys.indexOf(q);
                        if (idx === -1) idx = 0;
                        var chosenUrl = urls[Math.min(idx, urls.length - 1)];
                        var postId = location.pathname.split('/').filter(Boolean).pop() || Date.now();
                        VS.triggerDownload({
                            url: chosenUrl, filename: 'linkedin_' + postId + '.mp4', platform: 'linkedin',
                            thumbnail: (document.querySelector('meta[property="og:image"]') || {}).content
                        });
                    });
                } else if (attempts < maxAttempts) {
                    setTimeout(tryExtract, 200);
                } else {
                    console.error('[VidSnap LinkedIn] No URLs found after retries');
                    btn.innerHTML = origHTML;
                    VS.showErrorToast('No video found. Try scrolling to play the video first, then click again.');
                }
            }
            tryExtract();
        });
    }

    var handledVideos = new WeakSet(); // Track <video> elements to prevent duplicate buttons

    function tryInject() {
        // Look for video elements — find the best container for each
        document.querySelectorAll('video').forEach(function (video) {
            if (handledVideos.has(video)) return;

            // Walk up to find a feed post container first (prevents duplicates with selector scan)
            var postContainer = video.closest('.feed-shared-update-v2, article, [role="article"]');
            if (postContainer && !injected.has(postContainer)) {
                handledVideos.add(video);
                addButtonTo(postContainer);
                return;
            }

            // Fallback: walk up to find a reasonably-sized container
            var el = video.parentElement;
            for (var i = 0; i < 15 && el; i++) {
                var rect = el.getBoundingClientRect();
                if (rect.width > 200 && rect.height > 100) {
                    handledVideos.add(video);
                    addButtonTo(el);
                    return;
                }
                el = el.parentElement;
            }
        });
    }

    // Single global scroll/resize handler to reposition all buttons (prevents memory leak)
    var repositionTimer = null;
    function debouncedReposition() {
        if (repositionTimer) return;
        repositionTimer = setTimeout(function () {
            repositionTimer = null;
            document.querySelectorAll('.vidsnap-download-btn').forEach(function (btn) {
                if (btn._vsContainer) positionBtn(btn, btn._vsContainer);
            });
        }, 50);
    }
    window.addEventListener('scroll', debouncedReposition, { passive: true });
    window.addEventListener('resize', debouncedReposition, { passive: true });

    tryInject();
    setTimeout(tryInject, 1500);
    setTimeout(tryInject, 3000);
    setTimeout(tryInject, 6000);
    var observer = new MutationObserver(function () { tryInject(); });
    observer.observe(document.body, { childList: true, subtree: true });
}

window.__vidsnap_linkedin = { detect: detect, extractVideoUrl: extractVideoUrl, injectButton: injectButton };
if (detect()) { waitForBody(function () { injectButton(); }); }
