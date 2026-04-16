# VidSnap — Video Downloader Chrome Extension

> **Download videos from Reddit, Twitter/X, Instagram, TikTok, LinkedIn, and Vimeo with one click.**

A Manifest V3 Chrome Extension with a floating in-page download button, quality selection, freemium gating, and download history.

---

## 🚀 Installation (Developer Mode)

1. Clone or download this folder (`vidsnap-extension/`)
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer Mode** (toggle in the top-right corner)
4. Click **"Load unpacked"**
5. Select the `vidsnap-extension/` folder
6. The VidSnap icon will appear in your Chrome toolbar ✅

---

## ✨ Features

| Feature | Details |
|---|---|
| **Auto-detect & Button** | Floating "⬇ VidSnap" button appears on hover over any detected video |
| **Quality Selector** | SD / HD / Best popup before every download |
| **Download History** | Last 20 downloads stored locally with re-download button |
| **Right-click Menu** | "Download video with VidSnap" context menu on any supported page |
| **Freemium Gating** | 10 free downloads/day; Pro = unlimited |
| **Notifications** | Desktop + in-page toast on save |

---

## 🧩 How Each Extractor Works

### 🔴 Reddit (`content/reddit.js`)
Reddit hosts videos on `v.redd.it` as MPEG-DASH streams. The extension:
1. Finds the DASH manifest URL (`DASHPlaylist.mpd`) from `<shreddit-player>` attributes or `<video>` src
2. Fetches and parses the MPD XML to enumerate video and audio `AdaptationSet`s
3. Presents quality options (360p → 1080p) in a popup
4. Downloads via the background service worker; audio is fetched separately
5. **Fallback**: If audio merge fails, downloads video-only with a toast warning

> **Note**: Full A/V merge requires `ffmpeg.wasm` loaded in a Chrome Offscreen Document. The current implementation downloads video-only as a fallback. See `background/service-worker.js` for the ffmpeg.wasm integration stub.

---

### 🐦 Twitter / X (`content/twitter.js`)
Twitter serves videos via M3U8 HLS and direct mp4 variants through its GraphQL API. The extension:
1. Injects a script into the **MAIN world** to intercept `fetch()` and `XMLHttpRequest`
2. Watches for responses to `TweetDetail`/`TweetResult` endpoints
3. Parses the `variants[]` array from media entities, sorting by `bitrate`
4. Lets the user pick HD / SD / Low before downloading the direct mp4 URL

---

### 📸 Instagram (`content/instagram.js`)
Instagram embeds video data in `<script type="application/json">` blocks and API responses. The extension:
1. Walks all inline JSON blobs recursively searching for `video_url` and `video_versions[]` keys
2. Injects a MAIN-world interceptor for dynamic `fetch()` API calls (Reels / Stories)
3. Falls back to the `og:video` meta tag
4. Offers "Best Quality" and alternative stream options

---

### 🎵 TikTok (`content/tiktok.js`)
TikTok bakes all video data into `window.__UNIVERSAL_DATA_FOR_REHYDRATION__` and `__NEXT_DATA__`. The extension:
1. Parses these JSON blobs for `downloadAddr` (watermark-free) and `playAddr` fields
2. Prefers `downloadAddr` — this is the official, watermark-free download URL
3. For scroll-fed content, injects a MAIN-world `fetch()` interceptor to capture API responses
4. Presents "Watermark-Free (Best)" as the primary option

---

### 💼 LinkedIn (`content/linkedin.js`)
LinkedIn videos live on the Voyager API as `progressiveStreams[]`. The extension:
1. Injects a MAIN-world interceptor for `fetch()` and XHR calls to `api.linkedin.com/voyager`
2. Recursively traverses responses to find `progressiveStreams[].streamingLocations[].url`  
3. Also reads `<video>` src directly from the DOM
4. Sorts streams by bitrate/resolution for quality options

---

### 🎬 Vimeo (`content/vimeo.js`)
Vimeo embeds a full player config JSON in the page. The extension:
1. Reads `<script id="__vimeo_player_config__">` or searches inline scripts for `files.progressive[]`
2. Parses out direct mp4 URLs at 360p / 540p / 720p / 1080p with their heights
3. Falls back to fetching `https://player.vimeo.com/video/{id}/config` via the public API
4. Note: Private/DRM-protected videos cannot be downloaded

---

## 📁 Project Structure

```
vidsnap-extension/
├── manifest.json               ← Manifest V3 config
├── README.md
├── background/
│   └── service-worker.js       ← Downloads, context menus, license, notifications
├── content/
│   ├── injector.js             ← Shared UI: button, popup, toast, freemium check
│   ├── reddit.js               ← DASH MPD extractor
│   ├── twitter.js              ← HLS/mp4 variant interceptor
│   ├── instagram.js            ← JSON blob + API interceptor
│   ├── tiktok.js               ← Page data + feed interceptor
│   ├── linkedin.js             ← Voyager API interceptor
│   └── vimeo.js                ← Player config parser
├── popup/
│   ├── popup.html              ← Extension popup UI (400px)
│   ├── popup.css               ← Dark glassmorphism styles
│   └── popup.js                ← History, settings, license activation
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🔐 Freemium Model

| Tier | Limit | Price |
|---|---|---|
| **Free** | 10 downloads/day (resets at midnight) | Free |
| **Pro Monthly** | Unlimited | $2.99/mo |
| **Pro Yearly** | Unlimited | $19.99/yr |
| **Lifetime** | Unlimited | $39.99 |

To activate Pro, enter a license key in the extension popup → **Settings** tab.  
Dev testing: any key starting with `VIDSNAP-PRO-` will activate Pro locally.

> **TODO**: Replace the license stub in `background/service-worker.js → handleLicenseValidation()` with a real Stripe + backend API call.

---

## 🛠 Permissions Explained

| Permission | Why |
|---|---|
| `activeTab` | Read current page URL for platform detection |
| `downloads` | Trigger file downloads via `chrome.downloads.download()` |
| `scripting` | Inject extractors via context menu action |
| `contextMenus` | Right-click "Download with VidSnap" |
| `storage` | History, settings, freemium counter |
| `notifications` | Desktop toast on download complete |

---

## ⚠️ Known Limitations

- **Reddit A/V merge**: Requires ffmpeg.wasm in a Chrome Offscreen Document for proper merge. Current build downloads video-only as fallback.
- **Instagram private / Stories**: May not work for private accounts without a logged-in session.
- **TikTok bot detection**: If TikTok updates its anti-bot measures, the downloadAddr field may be blocked.
- **LinkedIn**: Only works for public posts visible in your feed.
- **No YouTube support**: Chrome Web Store policy prohibits YouTube downloaders.
- **No DRM bypass**: Netflix, Disney+, Prime Video are intentionally not supported.

---

## 🧪 Testing Locally

After loading unpacked:
1. Visit [Reddit](https://reddit.com) → hover over a video → click ⬇ VidSnap
2. Visit [Twitter/X](https://x.com) → open a video tweet → click ⬇ VidSnap  
3. Visit [Vimeo](https://vimeo.com) → open any public video → click ⬇ VidSnap
4. Right-click any supported page → "Download video with VidSnap"
5. Click the VidSnap toolbar icon → view download history & settings

---

## 📜 License

MIT — Free to use and modify for personal projects.
