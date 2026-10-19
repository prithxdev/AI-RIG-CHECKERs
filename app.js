/* =====================================================================
   app.js — Rig Check Client Logic & Telemetry Engine
   ===================================================================== */

const DEEP_SCAN_URL = "http://127.0.0.1:8765/scan";
const BACKEND_CHAT_URL = "/api/chat";
const BACKEND_STATUS_URL = "/api/status";

// State
let latestSpecs = {
  cores: null,
  cpuModel: null,
  ramGb: null,
  ramExact: false,
  ramDetails: null,
  gpuName: null,
  vramGb: null,
  isUnified: false,
  storage: null,
  platform: null,
  source: "none" // "none" | "quick" | "deep"
};

let modelsData = null;
let activeCategory = "all";
let currentTryTag = null;
let currentTryModelName = null;
let serverInfo = { online: false, mode: "unknown" };

// DOM Elements
const btnQuickScan = document.getElementById("btnQuickScan");
const btnRefreshScan = document.getElementById("btnRefreshScan");
const btnDeepScan = document.getElementById("btnDeepScan");
const btnCopyCmd = document.getElementById("btnCopyCmd");
const btnCopyResponse = document.getElementById("btnCopyResponse");
const tryModal = document.getElementById("tryModal");
const tryModalClose = document.getElementById("tryModalClose");
const modalOverlay = document.getElementById("modalOverlay");
const tryRun = document.getElementById("tryRun");
const tryPrompt = document.getElementById("tryPrompt");
const charCount = document.getElementById("charCount");
const categoryFilters = document.getElementById("categoryFilters");

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  initEventListeners();
  loadModelsData();
  checkServerStatus();
  checkDeepScanStatus(false);
});

function initEventListeners() {
  btnQuickScan?.addEventListener("click", () => triggerQuickScan(true));
  btnRefreshScan?.addEventListener("click", () => triggerQuickScan(true));
  btnDeepScan?.addEventListener("click", runDeepScan);
  btnCopyCmd?.addEventListener("click", copyDeepScanCommand);
  btnCopyResponse?.addEventListener("click", copyModalResponse);

  tryModalClose?.addEventListener("click", closeTryModal);
  modalOverlay?.addEventListener("click", closeTryModal);
  tryRun?.addEventListener("click", sendTryPrompt);

  tryPrompt?.addEventListener("input", (e) => {
    const len = e.target.value.length;
    if (charCount) charCount.textContent = `${len} / 2000`;
  });

  tryPrompt?.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      sendTryPrompt();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && tryModal && !tryModal.hidden) {
      closeTryModal();
    }
  });

  // Prompt Preset Chips
  document.querySelectorAll(".prompt-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const promptText = chip.dataset.prompt;
      if (tryPrompt && promptText) {
        tryPrompt.value = promptText;
        if (charCount) charCount.textContent = `${promptText.length} / 2000`;
        tryPrompt.focus();
      }
    });
  });

  // Category Filtering
  categoryFilters?.addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip) return;
    document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    activeCategory = chip.dataset.category || "all";
    renderRecommendations();
  });
}

/* -------------------------------------------------- Server & Models Loading */
async function loadModelsData() {
  try {
    const res = await fetch("models.json");
    if (!res.ok) throw new Error("Could not load models.json");
    modelsData = await res.json();
    if (latestSpecs.source !== "none") {
      renderRecommendations();
    }
  } catch (err) {
    console.error("Failed to load models data:", err);
  }
}

async function checkServerStatus() {
  const statusContainer = document.getElementById("topbarStatus");
  const statusText = document.getElementById("serverStatusText");
  try {
    const res = await fetch(BACKEND_STATUS_URL);
    if (res.ok) {
      const data = await res.json();
      serverInfo = { online: true, ...data };
      if (statusContainer && statusText) {
        const modeLabel = data.mode === "cloud" ? "Cloud API" : (data.mode === "local" ? "Local Ollama" : "Ready (Demo)");
        statusContainer.innerHTML = `
          <span class="status-indicator status-indicator--online"></span>
          <span>Server: Port ${data.port} (${modeLabel})</span>
        `;
      }
    }
  } catch (e) {
    if (statusContainer) {
      statusContainer.innerHTML = `
        <span class="status-indicator status-indicator--offline"></span>
        <span>Static Mode</span>
      `;
    }
  }
}

async function checkDeepScanStatus(notify = false) {
  const dot = document.getElementById("deepScanDot");
  const label = document.getElementById("deepScanStatusLabel");
  try {
    const res = await fetch("http://127.0.0.1:8765/health", { signal: AbortSignal.timeout(1200) });
    if (res.ok) {
      if (dot) {
        dot.className = "indicator-dot indicator-dot--connected";
      }
      if (label) {
        label.textContent = "Helper Active on Port 8765";
      }
      if (notify) showToast("Deep Scan helper detected locally!");
      return true;
    }
  } catch (e) {
    if (dot) dot.className = "indicator-dot indicator-dot--offline";
    if (label) label.textContent = "Helper Disconnected";
    return false;
  }
}

/* -------------------------------------------------------------- Quick Scan */
function triggerQuickScan(animated = true) {
  setReadoutStatus("Scanning browser environment…");
  const badge = document.getElementById("scanSourceBadge");

  if (animated) {
    // Quick micro-animation to indicate hardware probe
    const rows = document.querySelectorAll(".readout__value");
    rows.forEach(r => r.textContent = "Probing…");
  }

  setTimeout(() => {
    runQuickScan();
    if (badge) {
      badge.textContent = "Quick Scan (Browser)";
      badge.className = "readout-badge readout-badge--quick";
    }
    showToast("Quick diagnosis completed.");
  }, animated ? 300 : 0);
}

function runQuickScan() {
  const cores = navigator.hardwareConcurrency || null;
  const ramGb = "deviceMemory" in navigator ? navigator.deviceMemory : null;
  const gpuName = getWebglRenderer();
  const platform = describePlatform();

  latestSpecs = {
    cores,
    cpuModel: null,
    ramGb,
    ramExact: false,
    ramDetails: null,
    gpuName,
    vramGb: null,
    isUnified: false,
    storage: null,
    platform,
    source: "quick"
  };

  renderReadout();
  renderRecommendations();

  let note = "Approximate scan complete.";
  if (ramGb && ramGb >= 8) {
    note = "Approximate scan complete. RAM may be higher (browsers cap at 8GB). Run Deep Scan for exact specs.";
  } else if (!ramGb) {
    note = "Scan complete. Browser privacy sandbox restricts RAM detection. Use Deep Scan below for exact numbers.";
  }
  setReadoutStatus(note);
}

function getWebglRenderer() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return gl.getParameter(gl.RENDERER) || null;
    return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || null;
  } catch (e) {
    return null;
  }
}

function describePlatform() {
  if (navigator.userAgentData?.platform) {
    return navigator.userAgentData.platform;
  }
  const ua = navigator.userAgent;
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return navigator.platform || "Unknown OS";
}

/* --------------------------------------------------------------- Deep Scan */
async function runDeepScan() {
  setReadoutStatus("Connecting to local Deep Scan helper (127.0.0.1:8765/scan)…");
  const dot = document.getElementById("deepScanDot");
  const label = document.getElementById("deepScanStatusLabel");
  const badge = document.getElementById("scanSourceBadge");

  try {
    const res = await fetch(DEEP_SCAN_URL, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error("Helper HTTP " + res.status);
    const data = await res.json();

    const ramModules = data.ram?.modules || [];
    const ramDetailStr = ramModules.length > 0 && ramModules[0].type
      ? `(${ramModules[0].type}${ramModules[0].speed ? " • " + ramModules[0].speed : ""})`
      : "";

    latestSpecs = {
      cores: data.cpu?.logicalCores ?? latestSpecs.cores,
      cpuModel: data.cpu?.model || null,
      ramGb: data.ram?.totalGb ?? latestSpecs.ramGb,
      ramExact: true,
      ramDetails: ramDetailStr,
      gpuName: data.gpu?.name ?? latestSpecs.gpuName,
      vramGb: data.gpu?.vramGb ?? null,
      isUnified: !!data.gpu?.isUnifiedMemory,
      storage: data.storage ? `${data.storage.freeGb} GB free / ${data.storage.totalGb} GB total` : null,
      platform: data.platform ?? latestSpecs.platform,
      source: "deep",
      raw: data
    };

    if (dot) dot.className = "indicator-dot indicator-dot--connected";
    if (label) label.textContent = "Connected & Active";
    if (badge) {
      badge.textContent = "Deep Scan (Verified Hardware)";
      badge.className = "readout-badge readout-badge--deep";
    }

    renderReadout();
    renderRecommendations();
    setReadoutStatus("✓ Deep Scan connected — exact hardware specs loaded directly from host.");
    showToast("✓ Exact hardware specs verified via Deep Scan!");
  } catch (err) {
    if (dot) dot.className = "indicator-dot indicator-dot--offline";
    if (label) label.textContent = "Connection Failed";

    setReadoutStatus(
      "Could not reach Deep Scan helper on port 8765. Run `python3 deep_scan.py` in your terminal and leave it open, then click Connect again."
    );
    showToast("Could not connect to helper on port 8765", "error");
  }
}

/* ------------------------------------------------------------- Rendering */
function renderReadout() {
  const rCores = document.getElementById("rCores");
  const rRam = document.getElementById("rRam");
  const rGpu = document.getElementById("rGpu");
  const rStorage = document.getElementById("rStorage");
  const rPlatform = document.getElementById("rPlatform");

  // CPU
  if (rCores) {
    if (latestSpecs.cpuModel) {
      rCores.textContent = `${latestSpecs.cpuModel} (${latestSpecs.cores || "?"} cores)`;
    } else if (latestSpecs.cores) {
      rCores.textContent = `${latestSpecs.cores} Logical Cores`;
    } else {
      rCores.textContent = "Unavailable";
    }
  }

  // RAM
  if (rRam) {
    if (latestSpecs.ramGb) {
      const exactTag = latestSpecs.ramExact ? " (Exact)" : " (Approx. capped)";
      const detail = latestSpecs.ramDetails ? ` ${latestSpecs.ramDetails}` : "";
      rRam.textContent = `${latestSpecs.ramGb} GB${exactTag}${detail}`;
    } else {
      rRam.textContent = "Protected by browser sandbox";
    }
  }

  // GPU
  if (rGpu) {
    if (latestSpecs.gpuName) {
      let vramStr = "";
      if (latestSpecs.vramGb) {
        vramStr = latestSpecs.isUnified
          ? ` • ${latestSpecs.vramGb} GB Unified Memory`
          : ` • ${latestSpecs.vramGb} GB VRAM`;
      }
      rGpu.textContent = `${latestSpecs.gpuName}${vramStr}`;
    } else {
      rGpu.textContent = "Standard Display Renderer";
    }
  }

  // Storage
  if (rStorage) {
    rStorage.textContent = latestSpecs.storage || "Run Deep Scan to inspect";
  }

  // Platform
  if (rPlatform) {
    rPlatform.textContent = latestSpecs.platform || "Web Client";
  }
}

function computeTier() {
  // Use VRAM or RAM capacity to determine tier
  const capacityGb = latestSpecs.vramGb || latestSpecs.ramGb || 0;
  if (!modelsData || !modelsData.tiers) return null;
  return modelsData.tiers.find(t => capacityGb <= t.maxCapacityGb) || modelsData.tiers[modelsData.tiers.length - 1];
}

function renderRecommendations() {
  if (!modelsData) return;
  const tier = computeTier();
  const summary = document.getElementById("tierSummary");
  const tierBanner = document.getElementById("tierBanner");
  const tierBadge = document.getElementById("tierBadge");
  const tierLabel = document.getElementById("tierLabel");
  const tierDetail = document.getElementById("tierDetail");
  const container = document.getElementById("modelCards");

  if (!container) return;
  container.innerHTML = "";

  if (!tier) {
    if (summary) summary.textContent = "Run a diagnosis above to inspect your hardware and reveal recommendations.";
    if (tierBanner) tierBanner.hidden = true;
    return;
  }

  if (summary) {
    summary.textContent = `Displaying models tuned for ${tier.label} Tier (${tier.description})`;
  }

  if (tierBanner) {
    tierBanner.hidden = false;
    if (tierBadge) tierBadge.textContent = `${tier.label} Tier`;
    if (tierLabel) {
      tierLabel.textContent = latestSpecs.source === "deep" ? "Exact Hardware Verified" : "Approximate Profile";
    }
    if (tierDetail) {
      const cap = latestSpecs.vramGb || latestSpecs.ramGb;
      tierDetail.textContent = `Allocatable capacity: ${cap ? cap + " GB" : "Standard"} — ${tier.description}`;
    }
  }

  // Filter categories
  const categoriesToRender = activeCategory === "all"
    ? modelsData.categories
    : modelsData.categories.filter(c => c.id === activeCategory);

  categoriesToRender.forEach(cat => {
    const model = cat.models[tier.id];
    if (!model) return;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card__top">
        <span class="card__label">${escapeHtml(cat.label)}</span>
        <span class="card__fit fit--good">~${model.approxSizeGb} GB</span>
      </div>
      <h3 class="card__model">${escapeHtml(model.name)}</h3>
      <p class="card__desc">${escapeHtml(cat.blurb || "")}</p>
      <div class="card__cmd-box">
        <code class="card__tag">ollama run ${escapeHtml(model.ollamaTag)}</code>
        <button class="btn-copy-tag" title="Copy command" data-cmd="ollama run ${escapeHtml(model.ollamaTag)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
      </div>
      <button class="card__try" data-tag="${escapeHtml(model.ollamaTag)}" data-name="${escapeHtml(model.name)}">
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <span>Try it Live</span>
      </button>
    `;
    container.appendChild(card);
  });

  // Attach event handlers to dynamic cards
  container.querySelectorAll(".btn-copy-tag").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const cmd = btn.dataset.cmd;
      if (cmd) {
        navigator.clipboard.writeText(cmd);
        showToast("Copied command to clipboard!");
      }
    });
  });

  container.querySelectorAll(".card__try").forEach(btn => {
    btn.addEventListener("click", () => {
      openTryModal(btn.dataset.tag, btn.dataset.name);
    });
  });
}

function setReadoutStatus(text) {
  const el = document.getElementById("readoutStatus");
  if (el) el.textContent = text;
}

/* ------------------------------------------------------------- Try-it Modal */
function openTryModal(tag, name) {
  currentTryTag = tag;
  currentTryModelName = name;

  const titleEl = document.getElementById("tryModalTitle");
  const tagEl = document.getElementById("tryModelTag");
  const promptEl = document.getElementById("tryPrompt");
  const outputEl = document.getElementById("tryOutput");
  const modeTextEl = document.getElementById("tryModeText");

  if (titleEl) titleEl.textContent = `Test ${name}`;
  if (tagEl) tagEl.textContent = `ollamaTag: ${tag}`;
  if (promptEl) {
    promptEl.value = "";
    promptEl.focus();
  }
  if (charCount) charCount.textContent = "0 / 2000";
  if (outputEl) outputEl.textContent = "Ready. Enter a prompt above and click Send.";

  if (modeTextEl) {
    if (serverInfo.hasApiKey) {
      modeTextEl.textContent = "Live Ollama Cloud API Mode (Direct Stream)";
    } else if (serverInfo.localOllama) {
      modeTextEl.textContent = "Local Ollama Instance Detected (Offline Inference)";
    } else {
      modeTextEl.textContent = "Interactive Demo Mode (Full Frontend-Backend Bridge)";
    }
  }

  if (tryModal) tryModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeTryModal() {
  if (tryModal) tryModal.hidden = true;
  document.body.style.overflow = "";
}

async function sendTryPrompt() {
  const prompt = tryPrompt?.value.trim();
  const output = document.getElementById("tryOutput");
  const sendBtn = document.getElementById("tryRun");
  const btnText = document.getElementById("tryBtnText");

  if (!prompt) {
    showToast("Please enter a prompt first.", "error");
    tryPrompt?.focus();
    return;
  }
  if (!currentTryTag) return;

  if (output) output.textContent = `Generating response from ${currentTryModelName || currentTryTag}…`;
  if (sendBtn) sendBtn.disabled = true;
  if (btnText) btnText.textContent = "Processing…";

  const startTime = Date.now();

  try {
    const res = await fetch(BACKEND_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: currentTryTag, prompt })
    });

    const data = await res.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const providerLabel = data.provider ? `[Source: ${data.provider} • ${elapsed}s]\n\n` : "";
    if (output) {
      output.textContent = `${providerLabel}${data.reply ?? "(empty response)"}`;
    }
    showToast("Generation completed!");
  } catch (err) {
    if (output) {
      output.textContent = `Error reaching endpoint: ${err.message}\n\nPlease check server logs or verify your backend is running.`;
    }
    showToast("Request failed: " + err.message, "error");
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    if (btnText) btnText.textContent = "Send Prompt";
  }
}

/* ----------------------------------------------------------------- Helpers */
function copyDeepScanCommand() {
  const cmd = document.getElementById("deepScanCmd")?.textContent || "python3 deep_scan.py";
  navigator.clipboard.writeText(cmd.trim()).then(() => {
    showToast("Copied `python3 deep_scan.py` to clipboard!");
  }).catch(() => {
    showToast("Please copy manually: python3 deep_scan.py");
  });
}

function copyModalResponse() {
  const output = document.getElementById("tryOutput")?.textContent;
  if (!output || output === "Ready. Enter a prompt above and click Send.") {
    showToast("Nothing to copy yet.", "error");
    return;
  }
  navigator.clipboard.writeText(output).then(() => {
    showToast("Response copied to clipboard!");
  });
}

function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span class="toast__icon">${type === "success" ? "✓" : "!"}</span>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
