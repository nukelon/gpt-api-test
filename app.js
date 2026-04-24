const OFFICIAL_BASE_URL = "https://api.openai.com";
const DB_NAME = "gpt-image2-studio-db";
const DB_VERSION = 1;
const SETTINGS_KEY = "gpt-image2-studio.settings";
const MAX_INPUT_IMAGES = 16;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const SIZE_MIN_PIXELS = 655_360;
const SIZE_MAX_PIXELS = 8_294_400;
const SIZE_MAX_EDGE = 3840;
const SIZE_MULTIPLE = 16;
const SIZE_MAX_RATIO = 3;
const OUTPUT_FORMATS = new Set(["png", "jpeg", "webp"]);
const QUALITY_VALUES = new Set(["auto", "low", "medium", "high"]);
const BACKGROUND_VALUES = new Set(["auto", "opaque", "transparent"]);
const MODERATION_VALUES = new Set(["auto", "low"]);
const KNOWN_SIZES = new Set([
  "auto",
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "3072x1728",
  "3840x2160",
  "2160x3840",
]);

const DEFAULT_PARAMS = Object.freeze({
  endpoint: "generations",
  model: "gpt-image-2",
  size: "auto",
  customWidth: 1024,
  customHeight: 1024,
  quality: "auto",
  output_format: "png",
  output_compression: 100,
  background: "auto",
  n: 1,
  moderation: "auto",
  stream: false,
  partial_images: 0,
  user: "",
});

const DEFAULT_SETTINGS = Object.freeze({
  baseUrl: "",
  apiKey: "",
  saveApiKey: false,
});

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let db;
let conversations = [];
let presets = [];
let currentConversationId = null;
let currentParams = { ...DEFAULT_PARAMS };
let sourceItems = [];
let maskItem = null;
let settings = { ...DEFAULT_SETTINGS };
let runtimeApiKey = "";
let isSending = false;
let suppressSizeBuilderSync = false;
const overlaySidebarQuery = window.matchMedia("(max-width: 900px), (orientation: portrait)");

const els = {
  sidebar: $("#sidebar"),
  sidebarBackdrop: $("#sidebarBackdrop"),
  newChatBtn: $("#newChatBtn"),
  addPresetBtn: $("#addPresetBtn"),
  saveCurrentPresetBtn: $("#saveCurrentPresetBtn"),
  presetList: $("#presetList"),
  conversationList: $("#conversationList"),
  deleteAllChatsBtn: $("#deleteAllChatsBtn"),
  settingsBtn: $("#settingsBtn"),
  topSettingsBtn: $("#topSettingsBtn"),
  clearAllDataBtn: $("#clearAllDataBtn"),
  sidebarToggle: $("#sidebarToggle"),
  conversationTitle: $("#conversationTitle"),
  conversationSubtitle: $("#conversationSubtitle"),
  apiStatus: $("#apiStatus"),
  chatScroll: $("#chatScroll"),
  emptyState: $("#emptyState"),
  messageList: $("#messageList"),
  promptInput: $("#promptInput"),
  validationPanel: $("#validationPanel"),
  attachmentStrip: $("#attachmentStrip"),
  uploadImagesBtn: $("#uploadImagesBtn"),
  sourceImagesInput: $("#sourceImagesInput"),
  uploadMaskBtn: $("#uploadMaskBtn"),
  maskInput: $("#maskInput"),
  sendBtn: $("#sendBtn"),
  endpointSelect: $("#endpointSelect"),
  modelInput: $("#modelInput"),
  resolvedSizeLabel: $("#resolvedSizeLabel"),
  ratioSelect: $("#ratioSelect"),
  scaleSelect: $("#scaleSelect"),
  customSizeRow: $("#customSizeRow"),
  customWidthInput: $("#customWidthInput"),
  customHeightInput: $("#customHeightInput"),
  qualitySelect: $("#qualitySelect"),
  outputFormatSelect: $("#outputFormatSelect"),
  compressionInput: $("#compressionInput"),
  compressionLabel: $("#compressionLabel"),
  backgroundSelect: $("#backgroundSelect"),
  countInput: $("#countInput"),
  moderationSelect: $("#moderationSelect"),
  streamToggle: $("#streamToggle"),
  partialImagesInput: $("#partialImagesInput"),
  userInput: $("#userInput"),
  settingsDialog: $("#settingsDialog"),
  settingsForm: $("#settingsForm"),
  baseUrlInput: $("#baseUrlInput"),
  apiKeyInput: $("#apiKeyInput"),
  saveKeyToggle: $("#saveKeyToggle"),
  saveSettingsBtn: $("#saveSettingsBtn"),
  testConfigBtn: $("#testConfigBtn"),
  presetDialog: $("#presetDialog"),
  presetForm: $("#presetForm"),
  presetDialogTitle: $("#presetDialogTitle"),
  presetIdInput: $("#presetIdInput"),
  presetNameInput: $("#presetNameInput"),
  presetEndpointSelect: $("#presetEndpointSelect"),
  presetDescriptionInput: $("#presetDescriptionInput"),
  presetPromptInput: $("#presetPromptInput"),
  presetModelInput: $("#presetModelInput"),
  presetSizeInput: $("#presetSizeInput"),
  presetCountInput: $("#presetCountInput"),
  presetQualitySelect: $("#presetQualitySelect"),
  presetFormatSelect: $("#presetFormatSelect"),
  presetCompressionInput: $("#presetCompressionInput"),
  presetBackgroundSelect: $("#presetBackgroundSelect"),
  presetModerationSelect: $("#presetModerationSelect"),
  presetPartialInput: $("#presetPartialInput"),
  presetStreamToggle: $("#presetStreamToggle"),
  presetUserInput: $("#presetUserInput"),
  presetValidation: $("#presetValidation"),
  toastHost: $("#toastHost"),
};

function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatDateTime(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function firstLineTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > 32 ? `${clean.slice(0, 32)}…` : clean || "未命名对话";
}

function toast(message, type = "info", duration = 3400) {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  els.toastHost.appendChild(node);
  window.setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(8px)";
    window.setTimeout(() => node.remove(), 180);
  }, duration);
}

function isOverlaySidebar() {
  return overlaySidebarQuery.matches;
}

function updateSidebarToggleState() {
  const expanded = isOverlaySidebar()
    ? document.body.classList.contains("sidebar-open")
    : !document.body.classList.contains("sidebar-collapsed");
  if (els.sidebarToggle) {
    els.sidebarToggle.setAttribute("aria-expanded", String(expanded));
    els.sidebarToggle.setAttribute("aria-label", expanded ? "收起侧边栏" : "展开侧边栏");
    els.sidebarToggle.title = expanded ? "收起侧边栏" : "展开侧边栏";
  }
}

function setSidebarOpen(open) {
  if (isOverlaySidebar()) {
    document.body.classList.remove("sidebar-collapsed");
    document.body.classList.toggle("sidebar-open", Boolean(open));
    if (els.sidebarBackdrop) els.sidebarBackdrop.hidden = !open;
  } else {
    document.body.classList.remove("sidebar-open");
    document.body.classList.toggle("sidebar-collapsed", !open);
    if (els.sidebarBackdrop) els.sidebarBackdrop.hidden = true;
  }
  updateSidebarToggleState();
}

function closeSidebar() {
  if (isOverlaySidebar()) setSidebarOpen(false);
}

function toggleSidebar() {
  if (isOverlaySidebar()) {
    setSidebarOpen(!document.body.classList.contains("sidebar-open"));
    return;
  }
  setSidebarOpen(document.body.classList.contains("sidebar-collapsed"));
}

function syncSidebarMode() {
  if (isOverlaySidebar()) {
    document.body.classList.remove("sidebar-collapsed");
    document.body.classList.remove("sidebar-open");
  } else {
    document.body.classList.remove("sidebar-open");
    if (els.sidebarBackdrop) els.sidebarBackdrop.hidden = true;
  }
  updateSidebarToggleState();
}

function closeDialogById(dialogId) {
  const dialog = document.getElementById(dialogId);
  if (dialog?.open) dialog.close("cancel");
}


function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("conversations")) {
        const store = database.createObjectStore("conversations", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!database.objectStoreNames.contains("presets")) {
        const store = database.createObjectStore("presets", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbStore(name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

function idbGetAll(name) {
  return new Promise((resolve, reject) => {
    const request = idbStore(name).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(name, value) {
  return new Promise((resolve, reject) => {
    const request = idbStore(name, "readwrite").put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function idbDelete(name, id) {
  return new Promise((resolve, reject) => {
    const request = idbStore(name, "readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function idbClear(name) {
  return new Promise((resolve, reject) => {
    const request = idbStore(name, "readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteDatabase() {
  return new Promise((resolve, reject) => {
    if (db) db.close();
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  runtimeApiKey = settings.saveApiKey ? settings.apiKey || "" : "";
}

function persistSettings() {
  const value = { ...settings };
  if (!value.saveApiKey) value.apiKey = "";
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
}

function getApiKey() {
  return settings.saveApiKey ? settings.apiKey || "" : runtimeApiKey || "";
}

function normalizeBaseUrl(raw) {
  let value = String(raw || "").trim();
  if (!value) return OFFICIAL_BASE_URL;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (url.pathname.endsWith("/v1")) {
    url.pathname = url.pathname.slice(0, -3) || "/";
  }
  const normalized = url.toString().replace(/\/+$/, "");
  return normalized;
}

function getBaseUrl() {
  return normalizeBaseUrl(settings.baseUrl);
}

function isGptImage2Model(model) {
  return String(model || "").trim().toLowerCase().startsWith("gpt-image-2");
}

function parseSize(size) {
  const value = String(size || "").trim().toLowerCase();
  if (value === "auto") return { auto: true, value: "auto" };
  const match = value.match(/^(\d{2,5})\s*x\s*(\d{2,5})$/);
  if (!match) return null;
  return {
    auto: false,
    value: `${Number(match[1])}x${Number(match[2])}`,
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function resolveSize(params = currentParams) {
  if (params.size === "custom") {
    return `${Number(params.customWidth) || 0}x${Number(params.customHeight) || 0}`;
  }
  return String(params.size || "auto").trim() || "auto";
}

function validateSizeValue(size, { model = currentParams.model } = {}) {
  const errors = [];
  const warnings = [];
  const parsed = parseSize(size);
  if (!parsed) {
    errors.push("size 必须为 auto 或类似 3840x2160 的宽高格式。");
    return { errors, warnings, parsed: null };
  }
  if (parsed.auto) return { errors, warnings, parsed };

  const { width, height } = parsed;
  const pixels = width * height;
  const ratio = Math.max(width, height) / Math.min(width, height);

  if (width > SIZE_MAX_EDGE || height > SIZE_MAX_EDGE) {
    errors.push(`GPT Image 2 的单边最大长度为 ${SIZE_MAX_EDGE}px。`);
  }
  if (width % SIZE_MULTIPLE !== 0 || height % SIZE_MULTIPLE !== 0) {
    errors.push(`宽度和高度都必须是 ${SIZE_MULTIPLE} 的倍数。`);
  }
  if (ratio > SIZE_MAX_RATIO) {
    errors.push("长边与短边比例不能超过 3:1。");
  }
  if (pixels < SIZE_MIN_PIXELS) {
    errors.push(`总像素不能低于 ${SIZE_MIN_PIXELS.toLocaleString()}。`);
  }
  if (pixels > SIZE_MAX_PIXELS) {
    errors.push(`总像素不能超过 ${SIZE_MAX_PIXELS.toLocaleString()}。`);
  }
  if (!isGptImage2Model(model)) {
    warnings.push("当前项目按 GPT Image 2 的尺寸约束校验；其他模型的尺寸规则可能不同。");
  }
  return { errors, warnings, parsed };
}

function validateParams(params, options = {}) {
  const { prompt = els.promptInput?.value || "", endpoint = params.endpoint, checkKey = true, checkFiles = true } = options;
  const errors = [];
  const warnings = [];
  const model = String(params.model || "").trim();
  const size = resolveSize(params);

  if (!model) errors.push("model 不能为空。默认建议使用 gpt-image-2。");
  if (!prompt.trim()) errors.push("请输入 prompt。 ");
  if (prompt.length > 32000) errors.push("GPT Image 模型 prompt 最多 32000 字符。");
  if (checkKey && !getApiKey()) warnings.push("尚未填写 API Key；可在设置中填写，或选择保存到本地。");
  if (!["generations", "edits"].includes(endpoint)) errors.push("接口必须是 generations 或 edits。");

  const n = Number(params.n);
  if (!Number.isInteger(n) || n < 1 || n > 10) errors.push("n 必须是 1 到 10 之间的整数。");

  const sizeResult = validateSizeValue(size, { model });
  errors.push(...sizeResult.errors);
  warnings.push(...sizeResult.warnings);

  if (!QUALITY_VALUES.has(params.quality)) errors.push("quality 必须是 auto、low、medium 或 high。");
  if (!OUTPUT_FORMATS.has(params.output_format)) errors.push("output_format 必须是 png、jpeg 或 webp。");
  if (!BACKGROUND_VALUES.has(params.background)) errors.push("background 必须是 auto、opaque 或 transparent。");
  if (isGptImage2Model(model) && params.background === "transparent") {
    errors.push("gpt-image-2 当前不支持 background: transparent。请改为 auto 或 opaque。");
  }
  if (params.background === "transparent" && params.output_format === "jpeg") {
    errors.push("透明背景不能使用 jpeg；请改用 png 或 webp。");
  }
  const compression = Number(params.output_compression);
  if (!Number.isInteger(compression) || compression < 0 || compression > 100) {
    errors.push("output_compression 必须是 0 到 100 的整数。");
  }
  if (params.output_format === "png") {
    warnings.push("png 不使用 output_compression；请求时会自动忽略该参数。");
  }
  if (endpoint === "generations") {
    if (!MODERATION_VALUES.has(params.moderation)) errors.push("moderation 必须是 auto 或 low。");
  } else {
    warnings.push("moderation 只用于生成接口；编辑接口请求会忽略它。");
  }
  const partial = Number(params.partial_images);
  if (!Number.isInteger(partial) || partial < 0 || partial > 3) errors.push("partial_images 必须是 0 到 3 之间的整数。");
  if (!params.stream && partial > 0) warnings.push("partial_images 只在 stream=true 时发送；当前会被忽略。");

  if (checkFiles) {
    if (endpoint === "edits" && sourceItems.length === 0) errors.push("编辑接口需要至少上传 1 张参考图。");
    if (endpoint === "generations" && sourceItems.length > 0) warnings.push("参考图只会发送到编辑接口；当前生成接口会忽略已上传图片。");
    if (sourceItems.length > MAX_INPUT_IMAGES) errors.push(`编辑接口最多支持 ${MAX_INPUT_IMAGES} 张参考图。`);
    sourceItems.forEach((item) => {
      if (!/^image\/(png|jpeg|webp)$/i.test(item.type)) errors.push(`${item.name} 不是支持的 png、jpg/jpeg 或 webp。`);
      if (item.size > MAX_IMAGE_BYTES) errors.push(`${item.name} 超过 50MB。`);
    });
    if (maskItem) {
      if (endpoint !== "edits") warnings.push("mask 只会在编辑接口中发送；生成接口会忽略它。");
      if (!/^image\/png$/i.test(maskItem.type)) errors.push("mask 建议使用带 alpha 通道的 PNG 文件。");
      if (maskItem.size > MAX_IMAGE_BYTES) errors.push("mask 文件超过 50MB。 ");
      const first = sourceItems[0];
      if (first?.width && first?.height && maskItem.width && maskItem.height) {
        if (first.width !== maskItem.width || first.height !== maskItem.height) {
          errors.push(`mask 尺寸必须与第一张参考图一致；当前参考图 ${first.width}x${first.height}，mask ${maskItem.width}x${maskItem.height}。`);
        }
      }
    }
  }

  return { errors, warnings };
}

function showValidation(result) {
  const panel = els.validationPanel;
  const meaningfulWarnings = result.warnings.filter((warning) => !warning.startsWith("png 不使用"));
  const lines = [];
  if (result.errors.length) lines.push(...result.errors.map((item) => `错误：${item}`));
  if (meaningfulWarnings.length) lines.push(...meaningfulWarnings.map((item) => `提醒：${item}`));
  if (!lines.length) {
    panel.classList.add("hidden");
    panel.classList.remove("error");
    return;
  }
  panel.textContent = lines.join("\n");
  panel.classList.toggle("error", result.errors.length > 0);
  panel.classList.remove("hidden");
}

function updateSendState() {
  const result = validateParams(currentParams, { prompt: els.promptInput.value, checkKey: false, checkFiles: true });
  const hasApiKey = Boolean(getApiKey());
  const missingPromptOnly = result.errors.length === 1 && result.errors[0].includes("请输入 prompt");
  const displayErrors = missingPromptOnly && !els.promptInput.value.trim() ? [] : result.errors;
  showValidation({ errors: displayErrors, warnings: result.warnings });
  els.sendBtn.disabled = isSending || result.errors.length > 0 || !hasApiKey;
  updateApiStatus();
}

function updateApiStatus() {
  const key = getApiKey();
  let baseLabel = "官方站点";
  try {
    const base = getBaseUrl();
    baseLabel = base === OFFICIAL_BASE_URL ? "官方站点" : "中转站";
  } catch {
    baseLabel = "站点格式错误";
  }
  if (key) {
    els.apiStatus.textContent = settings.saveApiKey ? `API Key 已本地保存 · ${baseLabel}` : `API Key 本次会话可用 · ${baseLabel}`;
    els.apiStatus.className = "status-pill ok";
  } else {
    els.apiStatus.textContent = `未配置 API Key · ${baseLabel}`;
    els.apiStatus.className = "status-pill warn";
  }
}

function syncParamsFromControls() {
  currentParams.endpoint = els.endpointSelect.value;
  currentParams.model = els.modelInput.value.trim() || "gpt-image-2";
  currentParams.quality = els.qualitySelect.value;
  currentParams.output_format = els.outputFormatSelect.value;
  currentParams.output_compression = Number(els.compressionInput.value);
  currentParams.background = els.backgroundSelect.value;
  currentParams.n = Number(els.countInput.value);
  currentParams.moderation = els.moderationSelect.value;
  currentParams.stream = els.streamToggle.checked;
  currentParams.partial_images = Number(els.partialImagesInput.value);
  currentParams.user = els.userInput.value.trim();
  if (currentParams.size === "custom") {
    currentParams.customWidth = Number(els.customWidthInput.value);
    currentParams.customHeight = Number(els.customHeightInput.value);
  }
  renderParamVisibility();
  updateSizeUi({ syncBuilder: !suppressSizeBuilderSync });
  updateSendState();
}

function applyParamsToControls(params = currentParams) {
  const normalized = normalizeParams(params);
  currentParams = normalized;
  els.endpointSelect.value = normalized.endpoint;
  els.modelInput.value = normalized.model;
  els.qualitySelect.value = normalized.quality;
  els.outputFormatSelect.value = normalized.output_format;
  els.compressionInput.value = normalized.output_compression;
  els.compressionLabel.textContent = `${normalized.output_compression}%`;
  els.backgroundSelect.value = normalized.background;
  els.countInput.value = normalized.n;
  els.moderationSelect.value = normalized.moderation;
  els.streamToggle.checked = normalized.stream;
  els.partialImagesInput.value = normalized.partial_images;
  els.userInput.value = normalized.user || "";
  els.customWidthInput.value = normalized.customWidth;
  els.customHeightInput.value = normalized.customHeight;
  renderParamVisibility();
  updateSizeUi();
  updateSendState();
}

function normalizeParams(params) {
  const merged = { ...DEFAULT_PARAMS, ...(params || {}) };
  merged.endpoint = ["generations", "edits"].includes(merged.endpoint) ? merged.endpoint : DEFAULT_PARAMS.endpoint;
  merged.model = String(merged.model || DEFAULT_PARAMS.model).trim();
  merged.size = String(merged.size || DEFAULT_PARAMS.size).trim().toLowerCase();
  if (merged.size !== "auto" && merged.size !== "custom" && !parseSize(merged.size)) merged.size = "auto";
  if (merged.size !== "custom") {
    const parsed = parseSize(merged.size);
    if (parsed && !parsed.auto) {
      merged.customWidth = parsed.width;
      merged.customHeight = parsed.height;
    }
  }
  merged.customWidth = clamp(merged.customWidth, 16, SIZE_MAX_EDGE);
  merged.customHeight = clamp(merged.customHeight, 16, SIZE_MAX_EDGE);
  merged.quality = QUALITY_VALUES.has(merged.quality) ? merged.quality : DEFAULT_PARAMS.quality;
  merged.output_format = OUTPUT_FORMATS.has(merged.output_format) ? merged.output_format : DEFAULT_PARAMS.output_format;
  merged.output_compression = clamp(Math.round(merged.output_compression), 0, 100);
  merged.background = BACKGROUND_VALUES.has(merged.background) ? merged.background : DEFAULT_PARAMS.background;
  merged.n = clamp(Math.round(merged.n), 1, 10);
  merged.moderation = MODERATION_VALUES.has(merged.moderation) ? merged.moderation : DEFAULT_PARAMS.moderation;
  merged.stream = Boolean(merged.stream);
  merged.partial_images = clamp(Math.round(merged.partial_images), 0, 3);
  merged.user = String(merged.user || "").trim();
  return merged;
}

function renderParamVisibility() {
  const isGeneration = currentParams.endpoint === "generations";
  $$(".generation-only").forEach((node) => node.classList.toggle("hidden", !isGeneration));
  els.uploadImagesBtn.disabled = !isGeneration ? false : false;
  els.uploadMaskBtn.disabled = currentParams.endpoint !== "edits";
  els.partialImagesInput.disabled = !currentParams.stream;
}

function setSelectIfAvailable(select, value) {
  if (!select) return;
  const optionExists = Array.from(select.options || []).some((option) => option.value === value);
  if (optionExists) select.value = value;
}

function inferRatioValue(width, height) {
  const ratioOptions = ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "21:9"];
  const actual = Number(width) / Number(height);
  for (const option of ratioOptions) {
    const [rw, rh] = option.split(":").map(Number);
    if (Math.abs(actual - rw / rh) < 0.015) return option;
  }
  return "custom";
}

function inferScaleValue(width, height) {
  const longEdge = Math.max(Number(width) || 0, Number(height) || 0);
  const scales = [1024, 2048, 3072, 3840];
  const exact = scales.find((scale) => Math.abs(scale - longEdge) <= 16);
  if (exact) return String(exact);
  return String(scales.reduce((best, scale) => Math.abs(scale - longEdge) < Math.abs(best - longEdge) ? scale : best, 1024));
}

function syncSizeBuilderUi() {
  const mode = els.ratioSelect.value || "auto";
  const isAuto = mode === "auto";
  const isCustom = mode === "custom";
  els.scaleSelect.disabled = isAuto || isCustom;
  els.customSizeRow.classList.toggle("hidden", !isCustom);
}

function updateSizeUi({ syncBuilder = true } = {}) {
  const size = resolveSize(currentParams);
  els.resolvedSizeLabel.textContent = size;

  if (!syncBuilder) {
    syncSizeBuilderUi();
    return;
  }

  if (currentParams.size === "custom") {
    setSelectIfAvailable(els.ratioSelect, "custom");
    els.customWidthInput.value = currentParams.customWidth;
    els.customHeightInput.value = currentParams.customHeight;
    syncSizeBuilderUi();
    return;
  }

  const parsed = parseSize(size);
  if (!parsed || parsed.auto) {
    setSelectIfAvailable(els.ratioSelect, "auto");
  } else {
    els.customWidthInput.value = parsed.width;
    els.customHeightInput.value = parsed.height;
    const inferredRatio = inferRatioValue(parsed.width, parsed.height);
    setSelectIfAvailable(els.ratioSelect, inferredRatio);
    setSelectIfAvailable(els.scaleSelect, inferScaleValue(parsed.width, parsed.height));
  }
  syncSizeBuilderUi();
}

function applySizeSelectionFromBuilder({ notifyCapped = false } = {}) {
  const mode = els.ratioSelect.value || "auto";
  if (mode === "auto") {
    currentParams.size = "auto";
  } else if (mode === "custom") {
    currentParams.size = "custom";
    currentParams.customWidth = Number(els.customWidthInput.value);
    currentParams.customHeight = Number(els.customHeightInput.value);
  } else {
    const { width, height, capped } = computeRatioSize(mode, Number(els.scaleSelect.value));
    currentParams.size = `${width}x${height}`;
    currentParams.customWidth = width;
    currentParams.customHeight = height;
    if (capped && notifyCapped) toast(`已按 GPT Image 2 像素/边长上限调整为 ${width}x${height}。`, "info");
  }
  suppressSizeBuilderSync = true;
  try {
    syncParamsFromControls();
  } finally {
    suppressSizeBuilderSync = false;
  }
}

function roundToMultiple(value, mode = "nearest") {
  if (mode === "floor") return Math.max(SIZE_MULTIPLE, Math.floor(value / SIZE_MULTIPLE) * SIZE_MULTIPLE);
  if (mode === "ceil") return Math.max(SIZE_MULTIPLE, Math.ceil(value / SIZE_MULTIPLE) * SIZE_MULTIPLE);
  return Math.max(SIZE_MULTIPLE, Math.round(value / SIZE_MULTIPLE) * SIZE_MULTIPLE);
}

function computeRatioSize(ratioText, longEdge) {
  const [rwRaw, rhRaw] = ratioText.split(":").map(Number);
  const rw = Number.isFinite(rwRaw) && rwRaw > 0 ? rwRaw : 1;
  const rh = Number.isFinite(rhRaw) && rhRaw > 0 ? rhRaw : 1;
  let width;
  let height;
  if (rw >= rh) {
    width = Number(longEdge);
    height = width * (rh / rw);
  } else {
    height = Number(longEdge);
    width = height * (rw / rh);
  }
  width = roundToMultiple(width);
  height = roundToMultiple(height);
  let capped = false;
  let pixels = width * height;

  if (pixels < SIZE_MIN_PIXELS) {
    const factor = Math.sqrt(SIZE_MIN_PIXELS / pixels);
    width = roundToMultiple(width * factor, "ceil");
    height = roundToMultiple(height * factor, "ceil");
    pixels = width * height;
  }

  if (pixels > SIZE_MAX_PIXELS) {
    capped = true;
    const factor = Math.sqrt(SIZE_MAX_PIXELS / pixels);
    width = roundToMultiple(width * factor, "floor");
    height = roundToMultiple(height * factor, "floor");
    pixels = width * height;
  }
  if (Math.max(width, height) > SIZE_MAX_EDGE) {
    capped = true;
    const factor = SIZE_MAX_EDGE / Math.max(width, height);
    width = roundToMultiple(width * factor, "floor");
    height = roundToMultiple(height * factor, "floor");
  }
  return { width, height, capped };
}

function renderAttachmentStrip() {
  const items = [...sourceItems.map((item) => ({ ...item, kindLabel: "参考图" }))];
  if (maskItem) items.push({ ...maskItem, kindLabel: "Mask" });
  if (!items.length) {
    els.attachmentStrip.classList.add("hidden");
    els.attachmentStrip.innerHTML = "";
    return;
  }
  els.attachmentStrip.classList.remove("hidden");
  els.attachmentStrip.innerHTML = items.map((item) => `
    <div class="attachment-chip" title="${escapeHtml(item.name)}">
      <img src="${item.dataUrl}" alt="${escapeHtml(item.name)}" />
      <div>
        <div class="attachment-chip-title">${escapeHtml(item.kindLabel)} · ${escapeHtml(item.name)}</div>
        <div class="attachment-chip-subtitle">${item.width || "?"}×${item.height || "?"} · ${formatBytes(item.size)}</div>
      </div>
      <button class="remove-attachment" type="button" data-remove-kind="${item.kindLabel === "Mask" ? "mask" : "source"}" data-id="${item.id}" title="移除">×</button>
    </div>
  `).join("");
}

function serializeAttachment(item, kind = "source") {
  return {
    id: item.id,
    kind,
    name: item.name,
    type: item.type,
    size: item.size,
    width: item.width || null,
    height: item.height || null,
    dataUrl: item.dataUrl,
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function getImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("无法读取图片尺寸"));
    img.src = dataUrl;
  });
}

async function createFileItem(file) {
  const dataUrl = await readFileAsDataUrl(file);
  let width = null;
  let height = null;
  try {
    const dims = await getImageDimensions(dataUrl);
    width = dims.width;
    height = dims.height;
  } catch {
    // Ignore; server-side validation will still catch unsupported images.
  }
  return {
    id: uid("file"),
    file,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    dataUrl,
    width,
    height,
  };
}

async function handleSourceImages(files) {
  const incoming = Array.from(files || []);
  if (!incoming.length) return;
  const remaining = MAX_INPUT_IMAGES - sourceItems.length;
  if (remaining <= 0) {
    toast(`最多只能添加 ${MAX_INPUT_IMAGES} 张参考图。`, "error");
    return;
  }
  const selected = incoming.slice(0, remaining);
  if (incoming.length > selected.length) toast(`已忽略多余文件；最多支持 ${MAX_INPUT_IMAGES} 张参考图。`, "error");
  const created = [];
  for (const file of selected) {
    try {
      created.push(await createFileItem(file));
    } catch (error) {
      toast(`读取 ${file.name} 失败：${error.message || error}`, "error");
    }
  }
  sourceItems.push(...created);
  renderAttachmentStrip();
  updateSendState();
}

async function handleMask(file) {
  if (!file) return;
  try {
    maskItem = await createFileItem(file);
    renderAttachmentStrip();
    updateSendState();
  } catch (error) {
    toast(`读取 mask 失败：${error.message || error}`, "error");
  }
}

function renderSidebar() {
  const sortedConversations = [...conversations].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  els.conversationList.innerHTML = sortedConversations.length ? sortedConversations.map((conversation) => `
    <button class="conversation-item ${conversation.id === currentConversationId ? "active" : ""}" type="button" data-chat-id="${conversation.id}">
      <span class="item-main">
        <span class="item-title">${escapeHtml(conversation.title || "未命名对话")}</span>
        <span class="item-subtitle">${formatDateTime(conversation.updatedAt)} · ${conversation.messages?.length || 0} 条消息</span>
      </span>
      <span class="item-actions">
        <span class="mini-icon" role="button" tabindex="0" data-delete-chat="${conversation.id}" title="删除">×</span>
      </span>
    </button>
  `).join("") : `<div class="item-subtitle" style="padding: 8px 10px;">暂无对话</div>`;

  const sortedPresets = [...presets].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  els.presetList.innerHTML = sortedPresets.length ? sortedPresets.map((preset) => `
    <button class="preset-item" type="button" data-preset-id="${preset.id}">
      <span class="item-main">
        <span class="item-title">${escapeHtml(preset.name)}</span>
        <span class="item-subtitle">${escapeHtml(preset.description || preset.params?.size || "点击套用")}</span>
      </span>
      <span class="item-actions">
        <span class="mini-icon" role="button" tabindex="0" data-edit-preset="${preset.id}" title="编辑">✎</span>
        <span class="mini-icon" role="button" tabindex="0" data-delete-preset="${preset.id}" title="删除">×</span>
      </span>
    </button>
  `).join("") : `<div class="item-subtitle" style="padding: 8px 10px;">暂无预设</div>`;
}

function getCurrentConversation() {
  return conversations.find((item) => item.id === currentConversationId) || null;
}

function setCurrentConversation(id) {
  currentConversationId = id;
  const conversation = getCurrentConversation();
  els.conversationTitle.textContent = conversation?.title || "新图片对话";
  els.conversationSubtitle.textContent = conversation ? `${formatDateTime(conversation.updatedAt)} · 本地保存` : "生成、编辑并本地保存图片历史";
  renderSidebar();
  renderMessages();
}

function renderMessages() {
  const conversation = getCurrentConversation();
  const messages = conversation?.messages || [];
  els.emptyState.classList.toggle("hidden", messages.length > 0);
  els.messageList.innerHTML = messages.map(renderMessage).join("");
  queueMicrotask(() => {
    els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
  });
}

function renderMessage(message) {
  if (message.role === "user") return renderUserMessage(message);
  if (message.role === "assistant") return renderAssistantMessage(message);
  return renderErrorMessage(message);
}

function renderUserMessage(message) {
  const attachments = message.attachments || [];
  const chips = message.request?.params ? renderRequestChips(message.request.params, message.request.endpoint) : "";
  return `
    <article class="message user" data-message-id="${message.id}">
      <div class="message-content">
        ${escapeHtml(message.content)}
        ${attachments.length ? `<div class="attachment-preview-grid">${attachments.map((item) => `
          <div class="attachment-preview">
            <img src="${item.dataUrl}" alt="${escapeHtml(item.name)}" />
            <span>${escapeHtml(item.kind === "mask" ? "Mask" : item.name)}</span>
          </div>
        `).join("")}</div>` : ""}
        ${chips}
        <div class="message-meta">${formatDateTime(message.createdAt)}</div>
      </div>
      <div class="avatar">你</div>
    </article>
  `;
}

function renderRequestChips(params, endpoint) {
  const size = params.size || "auto";
  const pieces = [
    endpoint === "edits" ? "edits" : "generations",
    params.model,
    size,
    `q:${params.quality}`,
    params.output_format,
    `n:${params.n}`,
  ].filter(Boolean);
  return `<div class="request-summary">${pieces.map((piece) => `<span class="summary-chip">${escapeHtml(piece)}</span>`).join("")}</div>`;
}

function renderAssistantMessage(message) {
  if (message.status === "loading") {
    return `
      <article class="message assistant" data-message-id="${message.id}">
        <div class="avatar">AI</div>
        <div class="message-content"><div class="message-meta loading-dots">正在调用 Image API</div></div>
      </article>
    `;
  }
  const images = message.images || [];
  const imageGrid = images.length ? `<div class="image-grid">${images.map((image, index) => renderImageCard(image, index, message)).join("")}</div>` : "";
  const meta = renderResponseMeta(message);
  return `
    <article class="message assistant" data-message-id="${message.id}">
      <div class="avatar">AI</div>
      <div class="message-content">
        ${message.content ? `<div style="margin-bottom: 10px;">${escapeHtml(message.content)}</div>` : ""}
        ${imageGrid}
        ${meta}
      </div>
    </article>
  `;
}

function renderImageCard(image, index, message) {
  const extension = image.extension || mimeToExtension(image.mime) || "png";
  const filename = `gpt-image2-${message.createdAt?.slice(0, 10) || "image"}-${index + 1}.${extension}`;
  const isData = String(image.src || "").startsWith("data:");
  return `
    <figure class="image-card">
      <img src="${image.src}" alt="生成结果 ${index + 1}" loading="lazy" />
      <figcaption class="image-card-footer">
        <span>${escapeHtml(image.label || `结果 ${index + 1}`)}${image.size ? ` · ${escapeHtml(image.size)}` : ""}</span>
        ${isData ? `<a class="download-link" href="${image.src}" download="${filename}">下载</a>` : `<a class="download-link" href="${image.src}" target="_blank" rel="noreferrer">打开</a>`}
      </figcaption>
    </figure>
  `;
}

function renderResponseMeta(message) {
  const meta = message.responseMeta || {};
  const usage = meta.usage;
  const usageText = usage ? ` · tokens: ${usage.total_tokens ?? "?"}` : "";
  const requestId = meta.requestId ? ` · request_id: ${escapeHtml(meta.requestId)}` : "";
  return `<div class="message-meta">${formatDateTime(message.createdAt)}${usageText}${requestId}</div>`;
}

function renderErrorMessage(message) {
  return `
    <article class="message error" data-message-id="${message.id}">
      <div class="avatar">!</div>
      <div class="message-content">
        ${escapeHtml(message.content || "请求失败")}
        <div class="message-meta">${formatDateTime(message.createdAt)}</div>
      </div>
    </article>
  `;
}

function mimeToExtension(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  return null;
}

function mimeFromOutputFormat(format) {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function ensureConversation(prompt) {
  let conversation = getCurrentConversation();
  if (conversation) return conversation;
  const time = nowIso();
  conversation = {
    id: uid("chat"),
    title: firstLineTitle(prompt),
    createdAt: time,
    updatedAt: time,
    messages: [],
  };
  conversations.unshift(conversation);
  currentConversationId = conversation.id;
  return conversation;
}

async function saveConversation(conversation) {
  conversation.updatedAt = nowIso();
  await idbPut("conversations", conversation);
  const index = conversations.findIndex((item) => item.id === conversation.id);
  if (index >= 0) conversations[index] = conversation;
  else conversations.unshift(conversation);
  renderSidebar();
}

function buildRequestParams(prompt) {
  const params = normalizeParams(currentParams);
  const requestParams = {
    model: params.model,
    prompt,
    n: params.n,
    size: resolveSize(params),
    quality: params.quality,
    output_format: params.output_format,
    background: params.background,
  };
  if (params.output_format !== "png") requestParams.output_compression = params.output_compression;
  if (params.endpoint === "generations") requestParams.moderation = params.moderation;
  if (params.stream) {
    requestParams.stream = true;
    requestParams.partial_images = params.partial_images;
  }
  if (params.user) requestParams.user = params.user;
  return requestParams;
}

function appendFormField(formData, key, value) {
  if (value === undefined || value === null || value === "") return;
  formData.append(key, String(value));
}

function buildEditFormData(params) {
  const formData = new FormData();
  Object.entries(params).forEach(([key, value]) => appendFormField(formData, key, value));
  sourceItems.forEach((item) => formData.append("image[]", item.file, item.file.name));
  if (maskItem) formData.append("mask", maskItem.file, maskItem.file.name);
  return formData;
}

async function handleSend() {
  if (isSending) return;
  syncParamsFromControls();
  const prompt = els.promptInput.value.trim();
  const validation = validateParams(currentParams, { prompt, checkKey: true, checkFiles: true });
  if (validation.errors.length) {
    showValidation(validation);
    toast("请先修正参数错误。", "error");
    return;
  }
  if (!getApiKey()) {
    toast("请先在设置中填写 API Key。", "error");
    openSettingsDialog();
    return;
  }

  isSending = true;
  updateSendState();

  const conversation = ensureConversation(prompt);
  if (!conversation.messages.length) conversation.title = firstLineTitle(prompt);

  const endpoint = currentParams.endpoint;
  const requestParams = buildRequestParams(prompt);
  const userMessage = {
    id: uid("msg"),
    role: "user",
    content: prompt,
    createdAt: nowIso(),
    request: { endpoint, params: requestParams },
    attachments: [
      ...sourceItems.map((item) => serializeAttachment(item, "source")),
      ...(maskItem ? [serializeAttachment(maskItem, "mask")] : []),
    ],
  };
  const assistantMessage = {
    id: uid("msg"),
    role: "assistant",
    status: "loading",
    createdAt: nowIso(),
  };
  conversation.messages.push(userMessage, assistantMessage);
  await saveConversation(conversation);
  setCurrentConversation(conversation.id);

  try {
    const result = await callImageApi(endpoint, requestParams);
    const finalMessage = {
      id: assistantMessage.id,
      role: "assistant",
      content: result.images.length ? "" : "接口返回成功，但没有检测到图片数据。",
      images: result.images,
      responseMeta: result.meta,
      createdAt: nowIso(),
    };
    replaceMessage(conversation, assistantMessage.id, finalMessage);
    await saveConversation(conversation);
    renderMessages();
    toast("图片已生成并保存到本地历史。", "success");
  } catch (error) {
    const errorMessage = {
      id: assistantMessage.id,
      role: "error",
      content: `请求失败：${error.message || error}`,
      createdAt: nowIso(),
    };
    replaceMessage(conversation, assistantMessage.id, errorMessage);
    await saveConversation(conversation);
    renderMessages();
    toast(error.message || "请求失败", "error", 5200);
  } finally {
    isSending = false;
    updateSendState();
  }
}

function replaceMessage(conversation, id, replacement) {
  const index = conversation.messages.findIndex((message) => message.id === id);
  if (index >= 0) conversation.messages[index] = replacement;
}

async function callImageApi(endpoint, requestParams) {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/images/${endpoint}`;
  const headers = { Authorization: `Bearer ${getApiKey()}` };
  const fetchOptions = { method: "POST", headers };

  if (endpoint === "generations") {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(requestParams);
  } else {
    fetchOptions.body = buildEditFormData(requestParams);
  }

  const response = await fetch(url, fetchOptions);
  const requestId = response.headers.get("x-request-id") || response.headers.get("request-id") || "";
  if (!response.ok) {
    throw new Error(await readErrorResponse(response, requestId));
  }

  if (requestParams.stream) {
    const streamed = await readStreamingImages(response, requestParams);
    streamed.meta.requestId = requestId;
    return streamed;
  }

  const json = await response.json();
  return parseImageResponse(json, requestParams, requestId);
}

async function readErrorResponse(response, requestId) {
  let text = "";
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await response.json();
      text = json?.error?.message || json?.message || JSON.stringify(json);
    } else {
      text = await response.text();
    }
  } catch {
    text = "无法读取错误响应。";
  }
  return `${response.status} ${response.statusText}${requestId ? ` · ${requestId}` : ""}${text ? ` · ${text}` : ""}`;
}

function parseImageResponse(json, requestParams, requestId = "") {
  const format = json.output_format || requestParams.output_format || "png";
  const mime = mimeFromOutputFormat(format);
  const images = Array.isArray(json.data) ? json.data.flatMap((item, index) => {
    if (item.b64_json) {
      return [{
        src: `data:${mime};base64,${item.b64_json}`,
        mime,
        extension: format === "jpeg" ? "jpg" : format,
        label: `结果 ${index + 1}`,
        revisedPrompt: item.revised_prompt || "",
        size: json.size || requestParams.size || "",
      }];
    }
    if (item.url) {
      return [{
        src: item.url,
        mime: "",
        extension: "",
        label: `结果 ${index + 1}`,
        revisedPrompt: item.revised_prompt || "",
        size: json.size || requestParams.size || "",
      }];
    }
    return [];
  }) : [];
  return {
    images,
    meta: {
      requestId,
      created: json.created || null,
      background: json.background || requestParams.background,
      output_format: format,
      quality: json.quality || requestParams.quality,
      size: json.size || requestParams.size,
      usage: json.usage || null,
    },
  };
}

async function readStreamingImages(response, requestParams) {
  if (!response.body) throw new Error("浏览器没有返回可读的流式响应。 ");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\s*\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const parsed = parseStreamBlock(block);
      if (parsed) events.push(parsed);
    }
  }
  buffer += decoder.decode();
  const last = parseStreamBlock(buffer);
  if (last) events.push(last);

  const completed = events.filter((event) => event?.b64_json && String(event.type || "").includes("completed"));
  const partials = events.filter((event) => event?.b64_json && !String(event.type || "").includes("completed"));
  const selected = completed.length ? completed : partials;
  const format = selected.at(-1)?.output_format || requestParams.output_format || "png";
  const mime = mimeFromOutputFormat(format);
  const images = selected.map((event, index) => ({
    src: `data:${mime};base64,${event.b64_json}`,
    mime,
    extension: format === "jpeg" ? "jpg" : format,
    label: String(event.type || "").includes("partial") ? `部分图 ${index + 1}` : `结果 ${index + 1}`,
    size: event.size || requestParams.size || "",
  }));
  return {
    images,
    meta: {
      created: selected.at(-1)?.created_at || null,
      background: selected.at(-1)?.background || requestParams.background,
      output_format: format,
      quality: selected.at(-1)?.quality || requestParams.quality,
      size: selected.at(-1)?.size || requestParams.size,
      usage: selected.at(-1)?.usage || null,
      streamEvents: events.length,
    },
  };
}

function parseStreamBlock(block) {
  const clean = String(block || "").trim();
  if (!clean) return null;
  const dataLines = clean.split(/\r?\n/)
    .filter((line) => line.trim().startsWith("data:"))
    .map((line) => line.replace(/^\s*data:\s?/, ""));
  const payload = dataLines.length ? dataLines.join("\n") : clean;
  if (!payload || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload);
  } catch {
    const jsonStart = payload.indexOf("{");
    if (jsonStart >= 0) {
      try {
        return JSON.parse(payload.slice(jsonStart));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function openSettingsDialog() {
  els.baseUrlInput.value = settings.baseUrl || "";
  els.apiKeyInput.value = getApiKey();
  els.saveKeyToggle.checked = Boolean(settings.saveApiKey);
  els.settingsDialog.showModal();
}

function saveSettingsFromDialog() {
  try {
    const base = els.baseUrlInput.value.trim();
    if (base) normalizeBaseUrl(base);
    const key = els.apiKeyInput.value.trim();
    settings.baseUrl = base;
    settings.saveApiKey = els.saveKeyToggle.checked;
    if (settings.saveApiKey) {
      settings.apiKey = key;
      runtimeApiKey = key;
    } else {
      settings.apiKey = "";
      runtimeApiKey = key;
    }
    persistSettings();
    updateSendState();
    toast("设置已保存。", "success");
    els.settingsDialog.close();
  } catch (error) {
    toast(`API 站点格式错误：${error.message || error}`, "error");
  }
}

function testSettingsFormat() {
  try {
    normalizeBaseUrl(els.baseUrlInput.value.trim());
    const key = els.apiKeyInput.value.trim();
    if (!key) {
      toast("API Key 为空。", "error");
      return;
    }
    toast("格式看起来可用。此按钮不会联网测试 Key。", "success");
  } catch (error) {
    toast(`API 站点格式错误：${error.message || error}`, "error");
  }
}

function openPresetDialog(preset = null, useCurrent = false) {
  const params = preset?.params || (useCurrent ? { ...currentParams, size: resolveSize(currentParams) } : { ...DEFAULT_PARAMS });
  const normalized = normalizeParamsForPreset(params);
  els.presetDialogTitle.textContent = preset ? "编辑预设" : "添加预设";
  els.presetIdInput.value = preset?.id || "";
  els.presetNameInput.value = preset?.name || "";
  els.presetEndpointSelect.value = normalized.endpoint;
  els.presetDescriptionInput.value = preset?.description || "";
  els.presetPromptInput.value = preset?.promptTemplate || "";
  els.presetModelInput.value = normalized.model;
  els.presetSizeInput.value = normalized.size;
  els.presetCountInput.value = normalized.n;
  els.presetQualitySelect.value = normalized.quality;
  els.presetFormatSelect.value = normalized.output_format;
  els.presetCompressionInput.value = normalized.output_compression;
  els.presetBackgroundSelect.value = normalized.background;
  els.presetModerationSelect.value = normalized.moderation;
  els.presetPartialInput.value = normalized.partial_images;
  els.presetStreamToggle.checked = normalized.stream;
  els.presetUserInput.value = normalized.user || "";
  els.presetValidation.classList.add("hidden");
  els.presetDialog.showModal();
}

function normalizeParamsForPreset(params) {
  const merged = normalizeParams({ ...params, size: params.size || "auto" });
  if (params.size && params.size !== "custom") merged.size = String(params.size).trim().toLowerCase();
  return merged;
}

function readPresetForm() {
  return {
    endpoint: els.presetEndpointSelect.value,
    model: els.presetModelInput.value.trim() || "gpt-image-2",
    size: els.presetSizeInput.value.trim().toLowerCase() || "auto",
    n: Number(els.presetCountInput.value),
    quality: els.presetQualitySelect.value,
    output_format: els.presetFormatSelect.value,
    output_compression: Number(els.presetCompressionInput.value),
    background: els.presetBackgroundSelect.value,
    moderation: els.presetModerationSelect.value,
    stream: els.presetStreamToggle.checked,
    partial_images: Number(els.presetPartialInput.value),
    user: els.presetUserInput.value.trim(),
  };
}

function validatePresetForm(params) {
  const errors = [];
  const warnings = [];
  if (!els.presetNameInput.value.trim()) errors.push("预设名称不能为空。");
  const sizeResult = validateSizeValue(params.size, { model: params.model });
  errors.push(...sizeResult.errors);
  warnings.push(...sizeResult.warnings);
  const pseudo = normalizeParams({ ...DEFAULT_PARAMS, ...params, size: params.size });
  const result = validateParams(pseudo, { prompt: els.presetPromptInput.value || "占位", endpoint: params.endpoint, checkKey: false, checkFiles: false });
  errors.push(...result.errors.filter((item) => !item.includes("请输入 prompt")));
  warnings.push(...result.warnings.filter((item) => !item.includes("png 不使用")));
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

function showPresetValidation(result) {
  const lines = [...result.errors.map((item) => `错误：${item}`), ...result.warnings.map((item) => `提醒：${item}`)];
  if (!lines.length) {
    els.presetValidation.classList.add("hidden");
    els.presetValidation.classList.remove("error");
    return;
  }
  els.presetValidation.textContent = lines.join("\n");
  els.presetValidation.classList.toggle("error", result.errors.length > 0);
  els.presetValidation.classList.remove("hidden");
}

async function savePresetFromDialog() {
  const params = readPresetForm();
  const validation = validatePresetForm(params);
  showPresetValidation(validation);
  if (validation.errors.length) return;
  const id = els.presetIdInput.value || uid("preset");
  const existing = presets.find((item) => item.id === id);
  const time = nowIso();
  const preset = {
    id,
    name: els.presetNameInput.value.trim(),
    description: els.presetDescriptionInput.value.trim(),
    promptTemplate: els.presetPromptInput.value,
    params,
    createdAt: existing?.createdAt || time,
    updatedAt: time,
  };
  await idbPut("presets", preset);
  const index = presets.findIndex((item) => item.id === id);
  if (index >= 0) presets[index] = preset;
  else presets.push(preset);
  renderSidebar();
  els.presetDialog.close();
  toast("预设已保存。", "success");
}

function applyPreset(preset) {
  if (!preset) return;
  const params = normalizeParamsFromPreset(preset.params || {});
  applyParamsToControls(params);
  if (preset.promptTemplate) {
    els.promptInput.value = preset.promptTemplate;
    autoResizePrompt();
  }
  updateSendState();
  toast(`已套用预设：${preset.name}`, "success");
  closeSidebar();
}

function normalizeParamsFromPreset(params) {
  const size = String(params.size || "auto").trim().toLowerCase();
  const parsed = parseSize(size);
  if (KNOWN_SIZES.has(size) || size === "auto") {
    return normalizeParams({ ...DEFAULT_PARAMS, ...params, size });
  }
  if (parsed && !parsed.auto) {
    return normalizeParams({ ...DEFAULT_PARAMS, ...params, size: "custom", customWidth: parsed.width, customHeight: parsed.height });
  }
  return normalizeParams({ ...DEFAULT_PARAMS, ...params, size: "auto" });
}

async function deletePreset(id) {
  const preset = presets.find((item) => item.id === id);
  if (!preset) return;
  if (!confirm(`删除预设「${preset.name}」？`)) return;
  await idbDelete("presets", id);
  presets = presets.filter((item) => item.id !== id);
  renderSidebar();
  toast("预设已删除。", "success");
}

async function deleteConversation(id) {
  const conversation = conversations.find((item) => item.id === id);
  if (!conversation) return;
  if (!confirm(`删除对话「${conversation.title || "未命名对话"}」？`)) return;
  await idbDelete("conversations", id);
  conversations = conversations.filter((item) => item.id !== id);
  if (currentConversationId === id) currentConversationId = conversations[0]?.id || null;
  setCurrentConversation(currentConversationId);
  toast("对话已删除。", "success");
}

async function deleteAllConversations() {
  if (!conversations.length) return;
  if (!confirm("删除全部对话记录？生成图片也会从本地历史中移除。")) return;
  await idbClear("conversations");
  conversations = [];
  currentConversationId = null;
  setCurrentConversation(null);
  toast("全部对话记录已删除。", "success");
}

async function clearAllSavedData() {
  if (!confirm("清除本应用保存的所有数据？包括设置、API Key、本地对话、图片和预设。")) return;
  localStorage.removeItem(SETTINGS_KEY);
  await deleteDatabase();
  db = await openDatabase();
  conversations = [];
  presets = [];
  currentConversationId = null;
  sourceItems = [];
  maskItem = null;
  settings = { ...DEFAULT_SETTINGS };
  runtimeApiKey = "";
  currentParams = { ...DEFAULT_PARAMS };
  els.promptInput.value = "";
  applyParamsToControls(currentParams);
  renderAttachmentStrip();
  renderSidebar();
  setCurrentConversation(null);
  toast("所有保存数据已清除。", "success");
}

function startNewConversation() {
  currentConversationId = null;
  els.promptInput.value = "";
  sourceItems = [];
  maskItem = null;
  renderAttachmentStrip();
  autoResizePrompt();
  setCurrentConversation(null);
  updateSendState();
  closeSidebar();
}

function autoResizePrompt() {
  const textarea = els.promptInput;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
}

function bindEvents() {
  els.newChatBtn.addEventListener("click", startNewConversation);
  els.sidebarToggle.addEventListener("click", toggleSidebar);
  els.sidebarBackdrop?.addEventListener("click", closeSidebar);
  if (overlaySidebarQuery.addEventListener) {
    overlaySidebarQuery.addEventListener("change", syncSidebarMode);
  } else {
    overlaySidebarQuery.addListener(syncSidebarMode);
  }
  els.settingsBtn.addEventListener("click", openSettingsDialog);
  els.topSettingsBtn.addEventListener("click", openSettingsDialog);
  els.clearAllDataBtn.addEventListener("click", clearAllSavedData);
  els.deleteAllChatsBtn.addEventListener("click", deleteAllConversations);
  els.addPresetBtn.addEventListener("click", () => openPresetDialog());
  els.saveCurrentPresetBtn.addEventListener("click", () => openPresetDialog(null, true));

  els.promptInput.addEventListener("input", () => {
    autoResizePrompt();
    updateSendState();
  });
  els.promptInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleSend();
    }
  });

  els.uploadImagesBtn.addEventListener("click", () => els.sourceImagesInput.click());
  els.uploadMaskBtn.addEventListener("click", () => els.maskInput.click());
  els.sourceImagesInput.addEventListener("change", async () => {
    await handleSourceImages(els.sourceImagesInput.files);
    els.sourceImagesInput.value = "";
  });
  els.maskInput.addEventListener("change", async () => {
    await handleMask(els.maskInput.files?.[0]);
    els.maskInput.value = "";
  });

  els.attachmentStrip.addEventListener("click", (event) => {
    const target = event.target.closest("[data-remove-kind]");
    if (!target) return;
    const kind = target.dataset.removeKind;
    const id = target.dataset.id;
    if (kind === "mask") maskItem = null;
    else sourceItems = sourceItems.filter((item) => item.id !== id);
    renderAttachmentStrip();
    updateSendState();
  });

  els.sendBtn.addEventListener("click", handleSend);

  [
    els.endpointSelect,
    els.modelInput,
    els.qualitySelect,
    els.outputFormatSelect,
    els.compressionInput,
    els.backgroundSelect,
    els.countInput,
    els.moderationSelect,
    els.streamToggle,
    els.partialImagesInput,
    els.userInput,
    els.customWidthInput,
    els.customHeightInput,
  ].forEach((node) => {
    node.addEventListener("input", () => {
      els.compressionLabel.textContent = `${els.compressionInput.value}%`;
      syncParamsFromControls();
    });
    node.addEventListener("change", () => {
      els.compressionLabel.textContent = `${els.compressionInput.value}%`;
      syncParamsFromControls();
    });
  });

  els.ratioSelect.addEventListener("change", () => applySizeSelectionFromBuilder({ notifyCapped: true }));
  els.scaleSelect.addEventListener("change", () => applySizeSelectionFromBuilder({ notifyCapped: true }));

  els.conversationList.addEventListener("click", (event) => {
    const deleteTarget = event.target.closest("[data-delete-chat]");
    if (deleteTarget) {
      event.stopPropagation();
      deleteConversation(deleteTarget.dataset.deleteChat);
      return;
    }
    const item = event.target.closest("[data-chat-id]");
    if (item) {
      setCurrentConversation(item.dataset.chatId);
      closeSidebar();
    }
  });

  els.presetList.addEventListener("click", (event) => {
    const deleteTarget = event.target.closest("[data-delete-preset]");
    if (deleteTarget) {
      event.stopPropagation();
      deletePreset(deleteTarget.dataset.deletePreset);
      return;
    }
    const editTarget = event.target.closest("[data-edit-preset]");
    if (editTarget) {
      event.stopPropagation();
      const preset = presets.find((item) => item.id === editTarget.dataset.editPreset);
      openPresetDialog(preset);
      return;
    }
    const item = event.target.closest("[data-preset-id]");
    if (item) {
      const preset = presets.find((entry) => entry.id === item.dataset.presetId);
      applyPreset(preset);
    }
  });

  els.settingsForm.addEventListener("submit", (event) => {
    if (event.submitter?.id === "saveSettingsBtn") {
      event.preventDefault();
      saveSettingsFromDialog();
    }
  });
  els.testConfigBtn.addEventListener("click", testSettingsFormat);

  $$('[data-dialog-close]').forEach((button) => {
    button.addEventListener("click", () => closeDialogById(button.dataset.dialogClose));
  });

  els.presetForm.addEventListener("submit", (event) => {
    if (event.submitter?.id === "savePresetBtn") {
      event.preventDefault();
      savePresetFromDialog();
    }
  });
  [
    els.presetNameInput,
    els.presetEndpointSelect,
    els.presetModelInput,
    els.presetSizeInput,
    els.presetCountInput,
    els.presetQualitySelect,
    els.presetFormatSelect,
    els.presetCompressionInput,
    els.presetBackgroundSelect,
    els.presetModerationSelect,
    els.presetPartialInput,
    els.presetStreamToggle,
    els.presetUserInput,
  ].forEach((node) => node.addEventListener("input", () => showPresetValidation(validatePresetForm(readPresetForm()))));

  $$(".suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      els.promptInput.value = button.dataset.prompt || "";
      autoResizePrompt();
      updateSendState();
      els.promptInput.focus();
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
  });
}

async function init() {
  db = await openDatabase();
  loadSettings();
  conversations = await idbGetAll("conversations");
  presets = await idbGetAll("presets");
  bindEvents();
  syncSidebarMode();
  applyParamsToControls(currentParams);
  renderAttachmentStrip();
  renderSidebar();
  setCurrentConversation(conversations.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]?.id || null);
  updateApiStatus();
  autoResizePrompt();
}


/* ===== v6 overrides ===== */
Object.assign(els, {
  importPresetsBtn: $("#importPresetsBtn"),
  exportAllPresetsBtn: $("#exportAllPresetsBtn"),
  deleteAllLocalDataBtn: $("#deleteAllLocalDataBtn"),
  presetImportInput: $("#presetImportInput"),
});

const PRESET_EXPORT_SCHEMA = "gpt-image2-studio-preset";
const PRESET_BUNDLE_SCHEMA = "gpt-image2-studio-presets-bundle";

function conversationHasPending(conversation = getCurrentConversation()) {
  return Boolean(conversation?.messages?.some((message) => message.role === "assistant" && message.status === "loading"));
}

function getMessageCopyText(message) {
  if (!message) return "";
  if (message.role === "user") return String(message.content || "").trim();
  if (message.role === "assistant") {
    const parts = [];
    if (message.content) parts.push(String(message.content).trim());
    const revisedPrompts = (message.images || [])
      .map((image, index) => image?.revisedPrompt ? `图片 ${index + 1} 修订提示词：${image.revisedPrompt}` : "")
      .filter(Boolean);
    if (revisedPrompts.length) parts.push(revisedPrompts.join("\n"));
    if (!parts.length && (message.images || []).length) parts.push(`图片结果（${message.images.length} 张）`);
    if (message.rawOutput && !(message.images || []).length) parts.push(`原始输出：\n${message.rawOutput}`);
    return parts.join("\n\n").trim();
  }
  const parts = [String(message.content || "").trim()].filter(Boolean);
  if (message.rawOutput) parts.push(`原始输出：\n${message.rawOutput}`);
  return parts.join("\n\n").trim();
}

async function copyTextToClipboard(text) {
  if (!text) {
    toast("没有可复制的内容。", "info");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制。", "success", 1800);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    toast("已复制。", "success", 1800);
  }
}

function safePrettyJsonText(raw) {
  if (!raw) return "";
  if (typeof raw !== "string") {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

function renderCopyButton(message) {
  return `<button class="copy-btn" type="button" data-copy-message-id="${message.id}">复制</button>`;
}

function renderRawOutputBlock(rawOutput, options = {}) {
  const pretty = safePrettyJsonText(rawOutput);
  if (!pretty) return "";
  const openAttr = options.open ? " open" : "";
  const summaryText = options.summaryText || "查看原始输出";
  return `
    <details class="raw-output"${openAttr}>
      <summary>${escapeHtml(summaryText)}</summary>
      <pre>${escapeHtml(pretty)}</pre>
    </details>
  `;
}

function renderMessageFooter(message, extraTools = "") {
  return `
    <div class="message-footer">
      <div class="message-meta">${formatDateTime(message.createdAt)}</div>
      <div class="message-tools">
        ${extraTools}
        ${renderCopyButton(message)}
      </div>
    </div>
  `;
}

function renderSidebar() {
  const sortedConversations = [...conversations].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  els.conversationList.innerHTML = sortedConversations.length ? sortedConversations.map((conversation) => {
    const pending = conversationHasPending(conversation);
    return `
      <button class="conversation-item ${conversation.id === currentConversationId ? "active" : ""}" type="button" data-chat-id="${conversation.id}">
        <span class="item-main">
          <span class="item-title">${escapeHtml(conversation.title || "未命名对话")}</span>
          <span class="item-subtitle">${formatDateTime(conversation.updatedAt)} · ${conversation.messages?.length || 0} 条消息${pending ? ' · <span class="pending-chip">进行中</span>' : ""}</span>
        </span>
        <span class="item-actions">
          <span class="mini-icon" role="button" tabindex="0" data-delete-chat="${conversation.id}" title="删除">×</span>
        </span>
      </button>
    `;
  }).join("") : `<div class="item-subtitle" style="padding: 8px 10px;">暂无对话</div>`;

  const sortedPresets = [...presets].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  els.presetList.innerHTML = sortedPresets.length ? sortedPresets.map((preset) => `
    <button class="preset-item" type="button" data-preset-id="${preset.id}">
      <span class="item-main">
        <span class="item-title">${escapeHtml(preset.name)}</span>
        <span class="item-subtitle">${escapeHtml(preset.description || preset.params?.size || "点击套用")}</span>
      </span>
      <span class="item-actions">
        <span class="mini-icon" role="button" tabindex="0" data-export-preset="${preset.id}" title="导出">⤓</span>
        <span class="mini-icon" role="button" tabindex="0" data-edit-preset="${preset.id}" title="编辑">✎</span>
        <span class="mini-icon" role="button" tabindex="0" data-delete-preset="${preset.id}" title="删除">×</span>
      </span>
    </button>
  `).join("") : `<div class="item-subtitle" style="padding: 8px 10px;">暂无预设</div>`;
}

function setCurrentConversation(id) {
  currentConversationId = id;
  const conversation = getCurrentConversation();
  els.conversationTitle.textContent = conversation?.title || "新图片对话";
  els.conversationSubtitle.textContent = conversation ? `${formatDateTime(conversation.updatedAt)} · 本地保存` : "生成、编辑并本地保存图片历史";
  renderSidebar();
  renderMessages();
  updateSendState();
}

function renderUserMessage(message) {
  const attachments = message.attachments || [];
  const chips = message.request?.params ? renderRequestChips(message.request.params, message.request.endpoint) : "";
  return `
    <article class="message user" data-message-id="${message.id}">
      <div class="message-content">
        <div class="message-main-text message-body-block">${escapeHtml(message.content)}</div>
        ${attachments.length ? `<div class="attachment-preview-grid message-body-block">${attachments.map((item) => `
          <div class="attachment-preview">
            <img src="${item.dataUrl}" alt="${escapeHtml(item.name)}" />
            <span>${escapeHtml(item.kind === "mask" ? "Mask" : item.name)}</span>
          </div>
        `).join("")}</div>` : ""}
        ${chips ? `<div class="message-body-block">${chips}</div>` : ""}
        ${renderMessageFooter(message)}
      </div>
      <div class="avatar">你</div>
    </article>
  `;
}

function renderAssistantMessage(message) {
  if (message.status === "loading") {
    const startedAt = Number(message.startedAt) || Date.now();
    return `
      <article class="message assistant" data-message-id="${message.id}">
        <div class="avatar">AI</div>
        <div class="message-content">
          <div class="message-main-text message-body-block">正在调用 Image API…</div>
          <div class="message-footer">
            <div class="message-meta"><span data-elapsed-since="${startedAt}">已耗时 ${formatElapsedMs(Date.now() - startedAt)}</span></div>
            <div class="message-tools">${renderCopyButton(message)}</div>
          </div>
        </div>
      </article>
    `;
  }
  const images = message.images || [];
  const imageGrid = images.length ? `<div class="image-grid message-body-block">${images.map((image, index) => renderImageCard(image, index, message)).join("")}</div>` : "";
  const rawOutput = !images.length && message.rawOutput
    ? renderRawOutputBlock(message.rawOutput, { open: true, summaryText: "原始输出（点按收起）" })
    : "";
  const meta = renderResponseMeta(message);
  return `
    <article class="message assistant" data-message-id="${message.id}">
      <div class="avatar">AI</div>
      <div class="message-content">
        ${message.content ? `<div class="message-main-text message-body-block">${escapeHtml(message.content)}</div>` : ""}
        ${imageGrid}
        ${rawOutput}
        <div class="message-footer">
          ${meta}
          <div class="message-tools">${renderCopyButton(message)}</div>
        </div>
      </div>
    </article>
  `;
}

function renderResponseMeta(message) {
  const meta = message.responseMeta || {};
  const usage = meta.usage;
  const usageText = usage ? ` · tokens: ${usage.total_tokens ?? "?"}` : "";
  const requestId = meta.requestId ? ` · request_id: ${escapeHtml(meta.requestId)}` : "";
  const elapsedText = meta.elapsedMs ? ` · 耗时 ${formatElapsedMs(meta.elapsedMs)}` : "";
  return `<div class="message-meta">${formatDateTime(message.createdAt)}${elapsedText}${usageText}${requestId}</div>`;
}

function renderErrorMessage(message) {
  const meta = renderResponseMeta(message);
  return `
    <article class="message error" data-message-id="${message.id}">
      <div class="avatar">!</div>
      <div class="message-content">
        <div class="message-main-text">${escapeHtml(message.content || "请求失败")}</div>
        ${renderRawOutputBlock(message.rawOutput, { summaryText: "原始输出（点按展开）" })}
        <div class="message-footer">
          ${meta}
          <div class="message-tools">${renderCopyButton(message)}</div>
        </div>
      </div>
    </article>
  `;
}

function updateSendState() {
  const result = validateParams(currentParams, { prompt: els.promptInput.value, checkKey: false, checkFiles: true });
  const hasApiKey = Boolean(getApiKey());
  const pending = conversationHasPending(getCurrentConversation());
  const missingPromptOnly = result.errors.length === 1 && result.errors[0].includes("请输入 prompt");
  const displayErrors = missingPromptOnly && !els.promptInput.value.trim() ? [] : result.errors;
  showValidation({ errors: displayErrors, warnings: result.warnings });
  els.sendBtn.disabled = pending || result.errors.length > 0 || !hasApiKey;
  updateApiStatus();
}

function openSettingsDialog() {
  els.baseUrlInput.value = settings.baseUrl || "";
  els.apiKeyInput.value = getApiKey();
  els.saveKeyToggle.checked = Boolean(settings.saveApiKey);
  els.settingsDialog.showModal();
}

function startNewConversation() {
  currentConversationId = null;
  els.promptInput.value = "";
  sourceItems = [];
  maskItem = null;
  renderAttachmentStrip();
  autoResizePrompt();
  setCurrentConversation(null);
  closeSidebar();
}

function createApiError(message, rawOutput = "", extra = {}) {
  const error = new Error(message);
  error.rawOutput = safePrettyJsonText(rawOutput);
  Object.assign(error, extra);
  return error;
}

async function buildResponseError(response, requestId) {
  let rawText = "";
  try {
    rawText = await response.text();
  } catch {
    rawText = "";
  }
  const prettyRaw = safePrettyJsonText(rawText);
  let detail = "";
  try {
    const parsed = rawText ? JSON.parse(rawText) : null;
    detail = parsed?.error?.message || parsed?.message || "";
  } catch {
    detail = rawText.trim();
  }
  const message = `${response.status} ${response.statusText}${requestId ? ` · ${requestId}` : ""}${detail ? ` · ${detail}` : ""}`;
  return createApiError(message, prettyRaw || rawText, { requestId, status: response.status });
}

async function readErrorResponse(response, requestId) {
  return buildResponseError(response, requestId);
}

function parseImageResponse(json, requestParams, requestId = "", rawOutput = "") {
  const format = json.output_format || requestParams.output_format || "png";
  const mime = mimeFromOutputFormat(format);
  const images = Array.isArray(json.data) ? json.data.flatMap((item, index) => {
    if (item.b64_json) {
      return [{
        src: `data:${mime};base64,${item.b64_json}`,
        mime,
        extension: format === "jpeg" ? "jpg" : format,
        label: `结果 ${index + 1}`,
        revisedPrompt: item.revised_prompt || "",
        size: json.size || requestParams.size || "",
      }];
    }
    if (item.url) {
      return [{
        src: item.url,
        mime: "",
        extension: "",
        label: `结果 ${index + 1}`,
        revisedPrompt: item.revised_prompt || "",
        size: json.size || requestParams.size || "",
      }];
    }
    return [];
  }) : [];
  return {
    images,
    rawOutput: safePrettyJsonText(rawOutput || json),
    meta: {
      requestId,
      created: json.created || null,
      background: json.background || requestParams.background,
      output_format: format,
      quality: json.quality || requestParams.quality,
      size: json.size || requestParams.size,
      usage: json.usage || null,
    },
  };
}

async function callImageApi(endpoint, requestParams) {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/images/${endpoint}`;
  const headers = { Authorization: `Bearer ${getApiKey()}` };
  const fetchOptions = { method: "POST", headers };

  if (endpoint === "generations") {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(requestParams);
  } else {
    fetchOptions.body = buildEditFormData(requestParams);
  }

  let response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (error) {
    throw createApiError(`网络请求失败：${error.message || error}`, error?.stack || "");
  }
  const requestId = response.headers.get("x-request-id") || response.headers.get("request-id") || "";
  if (!response.ok) {
    throw await buildResponseError(response, requestId);
  }

  if (requestParams.stream) {
    const streamed = await readStreamingImages(response, requestParams);
    streamed.meta.requestId = requestId;
    return streamed;
  }

  const rawText = await response.text();
  let json;
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    throw createApiError(`接口返回的不是有效 JSON：${error.message || error}`, rawText, { requestId, status: response.status });
  }
  return parseImageResponse(json, requestParams, requestId, rawText);
}

async function handleSend() {
  syncParamsFromControls();
  const activeConversation = getCurrentConversation();
  if (activeConversation && conversationHasPending(activeConversation)) {
    toast("当前对话仍在生成中。如需并发，请新建一个对话再发送。", "info");
    updateSendState();
    return;
  }
  const prompt = els.promptInput.value.trim();
  const validation = validateParams(currentParams, { prompt, checkKey: true, checkFiles: true });
  if (validation.errors.length) {
    showValidation(validation);
    toast("请先修正参数错误。", "error");
    return;
  }
  if (!getApiKey()) {
    toast("请先在设置中填写 API Key。", "error");
    openSettingsDialog();
    return;
  }

  const conversation = ensureConversation(prompt);
  if (!conversation.messages.length) conversation.title = firstLineTitle(prompt);

  const endpoint = currentParams.endpoint;
  const requestParams = buildRequestParams(prompt);
  const startedAt = Date.now();
  const userMessage = {
    id: uid("msg"),
    role: "user",
    content: prompt,
    createdAt: nowIso(),
    request: { endpoint, params: requestParams },
    attachments: [
      ...sourceItems.map((item) => serializeAttachment(item, "source")),
      ...(maskItem ? [serializeAttachment(maskItem, "mask")] : []),
    ],
  };
  const assistantMessage = {
    id: uid("msg"),
    role: "assistant",
    status: "loading",
    createdAt: nowIso(),
    startedAt,
  };
  conversation.messages.push(userMessage, assistantMessage);
  await saveConversation(conversation);
  setCurrentConversation(conversation.id);
  els.promptInput.value = "";
  autoResizePrompt();
  updateSendState();
  updateLiveElapsedLabels();

  try {
    const result = await callImageApi(endpoint, requestParams);
    const elapsedMs = Date.now() - startedAt;
    const finalMessage = {
      id: assistantMessage.id,
      role: "assistant",
      content: result.images.length ? "" : "接口返回成功，但没有检测到图片数据。下面附上原始输出，便于排查。",
      images: result.images,
      rawOutput: result.images.length ? "" : result.rawOutput,
      responseMeta: { ...(result.meta || {}), elapsedMs },
      createdAt: nowIso(),
    };
    replaceMessage(conversation, assistantMessage.id, finalMessage);
    await saveConversation(conversation);
    if (currentConversationId === conversation.id) renderMessages();
    toast(result.images.length ? `图片已生成并保存到本地历史（耗时 ${formatElapsedMs(elapsedMs)}）。` : `接口成功返回，但未检测到图片数据（耗时 ${formatElapsedMs(elapsedMs)}）。`, result.images.length ? "success" : "info");
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const errorMessage = {
      id: assistantMessage.id,
      role: "error",
      content: `请求失败：${error.message || error}`,
      rawOutput: error.rawOutput || error.stack || "",
      responseMeta: { requestId: error.requestId || "", elapsedMs },
      createdAt: nowIso(),
    };
    replaceMessage(conversation, assistantMessage.id, errorMessage);
    await saveConversation(conversation);
    if (currentConversationId === conversation.id) renderMessages();
    toast(`${error.message || "请求失败"}（耗时 ${formatElapsedMs(elapsedMs)}）`, "error", 5200);
  } finally {
    updateSendState();
  }
}

function sanitizeFilename(name) {
  return String(name || "preset")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "preset";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function buildPresetExportObject(preset) {
  return {
    schema: PRESET_EXPORT_SCHEMA,
    version: 1,
    exportedAt: nowIso(),
    preset,
  };
}

async function exportPreset(preset) {
  if (!preset) return;
  const json = JSON.stringify(buildPresetExportObject(preset), null, 2);
  downloadBlob(new Blob([json], { type: "application/json" }), `${sanitizeFilename(preset.name)}.json`);
  toast(`已导出预设：${preset.name}`, "success");
}


async function exportAllPresets() {
  if (!presets.length) {
    toast("当前没有可导出的预设。", "info");
    return;
  }
  const exportedAt = nowIso();
  const files = [
    {
      name: "manifest.json",
      content: JSON.stringify({
        schema: PRESET_BUNDLE_SCHEMA,
        version: 1,
        exportedAt,
        count: presets.length,
      }, null, 2),
    },
    {
      name: "all-presets.json",
      content: JSON.stringify({
        schema: PRESET_BUNDLE_SCHEMA,
        version: 1,
        exportedAt,
        presets,
      }, null, 2),
    },
    ...presets.map((preset, index) => ({
      name: `presets/${String(index + 1).padStart(2, "0")}-${sanitizeFilename(preset.name)}.json`,
      content: JSON.stringify(buildPresetExportObject(preset), null, 2),
    })),
  ];
  const blob = createZipBlob(files);
  downloadBlob(blob, `gpt-image2-presets-${exportedAt.slice(0, 10)}.zip`);
  toast(`已导出全部预设（${presets.length} 个）。`, "success");
}

function normalizeImportedPresetRecord(record, usedIds = new Set()) {
  const base = record?.schema === PRESET_EXPORT_SCHEMA ? record.preset : record;
  if (!base || typeof base !== "object") return null;
  if (!base.name || !base.params) return null;
  let id = String(base.id || uid("preset"));
  while (usedIds.has(id) || presets.some((item) => item.id === id)) {
    id = uid("preset");
  }
  usedIds.add(id);
  const now = nowIso();
  return {
    id,
    name: String(base.name).trim() || "未命名预设",
    description: String(base.description || ""),
    promptTemplate: String(base.promptTemplate || ""),
    params: normalizeParamsForPreset(base.params || {}),
    createdAt: base.createdAt || now,
    updatedAt: now,
  };
}

function extractPresetCandidates(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (parsed.schema === PRESET_EXPORT_SCHEMA && parsed.preset) return [parsed.preset];
  if (parsed.schema === PRESET_BUNDLE_SCHEMA && Array.isArray(parsed.presets)) return parsed.presets;
  if (Array.isArray(parsed.presets)) return parsed.presets;
  if (parsed.name && parsed.params) return [parsed];
  return [];
}

function parsePresetJsonText(text) {
  const parsed = JSON.parse(text);
  const candidates = extractPresetCandidates(parsed);
  const usedIds = new Set();
  return candidates.map((item) => normalizeImportedPresetRecord(item, usedIds)).filter(Boolean);
}


async function readPresetFiles(files) {
  const collected = [];
  for (const file of files) {
    const lower = String(file.name || "").toLowerCase();
    if (lower.endsWith(".zip")) {
      let entries = [];
      try {
        entries = await readStoredZipJsonEntries(await file.arrayBuffer());
      } catch (error) {
        throw new Error(`读取 ZIP 失败：${error.message || error}`);
      }
      for (const entry of entries) {
        try {
          collected.push(...parsePresetJsonText(entry.text));
        } catch {
          // ignore invalid json inside zip
        }
      }
      continue;
    }
    if (lower.endsWith(".json")) {
      const text = await file.text();
      collected.push(...parsePresetJsonText(text));
    }
  }
  const final = [];
  const seenIds = new Set();
  const seenSignatures = new Set();
  for (const preset of collected) {
    if (!preset) continue;
    const signature = JSON.stringify({
      name: preset.name,
      description: preset.description || "",
      promptTemplate: preset.promptTemplate || "",
      params: preset.params || {},
    });
    if (seenSignatures.has(signature)) continue;
    if (seenIds.has(preset.id)) continue;
    seenIds.add(preset.id);
    seenSignatures.add(signature);
    final.push(preset);
  }
  return final;
}

async function importPresetsFromFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let imported;
  try {
    imported = await readPresetFiles(files);
  } catch (error) {
    toast(`导入失败：${error.message || error}`, "error", 5000);
    return;
  }
  if (!imported.length) {
    toast("没有检测到可导入的预设。", "error");
    return;
  }
  if (imported.length > 1) {
    const ok = confirm(`检测到 ${imported.length} 个可识别预设，是否一键全部导入？`);
    if (!ok) return;
  }
  for (const preset of imported) {
    await idbPut("presets", preset);
    const index = presets.findIndex((item) => item.id === preset.id);
    if (index >= 0) presets[index] = preset;
    else presets.push(preset);
  }
  renderSidebar();
  toast(`已导入 ${imported.length} 个预设。`, "success");
}

function bindEvents() {
  els.newChatBtn.addEventListener("click", startNewConversation);
  els.sidebarToggle.addEventListener("click", toggleSidebar);
  els.sidebarBackdrop?.addEventListener("click", closeSidebar);
  if (overlaySidebarQuery.addEventListener) {
    overlaySidebarQuery.addEventListener("change", syncSidebarMode);
  } else {
    overlaySidebarQuery.addListener(syncSidebarMode);
  }
  els.settingsBtn.addEventListener("click", openSettingsDialog);
  els.topSettingsBtn.addEventListener("click", openSettingsDialog);
  els.deleteAllChatsBtn.addEventListener("click", deleteAllConversations);
  els.addPresetBtn.addEventListener("click", () => openPresetDialog());
  els.saveCurrentPresetBtn.addEventListener("click", () => openPresetDialog(null, true));
  els.deleteAllLocalDataBtn?.addEventListener("click", clearAllSavedData);
  els.exportAllPresetsBtn?.addEventListener("click", exportAllPresets);
  els.importPresetsBtn?.addEventListener("click", () => els.presetImportInput?.click());
  els.presetImportInput?.addEventListener("change", async () => {
    await importPresetsFromFiles(els.presetImportInput.files);
    els.presetImportInput.value = "";
  });

  els.promptInput.addEventListener("input", () => {
    autoResizePrompt();
    updateSendState();
  });
  els.promptInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleSend();
    }
  });

  els.uploadImagesBtn.addEventListener("click", () => els.sourceImagesInput.click());
  els.uploadMaskBtn.addEventListener("click", () => els.maskInput.click());
  els.sourceImagesInput.addEventListener("change", async () => {
    await handleSourceImages(els.sourceImagesInput.files);
    els.sourceImagesInput.value = "";
  });
  els.maskInput.addEventListener("change", async () => {
    await handleMask(els.maskInput.files?.[0]);
    els.maskInput.value = "";
  });

  els.attachmentStrip.addEventListener("click", (event) => {
    const target = event.target.closest("[data-remove-kind]");
    if (!target) return;
    const kind = target.dataset.removeKind;
    const id = target.dataset.id;
    if (kind === "mask") maskItem = null;
    else sourceItems = sourceItems.filter((item) => item.id !== id);
    renderAttachmentStrip();
    updateSendState();
  });

  els.messageList.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-copy-message-id]");
    if (!target) return;
    const conversation = getCurrentConversation();
    const message = conversation?.messages?.find((item) => item.id === target.dataset.copyMessageId);
    await copyTextToClipboard(getMessageCopyText(message));
  });

  els.sendBtn.addEventListener("click", handleSend);

  [
    els.endpointSelect,
    els.modelInput,
    els.qualitySelect,
    els.outputFormatSelect,
    els.compressionInput,
    els.backgroundSelect,
    els.countInput,
    els.moderationSelect,
    els.streamToggle,
    els.partialImagesInput,
    els.userInput,
    els.customWidthInput,
    els.customHeightInput,
  ].forEach((node) => {
    node.addEventListener("input", () => {
      els.compressionLabel.textContent = `${els.compressionInput.value}%`;
      syncParamsFromControls();
    });
    node.addEventListener("change", () => {
      els.compressionLabel.textContent = `${els.compressionInput.value}%`;
      syncParamsFromControls();
    });
  });

  els.ratioSelect.addEventListener("change", () => applySizeSelectionFromBuilder({ notifyCapped: true }));
  els.scaleSelect.addEventListener("change", () => applySizeSelectionFromBuilder({ notifyCapped: true }));

  els.conversationList.addEventListener("click", (event) => {
    const deleteTarget = event.target.closest("[data-delete-chat]");
    if (deleteTarget) {
      event.stopPropagation();
      deleteConversation(deleteTarget.dataset.deleteChat);
      return;
    }
    const item = event.target.closest("[data-chat-id]");
    if (item) {
      setCurrentConversation(item.dataset.chatId);
      closeSidebar();
    }
  });

  els.presetList.addEventListener("click", (event) => {
    const deleteTarget = event.target.closest("[data-delete-preset]");
    if (deleteTarget) {
      event.stopPropagation();
      deletePreset(deleteTarget.dataset.deletePreset);
      return;
    }
    const exportTarget = event.target.closest("[data-export-preset]");
    if (exportTarget) {
      event.stopPropagation();
      const preset = presets.find((item) => item.id === exportTarget.dataset.exportPreset);
      exportPreset(preset);
      return;
    }
    const editTarget = event.target.closest("[data-edit-preset]");
    if (editTarget) {
      event.stopPropagation();
      const preset = presets.find((item) => item.id === editTarget.dataset.editPreset);
      openPresetDialog(preset);
      return;
    }
    const item = event.target.closest("[data-preset-id]");
    if (item) {
      const preset = presets.find((entry) => entry.id === item.dataset.presetId);
      applyPreset(preset);
    }
  });

  els.settingsForm.addEventListener("submit", (event) => {
    if (event.submitter?.id === "saveSettingsBtn") {
      event.preventDefault();
      saveSettingsFromDialog();
    }
  });
  els.testConfigBtn.addEventListener("click", testSettingsFormat);

  $$('[data-dialog-close]').forEach((button) => {
    button.addEventListener("click", () => closeDialogById(button.dataset.dialogClose));
  });

  els.presetForm.addEventListener("submit", (event) => {
    if (event.submitter?.id === "savePresetBtn") {
      event.preventDefault();
      savePresetFromDialog();
    }
  });
  [
    els.presetNameInput,
    els.presetEndpointSelect,
    els.presetModelInput,
    els.presetSizeInput,
    els.presetCountInput,
    els.presetQualitySelect,
    els.presetFormatSelect,
    els.presetCompressionInput,
    els.presetBackgroundSelect,
    els.presetModerationSelect,
    els.presetPartialInput,
    els.presetStreamToggle,
    els.presetUserInput,
  ].forEach((node) => node.addEventListener("input", () => showPresetValidation(validatePresetForm(readPresetForm()))));

  $$(".suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      els.promptInput.value = button.dataset.prompt || "";
      autoResizePrompt();
      updateSendState();
      els.promptInput.focus();
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
  });
}


function formatElapsedMs(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

function updateLiveElapsedLabels() {
  document.querySelectorAll('[data-elapsed-since]').forEach((node) => {
    const startedAt = Number(node.getAttribute('data-elapsed-since')) || 0;
    if (!startedAt) return;
    node.textContent = `已耗时 ${formatElapsedMs(Date.now() - startedAt)}`;
  });
}

setInterval(updateLiveElapsedLabels, 1000);

init().catch((error) => {
  console.error(error);
  toast(`初始化失败：${error.message || error}`, "error", 8000);
});
