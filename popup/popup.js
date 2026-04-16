/**
 * popup.js — VidSnap Popup Logic
 * Handles: history display, settings persistence, freemium count, license activation
 */

'use strict';

// ── Platform display helpers ──────────────────────────────────────────────────

const PLATFORM_ICONS = {
    reddit: '🔴',
    twitter: '🐦',
    instagram: '📸',
    tiktok: '🎵',
    linkedin: '💼',
    vimeo: '🎬',
    'context-menu': '🖱',
};

function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString();
}

function truncate(str, max = 36) {
    if (!str) return 'Unknown video';
    return str.length > max ? str.substring(0, max) + '…' : str;
}

// ── History Tab ───────────────────────────────────────────────────────────────

function renderHistory(history) {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');

    list.innerHTML = '';

    if (!history || !history.length) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    history.forEach((item) => {
        const platform = item.platform || 'unknown';
        const icon = PLATFORM_ICONS[platform] || '📥';
        const timeStr = formatTimestamp(item.timestamp);
        const filename = truncate(item.filename || 'video.mp4');

        // Build DOM safely to prevent XSS (no innerHTML with user data)
        const el = document.createElement('div');
        el.className = 'history-item';

        const thumbDiv = document.createElement('div');
        thumbDiv.className = 'history-thumb';
        if (item.thumbnail && typeof item.thumbnail === 'string' && item.thumbnail.startsWith('http')) {
            const img = document.createElement('img');
            img.src = item.thumbnail;
            img.alt = 'thumb';
            img.onerror = function () { this.parentElement.textContent = icon; };
            thumbDiv.appendChild(img);
        } else {
            thumbDiv.textContent = icon;
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = 'history-info';
        const fnDiv = document.createElement('div');
        fnDiv.className = 'history-filename';
        fnDiv.title = item.filename || '';
        fnDiv.textContent = filename;
        const metaDiv = document.createElement('div');
        metaDiv.className = 'history-meta';
        const pill = document.createElement('span');
        pill.className = `platform-pill ${platform}`;
        pill.textContent = platform;
        metaDiv.appendChild(pill);
        metaDiv.appendChild(document.createTextNode(' ' + timeStr));
        infoDiv.appendChild(fnDiv);
        infoDiv.appendChild(metaDiv);

        const reBtn = document.createElement('button');
        reBtn.className = 'history-redownload';
        reBtn.title = 'Download again';
        reBtn.textContent = '⬇';

        el.appendChild(thumbDiv);
        el.appendChild(infoDiv);
        el.appendChild(reBtn);

        reBtn.addEventListener('click', () => {
            const url = item.url;
            if (!url) return;
            chrome.runtime.sendMessage({
                action: 'download',
                url,
                filename: item.filename || `vidsnap_redownload_${Date.now()}.mp4`,
                platform: item.platform,
            });
            showPopupToast('⬇ Re-downloading…');
        });

        list.appendChild(el);
    });
}

function loadHistory() {
    chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
        renderHistory(response?.history || []);
    });
}

// ── Download Counter ──────────────────────────────────────────────────────────

function updateDownloadCounter() {
    chrome.storage.local.get(['vs_downloads_today', 'vs_last_reset', 'vs_pro'], (data) => {
        const countLabel = document.getElementById('count-label');
        const downloadCountEl = document.getElementById('download-count');
        const proBadge = document.getElementById('pro-badge');

        if (data.vs_pro) {
            countLabel.textContent = '∞ left';
            proBadge.textContent = 'PRO';
            proBadge.classList.add('is-pro');
            document.getElementById('footer-upgrade').style.display = 'none';
            return;
        }

        const today = new Date().toDateString();
        const count = data.vs_last_reset === today ? (data.vs_downloads_today || 0) : 0;
        const remaining = Math.max(0, 10 - count);
        countLabel.textContent = `${remaining} left`;

        if (remaining <= 2) {
            downloadCountEl.style.color = '#ef4444';
        } else if (remaining <= 5) {
            downloadCountEl.style.color = '#f59e0b';
        }
    });
}

// ── Settings ──────────────────────────────────────────────────────────────────

const SETTINGS_KEYS = ['vs_autodetect', 'vs_notifications', 'vs_quality'];

function loadSettings() {
    chrome.storage.local.get(SETTINGS_KEYS, (data) => {
        const autodetect = data.vs_autodetect !== false; // default true
        const notifications = data.vs_notifications !== false; // default true
        const quality = data.vs_quality || 'best';

        document.getElementById('toggle-autodetect').checked = autodetect;
        document.getElementById('toggle-notifications').checked = notifications;
        document.getElementById('select-quality').value = quality;
    });
}

function bindSettingsListeners() {
    document.getElementById('toggle-autodetect').addEventListener('change', (e) => {
        chrome.storage.local.set({ vs_autodetect: e.target.checked });
    });
    document.getElementById('toggle-notifications').addEventListener('change', (e) => {
        chrome.storage.local.set({ vs_notifications: e.target.checked });
    });
    document.getElementById('select-quality').addEventListener('change', (e) => {
        chrome.storage.local.set({ vs_quality: e.target.value });
    });
}

// ── License Activation ────────────────────────────────────────────────────────

function bindLicenseActivation() {
    const btn = document.getElementById('license-btn');
    const input = document.getElementById('license-input');
    const status = document.getElementById('license-status');

    // Show current status if pro
    chrome.storage.sync.get(['vs_pro', 'vs_license'], (data) => {
        if (data.vs_pro && data.vs_license) {
            status.textContent = `✅ Pro activated (${data.vs_license.substring(0, 16)}…)`;
            status.className = 'license-status valid';
            input.value = data.vs_license;
        }
    });

    btn.addEventListener('click', () => {
        const key = input.value.trim();
        if (!key) {
            status.textContent = 'Please enter a license key.';
            status.className = 'license-status invalid';
            return;
        }

        btn.textContent = '…';
        btn.disabled = true;

        chrome.runtime.sendMessage({ action: 'validateLicense', licenseKey: key }, (response) => {
            btn.textContent = 'Activate';
            btn.disabled = false;

            if (response?.valid) {
                status.textContent = '✅ Pro license activated!';
                status.className = 'license-status valid';
                document.getElementById('pro-badge').textContent = 'PRO';
                document.getElementById('pro-badge').classList.add('is-pro');
                document.getElementById('footer-upgrade').style.display = 'none';
                document.getElementById('count-label').textContent = '∞ left';
                showPopupToast('🎉 Pro activated!');
            } else {
                status.textContent = `❌ ${response?.error || 'Invalid key'}`;
                status.className = 'license-status invalid';
            }
        });
    });

    // Allow Enter key in input
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btn.click();
    });
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function bindTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;

            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`panel-${target}`).classList.add('active');
        });
    });
}

// ── Clear History ─────────────────────────────────────────────────────────────

function bindClearHistory() {
    document.getElementById('clear-history-btn').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'clearHistory' }, () => {
            loadHistory();
            showPopupToast('🗑 History cleared');
        });
    });
}

// ── Upgrade Modal ─────────────────────────────────────────────────────────────

function bindUpgradeModal() {
    const overlay = document.getElementById('upgrade-overlay');
    const closeBtn = document.getElementById('modal-close');
    const upgradeBtn = document.getElementById('upgrade-btn');

    upgradeBtn.addEventListener('click', () => overlay.classList.remove('hidden'));
    closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
    });

    overlay.querySelectorAll('.plan').forEach((plan) => {
        plan.addEventListener('click', () => {
            // TODO: Open Stripe payment link for selected plan
            showPopupToast('💳 Payment integration coming soon!');
            overlay.classList.add('hidden');
        });
    });
}

// ── Toast (popup-internal) ────────────────────────────────────────────────────

function showPopupToast(message) {
    let toast = document.getElementById('popup-toast-internal');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'popup-toast-internal';
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '60px',
            left: '50%',
            transform: 'translateX(-50%) translateY(10px)',
            background: 'rgba(15,15,25,0.95)',
            color: '#e2e8f0',
            fontSize: '12px',
            fontWeight: '600',
            fontFamily: 'Inter, sans-serif',
            padding: '8px 16px',
            borderRadius: '20px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.1)',
            opacity: '0',
            transition: 'opacity 0.2s ease, transform 0.2s ease',
            zIndex: '999',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
        });
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    requestAnimationFrame(() => {
        Object.assign(toast.style, { opacity: '1', transform: 'translateX(-50%) translateY(0)' });
    });
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        Object.assign(toast.style, { opacity: '0', transform: 'translateX(-50%) translateY(10px)' });
    }, 2500);
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    loadHistory();
    updateDownloadCounter();
    loadSettings();
    bindSettingsListeners();
    bindLicenseActivation();
    bindTabs();
    bindClearHistory();
    bindUpgradeModal();
});
