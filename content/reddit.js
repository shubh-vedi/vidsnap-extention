/**
 * reddit.js — VidSnap extractor for Reddit (v.redd.it) (v1.1)
 *
 * Extraction method:
 *   Reddit hosts videos on v.redd.it as DASH manifests. We find the MPD URL
 *   from <shreddit-player>, <video> elements, or page JSON, parse the XML to
 *   extract video+audio streams at multiple qualities, and present options.
 *
 * v1.1: Removed top-level destructuring of window.__vidsnap (caused silent crash).
 *       Uses lazy access pattern and waitForBody().
 *
 * Exports: { detect, extractVideoUrl, injectButton }
 */

'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────────

function waitForBody(fn) {
    if (document.body) { fn(); return; }
    var id = setInterval(function () { if (document.body) { clearInterval(id); fn(); } }, 100);
}

function parseMpd(mpdText, baseUrl) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(mpdText, 'application/xml');
    var sets = doc.querySelectorAll('AdaptationSet');
    var results = [];
    var audioUrl = null;

    sets.forEach(function (set) {
        var contentType = set.getAttribute('contentType') || '';
        var mimeType = set.getAttribute('mimeType') || '';
        if (contentType === 'audio' || mimeType.indexOf('audio') !== -1) {
            var reps = set.querySelectorAll('Representation');
            if (reps.length) {
                var last = reps[reps.length - 1];
                var baseUrlEl = last.querySelector('BaseURL');
                if (baseUrlEl) audioUrl = new URL(baseUrlEl.textContent.trim(), baseUrl).href;
            }
        }
    });

    sets.forEach(function (set) {
        var contentType = set.getAttribute('contentType') || '';
        var mimeType = set.getAttribute('mimeType') || '';
        if (contentType !== 'video' && mimeType.indexOf('video') === -1) return;
        set.querySelectorAll('Representation').forEach(function (rep) {
            var height = rep.getAttribute('height') || '?';
            var baseUrlEl = rep.querySelector('BaseURL');
            if (!baseUrlEl) return;
            var videoUrl = new URL(baseUrlEl.textContent.trim(), baseUrl).href;
            results.push({
                quality: height === '?' ? 'best' : (parseInt(height) >= 720 ? 'hd' : 'sd'),
                label: height !== '?' ? height + 'p' : 'Best',
                video: videoUrl,
                audio: audioUrl,
            });
        });
    });

    var seen = {};
    var deduped = [];
    results.forEach(function (r) {
        if (!seen[r.label]) { seen[r.label] = true; deduped.push(r); }
    });
    return deduped.reverse();
}

function findDashUrl() {
    // Method 1: shreddit-player element (new Reddit)
    var player = document.querySelector('shreddit-player');
    if (player) {
        var src = player.getAttribute('packaged-media-json');
        if (src) {
            try {
                var data = JSON.parse(src);
                // Try DASH manifest first
                var dash = data.dashUrl
                    || (data.dash && (data.dash.mpd || data.dash.url))
                    || (data.playbackMp4s && data.playbackMp4s.permutations
                        && data.playbackMp4s.permutations[0]
                        && data.playbackMp4s.permutations[0].source
                        && data.playbackMp4s.permutations[0].source.url);
                if (dash) return dash;
            } catch (e) { }
        }
        // Also check src attribute directly
        var playerSrc = player.getAttribute('src');
        if (playerSrc && playerSrc.indexOf('v.redd.it') !== -1) {
            var m = playerSrc.match(/v\.redd\.it\/([a-zA-Z0-9_-]+)/);
            if (m) return 'https://v.redd.it/' + m[1] + '/DASHPlaylist.mpd';
        }
    }

    // Method 2: video element with v.redd.it src
    var video = document.querySelector('video[src*="v.redd.it"], video source[src*="v.redd.it"]');
    var videoSrc = video ? (video.src || video.getAttribute('src')) : null;
    if (videoSrc) {
        var match = videoSrc.match(/v\.redd\.it\/([a-zA-Z0-9_-]+)\//);
        if (match) return 'https://v.redd.it/' + match[1] + '/DASHPlaylist.mpd';
    }

    // Method 3: JSON script tags (old Reddit / API responses)
    var scripts = document.querySelectorAll('script[type="application/json"]');
    for (var i = 0; i < scripts.length; i++) {
        try {
            var json = JSON.parse(scripts[i].textContent);
            var media = (json.media && json.media.reddit_video) || (json.secure_media && json.secure_media.reddit_video);
            if (media && media.dash_url) return media.dash_url;
        } catch (e) { }
    }

    // Method 4: scan all inline scripts for dash_url or v.redd.it URLs
    var allScripts = document.querySelectorAll('script:not([src])');
    for (var j = 0; j < allScripts.length; j++) {
        var text = allScripts[j].textContent;
        if (text.indexOf('dash_url') !== -1) {
            var dm = text.match(/"dash_url"\s*:\s*"([^"]+)"/);
            if (dm) return dm[1].replace(/\\\//g, '/');
        }
        if (text.indexOf('DASHPlaylist') !== -1) {
            var dm2 = text.match(/(https:\/\/v\.redd\.it\/[^"'\s]+DASHPlaylist\.mpd[^"'\s]*)/);
            if (dm2) return dm2[1];
        }
    }

    return null;
}

// ── Core API ─────────────────────────────────────────────────────────────────

function detect() {
    return location.hostname.indexOf('reddit.com') !== -1 || location.hostname.indexOf('redd.it') !== -1;
}

function extractVideoUrl() {
    var dashUrl = findDashUrl();
    if (!dashUrl) return Promise.reject(new Error('Could not find DASH manifest URL on this page.'));
    var baseUrl = dashUrl.substring(0, dashUrl.lastIndexOf('/') + 1);
    return fetch(dashUrl).then(function (resp) {
        if (!resp.ok) throw new Error('Failed to fetch DASH manifest: ' + resp.status);
        return resp.text();
    }).then(function (mpdText) {
        var options = parseMpd(mpdText, baseUrl);
        if (!options.length) throw new Error('No video streams found in DASH manifest.');
        return options;
    });
}

function injectButton() {
    if (!window.__vidsnap || !window.__vidsnap.createDownloadButton) { setTimeout(injectButton, 300); return; }
    var VS = window.__vidsnap;
    var injected = new WeakSet();

    function tryInject() {
        document.querySelectorAll('shreddit-player, .media-viewer__video-wrapper, [data-testid="media-element"], video').forEach(function (el) {
            var container = el.tagName === 'VIDEO' ? el.parentElement : el;
            if (!container || injected.has(container)) return;
            injected.add(container);

            var pos = getComputedStyle(container).position;
            if (pos === 'static' || pos === '') container.style.position = 'relative';
            var btn = VS.createDownloadButton('⬇ VidSnap');
            btn.style.cssText += ';position:absolute!important;bottom:48px!important;right:12px!important;top:auto!important;left:auto!important;opacity:1!important;transform:none!important;z-index:999999!important;';
            btn.classList.add('visible');
            container.appendChild(btn);

            btn.addEventListener('click', function (e) {
                e.stopPropagation(); e.preventDefault();
                var origHTML = btn.innerHTML;
                btn.textContent = '⏳ Detecting…';
                extractVideoUrl().then(function (options) {
                    btn.innerHTML = origHTML;
                    var qualityOptions = options.map(function (o) {
                        return { label: o.label + (o.audio ? ' (Video+Audio)' : ' (Video only)'), quality: o.label };
                    });
                    VS.showQualityPopup(btn, qualityOptions, function (selectedLabel) {
                        var chosen = options.find(function (o) { return o.label === selectedLabel; }) || options[0];
                        var filename = 'reddit_' + Date.now() + '.mp4';
                        // Use triggerDownload for reddit videos that have no audio (simple download)
                        // For videos with audio, check limit manually then send to service worker
                        if (!chosen.audio) {
                            VS.triggerDownload({ url: chosen.video, filename: filename, platform: 'reddit' });
                        } else {
                            if (!chrome.runtime || !chrome.runtime.sendMessage) {
                                VS.showErrorToast('Extension context lost. Please refresh the page and try again.');
                                return;
                            }
                            checkDownloadLimit().then(function (limit) {
                                if (!limit.allowed) { showUpgradeModal(); return; }
                                incrementDownloadCount();
                                saveToHistory({ url: chosen.video, platform: 'reddit', filename: filename });
                                chrome.runtime.sendMessage({ action: 'redditDownload', videoUrl: chosen.video, audioUrl: chosen.audio, filename: filename }, function (response) {
                                    if ((chrome.runtime && chrome.runtime.lastError) || (response && response.error)) {
                                        VS.showErrorToast('Could not extract video. Try right-clicking the video and saving directly.');
                                    } else {
                                        VS.showToast('✅ Video saved!');
                                    }
                                });
                            });
                        }
                    });
                }).catch(function (err) {
                    console.error('[VidSnap Reddit]', err);
                    btn.innerHTML = origHTML;
                    VS.showErrorToast('Could not extract video. Try right-clicking the video and saving directly.');
                });
            });
        });
    }

    tryInject();
    setTimeout(tryInject, 1500);
    setTimeout(tryInject, 4000);
    var observer = new MutationObserver(function () { tryInject(); });
    observer.observe(document.body, { childList: true, subtree: true });
}

window.__vidsnap_reddit = { detect: detect, extractVideoUrl: extractVideoUrl, injectButton: injectButton };
if (detect()) { waitForBody(function () { injectButton(); }); }
