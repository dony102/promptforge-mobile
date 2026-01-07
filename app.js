/**
 * PromptForge Mobile PWA
 * AI Prompt Generator - Mobile Version
 * © 2026 Muhammad Anggi
 */

// ========================================
// Configuration & State
// ========================================
const CONFIG = {
    STORAGE_KEYS: {
        API_KEY: 'pf_gemini_key',
        MODEL: 'pf_gemini_model',
        HISTORY: 'pf_history'
    }
};

let state = {
    imageDataUrl: null,
    isGenerating: false,
    prompts: []
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
        // Compress image if needed
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

            // Resize if needed
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

// Handle paste
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

        // Check YouTube
        const ytId = extractYouTubeId(url);
        if (ytId) {
            imageUrl = `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;
        } else if (url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) {
            // Direct image URL
            imageUrl = url;
        } else {
            throw new Error('Unsupported URL. Use YouTube or direct image URL.');
        }

        // Load image
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

    // Extract base64 from data URL
    const base64Match = imageDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
        throw new Error('Invalid image data');
    }

    const mimeType = `image/${base64Match[1]}`;
    const base64Data = base64Match[2];

    // Build prompt
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

    const btn = el('btnGenerate');
    btn.disabled = !hasImage || !hasApiKey || state.isGenerating;

    if (!hasApiKey) {
        btn.querySelector('.btn-text').textContent = '⚠️ Set API Key First';
    } else if (!hasImage) {
        btn.querySelector('.btn-text').textContent = '📷 Add Image First';
    } else {
        btn.querySelector('.btn-text').textContent = '✨ Generate Prompts';
    }
}

async function generatePrompts() {
    if (state.isGenerating || !state.imageDataUrl) return;

    const numPrompts = parseInt(el('numPrompts').value) || 2;
    const maxChars = parseInt(el('maxChars').value) || 250;
    const aspectRatio = el('aspectRatio').value;
    const style = el('styleSelect').value;
    const extraParams = el('extraParams').value.trim();

    state.isGenerating = true;
    state.prompts = [];

    // UI updates
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
            // Update progress
            const percent = ((i + 1) / numPrompts) * 100;
            progressFill.style.width = `${percent}%`;
            progressText.textContent = `${i + 1} / ${numPrompts}`;

            // Generate
            const promptText = await callGeminiAPI(state.imageDataUrl, {
                maxChars, aspectRatio, style, extraParams
            });

            state.prompts.push(promptText);

            // Add to UI
            addPromptToList(i + 1, promptText);

            // Small delay between requests
            if (i < numPrompts - 1) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // Save to history
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

    // Create thumbnail (smaller version)
    const thumbnail = imageDataUrl; // Could resize for storage efficiency

    history.unshift({
        id: Date.now(),
        thumbnail,
        prompts,
        date: new Date().toISOString()
    });

    // Keep only last 20
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
        // Load image and prompts
        setPreviewImage(item.thumbnail);
        state.prompts = item.prompts;

        // Show prompts
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
// Event Listeners & Init
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings
    loadSettings();
    renderHistory();

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
