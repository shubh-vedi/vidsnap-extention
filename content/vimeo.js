/**
 * vimeo.js — VidSnap extractor for Vimeo (v1.1)
 *
 * Extraction method:
 *   Vimeo embeds a JSON config with "request.files.progressive" containing
 *   direct mp4 URLs at multiple quality levels. Also fetches from
 *   https://player.vimeo.com/video/{id}/config as fallback.
 *
 * v1.1: Removed top-level destructuring, added waitForBody(), lazy VS access.
 *
 * Exports: { detect, extractVideoUrl, injectButton }
 */

'use strict';

function waitForBody(fn) {
    if (document.body) { fn(); return; }
    var id = setInterval(function () { if (document.body) { clearInterval(id); fn(); } }, 100);
}

function getVimeoId() {
    var match = location.pathname.match(/\/(\d+)/);
    return match ? match[1] : null;
}

function parseVimeoConfig(config) {
    var files = (config && config.request && config.request.files) || (config && config.files) || {};
    var progressive = files.progressive || [];
    if (!progressive.length && files.hls) {
        var hlsUrl = (files.hls && files.hls.url) || (files.hls && files.hls.cdns && files.hls.default_cdn && files.hls.cdns[files.hls.default_cdn] && files.hls.cdns[files.hls.default_cdn].url);
        if (hlsUrl) return [{ label: 'HLS Stream', quality: 'best', url: hlsUrl, width: 0, height: 0 }];
    }
    return progressive.filter(function (p) { return p.url; })
        .sort(function (a, b) { return (b.height || 0) - (a.height || 0); })
        .map(function (p) {
            return { label: (p.quality || (p.height + 'p') || 'Unknown'), quality: (p.height || 0) >= 720 ? 'hd' : 'sd', url: p.url, width: p.width || 0, height: p.height || 0 };
        });
}

function extractConfigFromPage() {
    var cs = document.querySelector('#__vimeo_player_config__');
    if (cs) { try { return JSON.parse(cs.textContent); } catch (e) { } }
    var scripts = document.querySelectorAll('script:not([src])');
    for (var i = 0; i < scripts.length; i++) {
        var text = scripts[i].textContent;
        if (text.indexOf('"progressive"') === -1 && text.indexOf('"files"') === -1) continue;
        var match = text.match(/window\.vimeo\s*=\s*({.+?});/) || text.match(/var\s+vimeo_config\s*=\s*({.+?});/);
        if (match) { try { return JSON.parse(match[1]); } catch (e) { } }
    }
    return null;
}

function fetchVimeoConfig(videoId) {
    return fetch('https://player.vimeo.com/video/' + videoId + '/config', { headers: { 'Referer': location.href } })
        .then(function (r) { if (!r.ok) throw new Error('Vimeo config API returned ' + r.status); return r.json(); });
}

// ── Core API ─────────────────────────────────────────────────────────────────

function detect() { return location.hostname.indexOf('vimeo.com') !== -1; }

function extractVideoUrl() {
    var inlineConfig = extractConfigFromPage();
    if (inlineConfig) {
        var streams = parseVimeoConfig(inlineConfig);
        if (streams.length) return Promise.resolve(streams);
    }
    var videoId = getVimeoId();
    if (!videoId) return Promise.reject(new Error('Could not determine Vimeo video ID from URL.'));
    return fetchVimeoConfig(videoId).then(function (config) {
        var streams = parseVimeoConfig(config);
        if (!streams.length) throw new Error('No downloadable streams found (video may be private or DRM-protected).');
        return streams;
    });
}

function injectButton() {
    if (!window.__vidsnap || !window.__vidsnap.createDownloadButton) { setTimeout(injectButton, 300); return; }
    var VS = window.__vidsnap;
    var injected = new WeakSet();

    function tryInject() {
        document.querySelectorAll('.player, #player, [class*="player"], video').forEach(function (el) {
            var container = (el.classList && (el.classList.contains('player') || el.id === 'player'))
                ? el : (el.closest && el.closest('.player, #player, .vp-player-layout')) || el.parentElement;
            if (!container || injected.has(container)) return;
            injected.add(container);
            var pos = getComputedStyle(container).position;
            if (pos === 'static' || pos === '') container.style.position = 'relative';

            var btn = VS.createDownloadButton('⬇ VidSnap');
            btn.style.cssText += ';position:absolute!important;bottom:52px!important;right:14px!important;top:auto!important;left:auto!important;opacity:1!important;transform:none!important;z-index:999999!important;';
            btn.classList.add('visible');
            container.appendChild(btn);

            btn.addEventListener('click', function (e) {
                e.stopPropagation(); e.preventDefault();
                var origHTML = btn.innerHTML;
                btn.textContent = '⏳ Detecting…';
                extractVideoUrl().then(function (streams) {
                    btn.innerHTML = origHTML;
                    var options = streams.map(function (s) { return { label: s.label, quality: s.quality }; });
                    VS.showQualityPopup(btn, options, function (q) {
                        var chosen = streams.find(function (s) { return s.quality === q; }) || streams[0];
                        var title = (document.querySelector('.vp-title, h1, [class*="title"]') || {}).textContent;
                        title = title ? title.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '_') : ('vimeo_' + (getVimeoId() || Date.now()));
                        VS.triggerDownload({
                            url: chosen.url, filename: title + '.mp4', platform: 'vimeo',
                            thumbnail: (document.querySelector('meta[property="og:image"]') || {}).content
                        });
                    });
                }).catch(function (err) {
                    console.error('[VidSnap Vimeo]', err);
                    btn.innerHTML = origHTML;
                    VS.showErrorToast('Could not extract video. The video may be private or DRM-protected.');
                });
            });
        });
    }

    setTimeout(tryInject, 1000);
    setTimeout(tryInject, 3000);
    var observer = new MutationObserver(function () { tryInject(); });
    observer.observe(document.body, { childList: true, subtree: true });
}

window.__vidsnap_vimeo = { detect: detect, extractVideoUrl: extractVideoUrl, injectButton: injectButton };
if (detect()) { waitForBody(function () { injectButton(); }); }
