/**
 * instagram.js — VidSnap extractor for Instagram (v1.1)
 *
 * Extraction method:
 *   Instagram embeds video data in <script type="application/json"> blocks
 *   containing "__additionalDataLoaded" or in window.__additionalData object.
 *   We traverse graphQL response structures to find `video_url` fields.
 *   Also intercepts fetch() for dynamically loaded Reel/Post API responses.
 *
 * v1.1 fix: Uses lazy access to window.__vidsnap instead of top-level destructuring,
 * and waitForBody() for safe DOM operations at document_start.
 *
 * Exports: { detect, extractVideoUrl, injectButton }
 */

'use strict';

// ── Interceptor (MAIN world, early) ──────────────────────────────────────────

(function installInterceptor() {
    if (document.getElementById('vidsnap-ig-interceptor')) return;
    var s = document.createElement('script');
    s.id = 'vidsnap-ig-interceptor';
    // Use a function reference so string escaping is not an issue
    s.textContent = '(' + (function () {
        if (window.__vidsnapIgDone) return;
        window.__vidsnapIgDone = true;
        var _f = window.fetch;
        window.fetch = function () {
            var a = arguments, p = _f.apply(this, a);
            try {
                var u = (typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url)) || '';
                // Instagram API endpoints often contain these strings
                if (u.indexOf('/api/v1/') !== -1 || u.indexOf('graphql') !== -1 || u.indexOf('api/graphql') !== -1 || u.indexOf('/reels/') !== -1) {
                    p.then(function (r) {
                        try {
                            r.clone().text().then(function (t) {
                                var urls = [];
                                // Pattern 1: video_url
                                var re = /"video_url"\s*:\s*"([^"]+)"/g;
                                var m;
                                while ((m = re.exec(t)) !== null) {
                                    urls.push(m[1].replace(/\\u0026/g, '&').replace(/\\/g, ''));
                                }
                                // Pattern 2: url inside video_versions
                                var re2 = /"url"\s*:\s*"(https:[^"]+\.mp4[^"]*)"/g;
                                while ((m = re2.exec(t)) !== null) {
                                    urls.push(m[1].replace(/\\u0026/g, '&').replace(/\\/g, ''));
                                }
                                // Pattern 3: direct mp4 links in text
                                var re3 = /https?:\/\/[^"'\s]+\.mp4[^"'\s]*/g;
                                while ((m = re3.exec(t)) !== null) {
                                    var du = m[0].replace(/\\u0026/g, '&').replace(/\\/g, '');
                                    if (du.indexOf('cdninstagram') !== -1 || du.indexOf('fbcdn') !== -1) {
                                        urls.push(du);
                                    }
                                }
                                if (urls.length) window.postMessage({ source: 'vidsnap-ig', urls: urls }, '*');
                            }).catch(function () { });
                        } catch (e) { }
                    }).catch(function () { });
                }
            } catch (e) { }
            return p;
        };
    }).toString() + ')();';
    var t = document.head || document.documentElement;
    if (t) t.insertBefore(s, t.firstChild);
})();

// ── Captured URLs ─────────────────────────────────────────────────────────────

var interceptedIgUrls = new Set();

window.addEventListener('message', function (e) {
    if (e.data && e.data.source === 'vidsnap-ig' && Array.isArray(e.data.urls)) {
        e.data.urls.forEach(function (u) { interceptedIgUrls.add(u); });
    }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function waitForBody(fn) {
    if (document.body) { fn(); return; }
    var id = setInterval(function () {
        if (document.body) { clearInterval(id); fn(); }
    }, 100);
}

function findVideoUrls(obj, found, depth) {
    // Use a Map keyed by URL to properly deduplicate (Set with objects doesn't deduplicate)
    if (!found) found = new Map();
    if (!obj || typeof obj !== 'object') return found;
    if (depth > 20) return found; // Prevent infinite recursion
    if (Array.isArray(obj)) {
        obj.forEach(function (item) { findVideoUrls(item, found, depth + 1); });
        return found;
    }

    // Look for video_url field
    if (obj.video_url && typeof obj.video_url === 'string') {
        if (!found.has(obj.video_url)) found.set(obj.video_url, { url: obj.video_url, quality: obj.height || 0 });
    }

    // Look for video_versions - sort by resolution
    if (obj.video_versions && Array.isArray(obj.video_versions)) {
        var sorted = obj.video_versions.slice().sort(function (a, b) {
            return ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0));
        });
        sorted.forEach(function (v) {
            if (v.url && !found.has(v.url)) found.set(v.url, { url: v.url, quality: v.height || v.width || 0 });
        });
    }

    // Look for download_url (Reels)
    if (obj.download_url && typeof obj.download_url === 'string') {
        if (!found.has(obj.download_url)) found.set(obj.download_url, { url: obj.download_url, quality: obj.height || 0 });
    }

    // Look for playback_url
    if (obj.playback_url && typeof obj.playback_url === 'string') {
        if (!found.has(obj.playback_url)) found.set(obj.playback_url, { url: obj.playback_url, quality: obj.height || 0 });
    }

    Object.values(obj).forEach(function (val) { findVideoUrls(val, found, depth + 1); });
    return found;
}

function extractFromPageData() {
    var urls = [];
    var qualityMap = {}; // URL -> quality score

    try {
        document.querySelectorAll('script[type="application/json"]').forEach(function (s) {
            try {
                var data = JSON.parse(s.textContent);
                var found = findVideoUrls(data, new Map(), 0);
                found.forEach(function (item) {
                    var url = typeof item === 'string' ? item : item.url;
                    var quality = typeof item === 'object' ? item.quality : 0;
                    if (url && url.startsWith('http')) {
                        // Prefer cdninstagram.com URLs (official CDN)
                        var score = quality;
                        if (url.indexOf('cdninstagram.com') !== -1) score += 10000;
                        if (url.indexOf('fbcdn.net') !== -1) score += 5000;

                        if (!qualityMap[url] || qualityMap[url] < score) {
                            qualityMap[url] = score;
                            urls.push(url);
                        }
                    }
                });
            } catch (e) { }
        });
    } catch (e) { }

    // Also try regex-based extraction from script tags
    try {
        document.querySelectorAll('script:not([src])').forEach(function (s) {
            var text = s.textContent;
            if (text.indexOf('video_url') === -1 && text.indexOf('.mp4') === -1) return;

            // video_url fields
            var re1 = /"video_url"\s*:\s*"([^"]+)"/g;
            var m;
            while ((m = re1.exec(text)) !== null) {
                var url = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                if (url.startsWith('http') && (url.indexOf('instagram') !== -1 || url.indexOf('cdninstagram') !== -1)) {
                    if (!qualityMap[url]) {
                        qualityMap[url] = 100;
                        urls.push(url);
                    }
                }
            }

            // video_versions URLs
            var re2 = /"url"\s*:\s*"(https:[^"]+\.mp4[^"]*)"/g;
            while ((m = re2.exec(text)) !== null) {
                var url = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                if (url.indexOf('instagram') !== -1 || url.indexOf('cdninstagram') !== -1 || url.indexOf('fbcdn') !== -1) {
                    if (!qualityMap[url]) {
                        qualityMap[url] = 50;
                        urls.push(url);
                    }
                }
            }
        });
    } catch (e) { }

    // Check og:video as fallback
    var og = document.querySelector('meta[property="og:video"]');
    if (og && og.content) urls.push(og.content);

    // Sort URLs by quality score
    urls.sort(function (a, b) {
        return (qualityMap[b] || 0) - (qualityMap[a] || 0);
    });

    return urls;
}

// ── Core API ─────────────────────────────────────────────────────────────────

function detect() {
    var path = location.pathname;
    return location.hostname.indexOf('instagram.com') !== -1 &&
        (path.startsWith('/p/') || path.startsWith('/reel/') || path.startsWith('/tv/') || path.includes('/reels/'));
}

function extractVideoUrl() {
    var pageUrls = extractFromPageData();
    var all = new Set();
    interceptedIgUrls.forEach(function (u) { all.add(u); });
    pageUrls.forEach(function (u) { all.add(u); });

    var urls = Array.from(all).filter(function (u) {
        return u.startsWith('http');
    });

    // Sort by quality (prefer cdninstagram.com URLs)
    urls.sort(function (a, b) {
        var aScore = a.indexOf('cdninstagram.com') !== -1 ? 10 : 0;
        var bScore = b.indexOf('cdninstagram.com') !== -1 ? 10 : 0;
        return bScore - aScore;
    });

    if (!urls.length) return Promise.reject(new Error('No video URL found. Make sure you are on a Reel or video post page.'));
    return Promise.resolve(urls);
}

function injectButton() {
    if (!window.__vidsnap || !window.__vidsnap.createDownloadButton) {
        setTimeout(injectButton, 300);
        return;
    }
    var VS = window.__vidsnap;
    var injected = new WeakSet();

    function addButton(container) {
        if (!container || injected.has(container)) return;
        injected.add(container);
        var pos = getComputedStyle(container).position;
        if (pos === 'static' || pos === '') container.style.position = 'relative';

        var btn = VS.createDownloadButton('⬇ VidSnap');
        btn.style.cssText += ';position:absolute!important;bottom:60px!important;right:14px!important;top:auto!important;left:auto!important;opacity:1!important;transform:none!important;z-index:999999!important;';
        btn.classList.add('visible');
        container.appendChild(btn);

        btn.addEventListener('click', function (e) {
            e.stopPropagation(); e.preventDefault();
            var origHTML = btn.innerHTML;
            btn.textContent = '⏳ Loading…';
            extractVideoUrl().then(function (urls) {
                btn.innerHTML = origHTML;
                var options = urls.slice(0, 3).map(function (_, i) {
                    return { label: i === 0 ? '📥 Best Quality' : '📥 Option ' + (i + 1), quality: i === 0 ? 'best' : 'sd' };
                });
                VS.showQualityPopup(btn, options, function (q) {
                    var idx = q === 'best' ? 0 : 1;
                    var chosenUrl = urls[Math.min(idx, urls.length - 1)];
                    var postId = location.pathname.replace(/\//g, '_') || Date.now();
                    VS.triggerDownload({
                        url: chosenUrl, filename: 'instagram_' + postId + '.mp4', platform: 'instagram',
                        thumbnail: (document.querySelector('meta[property="og:image"]') || {}).content
                    });
                });
            }).catch(function (err) {
                console.error('[VidSnap Instagram]', err);
                btn.innerHTML = origHTML;
                VS.showErrorToast(err.message || 'Could not extract video.');
            });
        });
    }

    function tryInject() {
        document.querySelectorAll('video').forEach(function (video) {
            // Find the best container for the download button
            // instagram uses 'article' for feed posts, '[role="dialog"]' for post popups, and specific classes for Reels
            var container = video.closest('article, [role="dialog"], [class*="Reel"], .x1qjc9v5.x972fbf.xcf9t4w') || video.parentElement;
            if (!container) return;

            // Walk up to find a reasonable-sized container that isn't too small
            var el = container;
            for (var i = 0; i < 8 && el; i++) {
                var rect = el.getBoundingClientRect();
                if (rect.width > 200 && rect.height > 150) {
                    addButton(el);
                    return;
                }
                el = el.parentElement;
            }
            addButton(container);
        });
    }

    tryInject();
    setTimeout(tryInject, 1000);
    setTimeout(tryInject, 3000);
    setTimeout(tryInject, 6000);

    var observer = new MutationObserver(function () { tryInject(); });
    observer.observe(document.body, { childList: true, subtree: true });
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.__vidsnap_instagram = { detect: detect, extractVideoUrl: extractVideoUrl, injectButton: injectButton };

if (detect()) {
    waitForBody(function () { injectButton(); });
}
