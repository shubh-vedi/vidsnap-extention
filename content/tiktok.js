/**
 * tiktok.js — VidSnap extractor for TikTok (v1.1)
 *
 * Extraction method:
 *   TikTok embeds full video data in JSON assigned to
 *   window.__UNIVERSAL_DATA_FOR_REHYDRATION__ or __NEXT_DATA__.
 *   These contain watermark-free download URLs (downloadAddr fields).
 *   Also intercepts fetch() for dynamically loaded feed API responses.
 *
 * v1.1 fix: waitForBody(), lazy window.__vidsnap access,
 * no top-level destructuring.
 *
 * Exports: { detect, extractVideoUrl, injectButton }
 */

'use strict';

// ── Interceptor (early, MAIN world) ──────────────────────────────────────────

(function installInterceptor() {
    if (document.getElementById('vidsnap-tt-interceptor')) return;
    var s = document.createElement('script');
    s.id = 'vidsnap-tt-interceptor';
    s.textContent = '(function(){' +
        'if(window.__vidsnapTtDone)return;window.__vidsnapTtDone=true;' +
        'var _f=window.fetch;' +
        'window.fetch=function(){var a=arguments,p=_f.apply(this,a);' +
        'try{var u=(typeof a[0]==="string"?a[0]:(a[0]&&a[0].url))||"";' +
        'if(u.indexOf("/api/")!==-1&&(u.indexOf("item_list")!==-1||u.indexOf("detail")!==-1)){' +
        'p.then(function(r){try{var c=r.clone();c.text().then(function(t){' +
        'var play=[],dl=[];' +
        't.replace(/"playAddr":"([^"]+)"/g,function(_,m){play.push(decodeURIComponent(m.replace(/\\\\u002F/g,"/")));});' +
        't.replace(/"downloadAddr":"([^"]+)"/g,function(_,m){dl.push(decodeURIComponent(m.replace(/\\\\u002F/g,"/")));});' +
        'if(play.length||dl.length)window.postMessage({source:"vidsnap-tt",play:play,download:dl},"*");' +
        '}).catch(function(){});}catch(e){}}).catch(function(){});' +
        '}}catch(e){}return p;};' +
        '})();';
    var t = document.head || document.documentElement;
    if (t) t.insertBefore(s, t.firstChild);
})();

// ── Captured URLs ─────────────────────────────────────────────────────────────

var ttPlayUrls = new Set();
var ttDownloadUrls = new Set();

window.addEventListener('message', function (e) {
    if (e.data && e.data.source === 'vidsnap-tt') {
        (e.data.play || []).forEach(function (u) { ttPlayUrls.add(u); });
        (e.data.download || []).forEach(function (u) { ttDownloadUrls.add(u); });
    }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function waitForBody(fn) {
    if (document.body) { fn(); return; }
    var id = setInterval(function () { if (document.body) { clearInterval(id); fn(); } }, 100);
}

function findTikTokUrlsInObj(obj, found) {
    if (!found) found = { play: new Set(), download: new Set() };
    if (!obj || typeof obj !== 'object') return found;
    if (Array.isArray(obj)) { obj.forEach(function (i) { findTikTokUrlsInObj(i, found); }); return found; }
    if (obj.playAddr && typeof obj.playAddr === 'string' && obj.playAddr.indexOf('http') === 0) found.play.add(obj.playAddr);
    if (obj.downloadAddr && typeof obj.downloadAddr === 'string' && obj.downloadAddr.indexOf('http') === 0) found.download.add(obj.downloadAddr);
    if (obj.bitrateInfo && Array.isArray(obj.bitrateInfo)) {
        obj.bitrateInfo.forEach(function (b) { if (b.PlayAddr && b.PlayAddr.UrlList && b.PlayAddr.UrlList[0]) found.play.add(b.PlayAddr.UrlList[0]); });
    }
    try { Object.values(obj).forEach(function (v) { if (typeof v === 'object') findTikTokUrlsInObj(v, found); }); } catch (e) { }
    return found;
}

function extractFromPageData() {
    var found = { play: new Set(), download: new Set() };
    try {
        var el = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script[id*="REHYDRATION"]');
        if (el) findTikTokUrlsInObj(JSON.parse(el.textContent || '{}'), found);
    } catch (e) { }
    try {
        var el2 = document.getElementById('__NEXT_DATA__');
        if (el2) findTikTokUrlsInObj(JSON.parse(el2.textContent || '{}'), found);
    } catch (e) { }
    return found;
}

// ── Core API ─────────────────────────────────────────────────────────────────

function detect() { return location.hostname.indexOf('tiktok.com') !== -1; }

function extractVideoUrl() {
    var pageData = extractFromPageData();
    var allDl = new Set(Array.from(pageData.download).concat(Array.from(ttDownloadUrls)));
    var allPlay = new Set(Array.from(pageData.play).concat(Array.from(ttPlayUrls)));
    // Prefer downloadAddr (watermark-free)
    var urls = allDl.size ? Array.from(allDl) : Array.from(allPlay);
    urls = urls.filter(function (u) { return u.startsWith('http'); });
    if (!urls.length) return Promise.reject(new Error('No video URL found. Make sure you are on a TikTok video page.'));
    return Promise.resolve(urls);
}

function injectButton() {
    if (!window.__vidsnap || !window.__vidsnap.createDownloadButton) { setTimeout(injectButton, 300); return; }
    var VS = window.__vidsnap;
    var injected = new WeakSet();

    function addButton(container) {
        if (!container || injected.has(container)) return;
        injected.add(container);
        var pos = getComputedStyle(container).position;
        if (pos === 'static' || pos === '') container.style.position = 'relative';
        var btn = VS.createDownloadButton('⬇ VidSnap');
        btn.style.cssText += ';position:absolute!important;bottom:70px!important;right:14px!important;top:auto!important;left:auto!important;opacity:1!important;transform:none!important;z-index:999999!important;';
        btn.classList.add('visible');
        container.appendChild(btn);

        btn.addEventListener('click', function (e) {
            e.stopPropagation(); e.preventDefault();
            var origHTML = btn.innerHTML;
            btn.textContent = '⏳ Loading…';
            extractVideoUrl().then(function (urls) {
                btn.innerHTML = origHTML;
                var options = [{ label: '✂️ Watermark-Free (Best)', quality: 'best' }];
                if (urls.length > 1) options.push({ label: '📱 Alternative Stream', quality: 'sd' });
                VS.showQualityPopup(btn, options, function (q) {
                    var idx = q === 'best' ? 0 : 1;
                    var chosenUrl = urls[Math.min(idx, urls.length - 1)];
                    var videoId = location.pathname.split('/').pop() || Date.now();
                    VS.triggerDownload({
                        url: chosenUrl, filename: 'tiktok_' + videoId + '.mp4', platform: 'tiktok',
                        thumbnail: (document.querySelector('meta[property="og:image"]') || {}).content
                    });
                });
            }).catch(function (err) {
                console.error('[VidSnap TikTok]', err);
                btn.innerHTML = origHTML;
                VS.showErrorToast(err.message || 'Could not extract video.');
            });
        });
    }

    function tryInject() {
        document.querySelectorAll('video').forEach(function (video) {
            var el = video.parentElement;
            for (var i = 0; i < 8 && el; i++) {
                var r = el.getBoundingClientRect();
                if (r.width > 150 && r.height > 100) { addButton(el); return; }
                el = el.parentElement;
            }
        });
    }

    tryInject();
    setTimeout(tryInject, 1000);
    setTimeout(tryInject, 3000);
    setTimeout(tryInject, 6000);
    var observer = new MutationObserver(function () { tryInject(); });
    observer.observe(document.body, { childList: true, subtree: true });
}

window.__vidsnap_tiktok = { detect: detect, extractVideoUrl: extractVideoUrl, injectButton: injectButton };
if (detect()) { waitForBody(function () { injectButton(); }); }
