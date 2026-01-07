/**
 * PromptForge Mobile PWA
 * AI Prompt Generator - Mobile Version
 * © 2026 Muhammad Anggi
 */

// ========================================
// Configuration & State
// ========================================
const CONFIG = {
    LICENSE_SECRETS: [
        'PromptForge-2026-MAnggi-Secret',  // New secret (PWA/Admin)
        'PF2026-ANGGI-SECRET'  // Original secret (Extension)
    ],
    STORAGE_KEYS: {
        API_KEY: 'pf_gemini_key',
        API_KEYS: 'pf_gemini_keys',  // Multiple keys support
        MODEL: 'pf_gemini_model',
        HISTORY: 'pf_history',
        LICENSE_KEY: 'pf_license_key',
        MACHINE_ID: 'pf_machine_id'
    },
    MIN_DELAY_MS: 9000,  // Minimum delay between API calls (free tier)
    COOLDOWN_MAX_MS: 10 * 60 * 1000  // Max cooldown for rate limited keys
};

// Key rotation state
const keyState = new Map(); // key -> {nextAt, fails}
let lastApiCallAt = 0;

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
// Text Processing Utilities (from Extension)
// ========================================

// Clamp text to max characters
function clampToMaxChars(text, maxChars) {
    if (!text || !maxChars || text.length <= maxChars) return text || "";
    let out = text.slice(0, maxChars);
    const lastSpace = out.lastIndexOf(" ");
    if (lastSpace > maxChars * 0.6) out = out.slice(0, lastSpace);
    return out.replace(/[\s,.;:\-–—]+$/, "").trim();
}

// Strip "copy space" / "negative space" phrases
function stripCopySpace(line) {
    if (!line) return line;
    let out = line
        .replace(/\bcopy\s*space\b(?:\s*(on|at|to|toward|towards)\s*(the)?\s*(left|right|top|bottom|center))?/gi, "")
        .replace(/\bnegative\s*space\b/gi, "");
    out = out.replace(/\s{2,}/g, " ").replace(/\s+,/g, ", ").replace(/,\s*,/g, ", ").replace(/,\s*$/, "").trim();
    return out;
}

// Force white background (replace transparent mentions)
function forceWhiteBackground(line) {
    if (!line) return line;
    let out = line;
    out = out.replace(/\bon\s+(?:an?\s+)?transparent\s+background\b/gi, "on a white background");
    out = out.replace(/\bagainst\s+(?:an?\s+)?transparent\s+background\b/gi, "against a white background");
    out = out.replace(/\bwith\s+(?:an?\s+)?transparent\s+background\b/gi, "with a white background");
    out = out.replace(/\btransparent\s+background\b/gi, "white background");
    out = out.replace(/\bno\s+background\b/gi, "white background");
    out = out.replace(/\balpha\s+background\b/gi, "white background");
    out = out.replace(/\bclear\s+background\b/gi, "white background");
    out = out.replace(/\bisolated(?:\s+on)?\s+(?:an?\s+)?(?:transparent|clear|alpha)\s+background\b/gi, "isolated on white background");
    return out;
}

// Add suffix safely (respecting maxChars)
function addSuffixSafely(line, phrase, maxChars) {
    try {
        if (!phrase) return clampToMaxChars(line, maxChars);
        const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        if (re.test(line)) return clampToMaxChars(line, maxChars);
        const t = (line || "").trim();
        const join = /[,.;:–—-]\s*$/.test(t) ? " " : ", ";
        const need = join + phrase;
        const budget = Math.max(0, (maxChars || 0) - need.length);
        let core = clampToMaxChars(t, budget);
        core = core.trim().replace(/[\s,.;:–—-]+$/g, "").trim();
        return (core ? core + join : "") + phrase;
    } catch (_) {
        return clampToMaxChars(line, maxChars);
    }
}

// ========================================
// API Key Rotation Utilities (from Extension)
// ========================================

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitMinDelay() {
    const elapsed = Date.now() - lastApiCallAt;
    const wait = Math.max(0, CONFIG.MIN_DELAY_MS - elapsed);
    if (wait > 0) await sleep(wait);
}

function markKeyOK(key) {
    const s = keyState.get(key) || { nextAt: 0, fails: 0 };
    s.fails = 0;
    s.nextAt = 0;
    keyState.set(key, s);
    lastApiCallAt = Date.now();
}

function markKey429(key) {
    const s = keyState.get(key) || { nextAt: 0, fails: 0 };
    s.fails++;
    const cooldown = Math.min(CONFIG.COOLDOWN_MAX_MS, 30000 * s.fails);
    s.nextAt = Date.now() + cooldown;
    keyState.set(key, s);
}

async function pickBestKey(keys) {
    const now = Date.now();
    let best = null;

    for (const k of keys) {
        const st = keyState.get(k) || { nextAt: 0, fails: 0 };
        if (st.nextAt <= now) return k;  // Available key found
        if (!best || st.nextAt < best.nextAt) best = { ...st, key: k };
    }

    if (best) {
        const wait = Math.max(0, best.nextAt - now);
        if (wait > 0) await sleep(wait);
        return best.key;
    }

    return keys[0];
}

// Get API keys (supports both single key and comma-separated multiple keys)
function getApiKeys() {
    const singleKey = localStorage.getItem(CONFIG.STORAGE_KEYS.API_KEY) || '';
    // Split by comma, newline, or space, filter empty
    return singleKey.split(/[,\n\s]+/).map(k => k.trim()).filter(k => k.length > 10);
}

// ========================================
// Image Analysis Utilities (from Extension)
// ========================================

// Convert dataURL to Blob
async function dataUrlToBlob(dataUrl) {
    const [meta, base64] = String(dataUrl || "").split(",");
    const match = meta.match(/data:(.*?);base64/);
    const mime = match ? match[1] : "image/png";
    const bin = atob(base64 || "");
    const len = bin.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return new Blob([out], { type: mime || "application/octet-stream" });
}

// Detect copy space in image (simplified version)
async function detectCopySpace(dataUrl) {
    try {
        if (!dataUrl) return { isCopySpace: false, side: null, score: 0 };
        const blob = await dataUrlToBlob(dataUrl);
        const bmp = await createImageBitmap(blob);
        const W0 = bmp.width, H0 = bmp.height;
        if (!W0 || !H0) return { isCopySpace: false, side: null, score: 0 };

        const max = 256, s = Math.min(1, max / Math.max(W0, H0));
        const W = Math.max(48, Math.round(W0 * s)), H = Math.max(48, Math.round(H0 * s));
        const cvs = new OffscreenCanvas(W, H), ctx = cvs.getContext("2d", { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(bmp, 0, 0, W, H);
        const { data } = ctx.getImageData(0, 0, W, H);

        // Convert to grayscale and compute gradient
        const gray = new Float32Array(W * H);
        for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
            gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
        }

        // Simple edge detection
        const grad = new Float32Array(W * H);
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                const i = y * W + x;
                const gx = gray[i + 1] - gray[i - 1];
                const gy = gray[i + W] - gray[i - W];
                grad[i] = Math.sqrt(gx * gx + gy * gy);
            }
        }

        // Analyze sides for low activity
        const band = 0.35;
        function analyzeRegion(x0, y0, x1, y1) {
            let sum = 0, cnt = 0;
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    sum += grad[y * W + x];
                    cnt++;
                }
            }
            return sum / (cnt || 1);
        }

        const left = analyzeRegion(0, 0, Math.round(W * band), H);
        const right = analyzeRegion(Math.round(W * (1 - band)), 0, W, H);
        const top = analyzeRegion(0, 0, W, Math.round(H * band));
        const bottom = analyzeRegion(0, Math.round(H * (1 - band)), W, H);
        const center = analyzeRegion(Math.round(W * 0.3), Math.round(H * 0.3), Math.round(W * 0.7), Math.round(H * 0.7));

        const threshold = center * 0.4;
        let side = null, minActivity = Infinity;
        if (left < threshold && left < minActivity) { side = "left"; minActivity = left; }
        if (right < threshold && right < minActivity) { side = "right"; minActivity = right; }
        if (top < threshold && top < minActivity) { side = "top"; minActivity = top; }
        if (bottom < threshold && bottom < minActivity) { side = "bottom"; minActivity = bottom; }

        return { isCopySpace: !!side, side, score: side ? (center - minActivity) / center : 0 };
    } catch (e) {
        return { isCopySpace: false, side: null, score: 0 };
    }
}

// Detect cutout (transparency) or checkerboard pattern
async function detectCutoutOrCheckerboard(dataUrl) {
    try {
        if (!dataUrl) return { cutout: false, checker: false };
        const blob = await dataUrlToBlob(dataUrl);
        const bmp = await createImageBitmap(blob);
        const W0 = bmp.width, H0 = bmp.height;
        if (!W0 || !H0) return { cutout: false, checker: false };

        const W = 192, H = Math.max(96, Math.round(H0 * (W / W0)));
        const cvs = new OffscreenCanvas(W, H);
        const ctx = cvs.getContext("2d", { alpha: true });
        ctx.drawImage(bmp, 0, 0, W, H);
        const { data } = ctx.getImageData(0, 0, W, H);

        // Check for transparency
        let alphaZero = 0, sample = 0;
        for (let y = 0; y < H; y += 2) {
            for (let x = 0; x < W; x += 2) {
                const i = (y * W + x) * 4;
                if (data[i + 3] < 10) alphaZero++;
                sample++;
            }
        }
        const cutout = alphaZero / Math.max(1, sample) > 0.25;

        // Simple checkerboard detection
        let whiteCount = 0, grayCount = 0;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            if (a > 240) {
                const v = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
                if (v > 245) whiteCount++;
                else if (v > 200 && v < 220) grayCount++;
            }
        }
        const total = data.length / 4;
        const checker = (whiteCount > total * 0.1) && (grayCount > total * 0.1);

        return { cutout, checker };
    } catch (e) {
        return { cutout: false, checker: false };
    }
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
function generateMachineHash(machineId, secret) {
    let hash = 0;
    const combined = machineId + secret;
    for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

// Validate license key format and check against machine ID (tries all secrets)
function validateLicenseKey(machineId, licenseKey) {
    if (!machineId || !licenseKey) return false;

    // License format: PF-XXXX-XXXX-XXXX-XXXX-XXXX
    const cleanKey = licenseKey.toUpperCase().trim();
    if (!cleanKey.startsWith('PF-')) return false;

    const parts = cleanKey.split('-');
    if (parts.length !== 6) return false;

    // Try validation with each secret
    for (const secret of CONFIG.LICENSE_SECRETS) {
        const hash = generateMachineHash(machineId, secret);
        const segment1 = (hash % 10000).toString().padStart(4, '0');
        const segment2 = ((hash >> 4) % 10000).toString().padStart(4, '0');
        const segment3 = ((hash >> 8) % 10000).toString().padStart(4, '0');

        // Check first 3 segments match
        if (parts[1] === segment1 && parts[2] === segment2 && parts[3] === segment3) {
            return true;
        }
    }
    return false;
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
        setTimeout(() => {
            setUILocked(false);
            updateGenerateButton();
        }, 1000);
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
    const apiKeys = getApiKeys();
    const model = localStorage.getItem(CONFIG.STORAGE_KEYS.MODEL) || 'gemini-2.5-flash-lite';

    if (!apiKeys.length) {
        throw new Error('Please set your Gemini API key(s) in Settings');
    }

    const base64Match = imageDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
        throw new Error('Invalid image data');
    }

    const mimeType = `image/${base64Match[1]}`;
    const base64Data = base64Match[2];

    // Build system prompt based on output format (matching Extension quality)
    let systemPrompt;

    if (options.outputFormat === 'json') {
        // JSON format - structured output
        systemPrompt = `You are an elite creative prompt engineer specializing in AI video/image generation and cinematic scene description.

TASK: Analyze the attached image and generate a STRUCTURED JSON object describing it comprehensively.

OUTPUT FORMAT - Return ONLY valid JSON with this exact structure:
{
  "scene_description": "A comprehensive one-paragraph description of the main scene, subject, and overall visual impression.",
  "visual_elements": {
    "weather": "Description of weather conditions if applicable (rain, snow, fog, clear, etc.) or 'N/A'",
    "environment": "Detailed description of the setting, location, background elements, atmosphere",
    "lighting": "Light type, direction, quality, color temperature, shadows, highlights",
    "style": "Photography/art style, aesthetic, mood, tone, color grading"
  },
  "camera_control": {
    "motion": "Suggested camera motion (static, pan, tilt, tracking, etc.)",
    "shot_type": "Wide shot, medium shot, close-up, extreme close-up, etc.",
    "angle": "Eye-level, low angle, high angle, bird's eye, dutch angle, etc.",
    "depth_of_field": "Shallow bokeh, deep focus, selective focus, etc."
  },
  "color_palette": {
    "dominant_colors": "Main colors in the scene",
    "accents": "Highlight and accent colors",
    "mood": "Warm, cool, neutral, vibrant, muted, etc."
  },
  "textures_materials": "Description of visible textures and materials (rough, smooth, metallic, organic, etc.)",
  "audio_suggestion": {
    "ambience": "Suggested ambient sounds for the scene",
    "music_mood": "Suggested music mood/style if applicable"
  }
}

REQUIREMENTS:
- Return ONLY the JSON object, no markdown, no code blocks, no explanation
- All values must be strings
- Be specific and detailed in each field
- Use professional, evocative language suitable for AI generation`;
    } else {
        // TXT format - detailed single paragraph
        systemPrompt = `You are an elite creative prompt engineer specializing in AI image generation (Midjourney, DALL-E, Ideogram, Stable Diffusion) and commercial microstock photography.

TASK: Analyze the attached image and generate ONE comprehensive, highly-detailed prompt that could recreate or describe it perfectly.

REQUIREMENTS - Include ALL applicable elements:
📷 CAMERA & COMPOSITION:
- Camera angle (eye-level, bird's eye, low angle, dutch angle, overhead, worm's eye)
- Shot type (extreme close-up, close-up, medium shot, full shot, wide shot, establishing shot)
- Depth of field (shallow/bokeh, deep focus, selective focus)
- Framing & rule of thirds

🎨 VISUAL STYLE:
- Photography style (editorial, commercial, documentary, lifestyle, fine art, cinematic)
- Aesthetic (minimalist, maximalist, vintage, modern, rustic, industrial, elegant)
- Art direction mood (energetic, calm, dramatic, warm, cold, mysterious)

💡 LIGHTING:
- Light type (natural sunlight, golden hour, blue hour, studio lighting, dramatic shadows)
- Light direction (front, side, back, rim light, diffused, hard shadows)
- Light quality (soft, harsh, moody, high-key, low-key)

🎨 COLOR & TEXTURE:
- Dominant color palette (warm tones, cool tones, complementary, monochromatic)
- Color accents and highlights
- Surface textures and materials (matte, glossy, rough, smooth, metallic)

🌍 ENVIRONMENT & CONTEXT:
- Setting/location details
- Background elements and atmosphere
- Time of day, weather, season if relevant

OUTPUT FORMAT:
- Return ONLY the prompt as a single flowing paragraph
- No numbering, no quotes, no bullet points
- Target length: ${Math.floor((options.maxChars || 250) * 0.85)} to ${options.maxChars || 250} characters
- Prioritize visual richness and concrete descriptors over generic terms
- Make it suitable for professional AI image generators`;
    }

    // Add style and aspect ratio hints
    if (options.style) {
        systemPrompt += `\n\nAPPLY STYLE: ${options.style}`;
    }
    if (options.aspectRatio) {
        systemPrompt += `\n\nASPECT RATIO: ${options.aspectRatio}`;
    }
    if (options.extraParams) {
        systemPrompt += `\n\nINCLUDE PARAMETERS: ${options.extraParams}`;
    }

    const requestBody = {
        contents: [{
            parts: [
                { text: systemPrompt },
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

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // Retry with multiple keys
    let attempt = 0;
    let lastError = null;
    const maxAttempts = apiKeys.length * 3;

    while (attempt < maxAttempts) {
        attempt++;
        const apiKey = await pickBestKey(apiKeys);
        await waitMinDelay();

        const url = `${endpoint}?key=${encodeURIComponent(apiKey)}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (response.status === 429) {
                markKey429(apiKey);
                const retryAfter = Number(response.headers.get('Retry-After'));
                const waitTime = 2000 * attempt + (retryAfter > 0 ? retryAfter * 1000 : 0);
                await sleep(waitTime + Math.random() * 500);
                lastError = new Error('Rate limit exceeded');
                continue;
            }

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                if (response.status >= 500) {
                    await sleep(1500 + Math.random() * 600);
                    continue;
                }
                markKey429(apiKey);
                lastError = new Error(error.error?.message || `API error: ${response.status}`);
                continue;
            }

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!text) {
                lastError = new Error('Empty response from API');
                await sleep(800);
                continue;
            }

            markKeyOK(apiKey);
            return await processApiResponse(text, imageDataUrl, options);

        } catch (e) {
            markKey429(apiKey);
            lastError = e;
            await sleep(1200 + Math.random() * 500);
        }
    }

    throw lastError || new Error('All API keys failed');
}

// Process API response with post-processing
async function processApiResponse(text, imageDataUrl, options) {
    // Process based on output format
    if (options.outputFormat === 'json') {
        // Clean markdown code blocks if present
        let jsonText = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        // Try to extract JSON object
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                JSON.parse(jsonMatch[0]); // Validate it's valid JSON
                return jsonMatch[0];
            } catch (e) {
                return jsonText || text;
            }
        }
        return jsonText || text;
    }

    // For TXT format, extract first line only (clean paragraph)
    let line = (text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || "";

    // Run image detectors for post-processing
    const cs = await detectCopySpace(imageDataUrl);
    const cut = await detectCutoutOrCheckerboard(imageDataUrl);

    // Post-processing (matching Extension behavior)
    line = stripCopySpace(line);

    // Enforce white background for cutout/transparent images
    if (cut.cutout || cut.checker) {
        line = addSuffixSafely(forceWhiteBackground(line), "isolated on white background", options.maxChars);
    } else if (/transparent\s+background/i.test(line)) {
        line = addSuffixSafely(forceWhiteBackground(line), "isolated on white background", options.maxChars);
    }

    // Clamp to max chars
    line = clampToMaxChars(line, options.maxChars);

    return line;
}

// ========================================
// Generate Prompts
// ========================================
function updateGenerateButton() {
    const hasImage = !!state.imageDataUrl;
    const hasApiKey = !!localStorage.getItem(CONFIG.STORAGE_KEYS.API_KEY);

    const btn = el('btnGenerate');
    if (!btn) return;

    // Only disable if generating or missing image/API key (no license check here)
    btn.disabled = !hasImage || !hasApiKey || state.isGenerating;

    if (!hasApiKey) {
        btn.textContent = '⚠️ Set API Key';
    } else if (!hasImage) {
        btn.textContent = '📷 Add Image First';
    } else {
        btn.textContent = '▶ Generate Prompts';
    }
}

async function generatePrompts() {
    // Check license first - show modal if not licensed
    if (!state.licenseValid) {
        showLicenseModal(true);
        showToast('Please activate your license first', 'error');
        return;
    }

    if (state.isGenerating || !state.imageDataUrl) return;

    const numPrompts = parseInt(el('numPrompts').value) || 2;
    const templatePreset = el('templatePreset')?.value;
    const outputFormat = el('exportFormat')?.value || 'txt'; // Get output format

    // Get preset config or use defaults
    const preset = TEMPLATE_PRESETS[templatePreset] || {};
    const maxChars = 250;
    const aspectRatio = preset.aspectRatio || '';
    const style = preset.style || '';
    const extraParams = preset.params || '';

    state.isGenerating = true;
    state.prompts = [];

    const btn = el('btnGenerate');
    btn.disabled = true;
    btn.textContent = '⏳ Generating...';

    el('outputList').innerHTML = '';
    el('progressBar').style.width = '0%';
    el('progressCount').textContent = '0';
    el('progressPct').textContent = '0%';

    try {
        for (let i = 0; i < numPrompts; i++) {
            const percent = Math.round(((i + 1) / numPrompts) * 100);
            el('progressBar').style.width = `${percent}%`;
            el('progressCount').textContent = `${i + 1}`;
            el('progressPct').textContent = `${percent}%`;

            const promptText = await callGeminiAPI(state.imageDataUrl, {
                maxChars, aspectRatio, style, extraParams, outputFormat
            });

            state.prompts.push(promptText);
            addPromptToOutputTable(i + 1, promptText);

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
        btn.textContent = '▶ Generate Prompts';
        updateGenerateButton();
    }
}

function addPromptToOutputTable(number, text) {
    const item = document.createElement('div');
    item.className = 'output-item';
    item.innerHTML = `
        <span class="col-no">${number}</span>
        <span class="col-prompt">${escapeHtml(text)}</span>
        <span class="col-copy"><button onclick="copyPrompt(${number - 1})">Copy</button></span>
    `;
    el('outputList').appendChild(item);
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
    el('outputList').innerHTML = '';
    el('progressBar').style.width = '0%';
    el('progressCount').textContent = '0';
    el('progressPct').textContent = '0%';
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

    console.log('[DEBUG] Init - isLicensed:', isLicensed, 'state.licenseValid:', state.licenseValid);

    if (isLicensed) {
        // License valid - ensure UI is unlocked
        setUILocked(false);
    } else {
        // License not valid - show modal
        setUILocked(true);
    }

    // Load saved settings
    loadSettings();
    renderHistory();
    updateGenerateButton();

    // Tab switching
    document.querySelectorAll('.ae-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.dataset.target;
            if (!targetId) return;

            // Update tabs
            document.querySelectorAll('.ae-tab').forEach(t => t.classList.remove('is-active'));
            tab.classList.add('is-active');

            // Update panels
            document.querySelectorAll('.ae-panel').forEach(p => p.classList.remove('is-active'));
            el(targetId)?.classList.add('is-active');
        });
    });

    // Provider toggle (API Settings)
    el('providerToggle')?.addEventListener('click', () => {
        const body = el('providerBody');
        const arrow = el('providerToggle').querySelector('.toggle-arrow');
        if (body.style.display === 'none') {
            body.style.display = 'block';
            arrow.textContent = '▲';
        } else {
            body.style.display = 'none';
            arrow.textContent = '▼';
        }
    });

    // API key visibility toggle
    el('btnToggleKey')?.addEventListener('click', () => {
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
    el('btnSaveSettings')?.addEventListener('click', saveSettings);

    // Image inputs - File upload
    el('fileInput')?.addEventListener('change', async (e) => {
        if (e.target.files[0]) {
            await handleImageFile(e.target.files[0]);
        }
    });

    // Camera input (for mobile)
    el('cameraInput')?.addEventListener('change', async (e) => {
        if (e.target.files[0]) {
            await handleImageFile(e.target.files[0]);
        }
    });

    // Paste button
    el('btnPaste')?.addEventListener('click', handlePaste);

    // URL extraction
    el('btnExtractUrl')?.addEventListener('click', extractImageFromUrl);
    el('urlInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') extractImageFromUrl();
    });

    // Generate
    el('btnGenerate')?.addEventListener('click', generatePrompts);

    // Copy all
    el('btnCopyAll')?.addEventListener('click', copyAllPrompts);

    // Clear output
    el('btnClear')?.addEventListener('click', clearOutput);

    // Clear history
    el('btnClearHistory')?.addEventListener('click', clearHistory);

    // Template preset
    el('templatePreset')?.addEventListener('change', (e) => {
        applyTemplatePreset(e.target.value);
    });

    // Export button
    el('btnExport')?.addEventListener('click', exportPrompts);

    // Export history
    el('btnExportHistory')?.addEventListener('click', () => {
        const history = getHistory();
        if (history.length === 0) {
            showToast('No history to export', 'error');
            return;
        }
        const content = JSON.stringify(history, null, 2);
        downloadFile(content, 'promptforge-history.json', 'application/json');
        showToast('History exported!', 'success');
    });

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
