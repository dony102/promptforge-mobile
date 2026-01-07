/**
 * PromptForge Mobile PWA
 * AI Prompt Generator - Mobile Version
 * © 2026 Muhammad Anggi
 */

// ========================================
// Configuration & State
// ========================================
const CONFIG = {
    LICENSE_SECRET: 'PromptForge-2026-MAnggi-Secret',
    STORAGE_KEYS: {
        API_KEY: 'pf_gemini_key',
        MODEL: 'pf_gemini_model',
        HISTORY: 'pf_history',
        LICENSE_KEY: 'pf_license_key',
        MACHINE_ID: 'pf_machine_id'
    }
};

let state = {
    imageDataUrl: null,
    isGenerating: false,
    prompts: [],
    machineId: null,
    licenseValid: false
};

// Template Preset Configurations
const TEMPLATE_PRESETS = {
    product: {
        style: 'realistic',
        aspectRatio: '1:1',
        prefix: '',
        params: '--style raw --no human, isolated on white background'
    },
    character: {
        style: 'fantasy',
        aspectRatio: '3:2',
        prefix: '',
        params: 'full body, detailed, character design'
    },
    logo: {
        style: 'minimalist',
        aspectRatio: '1:1',
        prefix: '',
        params: 'vector, clean lines, simple, iconic'
    },
    landscape: {
        style: 'cinematic',
        aspectRatio: '16:9',
        prefix: '',
        params: 'wide angle, cinematic lighting, epic'
    },
    portrait: {
        style: 'realistic',
        aspectRatio: '3:2',
        prefix: '',
        params: 'portrait photography, professional lighting'
    },
    anime: {
        style: 'anime',
        aspectRatio: '9:16',
        prefix: '',
        params: 'anime style, detailed, vibrant colors'
    }
};

// ========================================
// Utility Functions
// ========================================
const el = (id) => document.getElementById(id);

function showToast(message, type = 'default') {
    const toast = el('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
    }
}

function formatDate(date) {
    return date.toLocaleDateString('id-ID', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// ========================================
// LICENSE SYSTEM - Device ID Based
// ========================================

// Generate unique Machine ID from browser fingerprint
async function generateMachineId() {
    // Check if we already have one stored
    const stored = localStorage.getItem(CONFIG.STORAGE_KEYS.MACHINE_ID);
    if (stored) {
        state.machineId = stored;
        return stored;
    }

    try {
        // Collect browser fingerprint data
        const data = [
            navigator.userAgent,
            navigator.language,
            screen.width + 'x' + screen.height,
            screen.colorDepth,
            new Date().getTimezoneOffset(),
            navigator.hardwareConcurrency || 'unknown',
            navigator.platform,
            // Add some randomness for uniqueness
            Math.random().toString(36).substring(2, 8)
        ].join('|');

        // Create hash using SubtleCrypto
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Format as readable machine ID
        state.machineId = hashHex.substring(0, 16).toUpperCase().match(/.{4}/g).join('-');

        // Store it permanently
        localStorage.setItem(CONFIG.STORAGE_KEYS.MACHINE_ID, state.machineId);

        return state.machineId;
    } catch (e) {
        console.error('Machine ID generation failed:', e);
        // Fallback to random ID
        state.machineId = 'XXXX-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' +
            Math.random().toString(36).substring(2, 6).toUpperCase() + '-' +
            Math.random().toString(36).substring(2, 6).toUpperCase();
        localStorage.setItem(CONFIG.STORAGE_KEYS.MACHINE_ID, state.machineId);
        return state.machineId;
    }
}

// Generate expected license key from machine ID (must match admin tool)
function generateMachineHash(machineId) {
    let hash = 0;
    const combined = machineId + CONFIG.LICENSE_SECRET;
    for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

// Validate license key format and check against machine ID
function validateLicenseKey(machineId, licenseKey) {
    if (!machineId || !licenseKey) return false;

    // License format: PF-XXXX-XXXX-XXXX-XXXX-XXXX
    const cleanKey = licenseKey.toUpperCase().trim();
    if (!cleanKey.startsWith('PF-')) return false;

    const parts = cleanKey.split('-');
    if (parts.length !== 6) return false;

    // Validate using hash
    const hash = generateMachineHash(machineId);
    const segment1 = (hash % 10000).toString().padStart(4, '0');
    const segment2 = ((hash >> 4) % 10000).toString().padStart(4, '0');
    const segment3 = ((hash >> 8) % 10000).toString().padStart(4, '0');

    // Check first 3 segments match
    return parts[1] === segment1 && parts[2] === segment2 && parts[3] === segment3;
}

// Check if license is valid
async function checkLicense() {
    const machineId = await generateMachineId();
    const licenseKey = localStorage.getItem(CONFIG.STORAGE_KEYS.LICENSE_KEY);

    if (licenseKey && validateLicenseKey(machineId, licenseKey)) {
        state.licenseValid = true;
        return true;
    }

    state.licenseValid = false;
    return false;
}

// Show/hide license modal
function showLicenseModal(show = true) {
    const modal = el('licenseModal');
    if (modal) {
        modal.style.display = show ? 'flex' : 'none';
    }

    // Update machine ID display
    if (show && state.machineId) {
        el('machineIdDisplay').textContent = state.machineId;
    }
}

// Lock/unlock main UI
function setUILocked(locked) {
    const mainContent = el('mainContent');
    if (locked) {
        if (mainContent) {
            mainContent.style.filter = 'blur(5px)';
            mainContent.style.pointerEvents = 'none';
        }
        showLicenseModal(true);
    } else {
        if (mainContent) {
            mainContent.style.filter = '';
            mainContent.style.pointerEvents = '';
        }
        showLicenseModal(false);
    }
}

// Activate license
async function activateLicense() {
    const input = el('licenseKeyInput');
    const status = el('licenseStatus');
    const licenseKey = (input?.value || '').trim();

    if (!licenseKey) {
        status.innerHTML = '<span style="color:#f38ba8">Please enter a license key</span>';
        return;
    }

    const machineId = state.machineId || await generateMachineId();
    const isValid = validateLicenseKey(machineId, licenseKey);

    if (isValid) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.LICENSE_KEY, licenseKey.toUpperCase().trim());
        state.licenseValid = true;
        status.innerHTML = '<span style="color:#a6e3a1">✅ License activated successfully!</span>';
        showToast('License activated! 🎉', 'success');
        setTimeout(() => setUILocked(false), 1000);
    } else {
        status.innerHTML = '<span style="color:#f38ba8">❌ Invalid license key</span>';
        showToast('Invalid license key', 'error');
    }
}

// Copy machine ID
async function copyMachineId() {
    if (state.machineId) {
        await copyToClipboard(state.machineId);
        showToast('Machine ID copied! 📋', 'success');
    }
}

// ========================================
// Settings Management
// ========================================
function loadSettings() {
    const key = localStorage.getItem(CONFIG.STORAGE_KEYS.API_KEY) || '';
    const model = localStorage.getItem(CONFIG.STORAGE_KEYS.MODEL) || 'gemini-2.5-flash-lite';

    el('geminiKey').value = key;
    el('geminiModel').value = model;

    updateGenerateButton();
}

function saveSettings() {
    const key = el('geminiKey').value.trim();
    const model = el('geminiModel').value;

    localStorage.setItem(CONFIG.STORAGE_KEYS.API_KEY, key);
    localStorage.setItem(CONFIG.STORAGE_KEYS.MODEL, model);

    showToast('Settings saved! ✅', 'success');
    updateGenerateButton();

    // Collapse settings
    el('settingsCard').classList.add('collapsed');
}

// ========================================
// Image Handling
// ========================================
function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
        showToast('Please select an image file', 'error');
        return;
    }

    try {
        const dataUrl = await compressImage(file, 1024, 0.85);
        setPreviewImage(dataUrl);
    } catch (err) {
        showToast('Failed to load image: ' + err.message, 'error');
    }
}

async function compressImage(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;

            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = Math.round(height * maxSize / width);
                    width = maxSize;
                } else {
                    width = Math.round(width * maxSize / height);
                    height = maxSize;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

function setPreviewImage(dataUrl) {
    state.imageDataUrl = dataUrl;
    const preview = el('preview');
    preview.innerHTML = `<img src="${dataUrl}" alt="Preview">`;
    updateGenerateButton();
}

function clearPreview() {
    state.imageDataUrl = null;
    el('preview').innerHTML = `
    <div class="placeholder">
      <span class="placeholder-icon">🖼️</span>
      <span>Tap Camera or Gallery to add image</span>
    </div>
  `;
    updateGenerateButton();
}

async function handlePaste() {
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            for (const type of item.types) {
                if (type.startsWith('image/')) {
                    const blob = await item.getType(type);
                    await handleImageFile(blob);
                    showToast('Image pasted! 📋', 'success');
                    return;
                }
            }
        }
        showToast('No image in clipboard', 'error');
    } catch (err) {
        showToast('Cannot access clipboard. Try upload instead.', 'error');
    }
}

// ========================================
// URL Image Extraction
// ========================================
function extractYouTubeId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

async function extractImageFromUrl() {
    const urlInput = el('urlInput');
    const status = el('urlStatus');
    const btn = el('btnExtractUrl');

    const url = urlInput.value.trim();
    if (!url) {
        status.textContent = '❌ Please enter a URL';
        status.className = 'url-status error';
        return;
    }

    btn.disabled = true;
    status.textContent = '⏳ Extracting...';
    status.className = 'url-status loading';

    try {
        let imageUrl;

        const ytId = extractYouTubeId(url);
        if (ytId) {
            imageUrl = `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;
        } else if (url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) {
            imageUrl = url;
        } else {
            throw new Error('Unsupported URL. Use YouTube or direct image URL.');
        }

        const dataUrl = await loadImageAsDataUrl(imageUrl);
        setPreviewImage(dataUrl);

        urlInput.value = '';
        status.textContent = '✅ Image loaded!';
        status.className = 'url-status success';
        showToast('Image extracted! 🔗', 'success');

    } catch (err) {
        status.textContent = '❌ ' + err.message;
        status.className = 'url-status error';
    } finally {
        btn.disabled = false;
    }
}

async function loadImageAsDataUrl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            try {
                resolve(canvas.toDataURL('image/jpeg', 0.9));
            } catch (e) {
                reject(new Error('Cannot load image (CORS blocked)'));
            }
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = url;
        setTimeout(() => reject(new Error('Timeout')), 15000);
    });
}

// ========================================
// Gemini API Integration
// ========================================
async function callGeminiAPI(imageDataUrl, options) {
    const apiKey = localStorage.getItem(CONFIG.STORAGE_KEYS.API_KEY);
    const model = localStorage.getItem(CONFIG.STORAGE_KEYS.MODEL) || 'gemini-2.5-flash-lite';

    if (!apiKey) {
        throw new Error('Please set your Gemini API key in Settings');
    }

    const base64Match = imageDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
        throw new Error('Invalid image data');
    }

    const mimeType = `image/${base64Match[1]}`;
    const base64Data = base64Match[2];

    let prompt = `You are an expert AI prompt engineer. Analyze this image and generate a creative, detailed prompt that could recreate it using an AI image generator like Midjourney or DALL-E.

Requirements:
- Maximum ${options.maxChars} characters
- Be descriptive about style, lighting, composition, colors, mood
- Use comma-separated keywords/phrases
- Do NOT include any explanations, just the prompt itself`;

    if (options.aspectRatio) {
        prompt += `\n- Include aspect ratio: ${options.aspectRatio}`;
    }

    if (options.style) {
        prompt += `\n- Apply ${options.style} style`;
    }

    if (options.extraParams) {
        prompt += `\n- End with these parameters: ${options.extraParams}`;
    }

    prompt += '\n\nGenerate the prompt now:';

    const requestBody = {
        contents: [{
            parts: [
                { text: prompt },
                {
                    inline_data: {
                        mime_type: mimeType,
                        data: base64Data
                    }
                }
            ]
        }],
        generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 500
        }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (response.status === 429) {
            throw new Error('Rate limit exceeded. Wait a moment and try again.');
        }
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        throw new Error('No response from API');
    }

    return text.trim();
}

// ========================================
// Generate Prompts
// ========================================
function updateGenerateButton() {
    const hasImage = !!state.imageDataUrl;
    const hasApiKey = !!localStorage.getItem(CONFIG.STORAGE_KEYS.API_KEY);
    const hasLicense = state.licenseValid;

    const btn = el('btnGenerate');
    btn.disabled = !hasImage || !hasApiKey || state.isGenerating || !hasLicense;

    if (!hasLicense) {
        btn.querySelector('.btn-text').textContent = '🔒 Activate License First';
    } else if (!hasApiKey) {
        btn.querySelector('.btn-text').textContent = '⚠️ Set API Key First';
    } else if (!hasImage) {
        btn.querySelector('.btn-text').textContent = '📷 Add Image First';
    } else {
        btn.querySelector('.btn-text').textContent = '✨ Generate Prompts';
    }
}

async function generatePrompts() {
    if (state.isGenerating || !state.imageDataUrl || !state.licenseValid) return;

    const numPrompts = parseInt(el('numPrompts').value) || 2;
    const maxChars = parseInt(el('maxChars').value) || 250;
    const aspectRatio = el('aspectRatio').value;
    const style = el('styleSelect').value;
    const extraParams = el('extraParams').value.trim();

    state.isGenerating = true;
    state.prompts = [];

    el('btnGenerate').disabled = true;
    el('btnGenerate').querySelector('.btn-text').style.display = 'none';
    el('btnGenerate').querySelector('.btn-loading').style.display = 'inline';

    el('progressSection').style.display = 'block';
    el('outputSection').style.display = 'block';
    el('promptsList').innerHTML = '';

    const progressFill = el('progressFill');
    const progressText = el('progressText');

    try {
        for (let i = 0; i < numPrompts; i++) {
            const percent = ((i + 1) / numPrompts) * 100;
            progressFill.style.width = `${percent}%`;
            progressText.textContent = `${i + 1} / ${numPrompts}`;

            const promptText = await callGeminiAPI(state.imageDataUrl, {
                maxChars, aspectRatio, style, extraParams
            });

            state.prompts.push(promptText);
            addPromptToList(i + 1, promptText);

            if (i < numPrompts - 1) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        saveToHistory(state.imageDataUrl, state.prompts);
        showToast(`Generated ${numPrompts} prompts! ✨`, 'success');

    } catch (err) {
        showToast(err.message, 'error');
        console.error('Generation error:', err);
    } finally {
        state.isGenerating = false;
        el('btnGenerate').querySelector('.btn-text').style.display = 'inline';
        el('btnGenerate').querySelector('.btn-loading').style.display = 'none';
        updateGenerateButton();
    }
}

function addPromptToList(number, text) {
    const item = document.createElement('div');
    item.className = 'prompt-item';
    item.innerHTML = `
    <span class="prompt-number">#${number}</span>
    <button class="prompt-copy" onclick="copyPrompt(${number - 1})">📋 Copy</button>
    <p class="prompt-text">${escapeHtml(text)}</p>
  `;
    el('promptsList').appendChild(item);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function copyPrompt(index) {
    if (state.prompts[index]) {
        await copyToClipboard(state.prompts[index]);
        showToast('Prompt copied! 📋', 'success');
    }
}

async function copyAllPrompts() {
    if (state.prompts.length === 0) {
        showToast('No prompts to copy', 'error');
        return;
    }

    const text = state.prompts.map((p, i) => `#${i + 1}\n${p}`).join('\n\n');
    await copyToClipboard(text);
    showToast('All prompts copied! 📋', 'success');
}

function clearOutput() {
    state.prompts = [];
    el('promptsList').innerHTML = '';
    el('outputSection').style.display = 'none';
    el('progressSection').style.display = 'none';
}

// ========================================
// Template Preset Functions
// ========================================
function applyTemplatePreset(presetName) {
    if (!presetName || !TEMPLATE_PRESETS[presetName]) return;

    const preset = TEMPLATE_PRESETS[presetName];

    if (preset.style) el('styleSelect').value = preset.style;
    if (preset.aspectRatio) el('aspectRatio').value = preset.aspectRatio;
    if (preset.prefix !== undefined) el('prefixInput').value = preset.prefix;
    if (preset.params !== undefined) el('extraParams').value = preset.params;

    showToast(`Applied ${presetName} preset`, 'success');
}

// ========================================
// Export Functions
// ========================================
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function exportPrompts() {
    if (state.prompts.length === 0) {
        showToast('No prompts to export', 'error');
        return;
    }

    const format = el('exportFormat')?.value || 'json';
    const timestamp = new Date().toISOString().slice(0, 10);
    const prefix = el('prefixInput')?.value.trim() || '';

    // Apply prefix if set
    const promptsWithPrefix = state.prompts.map(p => prefix ? `${prefix} ${p}` : p);

    let content, filename, mimeType;

    switch (format) {
        case 'json':
            content = JSON.stringify({
                generated: new Date().toISOString(),
                count: promptsWithPrefix.length,
                prompts: promptsWithPrefix
            }, null, 2);
            filename = `promptforge-${timestamp}.json`;
            mimeType = 'application/json';
            break;

        case 'txt':
            content = promptsWithPrefix.map((p, i) => `#${i + 1}\n${p}`).join('\n\n---\n\n');
            filename = `promptforge-${timestamp}.txt`;
            mimeType = 'text/plain';
            break;

        case 'csv':
            content = 'Number,Prompt\n' +
                promptsWithPrefix.map((p, i) => `${i + 1},"${p.replace(/"/g, '""')}"`).join('\n');
            filename = `promptforge-${timestamp}.csv`;
            mimeType = 'text/csv';
            break;

        default:
            return;
    }

    downloadFile(content, filename, mimeType);
    showToast(`Exported ${state.prompts.length} prompts as ${format.toUpperCase()}`, 'success');
}

// ========================================
// History Management
// ========================================
function getHistory() {
    try {
        return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.HISTORY) || '[]');
    } catch {
        return [];
    }
}

function saveToHistory(imageDataUrl, prompts) {
    const history = getHistory();

    history.unshift({
        id: Date.now(),
        thumbnail: imageDataUrl,
        prompts,
        date: new Date().toISOString()
    });

    const trimmed = history.slice(0, 20);
    localStorage.setItem(CONFIG.STORAGE_KEYS.HISTORY, JSON.stringify(trimmed));
    renderHistory();
}

function renderHistory() {
    const container = el('historyList');
    const history = getHistory();

    if (history.length === 0) {
        container.innerHTML = '<p class="empty-history">No history yet</p>';
        return;
    }

    container.innerHTML = history.map(item => `
    <div class="history-item" onclick="loadHistory('${item.id}')">
      <img src="${item.thumbnail}" alt="Preview" class="history-item-preview">
      <div class="history-item-text">${escapeHtml(item.prompts[0] || '')}</div>
      <div class="history-item-date">${formatDate(new Date(item.date))}</div>
    </div>
  `).join('');
}

function loadHistory(id) {
    const history = getHistory();
    const item = history.find(h => h.id === parseInt(id));

    if (item) {
        setPreviewImage(item.thumbnail);
        state.prompts = item.prompts;

        el('outputSection').style.display = 'block';
        el('promptsList').innerHTML = '';
        item.prompts.forEach((p, i) => addPromptToList(i + 1, p));

        showToast('Loaded from history', 'success');
    }
}

function clearHistory() {
    if (confirm('Clear all history?')) {
        localStorage.removeItem(CONFIG.STORAGE_KEYS.HISTORY);
        renderHistory();
        showToast('History cleared', 'success');
    }
}

// ========================================
// PWA Service Worker
// ========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('SW registered'))
            .catch(err => console.log('SW failed:', err));
    });
}

// ========================================
// Initialization
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize license system first
    await generateMachineId();
    const isLicensed = await checkLicense();

    if (!isLicensed) {
        setUILocked(true);
    }

    // Load saved settings
    loadSettings();
    renderHistory();
    updateGenerateButton();

    // Settings toggle
    el('settingsToggle').addEventListener('click', () => {
        el('settingsCard').classList.toggle('collapsed');
    });

    el('btnSettings').addEventListener('click', () => {
        el('settingsCard').classList.toggle('collapsed');
        el('settingsCard').scrollIntoView({ behavior: 'smooth' });
    });

    // API key visibility toggle
    el('btnToggleKey').addEventListener('click', () => {
        const input = el('geminiKey');
        const btn = el('btnToggleKey');
        if (input.type === 'password') {
            input.type = 'text';
            btn.textContent = '🙈';
        } else {
            input.type = 'password';
            btn.textContent = '👁️';
        }
    });

    // Save settings
    el('btnSaveSettings').addEventListener('click', saveSettings);

    // Image inputs
    el('cameraInput').addEventListener('change', async (e) => {
        if (e.target.files[0]) {
            await handleImageFile(e.target.files[0]);
        }
    });

    el('galleryInput').addEventListener('change', async (e) => {
        if (e.target.files[0]) {
            await handleImageFile(e.target.files[0]);
        }
    });

    el('btnPaste').addEventListener('click', handlePaste);

    // URL extraction
    el('btnExtractUrl').addEventListener('click', extractImageFromUrl);
    el('urlInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') extractImageFromUrl();
    });

    // Generate
    el('btnGenerate').addEventListener('click', generatePrompts);

    // Copy all
    el('btnCopyAll').addEventListener('click', copyAllPrompts);

    // Clear output
    el('btnClear').addEventListener('click', clearOutput);

    // Clear history
    el('btnClearHistory').addEventListener('click', clearHistory);

    // Template preset
    el('templatePreset')?.addEventListener('change', (e) => {
        applyTemplatePreset(e.target.value);
    });

    // Export button
    el('btnExport')?.addEventListener('click', exportPrompts);

    // License handlers
    el('btnCopyMachineId')?.addEventListener('click', copyMachineId);
    el('btnActivateLicense')?.addEventListener('click', activateLicense);
    el('licenseKeyInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') activateLicense();
    });

    // Global paste listener
    document.addEventListener('paste', async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    await handleImageFile(file);
                    showToast('Image pasted! 📋', 'success');
                    e.preventDefault();
                    return;
                }
            }
        }
    });
});

// Expose functions for onclick
window.copyPrompt = copyPrompt;
window.loadHistory = loadHistory;
window.copyMachineId = copyMachineId;
window.activateLicense = activateLicense;
