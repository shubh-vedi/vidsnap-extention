/**
 * linkedin-interceptor.js — Runs in MAIN world to intercept LinkedIn video API responses.
 * Declared in manifest with "world": "MAIN" to bypass LinkedIn's CSP.
 *
 * LinkedIn's voyager API endpoint for video:
 *   /voyager/api/videoCentricFeed  or  /voyager/api/feed/updates
 * The video object has:
 *   - adaptiveStreams[]  → HLS .m3u8 — skip
 *   - progressiveStreams[] → direct MP4 — take these
 *   Each progressiveStream has: { streamingLocations: [{url}], bitRate, width, height, mediaType:"VIDEO" }
 *
 * The problem: "progressiveStreams" also appears in LinkedIn image/thumbnail objects.
 * Fix: only accept streamingLocation URLs whose path contains "/vid/" or ends with .mp4
 * AND only from responses where the URL contains "video" or from known video API endpoints.
 */

(function () {
    if (window.__vidsnapLiDone) return;
    window.__vidsnapLiDone = true;

    function isVideoUrl(url) {
        if (!url || url.indexOf('http') !== 0) return false;
        var lower = url.toLowerCase();
        // Reject known non-video URLs (cover images, thumbnails, profile pics)
        if (lower.indexOf('videocover') !== -1) return false;
        if (lower.indexOf('/image/') !== -1) return false;
        if (lower.indexOf('/profilephoto/') !== -1) return false;
        if (lower.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/)) return false;
        // Must contain video-related path segments or end in mp4
        return lower.indexOf('/vid/') !== -1
            || lower.indexOf('/video/') !== -1
            || lower.match(/\.mp4(\?|$)/)
            || (lower.indexOf('dms.licdn.com') !== -1 && lower.indexOf('/dms/') !== -1 && lower.indexOf('/vid') !== -1);
    }

    function isVideoApiEndpoint(url) {
        if (!url) return false;
        return url.indexOf('videoPlayMetadata') !== -1
            || url.indexOf('videoCentricFeed') !== -1
            || url.indexOf('videoCentricFeedV2') !== -1
            || url.indexOf('videoV2') !== -1
            || url.indexOf('/video') !== -1
            || url.indexOf('voyager') !== -1
            || url.indexOf('dms.licdn.com') !== -1
            || url.indexOf('media.licdn.com') !== -1
            || url.indexOf('playlistVideo') !== -1;
    }

    /**
     * Walk JSON to find progressiveStreams with VIDEO mediaType.
     * Returns array of {url, bitrate} sorted best-first.
     */
    function extractFromJson(json) {
        var results = [];
        function walk(obj, depth) {
            if (!obj || typeof obj !== 'object' || depth > 25) return;
            if (Array.isArray(obj)) {
                obj.forEach(function (item) { walk(item, depth + 1); });
                return;
            }

            // Check for progressiveStreams (main video source)
            if (obj.progressiveStreams && Array.isArray(obj.progressiveStreams)) {
                obj.progressiveStreams.forEach(function (stream) {
                    var mt = (stream.mediaType || '').toUpperCase();
                    if (mt && mt !== 'VIDEO') return;

                    // Must have width/height or bitrate to be a real video
                    if (!stream.bitRate && !stream.width && !stream.height) return;

                    if (stream.streamingLocations && Array.isArray(stream.streamingLocations)) {
                        stream.streamingLocations.forEach(function (loc) {
                            if (loc.url && isVideoUrl(loc.url)) {
                                results.push({ url: loc.url, bitrate: stream.bitRate || 0, width: stream.width, height: stream.height });
                            }
                        });
                    }
                });
            }

            // Check for direct video URLs
            if (typeof obj.url === 'string' && obj.url.match(/\.mp4(\?|$)/i)) {
                results.push({ url: obj.url, bitrate: obj.bitRate || 0 });
            }

            // Check for downloadUrl or playbackUrl
            if (typeof obj.downloadUrl === 'string' && obj.downloadUrl.match(/\.mp4/i)) {
                results.push({ url: obj.downloadUrl, bitrate: obj.bitrate || 0 });
            }
            if (typeof obj.playbackUrl === 'string' && obj.playbackUrl.match(/\.mp4/i)) {
                results.push({ url: obj.playbackUrl, bitrate: obj.bitrate || 0 });
            }

            // Check for adaptiveStreams (HLS, skip these)
            // Don't recurse into adaptiveStreams
            Object.keys(obj).forEach(function (key) {
                if (key === 'adaptiveStreams' || key === 'captions') return;
                walk(obj[key], depth + 1);
            });
        }
        walk(json, 0);
        return results;
    }

    function processResponse(text, fromVideoEndpoint) {
        // Quick check - only process if it contains video-related content
        if (text.indexOf('progressiveStreams') === -1 &&
            text.indexOf('.mp4') === -1 &&
            text.indexOf('video') === -1 &&
            text.indexOf('streamingLocations') === -1) return;

        var results = [];
        try {
            var json = JSON.parse(text);
            results = extractFromJson(json);
        } catch (e) {
            // partial/non-JSON — regex fallback
            if (fromVideoEndpoint || text.indexOf('progressiveStreams') !== -1) {
                var re = /"streamingLocations"\s*:\s*\[[^\]]*"url"\s*:\s*"([^"]+\.mp4[^"]*)"/g;
                var m;
                while ((m = re.exec(text)) !== null) {
                    results.push({ url: m[1].replace(/\\u002F/gi, '/').replace(/\\\//g, '/'), bitrate: 0 });
                }
            }
        }

        if (!results.length) return;

        // Sort by bitrate descending, deduplicate
        results.sort(function (a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
        var seen = {};
        var urls = [];
        results.forEach(function (r) {
            if (!seen[r.url]) {
                seen[r.url] = true;
                urls.push(r.url);
            }
        });

        if (urls.length) {
            console.log('[VidSnap LinkedIn] Captured video URLs:', urls.length, 'videos found');
            window.postMessage({ source: 'vidsnap-li', urls: urls }, '*');
        }
    }

    // Intercept fetch
    var _f = window.fetch;
    window.fetch = function () {
        var args = arguments;
        var p = _f.apply(this, args);
        try {
            var url = (typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url)) || '';
            var isVideoApi = isVideoApiEndpoint(url);
            var isLinkedIn = url.indexOf('linkedin.com') !== -1 || url.indexOf('licdn') !== -1;
            if (isLinkedIn) {
                p.then(function (r) {
                    try {
                        r.clone().text().then(function (t) {
                            processResponse(t, isVideoApi);
                        }).catch(function () { });
                    } catch (e) { }
                }).catch(function () { });
            }
        } catch (e) { }
        return p;
    };

    // Intercept XHR
    var _open = XMLHttpRequest.prototype.open;
    var _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        this._vsUrl = url;
        return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
        var self = this;
        this.addEventListener('load', function () {
            try {
                var url = self._vsUrl || '';
                var isLinkedIn = url.indexOf('linkedin.com') !== -1 || url.indexOf('licdn') !== -1;
                if (!isLinkedIn) return;
                processResponse(self.responseText || '', isVideoApiEndpoint(url));
            } catch (e) { }
        });
        return _send.apply(this, arguments);
    };
})();
