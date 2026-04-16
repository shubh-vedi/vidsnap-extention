/**
 * injector.js — Common button injection helpers for VidSnap
 * Shared across all platform-specific content scripts.
 * Provides: createDownloadButton(), showQualityPopup(), showToast(), showErrorToast()
 *
 * NOTE: This script may run at document_start (before DOM is ready).
 * All DOM operations are deferred safely.
 */

var VIDSNAP_BTN_CLASS = 'vidsnap-download-btn';
var VIDSNAP_POPUP_CLASS = 'vidsnap-quality-popup';

// ── Styles (deferred until head is available) ─────────────────────────────────

function injectStyles() {
  if (document.getElementById('vidsnap-styles')) return;
  const target = document.head || document.documentElement;
  if (!target) return;

  const style = document.createElement('style');
  style.id = 'vidsnap-styles';
  style.textContent = `
    .vidsnap-download-btn {
      position: absolute;
      z-index: 2147483647;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      background: rgba(15, 15, 15, 0.82);
      backdrop-filter: blur(8px);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 20px;
      cursor: pointer;
      pointer-events: all;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.22s ease, transform 0.22s ease, background 0.15s ease;
      box-shadow: 0 4px 20px rgba(0,0,0,0.45);
      user-select: none;
      text-decoration: none;
      white-space: nowrap;
    }
    .vidsnap-download-btn:hover {
      background: rgba(99, 102, 241, 0.88);
      border-color: rgba(99,102,241,0.5);
    }
    .vidsnap-download-btn.visible {
      opacity: 1 !important;
      transform: translateY(0) !important;
    }
    .vidsnap-download-btn svg {
      width: 14px; height: 14px; flex-shrink: 0;
    }

    /* Quality Popup */
    .vidsnap-quality-popup {
      position: fixed;
      z-index: 2147483647;
      background: #1a1a2e;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 14px;
      padding: 16px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.7);
      min-width: 220px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e2e2e2;
      animation: vsPopIn 0.2s ease;
    }
    @keyframes vsPopIn {
      from { opacity:0; transform: scale(0.9) translateY(6px); }
      to   { opacity:1; transform: scale(1)   translateY(0); }
    }
    .vidsnap-quality-popup h4 {
      margin: 0 0 12px;
      font-size: 13px;
      font-weight: 700;
      color: #a5b4fc;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .vidsnap-quality-popup .vs-quality-option {
      width: 100%;
      padding: 9px 14px;
      margin-bottom: 7px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 8px;
      color: #e2e2e2;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: background 0.15s ease, border-color 0.15s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .vidsnap-quality-popup .vs-quality-option:hover {
      background: rgba(99,102,241,0.25);
      border-color: rgba(99,102,241,0.5);
    }
    .vidsnap-quality-popup .vs-quality-option:last-child { margin-bottom: 0; }
    .vidsnap-quality-popup .vs-close {
      position: absolute;
      top: 10px; right: 12px;
      background: none; border: none;
      color: #888; cursor: pointer;
      font-size: 18px; line-height: 1;
      padding: 2px 6px;
    }
    .vidsnap-quality-popup .vs-close:hover { color: #fff; }

    /* Toast */
    .vidsnap-toast {
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      z-index: 2147483647;
      background: rgba(15,15,15,0.92);
      backdrop-filter: blur(12px);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      font-weight: 500;
      padding: 11px 22px;
      border-radius: 30px;
      box-shadow: 0 6px 30px rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.12);
      opacity: 0;
      transition: opacity 0.25s ease, transform 0.25s ease;
      pointer-events: none;
    }
    .vidsnap-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    /* Upgrade Modal */
    .vidsnap-upgrade-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      background: rgba(0,0,0,0.72);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: vsFadeIn 0.2s ease;
    }
    @keyframes vsFadeIn { from{opacity:0} to{opacity:1} }
    .vidsnap-upgrade-modal {
      background: linear-gradient(145deg, #1a1a2e, #16213e);
      border: 1px solid rgba(99,102,241,0.3);
      border-radius: 20px;
      padding: 32px;
      max-width: 360px;
      width: 90%;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e2e2e2;
      box-shadow: 0 24px 80px rgba(0,0,0,0.8);
    }
    .vidsnap-upgrade-modal h2 {
      margin: 0 0 8px;
      font-size: 22px;
      font-weight: 800;
      background: linear-gradient(135deg, #a5b4fc, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .vidsnap-upgrade-modal p {
      margin: 0 0 20px;
      font-size: 14px;
      color: #9ca3af;
      line-height: 1.5;
    }
    .vidsnap-upgrade-modal .vs-plan {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: all 0.15s;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .vidsnap-upgrade-modal .vs-plan:hover {
      background: rgba(99,102,241,0.2);
      border-color: rgba(99,102,241,0.5);
    }
    .vidsnap-upgrade-modal .vs-plan-name { font-weight: 600; font-size: 14px; }
    .vidsnap-upgrade-modal .vs-plan-price { color: #a5b4fc; font-weight: 700; font-size: 14px; }
    .vidsnap-upgrade-modal .vs-modal-close {
      display: block;
      margin-top: 16px;
      color: #6b7280;
      font-size: 13px;
      cursor: pointer;
      background: none; border: none;
    }
    .vidsnap-upgrade-modal .vs-modal-close:hover { color: #e2e2e2; }
  `;
  target.appendChild(style);
}

// Inject styles now if head is ready, otherwise defer
if (document.head || document.documentElement) {
  injectStyles();
}
document.addEventListener('DOMContentLoaded', injectStyles);

// ─── Download limit (freemium) ────────────────────────────────────────────────

/**
 * Check if the user has downloads remaining today.
 * Returns { allowed: boolean, remaining: number }
 */
async function checkDownloadLimit() {
  if (!chrome.storage || !chrome.storage.local) {
    return { allowed: true, remaining: 0 };
  }
  return new Promise((resolve) => {
    chrome.storage.local.get(['vs_downloads_today', 'vs_last_reset', 'vs_pro'], (data) => {
      if (data.vs_pro) return resolve({ allowed: true, remaining: Infinity });

      const today = new Date().toDateString();
      let count = data.vs_downloads_today || 0;
      const lastReset = data.vs_last_reset;

      if (lastReset !== today) {
        count = 0;
        chrome.storage.local.set({ vs_downloads_today: 0, vs_last_reset: today });
      }

      const FREE_LIMIT = 10;
      resolve({ allowed: count < FREE_LIMIT, remaining: FREE_LIMIT - count });
    });
  });
}

function incrementDownloadCount() {
  if (!chrome.storage || !chrome.storage.local) return;
  chrome.storage.local.get(['vs_downloads_today', 'vs_last_reset'], (data) => {
    const today = new Date().toDateString();
    const lastReset = data.vs_last_reset;
    let count = (lastReset === today) ? (data.vs_downloads_today || 0) : 0;
    chrome.storage.local.set({ vs_downloads_today: count + 1, vs_last_reset: today });
  });
}

// ─── Download history ─────────────────────────────────────────────────────────

function saveToHistory(entry) {
  if (!chrome.storage || !chrome.storage.local) return;
  chrome.storage.local.get(['vs_history'], (data) => {
    const history = data.vs_history || [];
    history.unshift({ ...entry, timestamp: Date.now() });
    if (history.length > 20) history.length = 20;
    chrome.storage.local.set({ vs_history: history });
  });
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function showUpgradeModal() {
  if (!document.body) return;
  const overlay = document.createElement('div');
  overlay.className = 'vidsnap-upgrade-overlay';
  overlay.innerHTML = `
    <div class="vidsnap-upgrade-modal">
      <h2>🚀 Upgrade to Pro</h2>
      <p>You've reached your 10 free downloads today. Upgrade for unlimited downloads.</p>
      <div class="vs-plan">
        <span class="vs-plan-name">⚡ Pro Monthly</span>
        <span class="vs-plan-price">$2.99/mo</span>
      </div>
      <div class="vs-plan">
        <span class="vs-plan-name">🌟 Pro Yearly</span>
        <span class="vs-plan-price">$19.99/yr</span>
      </div>
      <div class="vs-plan">
        <span class="vs-plan-name">♾️ Lifetime</span>
        <span class="vs-plan-price">$39.99</span>
      </div>
      <button class="vs-modal-close">Maybe later</button>
    </div>
  `;
  overlay.querySelector('.vs-modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelectorAll('.vs-plan').forEach((plan) => {
    plan.addEventListener('click', () => {
      showToast('💳 Payment integration coming soon!');
      overlay.remove();
    });
  });
  document.body.appendChild(overlay);
}

function showQualityPopup(anchorEl, options, onSelect) {
  document.querySelectorAll('.' + VIDSNAP_POPUP_CLASS).forEach(el => el.remove());

  const popup = document.createElement('div');
  popup.className = VIDSNAP_POPUP_CLASS;

  const icons = { best: '✨', hd: '🎬', sd: '📱', audio: '🎵' };

  popup.innerHTML = `
    <button class="vs-close">✕</button>
    <h4>Select Quality</h4>
    ${options.map(o => `
      <button class="vs-quality-option" data-quality="${o.quality}">
        <span>${icons[o.quality] || '📥'}</span>
        <span>${o.label}</span>
      </button>
    `).join('')}
  `;

  document.body.appendChild(popup);

  const rect = anchorEl.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  let top = rect.bottom + 8;
  let left = rect.left;
  if (left + popupRect.width > window.innerWidth - 16) {
    left = window.innerWidth - popupRect.width - 16;
  }
  if (top + popupRect.height > window.innerHeight - 16) {
    top = rect.top - popupRect.height - 8;
  }
  popup.style.top = `${Math.max(8, top)}px`;
  popup.style.left = `${Math.max(8, left)}px`;

  popup.querySelector('.vs-close').addEventListener('click', () => popup.remove());
  popup.querySelectorAll('.vs-quality-option').forEach(btn => {
    btn.addEventListener('click', () => {
      onSelect(btn.dataset.quality);
      popup.remove();
    });
  });

  setTimeout(() => {
    const closeOutside = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', closeOutside);
      }
    };
    document.addEventListener('click', closeOutside);
  }, 50);
}

function showToast(message, duration = 3000) {
  if (!document.body) return;
  document.querySelectorAll('.vidsnap-toast').forEach(el => el.remove());
  const toast = document.createElement('div');
  toast.className = 'vidsnap-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function showErrorToast(message) {
  showToast(`⚠ ${message}`, 5000);
}

function createDownloadButton(label = '⬇ VidSnap') {
  const btn = document.createElement('button');
  btn.className = VIDSNAP_BTN_CLASS;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v13M7 11l5 5 5-5"/><path d="M5 21h14"/>
    </svg>
    ${label}
  `;
  return btn;
}

function attachHoverVisibility(container, btn) {
  container.addEventListener('mouseenter', () => btn.classList.add('visible'));
  container.addEventListener('mouseleave', () => btn.classList.remove('visible'));
}

async function triggerDownload(opts) {
  if (!chrome.runtime || !chrome.runtime.sendMessage) {
    showErrorToast('Extension context lost. Please refresh the page and try again.');
    return;
  }

  const limit = await checkDownloadLimit();
  if (!limit.allowed) {
    showUpgradeModal();
    return;
  }

  incrementDownloadCount();
  saveToHistory({
    url: opts.url,
    platform: opts.platform,
    filename: opts.filename,
    thumbnail: opts.thumbnail || null,
  });

  chrome.runtime.sendMessage({
    action: 'download',
    url: opts.url,
    filename: opts.filename,
    platform: opts.platform,
  }, (response) => {
    if (chrome.runtime.lastError || (response && response.error)) {
      showErrorToast('Could not extract video. Try right-clicking the video and saving directly.');
    } else {
      showToast('✅ Video saved!');
    }
  });
}

// Expose helpers to platform scripts immediately (available even at document_start)
window.__vidsnap = {
  createDownloadButton,
  showQualityPopup,
  showToast,
  showErrorToast,
  triggerDownload,
  attachHoverVisibility,
};
