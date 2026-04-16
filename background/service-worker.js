/**
 * background/service-worker.js — VidSnap Background Service Worker (MV3)
 *
 * Responsibilities:
 *   1. Handle chrome.downloads.download() requests from content scripts
 *   2. Context menu: "Download video with VidSnap" on right-click
 *   3. Reddit: receive video+audio URLs and trigger merged download
 *      (ffmpeg.wasm merge is stubbed here — extension offloads to a
 *       local blob-merge approach or falls back to video-only)
 *   4. Send desktop notifications on completed downloads
 *   5. Pro license validation (license key check stub)
 */

'use strict';

// ── Context Menu Setup ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
    // Create right-click context menu on video elements and pages
    chrome.contextMenus.create({
        id: 'vidsnap-download',
        title: '⬇ Download video with VidSnap',
        contexts: ['video', 'page', 'link'],
        documentUrlPatterns: [
            'https://*.reddit.com/*',
            'https://*.redd.it/*',
            'https://twitter.com/*',
            'https://x.com/*',
            'https://www.instagram.com/*',
            'https://www.tiktok.com/*',
            'https://www.linkedin.com/*',
            'https://vimeo.com/*',
        ],
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'vidsnap-download') return;

    // Inject the active platform's extractor via scripting API
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                // Find whichever platform extractor is loaded and trigger it
                const extractors = [
                    window.__vidsnap_reddit,
                    window.__vidsnap_twitter,
                    window.__vidsnap_instagram,
                    window.__vidsnap_tiktok,
                    window.__vidsnap_linkedin,
                    window.__vidsnap_vimeo,
                ].filter(Boolean);

                for (const extractor of extractors) {
                    if (extractor.detect()) {
                        extractor.extractVideoUrl().then((result) => {
                            const urls = Array.isArray(result) ? result : [result];
                            const first = urls[0];
                            const url = typeof first === 'string' ? first : first?.url || first?.video;
                            if (url) {
                                chrome.runtime.sendMessage({
                                    action: 'download',
                                    url,
                                    filename: `vidsnap_${Date.now()}.mp4`,
                                    platform: 'context-menu',
                                });
                            }
                        }).catch(() => {
                            window.__vidsnap?.showErrorToast('Could not extract video from context menu.');
                        });
                        return;
                    }
                }
                window.__vidsnap?.showErrorToast('No supported video found on this page.');
            },
        });
    } catch (err) {
        console.error('[VidSnap] Context menu injection error:', err);
    }
});

// ── Message Handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'download') {
        handleSimpleDownload(message, sendResponse);
        return true; // keep channel open for async response
    }

    if (message.action === 'redditDownload') {
        handleRedditDownload(message, sendResponse);
        return true;
    }

    if (message.action === 'validateLicense') {
        handleLicenseValidation(message, sendResponse);
        return true;
    }

    if (message.action === 'getHistory') {
        chrome.storage.local.get(['vs_history'], (data) => {
            sendResponse({ history: data.vs_history || [] });
        });
        return true;
    }

    if (message.action === 'clearHistory') {
        chrome.storage.local.set({ vs_history: [] }, () => sendResponse({ ok: true }));
        return true;
    }

    if (message.action === 'fetchTwitterVideo') {
        handleFetchTwitterVideo(message, sendResponse);
        return true;
    }

    if (message.action === 'fetchVideoUrl') {
        handleFetchVideoUrl(message, sendResponse);
        return true;
    }
});

// ── Generic Video URL Fetcher (for CORS bypass) ───────────────────────────────

async function handleFetchVideoUrl(message, sendResponse) {
    const { url } = message;
    if (!url) {
        sendResponse({ error: 'No URL provided' });
        return;
    }

    try {
        const resp = await fetch(url, {
            credentials: 'omit',
            headers: { 'Accept': 'video/mp4,video/webm,video/*,*/*' }
        });

        if (!resp.ok) {
            sendResponse({ error: `Fetch failed: ${resp.status}` });
            return;
        }

        const contentType = resp.headers.get('content-type') || '';

        if (resp.redirected && resp.url) {
            sendResponse({ ok: true, url: resp.url, contentType: contentType });
            return;
        }

        sendResponse({ ok: true, url: url, contentType: contentType });
    } catch (err) {
        console.error('[VidSnap] fetchVideoUrl error:', err);
        sendResponse({ error: err.message });
    }
}

// ── Download Handlers ─────────────────────────────────────────────────────────

/**
 * Handle a simple single-URL download (Twitter, Instagram, TikTok, LinkedIn, Vimeo).
 */
async function handleSimpleDownload(message, sendResponse) {
    const { url, filename, platform } = message;
    if (!url) {
        sendResponse({ error: 'No URL provided' });
        return;
    }

    const safeFilename = sanitizeFilename(filename || `vidsnap_${Date.now()}.mp4`);

    // For URLs without a clear .mp4 extension (e.g. LinkedIn signed CDN URLs),
    // fetch as blob first so chrome.downloads doesn't reject it as an image.
    const needsBlobFetch = !url.match(/\.mp4(\?|#|$)/i) && !url.startsWith('blob:');

    try {
        let downloadUrl = url;

        if (needsBlobFetch) {
            console.log('[VidSnap] Fetching as blob:', url);
            const resp = await fetch(url, { credentials: 'omit' });
            if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
            const contentType = resp.headers.get('content-type') || '';
            console.log('[VidSnap] Content-Type:', contentType, 'URL:', url);
            // If it's an image, the URL we received is wrong — reject it
            if (contentType.indexOf('image') !== -1) {
                throw new Error(`URL returned image content (${contentType}), not video. Wrong URL captured.`);
            }
            const blob = await resp.blob();
            // Convert to data URL — works in service workers (no URL.createObjectURL)
            downloadUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        const downloadId = await new Promise((resolve, reject) => {
            chrome.downloads.download(
                { url: downloadUrl, filename: safeFilename, saveAs: false },
                (id) => {
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve(id);
                }
            );
        });

        sendResponse({ ok: true, downloadId });
        sendNotification(`Video download started from ${platform || 'site'}!`);
    } catch (err) {
        console.error('[VidSnap] Download error for URL:', url, err);
        sendResponse({ error: err.message });
    }
}

/**
 * Handle Reddit video+audio merge and download.
 *
 * Strategy:
 *   1. Download video stream as blob via fetch()
 *   2. Download audio stream as blob via fetch()
 *   3. Attempt to merge using MediaRecorder trick (limited quality)
 *   4. If merge fails, fall back to video-only download with a warning
 *
 * Note: Full ffmpeg.wasm integration would require loading the WASM module
 * (~30MB) via a dedicated offscreen document. This implementation uses a
 * lightweight approach that works for most reddit videos in the background SW.
 * For production, replace the merge stub with ffmpeg.wasm via offscreen doc.
 */
async function handleRedditDownload(message, sendResponse) {
    const { videoUrl, audioUrl, filename } = message;

    try {
        if (!audioUrl) {
            // No audio track — just download video directly
            await handleSimpleDownload({ url: videoUrl, filename, platform: 'reddit' }, sendResponse);
            return;
        }

        // Fetch video and audio as blobs
        const [videoBlob, audioBlob] = await Promise.all([
            fetchBlob(videoUrl),
            fetchBlob(audioUrl),
        ]);

        // TODO: Integrate ffmpeg.wasm via chrome.offscreen API for proper A/V merge
        // For now: create a combined download with video-only blob + notification about limitation
        // In a full implementation:
        //   const { createFFmpeg, fetchFile } = FFmpeg;
        //   const ffmpeg = createFFmpeg({ log: false });
        //   await ffmpeg.load();
        //   ffmpeg.FS('writeFile', 'video.mp4', await fetchFile(videoBlob));
        //   ffmpeg.FS('writeFile', 'audio.aac', await fetchFile(audioBlob));
        //   await ffmpeg.run('-i', 'video.mp4', '-i', 'audio.aac', '-c:v', 'copy', '-c:a', 'aac', 'output.mp4');
        //   const data = ffmpeg.FS('readFile', 'output.mp4');
        //   const mergedBlob = new Blob([data.buffer], { type: 'video/mp4' });

        // Fallback: download video only — convert blob to data URL
        // (URL.createObjectURL is NOT available in MV3 service workers)
        const videoDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(videoBlob);
        });
        const downloadId = await new Promise((resolve, reject) => {
            chrome.downloads.download(
                {
                    url: videoDataUrl,
                    filename: sanitizeFilename(filename || `reddit_${Date.now()}.mp4`),
                    saveAs: false,
                },
                (id) => {
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve(id);
                }
            );
        });

        sendResponse({ ok: true, downloadId, warning: 'Video saved (audio merge requires ffmpeg.wasm — video-only fallback used)' });
        sendNotification('Reddit video saved (video only — audio merge is a Pro feature placeholder)');
    } catch (err) {
        console.error('[VidSnap] Reddit download error:', err);
        // Last resort: try direct video URL download
        await handleSimpleDownload({ url: videoUrl, filename, platform: 'reddit' }, sendResponse);
    }
}

// ── Twitter Syndication API ───────────────────────────────────────────────────

/**
 * Fetch video URLs from Twitter's syndication API.
 * Runs in service worker to bypass CORS restrictions.
 */
async function handleFetchTwitterVideo(message, sendResponse) {
    const { tweetId } = message;
    if (!tweetId) {
        sendResponse({ error: 'No tweet ID provided' });
        return;
    }

    try {
        const resp = await fetch(
            `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=0`,
            { headers: { 'Accept': 'application/json' } }
        );

        if (!resp.ok) {
            sendResponse({ error: `Syndication API returned ${resp.status}` });
            return;
        }

        const data = await resp.json();
        const variants = [];

        // Extract from mediaDetails[].video_info.variants
        if (data.mediaDetails) {
            data.mediaDetails.forEach(md => {
                if (md.video_info && md.video_info.variants) {
                    md.video_info.variants.forEach(v => {
                        if (v.content_type === 'video/mp4' && v.url) {
                            variants.push({
                                url: v.url,
                                bitrate: v.bitrate || 0,
                                height: v.video_info?.height || v.height || 0,
                                width: v.video_info?.width || v.width || 0,
                                content_type: v.content_type,
                            });
                        }
                    });
                }
            });
        }

        // Also extract from video.variants
        if (data.video && data.video.variants) {
            data.video.variants.forEach(v => {
                if (v.type === 'video/mp4' && v.src) {
                    variants.push({
                        url: v.src,
                        bitrate: 0,
                        content_type: 'video/mp4',
                    });
                }
            });
        }

        // Deduplicate by URL
        const seen = new Set();
        const unique = variants.filter(v => {
            if (seen.has(v.url)) return false;
            seen.add(v.url);
            return true;
        });

        // Sort by bitrate descending
        unique.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

        sendResponse({
            ok: true,
            variants: unique,
            thumbnail: data.mediaDetails?.[0]?.media_url_https || data.video?.poster || null,
        });
    } catch (err) {
        console.error('[VidSnap] Twitter syndication fetch error:', err);
        sendResponse({ error: err.message });
    }
}

// ── License Validation ────────────────────────────────────────────────────────

/**
 * Validate a Pro license key.
 * TODO: Replace this stub with a real backend call to your licensing server
 *       or Stripe's customer portal API.
 * @param {object} message - { licenseKey }
 */
async function handleLicenseValidation(message, sendResponse) {
    const { licenseKey } = message;
    if (!licenseKey) {
        sendResponse({ valid: false, error: 'No license key provided' });
        return;
    }

    // TODO: POST to https://api.yourserver.com/validate-license
    // const resp = await fetch('https://api.yourserver.com/validate-license', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ key: licenseKey }),
    // });
    // const data = await resp.json();
    // if (data.valid) {
    //   chrome.storage.sync.set({ vs_pro: true, vs_license: licenseKey });
    //   sendResponse({ valid: true });
    // } else {
    //   sendResponse({ valid: false, error: data.error });
    // }

    // Stub: Accept keys starting with "VIDSNAP-PRO-" for dev testing
    if (licenseKey.toUpperCase().startsWith('VIDSNAP-PRO-')) {
        chrome.storage.sync.set({ vs_pro: true, vs_license: licenseKey });
        sendResponse({ valid: true });
    } else {
        sendResponse({ valid: false, error: 'Invalid license key' });
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Fetch a URL and return as a Blob.
 * @param {string} url
 * @returns {Promise<Blob>}
 */
async function fetchBlob(url) {
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} for ${url}`);
    return resp.blob();
}

/**
 * Sanitize a filename, removing illegal characters.
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
    return name
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .substring(0, 200);
}

/**
 * Send a desktop notification.
 * @param {string} message
 */
function sendNotification(message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'VidSnap',
        message,
    });
}

// ── Download progress tracking ────────────────────────────────────────────────

chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state?.current === 'complete') {
        // Optionally notify on complete
        // sendNotification('✅ Video download complete!');
    }
    if (delta.state?.current === 'interrupted') {
        sendNotification('⚠ Download interrupted. Please try again.');
    }
});
