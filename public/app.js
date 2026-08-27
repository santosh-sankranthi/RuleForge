/**
 * app.js — Client-side workbench controller for DMN Copilot Studio & Test Workbench.
 */

// Application State
const state = {
  activeTab: "tab-copilot",
  activeSubtab: "view-rules",
  presets: [],
  savedModels: [],
  currentModelName: "ride_pricing",
  currentRules: "",
  currentDmn: "",
  currentSpec: "",
  manifest: { inputs: [], decisions: [], typedInputs: [] },
  scenarios: [],
  liveInputState: {},
};

// DOM Element References
const dom = {
  navTabs: document.querySelectorAll(".nav-tab"),
  tabPanels: document.querySelectorAll(".tab-panel"),
  presetSelect: document.getElementById("presetSelect"),
  myModelsSelect: document.getElementById("myModelsSelect"),
  newModelBtn: document.getElementById("newModelBtn"),
  nlSpecInput: document.getElementById("nlSpecInput"),
  modelNameInput: document.getElementById("modelNameInput"),
  compileBtn: document.getElementById("compileBtn"),
  compilationLog: document.getElementById("compilationLog"),
  compilationBadge: document.getElementById("compilationBadge"),
  logContent: document.getElementById("logContent"),
  subtabs: document.querySelectorAll(".subtab"),
  subviewContents: document.querySelectorAll(".subview-content"),
  rulesOutput: document.getElementById("rulesOutput"),
  dmnOutput: document.getElementById("dmnOutput"),
  manifestNodes: document.getElementById("manifestNodes"),
  copyOutputBtn: document.getElementById("copyOutputBtn"),
  downloadDmnBtn: document.getElementById("downloadDmnBtn"),
  quickJumpToTestsBtn: document.getElementById("quickJumpToTestsBtn"),
  templateFormFields: document.getElementById("templateFormFields"),
  runTemplateBtn: document.getElementById("runTemplateBtn"),
  sendToBatchBtn: document.getElementById("sendToBatchBtn"),
  copyTemplateBtn: document.getElementById("copyTemplateBtn"),
  downloadTemplateBtn: document.getElementById("downloadTemplateBtn"),
  templateJsonPreview: document.getElementById("templateJsonPreview"),
  templateRunResults: document.getElementById("templateRunResults"),
  activeModelTag: document.getElementById("activeModelTag"),
  scenarioCountBadge: document.getElementById("scenarioCountBadge"),
  dynamicFormInputs: document.getElementById("dynamicFormInputs"),
  scNameInput: document.getElementById("scNameInput"),
  saveScenarioBtn: document.getElementById("saveScenarioBtn"),
  cancelScenarioBtn: document.getElementById("cancelScenarioBtn"),
  scenarioFormCard: document.getElementById("scenarioFormCard"),
  addScenarioBtn: document.getElementById("addScenarioBtn"),
  loadPresetScenariosBtn: document.getElementById("loadPresetScenariosBtn"),
  importJsonBtn: document.getElementById("importJsonBtn"),
  jsonFileInput: document.getElementById("jsonFileInput"),
  runAllBatchBtn: document.getElementById("runAllBatchBtn"),
  resultsTable: document.getElementById("resultsTable"),
  tableBody: document.getElementById("tableBody"),
  metricPassRate: document.getElementById("metricPassRate"),
  metricLatency: document.getElementById("metricLatency"),
  liveControlsContainer: document.getElementById("liveControlsContainer"),
  liveOutputsCards: document.getElementById("liveOutputsCards"),
  liveLatencyBadge: document.getElementById("liveLatencyBadge"),
  modelIndicator: document.getElementById("modelIndicator"),
};

/* ---------------- Initialization ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  loadCompileConfig();
  await loadPresets();
  await loadSavedModels();
});

/* ---------------- Event Listeners ---------------- */
function setupEventListeners() {
  // Main Tab Navigation
  dom.navTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetTab = tab.dataset.tab;
      switchTab(targetTab);
    });
  });

  // Output Subtabs
  dom.subtabs.forEach(btn => {
    btn.addEventListener("click", () => {
      dom.subtabs.forEach(b => b.classList.remove("active"));
      dom.subviewContents.forEach(v => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.subtab).classList.add("active");
      state.activeSubtab = btn.dataset.subtab;
      if (btn.dataset.subtab === "view-manifest") {
        renderManifestGraph(state.manifest, state.currentRules);
      }
    });
  });

  // Preset Selector
  dom.presetSelect.addEventListener("change", (e) => {
    const selectedId = e.target.value;
    const preset = state.presets.find(p => p.id === selectedId);
    if (preset) {
      dom.nlSpecInput.value = preset.spec;
      dom.modelNameInput.value = preset.id;
      state.currentSpec = preset.spec;
      state.scenarios = JSON.parse(JSON.stringify(preset.scenarios || []));
      updateScenarioCount();
    }
  });

  // My Models Selector — restore a previously compiled model AND its NL spec
  dom.myModelsSelect.addEventListener("change", (e) => {
    const model = state.savedModels.find(m => m.id === e.target.value);
    if (!model) return;
    applyLoadedModel(model, { restoreSpec: true });
  });

  // New Model — blank editor, fresh unique model id
  dom.newModelBtn.addEventListener("click", () => {
    const existing = new Set(state.savedModels.map(m => m.id));
    let n = 1;
    while (existing.has(`my_model_${n}`)) n++;
    dom.nlSpecInput.value = "";
    dom.modelNameInput.value = `my_model_${n}`;
    state.currentSpec = "";
    dom.nlSpecInput.focus();
  });

  // Compile Button
  dom.compileBtn.addEventListener("click", handleCompile);

  // Copy Output
  dom.copyOutputBtn.addEventListener("click", () => {
    const textToCopy = state.activeSubtab === "view-dmn" ? state.currentDmn : state.currentRules;
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    dom.copyOutputBtn.textContent = "✓ Copied!";
    setTimeout(() => { dom.copyOutputBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy`; }, 1500);
  });

  // Download DMN
  dom.downloadDmnBtn.addEventListener("click", () => {
    if (!state.currentDmn) {
      alert("Please compile a model first!");
      return;
    }
    const blob = new Blob([state.currentDmn], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.currentModelName || "model"}.dmn`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Quick Jump to Tests
  dom.quickJumpToTestsBtn.addEventListener("click", () => {
    switchTab("tab-batch");
  });

  // Scenario Manager Form Toggle
  dom.addScenarioBtn.addEventListener("click", () => {
    buildScenarioFormInputs();
    dom.scNameInput.value = `Scenario #${state.scenarios.length + 1}`;
    dom.scenarioFormCard.classList.remove("hidden");
  });

  dom.cancelScenarioBtn.addEventListener("click", () => {
    dom.scenarioFormCard.classList.add("hidden");
  });

  dom.saveScenarioBtn.addEventListener("click", () => {
    const name = dom.scNameInput.value.trim() || `Scenario #${state.scenarios.length + 1}`;
    const inputObj = collectInputFields("sc_input");
    state.scenarios.push({ name, input: inputObj });
    updateScenarioCount();
    dom.scenarioFormCard.classList.add("hidden");
  });

  // Load Preset Scenarios
  dom.loadPresetScenariosBtn.addEventListener("click", () => {
    const preset = state.presets.find(p => p.id === state.currentModelName) || state.presets[0];
    if (preset && preset.scenarios) {
      state.scenarios = JSON.parse(JSON.stringify(preset.scenarios));
      updateScenarioCount();
    }
  });

  // Import JSON Scenarios
  dom.importJsonBtn.addEventListener("click", () => {
    dom.jsonFileInput.click();
  });

  dom.jsonFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (Array.isArray(parsed)) {
          state.scenarios = parsed;
          updateScenarioCount();
          alert(`Successfully loaded ${parsed.length} test scenarios!`);
        } else {
          alert("Invalid JSON: Expected an array of test scenarios.");
        }
      } catch (err) {
        alert("Error parsing JSON file: " + err.message);
      }
    };
    reader.readAsText(file);
  });

  // Run All Batch Tests
  dom.runAllBatchBtn.addEventListener("click", handleRunBatch);

  /* ------- Input Data & Run studio ------- */
  dom.runTemplateBtn.addEventListener("click", handleRunTemplate);
  dom.sendToBatchBtn.addEventListener("click", () => {
    if (!state.currentRules) {
      alert("Please compile or load a model first!");
      return;
    }
    const input = collectTemplateInput();
    state.scenarios.push({
      name: `${state.currentModelName} — Input Data values`,
      input,
    });
    updateScenarioCount();
    switchTab("tab-batch");
  });

  dom.copyTemplateBtn.addEventListener("click", () => {
    const json = dom.templateJsonPreview.textContent;
    if (!json || json === "{ }") return;
    navigator.clipboard.writeText(json);
    dom.copyTemplateBtn.textContent = "✓ Copied!";
    setTimeout(() => { dom.copyTemplateBtn.textContent = "Copy JSON"; }, 1500);
  });

  dom.downloadTemplateBtn.addEventListener("click", () => {
    if (!state.manifest.inputs?.length) {
      alert("Please compile or load a model first!");
      return;
    }
    const suite = buildScenarioTemplate(state.currentModelName, getTypeEntries(), collectTemplateInput());
    const blob = new Blob([JSON.stringify(suite, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.currentModelName || "model"}.scenarios.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

/* ---------------- Navigation ---------------- */
function switchTab(tabId) {
  state.activeTab = tabId;
  dom.navTabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
  dom.tabPanels.forEach(p => p.classList.toggle("active", p.id === tabId));

  if (tabId === "tab-playground") {
    buildLivePlayground();
  } else if (tabId === "tab-batch") {
    buildScenarioFormInputs();
  }
}

/* ---------------- API Requests ---------------- */
async function loadPresets() {
  try {
    const res = await fetch("/api/presets");
    const data = await res.json();
    if (data.ok) {
      state.presets = data.presets;
      if (data.model) dom.modelIndicator.textContent = data.model;

      dom.presetSelect.innerHTML = '<option value="" disabled selected>✨ Load a Template...</option>';
      data.presets.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.title} (${p.category})`;
        dom.presetSelect.appendChild(opt);
      });

      // Default load first preset
      if (data.presets.length > 0) {
        const first = data.presets[0];
        dom.nlSpecInput.value = first.spec;
        dom.modelNameInput.value = first.id;
        state.currentModelName = first.id;
        state.scenarios = JSON.parse(JSON.stringify(first.scenarios || []));
        updateScenarioCount();
      }
    }
  } catch (err) {
    console.error("Error loading presets:", err);
  }
}

async function loadSavedModels() {
  try {
    const res = await fetch("/api/models");
    const data = await res.json();
    if (!data.ok) return;
    state.savedModels = data.models || [];
    refreshSavedModelOptions();

    const active = state.savedModels.find(m => m.id === "ride_pricing") || state.savedModels[0];
    if (active) applyLoadedModel(active, { restoreSpec: false, selectInDropdown: true });
  } catch (err) {
    console.error("Error loading saved models:", err);
  }
}

/** Rebuild the "My Models" dropdown, preserving the current selection when possible. */
function refreshSavedModelOptions() {
  const current = dom.myModelsSelect.value || state.currentModelName;
  dom.myModelsSelect.innerHTML = '<option value="" disabled selected>📂 My Models…</option>';
  state.savedModels.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.id}${m.spec ? "" : " (no spec)"}`;
    dom.myModelsSelect.appendChild(opt);
  });
  if (state.savedModels.some(m => m.id === current)) dom.myModelsSelect.value = current;
}

/** Put a loaded/compiled model into every panel: outputs, DRD, forms, playground. */
function applyLoadedModel(model, { restoreSpec = false, selectInDropdown = false } = {}) {
  state.currentModelName = model.id;
  state.currentRules = model.rules;
  state.currentDmn = model.dmn || "";
  state.manifest = model.manifest || { inputs: [], decisions: [], typedInputs: [] };
  if (restoreSpec && model.spec) {
    dom.nlSpecInput.value = model.spec;
    state.currentSpec = model.spec;
  }
  dom.modelNameInput.value = model.id;
  dom.rulesOutput.textContent = model.rules;
  dom.dmnOutput.textContent = model.dmn || "<!-- No DMN XML generated -->";
  dom.activeModelTag.textContent = `Model: ${model.id}`;
  if (selectInDropdown) dom.myModelsSelect.value = model.id;

  renderManifestGraph(state.manifest, model.rules);
  buildScenarioFormInputs();
  renderTemplateStudio();
  buildLivePlayground();
}

/* ---------------- Compilation & Repair Loop ---------------- */
/* Compile policy advertised by the server (GET /api/config). */
let COMPILE_CFG = { maxTokens: "?", compileMaxRounds: 12, compileBudgetMinutes: 30, chatTimeoutMinutes: 30 };
async function loadCompileConfig() {
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    if (data.ok) COMPILE_CFG = data;
  } catch { /* cosmetic only */ }
}

async function handleCompile() {
  const spec = dom.nlSpecInput.value.trim();
  const modelName = dom.modelNameInput.value.trim() || "model";
  if (!spec) {
    alert("Please provide natural language rules first.");
    return;
  }

  dom.compileBtn.disabled = true;
  dom.compileBtn.innerHTML = `<span class="pulse-dot"></span> Compiling & SMT Proving...`;
  dom.compilationLog.classList.remove("hidden");
  dom.compilationBadge.className = "badge badge-info";
  dom.compilationBadge.textContent = "Drafting with LLM...";
  dom.logContent.innerHTML = `<div>[1] Sending NL spec to LLM (ceiling ${COMPILE_CFG.maxTokens} tokens · up to ${COMPILE_CFG.compileMaxRounds} rounds / ${COMPILE_CFG.compileBudgetMinutes} min)...</div>`;

  // Long compiles are NORMAL now (100-500 rule specs): show live elapsed time.
  const t0 = Date.now();
  const ticker = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    const mm = Math.floor(s / 60), ss = s % 60;
    dom.compileBtn.innerHTML = `<span class="pulse-dot"></span> Compiling… ${mm}m ${ss}s`;
    dom.compilationBadge.textContent = `LLM working… ${mm}m ${ss}s elapsed (budget ${COMPILE_CFG.compileBudgetMinutes} min · ≤${COMPILE_CFG.compileMaxRounds} rounds)`;
  }, 1000);

  try {
    dom.logContent.innerHTML += `<div>[2] Draft → feelc formal SMT verification → repair loop...</div>`;

    const res = await fetch("/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec, name: modelName })
    });

    const data = await res.json();

    if (data.ok) {
      const secs = ((data.elapsedMs || 0) / 1000).toFixed(1);
      dom.compilationBadge.className = "badge badge-success";
      dom.compilationBadge.textContent = "Clean SMT Proof ✓";
      dom.logContent.innerHTML += `<div style="color: var(--accent-success);">[3] ✓ Formally proven total & consistent after ${data.rounds} round(s) in ${secs}s</div>`;
      if (Array.isArray(data.history) && data.history.length > 1) {
        dom.logContent.innerHTML += `<div style="color: var(--text-secondary);">Round trail: ${data.history.map(h => `R${h.round}:${h.outcome}${h.issueCodes?.length ? `(${h.issueCodes.join(",")})` : ""}`).join(" → ")}</div>`;
      }
      dom.logContent.innerHTML += `<div style="color: var(--accent-secondary);">[4] ✓ Exported OMG DMN 1.3 XML (${data.dmn.length} bytes)</div>`;

      state.currentModelName = data.name;
      state.currentRules = data.rules;
      state.currentDmn = data.dmn;
      state.currentSpec = spec;
      state.manifest = data.manifest;

      dom.rulesOutput.textContent = data.rules;
      dom.dmnOutput.textContent = data.dmn;
      dom.activeModelTag.textContent = `Model: ${data.name}`;

      // The freshly compiled model is now saved server-side; make it selectable.
      const existingIdx = state.savedModels.findIndex(m => m.id === data.name);
      const entry = { id: data.name, name: data.name, rules: data.rules, dmn: data.dmn, spec, manifest: data.manifest };
      if (existingIdx >= 0) state.savedModels[existingIdx] = entry;
      else state.savedModels.push(entry);
      refreshSavedModelOptions();
      dom.myModelsSelect.value = data.name;

      renderManifestGraph(data.manifest, data.rules);
      buildScenarioFormInputs();
      renderTemplateStudio();
      buildLivePlayground();

      dom.logContent.innerHTML += `<div style="color: var(--text-secondary);">🧾 Input JSON template generated (${data.manifest.inputs.length} fields) — see the "Input Data & Run" tab.</div>`;
    } else {
      dom.compilationBadge.className = "badge badge-danger";
      dom.compilationBadge.textContent = data.stopReason ? "Time Budget Exhausted" : "SMT Error";
      const secs = ((data.elapsedMs || 0) / 1000).toFixed(1);
      dom.logContent.innerHTML += `<div style="color: var(--accent-danger);">✗ Error after ${data.rounds ?? "?"} round(s) / ${secs}s: ${data.error}</div>`;
      if (Array.isArray(data.history) && data.history.length) {
        dom.logContent.innerHTML += `<div style="color: var(--text-secondary);">Round trail: ${data.history.map(h => `R${h.round}:${h.outcome}${h.issueCodes?.length ? `(${h.issueCodes.join(",")})` : ""}`).join(" → ")}</div>`;
      }
      if (data.issues) {
        data.issues.forEach(i => {
          dom.logContent.innerHTML += `<div style="color: #fca5a5;">  • [Line ${i.line ?? "?"}] ${i.code}: ${i.message}</div>`;
        });
      }
      if (data.rules) {
        dom.rulesOutput.textContent = data.rules;
      }
    }
  } catch (err) {
    dom.compilationBadge.className = "badge badge-danger";
    dom.compilationBadge.textContent = "Network Error";
    dom.logContent.innerHTML += `<div style="color: var(--accent-danger);">Network/server failure: ${err.message}</div>`;
  } finally {
    clearInterval(ticker);
    dom.compileBtn.disabled = false;
    dom.compileBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Compile to DMN 1.3`;
  }
}

/* ---------------- DRD Graph Visualizer ---------------- */

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
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

async function renderManifestGraph(manifest, rulesText) {
  if (!manifest) return;
  dom.manifestNodes.innerHTML = `<div class="drd-graph-loading"><div class="spinner-small"></div> Rendering Decision Requirements Graph…</div>`;

  const rules = rulesText || state.currentRules;
  if (!rules || !rules.trim()) {
    renderFallbackManifestGraph(dom.manifestNodes, manifest);
    return;
  }

  try {
    const res = await fetch("/api/graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules, format: "json" }),
    });
    const data = await res.json();
    if (data.ok && data.graph && data.graph.nodes && data.graph.nodes.length > 0) {
      renderSvgDRD(dom.manifestNodes, data.graph, manifest);
      return;
    }
  } catch (err) {
    console.warn("Could not fetch graph via /api/graph, falling back:", err);
  }

  renderFallbackManifestGraph(dom.manifestNodes, manifest);
}

function renderFallbackManifestGraph(container, manifest) {
  const nodes = [];
  const edges = [];
  const inputs = manifest.inputs || [];
  const decisions = manifest.decisions || [];

  inputs.forEach(inName => {
    nodes.push({ id: `n_${inName}`, name: inName, kind: "input", type: "input" });
  });

  decisions.forEach(decName => {
    const isFinal = decName === manifest.final;
    nodes.push({ id: `n_${decName}`, name: decName, kind: "decision", hitPolicy: isFinal ? "final" : "decision" });
  });

  // Infer dependencies from rules source if available
  const rules = state.currentRules || "";
  decisions.forEach(decName => {
    const needsMatch = new RegExp(`decision\\s+${decName}[^{]*\\{[^}]*needs:\\s*([^\\n]+)`, "m").exec(rules);
    if (needsMatch) {
      const neededVars = needsMatch[1].split(",").map(s => s.trim()).filter(Boolean);
      neededVars.forEach(v => {
        edges.push({ from: `n_${v}`, into: `n_${decName}` });
      });
    } else {
      inputs.forEach(inName => {
        if (new RegExp(`\\b${inName}\\b`).test(rules)) {
          edges.push({ from: `n_${inName}`, into: `n_${decName}` });
        }
      });
      decisions.forEach(otherDec => {
        if (otherDec !== decName && new RegExp(`\\b${otherDec}\\b`).test(rules)) {
          edges.push({ from: `n_${otherDec}`, into: `n_${decName}` });
        }
      });
    }
  });

  renderSvgDRD(container, { nodes, edges }, manifest);
}

function renderSvgDRD(container, graph, manifest) {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  container.innerHTML = "";

  if (!nodes.length) {
    container.innerHTML = `<div class="drd-graph-loading">No graph nodes available.</div>`;
    return;
  }

  // Layered topological ranking (Rank 0 = Inputs, Rank 1+ = Dependent Decisions)
  const rank = {};
  nodes.forEach(n => {
    rank[n.id] = n.kind === "input" ? 0 : 1;
  });

  for (let pass = 0; pass <= nodes.length + 2; pass++) {
    let changed = false;
    edges.forEach(e => {
      const fromRank = rank[e.from] ?? 0;
      const targetRank = fromRank + 1;
      if (targetRank > (rank[e.into] ?? 0)) {
        rank[e.into] = targetRank;
        changed = true;
      }
    });
    if (!changed) break;
  }

  const cols = {};
  nodes.forEach(n => {
    const r = rank[n.id] || 0;
    (cols[r] = cols[r] || []).push(n);
  });

  const colW = 240, rowH = 76, nodeW = 180, nodeH = 48, padX = 40, padY = 40;
  const pos = {};
  let maxRows = 0;
  const rankKeys = Object.keys(cols).map(Number).sort((a, b) => a - b);

  rankKeys.forEach(r => {
    cols[r].sort((a, b) => a.name.localeCompare(b.name));
    cols[r].forEach((n, i) => {
      pos[n.id] = { x: padX + r * colW, y: padY + i * rowH };
    });
    maxRows = Math.max(maxRows, cols[r].length);
  });

  const W = padX * 2 + Math.max(1, rankKeys.length - 1) * colW + nodeW;
  const H = padY * 2 + Math.max(1, maxRows) * rowH;

  const wrap = document.createElement("div");
  wrap.className = "graph-wrap";

  // Top-Right Graph Controls (Zoom In, Zoom Out, Fit)
  const controls = document.createElement("div");
  controls.className = "graph-controls";

  const mkBtn = (label, title, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.onclick = fn;
    controls.appendChild(b);
  };

  const svg = svgEl("svg", {
    class: "drg",
    width: "100%",
    viewBox: `0 0 ${W} ${H}`,
    role: "group",
    "aria-label": "Decision Requirements Diagram"
  });

  const defs = svgEl("defs", {});
  const mkMarker = (id, color) => {
    const m = svgEl("marker", {
      id,
      viewBox: "0 0 10 10",
      refX: "8",
      refY: "5",
      markerWidth: "8",
      markerHeight: "8",
      orient: "auto"
    });
    m.appendChild(svgEl("path", { d: "M 0 1.5 L 8 5 L 0 8.5 z", fill: color }));
    return m;
  };
  defs.appendChild(mkMarker("drd-arrow", "#38bdf8"));
  defs.appendChild(mkMarker("drd-arrow-active", "#f43f5e"));
  svg.appendChild(defs);

  // Render Edges (smooth cubic-bezier curves with high contrast cyan stroke)
  edges.forEach(e => {
    const a = pos[e.from], b = pos[e.into];
    if (!a || !b) return;
    const x1 = a.x + nodeW, y1 = a.y + nodeH / 2;
    const x2 = b.x - 3, y2 = b.y + nodeH / 2;
    const mx = (x1 + x2) / 2;
    const path = svgEl("path", {
      d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`,
      fill: "none",
      stroke: "#38bdf8",
      "stroke-width": "2.2",
      "stroke-opacity": "0.85",
      "marker-end": "url(#drd-arrow)",
      class: "drd-edge",
      "data-from": e.from,
      "data-into": e.into
    });
    svg.appendChild(path);
  });

  // Track connections per node
  const inDegree = {};
  const outDegree = {};
  nodes.forEach(n => {
    inDegree[n.id] = 0;
    outDegree[n.id] = 0;
  });
  edges.forEach(e => {
    outDegree[e.from] = (outDegree[e.from] || 0) + 1;
    inDegree[e.into] = (inDegree[e.into] || 0) + 1;
  });

  // Node Inspector Popover
  const inspect = document.createElement("div");
  inspect.className = "graph-inspect";
  inspect.hidden = true;

  const selectNode = n => {
    const isFinal = manifest && (n.name === manifest.final || n.local === manifest.final);
    const inc = inDegree[n.id] || 0;
    const out = outDegree[n.id] || 0;
    const rows = [
      `<b>${escapeHtml(n.local || n.name)}</b>`,
      `<span class="gi-kind">${isFinal ? "🎯 Final Decision" : (n.kind === "input" ? "📥 Input Data" : "⚙️ Decision Node")}</span>`
    ];
    if (n.type) rows.push(`Type: <code>${escapeHtml(n.type)}</code>`);
    if (n.hitPolicy) rows.push(`Hit Policy: <code>${escapeHtml(n.hitPolicy)}</code>`);
    if (n.decisionKind) rows.push(`Logic: <code>${escapeHtml(n.decisionKind)}</code>`);
    if (n.line) rows.push(`Source Line: <code>${n.line}</code>`);
    rows.push(`Flow: <code>${inc} incoming → ${out} outgoing</code>`);
    if (n.kind === "input" && out === 0) {
      rows.push(`<div class="gi-find" style="color: #fbbf24;">⚠️ Unused Input: Declared at the top of .rules, but not referenced in any decision table's "needs:" list or formula.</div>`);
    } else if (n.kind !== "input" && inc === 0 && out === 0) {
      rows.push(`<div class="gi-find" style="color: #fbbf24;">⚠️ Floating Decision: Has no inputs feeding in and no decisions consuming it.</div>`);
    } else if (n.findings && n.findings.length) {
      rows.push(`<div class="gi-find">${n.findings.map(f => `• ${escapeHtml(f)}`).join("<br/>")}</div>`);
    } else {
      rows.push(`<div style="color:#22c55e; margin-top:4px;">✓ Formally verified clean</div>`);
    }
    inspect.innerHTML = `<button class="gi-close" type="button" title="Close">×</button>` + rows.join("<br/>");
    inspect.querySelector(".gi-close").onclick = () => { inspect.hidden = true; };
    inspect.hidden = false;
  };

  // Render Nodes with Standard DMN Shapes
  nodes.forEach(n => {
    const p = pos[n.id];
    if (!p) return;
    const isInput = n.kind === "input";
    const isFinal = manifest && (n.name === manifest.final || n.local === manifest.final);
    const inc = inDegree[n.id] || 0;
    const out = outDegree[n.id] || 0;
    const isUnused = (isInput && out === 0) || (!isInput && inc === 0 && out === 0);

    const nodeG = svgEl("g", {
      class: "gnode",
      transform: `translate(${p.x},${p.y})`,
      "data-name": n.name,
      "data-kind": n.kind,
      tabindex: "0",
      role: "button",
      "aria-label": `${n.kind} ${n.name}`
    });

    let fill = isInput ? "#1e293b" : (isFinal ? "#064e3b" : "#1e1e38");
    let stroke = isInput ? "#0284c7" : (isFinal ? "#10b981" : "#6366f1");
    if (isUnused) {
      fill = "#292116";
      stroke = "#f59e0b";
    }
    const radius = isInput ? 24 : 8;

    const rect = svgEl("rect", {
      x: 0,
      y: 0,
      width: nodeW,
      height: nodeH,
      rx: radius,
      fill,
      stroke,
      "stroke-width": isUnused ? "1.8" : "1.5",
      class: "gn-rect"
    });
    nodeG.appendChild(rect);

    // Title label
    const name = n.local || n.name;
    const displayName = name.length > 20 ? name.slice(0, 18) + "…" : name;
    const titleText = svgEl("text", {
      x: nodeW / 2,
      y: nodeH / 2 - 1,
      "text-anchor": "middle",
      fill: "#f8fafc",
      "font-size": "11.5",
      "font-weight": "600",
      "font-family": "var(--font-mono, monospace)"
    });
    titleText.textContent = displayName;
    nodeG.appendChild(titleText);

    // Subtitle badge
    let subLabel;
    if (isUnused) {
      subLabel = isInput ? "⚠️ unused input" : "⚠️ floating";
    } else if (isInput) {
      subLabel = n.type ? `input: ${n.type}` : "input";
    } else if (isFinal) {
      subLabel = "★ final decision";
    } else {
      subLabel = n.hitPolicy || n.decisionKind || "decision";
    }

    let subColor = isUnused ? "#fbbf24" : (isInput ? "#38bdf8" : (isFinal ? "#34d399" : "#a5b4fc"));
    const subText = svgEl("text", {
      x: nodeW / 2,
      y: nodeH - 8,
      "text-anchor": "middle",
      fill: subColor,
      "font-size": "9",
      "font-weight": "500"
    });
    subText.textContent = subLabel;
    nodeG.appendChild(subText);

    nodeG.addEventListener("click", ev => {
      ev.stopPropagation();
      selectNode(n);
    });

    nodeG.addEventListener("mouseenter", () => {
      svg.querySelectorAll(".drd-edge").forEach(edgeEl => {
        if (edgeEl.getAttribute("data-from") === n.id || edgeEl.getAttribute("data-into") === n.id) {
          edgeEl.classList.add("highlighted");
          edgeEl.setAttribute("marker-end", "url(#drd-arrow-active)");
        }
      });
    });

    nodeG.addEventListener("mouseleave", () => {
      svg.querySelectorAll(".drd-edge").forEach(edgeEl => {
        edgeEl.classList.remove("highlighted");
        edgeEl.setAttribute("marker-end", "url(#drd-arrow)");
      });
    });

    nodeG.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        selectNode(n);
      }
    });

    svg.appendChild(nodeG);
  });

  svg.addEventListener("click", () => {
    inspect.hidden = true;
  });

  // Pan & Zoom Implementation
  let vb = { x: 0, y: 0, w: W, h: H };
  const applyViewBox = () => svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);

  const zoomAt = (factor, cx, cy) => {
    const nw = Math.min(W * 4, Math.max(W * 0.25, vb.w * factor));
    const ratio = nw / vb.w;
    vb = {
      x: cx - (cx - vb.x) * ratio,
      y: cy - (cy - vb.y) * ratio,
      w: nw,
      h: vb.h * ratio
    };
    applyViewBox();
  };

  mkBtn("+", "Zoom in", () => zoomAt(0.8, vb.x + vb.w / 2, vb.y + vb.h / 2));
  mkBtn("−", "Zoom out", () => zoomAt(1.25, vb.x + vb.w / 2, vb.y + vb.h / 2));
  mkBtn("⤢", "Fit graph to screen", () => {
    vb = { x: 0, y: 0, w: W, h: H };
    applyViewBox();
  });

  svg.addEventListener("wheel", ev => {
    ev.preventDefault();
    const rect = svg.getBoundingClientRect();
    const cursorX = vb.x + ((ev.clientX - rect.left) / rect.width) * vb.w;
    const cursorY = vb.y + ((ev.clientY - rect.top) / rect.height) * vb.h;
    zoomAt(ev.deltaY < 0 ? 0.88 : 1.15, cursorX, cursorY);
  }, { passive: false });

  let drag = null;
  svg.addEventListener("mousedown", ev => {
    drag = { x: ev.clientX, y: ev.clientY };
    svg.classList.add("grabbing");
  });

  svg.addEventListener("mousemove", ev => {
    if (!drag) return;
    const rect = svg.getBoundingClientRect();
    vb.x -= ((ev.clientX - drag.x) / rect.width) * vb.w;
    vb.y -= ((ev.clientY - drag.y) / rect.height) * vb.h;
    drag = { x: ev.clientX, y: ev.clientY };
    applyViewBox();
  });

  const endDrag = () => {
    drag = null;
    svg.classList.remove("grabbing");
  };
  svg.addEventListener("mouseup", endDrag);
  svg.addEventListener("mouseleave", endDrag);

  // Bottom Legend
  const legend = document.createElement("div");
  legend.className = "graph-legend";
  legend.innerHTML = `
    <span><i class="lg-pill" style="border-radius:12px; background:#1e293b; border:1px solid #0284c7;"></i> Input Data (${(manifest.inputs || []).length})</span>
    <span><i class="lg-pill" style="background:#1e1e38; border:1px solid #6366f1;"></i> Decision Node</span>
    <span><i class="lg-pill" style="background:#064e3b; border:1px solid #10b981;"></i> Final Decision</span>
    <span><i class="lg-arrow"></i> Information Requirement (Dependency)</span>
  `;

  wrap.appendChild(controls);
  wrap.appendChild(svg);
  wrap.appendChild(inspect);
  container.appendChild(wrap);
  container.appendChild(legend);
}

/* ---------------- Typed inputs & shared controls ---------------- */

/**
 * Normalized [{name,type,min?,max?,options?}] for the active model.
 * Prefers the server-parsed declarations (`input x : number in [a..b]`).
 * Falls back to conservative guesses for legacy manifests without types.
 */
function getTypeEntries() {
  const typed = state.manifest?.typedInputs;
  if (Array.isArray(typed) && typed.length > 0) return typed;
  return (state.manifest?.inputs || []).map(name => {
    if (/^(is_|has_)/i.test(name) || /rain|flag|enabled|active|approved/i.test(name)) return { name, type: "boolean" };
    if (/fare|distance|score|income|debt|age|amount|weight|pct|percent|cost/i.test(name)) return { name, type: "number" };
    return { name, type: "string" };
  });
}

/** Client mirror of copilot-lib.mjs buildInputTemplate defaults. */
function defaultForNumber({ min, max } = {}) {
  if (min != null && max != null) {
    const mid = (min + max) / 2;
    return Number.isInteger(min) && Number.isInteger(max) ? Math.round(mid) : Number(mid.toFixed(2));
  }
  if (min != null) return min > 0 ? min : 1;
  if (max != null) return Math.max(0, Math.min(max, Math.round(max / 2)));
  return 1;
}

function defaultsFromEntries(entries) {
  const tpl = {};
  entries.forEach(t => {
    if (t.type === "boolean") tpl[t.name] = false;
    else if (t.type === "string") tpl[t.name] = t.options?.length ? t.options[0] : "";
    else if (t.type === "number") tpl[t.name] = defaultForNumber(t);
    else tpl[t.name] = "";
  });
  return tpl;
}

/** One form control for a typed entry — shared by the Input-Data studio and Batch scenario form. */
function controlHtml(entry, id, value) {
  const label = escapeHtml(entry.name);
  const typeHint = escapeHtml(String(entry.type || "text"));
  if (entry.type === "boolean") {
    return `
      <label>${label} <span class="type-hint">(boolean)</span></label>
      <select id="${id}">
        <option value="true"${value === true ? " selected" : ""}>true</option>
        <option value="false"${value !== true ? " selected" : ""}>false</option>
      </select>`;
  }
  if (entry.type === "string" && entry.options?.length) {
    const opts = entry.options.map(o =>
      `<option value="${escapeHtml(o)}"${o === value ? " selected" : ""}>${escapeHtml(o)}</option>`).join("");
    return `
      <label>${label} <span class="type-hint">(one of: ${escapeHtml(entry.options.join(", "))})</span></label>
      <select id="${id}">${opts}</select>`;
  }
  if (entry.type === "number") {
    const minAttr = entry.min != null ? ` min="${entry.min}"` : "";
    const maxAttr = entry.max != null ? ` max="${entry.max}"` : "";
    const domain = entry.min != null || entry.max != null
      ? ` <span class="type-hint">(domain: ${entry.min ?? "-∞"} … ${entry.max ?? "∞"})</span>` : "";
    return `
      <label>${label} <span class="type-hint">(number)${domain}</span></label>
      <input type="number" step="any" id="${id}" value="${escapeHtml(String(value))}"${minAttr}${maxAttr}>`;
  }
  return `
    <label>${label} <span class="type-hint">(${typeHint})</span></label>
    <input type="text" id="${id}" value="${escapeHtml(String(value))}">`;
}

/** Read all `tpl_input_*` / `sc_input_*` fields back into a plain input object. */
function collectInputFields(idPrefix) {
  const obj = {};
  getTypeEntries().forEach(t => {
    const el = document.getElementById(`${idPrefix}_${t.name}`);
    if (!el) return;
    if (el.tagName === "SELECT" && (t.type === "boolean")) obj[t.name] = el.value === "true";
    else if (el.type === "number") obj[t.name] = el.value === "" ? null : Number(el.value);
    else obj[t.name] = el.value;
  });
  return obj;
}

/* ---------------- Input Data & Run Studio ---------------- */

function renderTemplateStudio() {
  const entries = getTypeEntries();
  dom.templateFormFields.innerHTML = "";
  dom.templateRunResults.innerHTML = "";

  if (entries.length === 0) {
    dom.templateFormFields.innerHTML = `<span class="hint-text">No inputs declared in this model. Compile a model first.</span>`;
    dom.templateJsonPreview.textContent = "{ }";
    return;
  }

  const defaults = defaultsFromEntries(entries);
  entries.forEach(t => {
    const group = document.createElement("div");
    group.className = "form-group";
    group.innerHTML = controlHtml(t, `tpl_input_${t.name}`, defaults[t.name]);
    dom.templateFormFields.appendChild(group);
  });

  // Live JSON preview follows every edit
  dom.templateFormFields.addEventListener("input", updateTemplatePreview);
  dom.templateFormFields.addEventListener("change", updateTemplatePreview);
  updateTemplatePreview();
}

function collectTemplateInput() {
  return collectInputFields("tpl_input");
}

function updateTemplatePreview() {
  dom.templateJsonPreview.textContent = JSON.stringify(collectTemplateInput(), null, 2);
}

/** Scenario-suite skeleton compatible with Import JSON & test-workflow.mjs. */
function buildScenarioTemplate(modelName, entries, inputOverride) {
  return [{
    name: `${modelName || "model"} input template`,
    input: inputOverride || defaultsFromEntries(entries),
  }];
}

async function handleRunTemplate() {
  if (!state.currentRules) {
    alert("Please compile or load a model first!");
    return;
  }
  const input = collectTemplateInput();

  dom.runTemplateBtn.disabled = true;
  dom.runTemplateBtn.innerHTML = `<span class="pulse-dot"></span> Running…`;
  dom.templateRunResults.innerHTML = "";

  try {
    const res = await fetch("/api/evaluate-single", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules: state.currentRules, input })
    });
    const data = await res.json();
    if (data.ok) {
      const latency = document.createElement("div");
      latency.className = "run-meta";
      latency.innerHTML = `<span class="badge badge-success">Executed ✓</span> <span class="hint-text">${data.latencyMs}ms · ${Object.keys(data.outputs).length} decision(s)</span>`;
      dom.templateRunResults.appendChild(latency);
      renderDecisionCards(dom.templateRunResults, data.outputs);
    } else {
      alert("Evaluation failed: " + data.error);
    }
  } catch (err) {
    alert("Error executing input: " + err.message);
  } finally {
    dom.runTemplateBtn.disabled = false;
    dom.runTemplateBtn.innerHTML = `▶ Run All Decisions`;
  }
}

/* ---------------- Decision output cards (shared by Live Playground & Input-Data runner) ---------------- */
function renderDecisionCards(container, outputs) {
  Object.entries(outputs).forEach(([decName, value]) => {
    const card = document.createElement("div");
    card.className = "live-output-card";

    let displayVal = "";
    let desc = "";

    if (value && typeof value === "object" && value.__error) {
      displayVal = escapeHtml(value.__error);
      desc = "Engine error";
      card.style.borderLeftColor = "var(--accent-danger)";
    } else if (typeof value === "object" && value !== null) {
      displayVal = escapeHtml(JSON.stringify(value));
      desc = "Complex context decision output";
    } else if (typeof value === "boolean") {
      displayVal = value ? "TRUE ✓" : "FALSE ✗";
      card.style.borderLeftColor = value ? "var(--accent-success)" : "var(--accent-danger)";
    } else if (typeof value === "number") {
      displayVal = Number.isInteger(value) ? value : Number(value).toFixed(2);
      card.style.borderLeftColor = "var(--accent-secondary)";
    } else {
      displayVal = `"${escapeHtml(String(value))}"`;
    }

    card.innerHTML = `
      <div class="live-card-title">Decision: ${escapeHtml(decName)}</div>
      <div class="live-card-value">${displayVal}</div>
      ${desc ? `<div class="live-card-desc">${desc}</div>` : ""}
    `;
    container.appendChild(card);
  });
}

/* ---------------- Dynamic Form Inputs Builder (Batch scenario form) ---------------- */
function buildScenarioFormInputs() {
  dom.dynamicFormInputs.innerHTML = "";
  const entries = getTypeEntries();

  if (entries.length === 0) {
    dom.dynamicFormInputs.innerHTML = `<span class="hint-text">No inputs declared in current model. Compile a model first.</span>`;
    return;
  }

  const defaults = defaultsFromEntries(entries);
  entries.forEach(t => {
    const group = document.createElement("div");
    group.className = "form-group";
    group.innerHTML = controlHtml(t, `sc_input_${t.name}`, defaults[t.name]);
    dom.dynamicFormInputs.appendChild(group);
  });
}

function updateScenarioCount() {
  dom.scenarioCountBadge.textContent = `${state.scenarios.length} Scenarios`;
}

/* ---------------- Batch Test Suite Execution ---------------- */
async function handleRunBatch() {
  if (!state.currentRules) {
    alert("Please compile a model first!");
    return;
  }
  if (state.scenarios.length === 0) {
    alert("Please add or load at least one test scenario.");
    return;
  }

  dom.runAllBatchBtn.disabled = true;
  dom.runAllBatchBtn.innerHTML = `<span class="pulse-dot"></span> Executing ${state.scenarios.length} Scenarios...`;

  try {
    const res = await fetch("/api/evaluate-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rules: state.currentRules,
        scenarios: state.scenarios
      })
    });

    const data = await res.json();
    if (data.ok) {
      renderResultsTable(data.results);
      const passPct = ((data.passed / data.total) * 100).toFixed(0);
      const avgMs = (data.results.reduce((acc, r) => acc + r.latencyMs, 0) / data.total).toFixed(2);
      dom.metricPassRate.textContent = `${passPct}% (${data.passed}/${data.total})`;
      dom.metricLatency.textContent = `${avgMs}ms`;
    } else {
      alert("Evaluation failed: " + data.error);
    }
  } catch (err) {
    alert("Error executing batch: " + err.message);
  } finally {
    dom.runAllBatchBtn.disabled = false;
    dom.runAllBatchBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Run All Test Scenarios`;
  }
}

function renderResultsTable(results) {
  dom.tableBody.innerHTML = "";

  results.forEach(r => {
    const tr = document.createElement("tr");

    // Input pills
    const inputPills = Object.entries(r.input)
      .map(([k, v]) => `<span class="input-pill">${escapeHtml(k)}: <strong>${escapeHtml(String(v))}</strong></span>`)
      .join(" ");

    // Decision output rows
    const outputRows = Object.entries(r.outputs)
      .map(([dec, out]) => {
        if (out.error) {
          return `<div class="decision-pill"><span class="decision-key">${escapeHtml(dec)}:</span> <span style="color: var(--accent-danger);">${escapeHtml(out.error)}</span></div>`;
        }
        const valStr = typeof out.value === "object" ? JSON.stringify(out.value) : String(out.value);
        return `<div class="decision-pill"><span class="decision-key">${escapeHtml(dec)}:</span> <span class="decision-val">${escapeHtml(valStr)}</span></div>`;
      })
      .join("");

    tr.innerHTML = `
      <td style="color: var(--text-muted); font-family: var(--font-mono);">${r.id}</td>
      <td><strong>${escapeHtml(r.name)}</strong></td>
      <td>${inputPills}</td>
      <td>${outputRows}</td>
      <td style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted);">${r.latencyMs}ms</td>
      <td>
        <span class="badge ${r.passed ? 'badge-success' : 'badge-danger'}">
          ${r.passed ? 'PASSED ✓' : 'FAILED ✗'}
        </span>
      </td>
    `;
    dom.tableBody.appendChild(tr);
  });
}

/* ---------------- Live Playground Controls ---------------- */
function buildLivePlayground() {
  dom.liveControlsContainer.innerHTML = "";
  dom.liveOutputsCards.innerHTML = "";
  const entries = getTypeEntries();

  if (entries.length === 0) {
    dom.liveControlsContainer.innerHTML = `<span class="hint-text">Compile a model first to generate live controls.</span>`;
    return;
  }

  // Initialize input state with type-aware defaults from the declared domains
  state.liveInputState = defaultsFromEntries(entries);

  entries.forEach(t => {
    const row = document.createElement("div");
    row.className = "live-control-row";
    const dispDefault = `<span class="control-val-display" id="disp_${t.name}">${escapeHtml(String(state.liveInputState[t.name]))}</span>`;

    if (t.type === "boolean") {
      row.innerHTML = `
        <div class="control-header">
          <span class="control-name">${escapeHtml(t.name)}</span>
          ${dispDefault}
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="live_ctrl_${t.name}"${state.liveInputState[t.name] ? " checked" : ""}>
          <span style="font-size: 0.8rem; color: var(--text-secondary);">Toggle switch</span>
        </label>
      `;
    } else if (t.type === "number") {
      const min = t.min != null ? t.min : 0;
      const max = t.max != null ? t.max : (t.min != null ? t.min + 100 : 100);
      const step = Number.isInteger(min) && Number.isInteger(max) ? 1 : 0.5;
      row.innerHTML = `
        <div class="control-header">
          <span class="control-name">${escapeHtml(t.name)}</span>
          ${dispDefault}
        </div>
        <input type="range" class="range-slider" id="live_ctrl_${t.name}" min="${min}" max="${max}" step="${step}" value="${state.liveInputState[t.name]}">
      `;
    } else if (t.type === "string" && t.options?.length) {
      const opts = t.options.map(o =>
        `<option value="${escapeHtml(o)}"${o === state.liveInputState[t.name] ? " selected" : ""}>${escapeHtml(o)}</option>`).join("");
      row.innerHTML = `
        <div class="control-header">
          <span class="control-name">${escapeHtml(t.name)}</span>
          ${dispDefault}
        </div>
        <select id="live_ctrl_${t.name}" class="preset-dropdown" style="width: 100%;">${opts}</select>
      `;
    } else {
      row.innerHTML = `
        <div class="control-header">
          <span class="control-name">${escapeHtml(t.name)}</span>
          ${dispDefault}
        </div>
        <input type="text" id="live_ctrl_${t.name}" class="preset-dropdown" style="width: 100%;" value="${escapeHtml(String(state.liveInputState[t.name] ?? ""))}">
      `;
    }
    dom.liveControlsContainer.appendChild(row);

    // Event listener for live update
    setTimeout(() => {
      const el = document.getElementById(`live_ctrl_${t.name}`);
      const disp = document.getElementById(`disp_${t.name}`);
      if (!el || !disp) return;
      el.addEventListener("input", () => {
        if (el.type === "checkbox") {
          state.liveInputState[t.name] = el.checked;
        } else if (el.type === "range") {
          state.liveInputState[t.name] = Number(el.value);
        } else {
          state.liveInputState[t.name] = el.value;
        }
        disp.textContent = String(state.liveInputState[t.name]);
        triggerLiveEvaluation();
      });
    }, 10);
  });

  // Initial trigger
  triggerLiveEvaluation();
}

let liveDebounceTimer = null;
function triggerLiveEvaluation() {
  clearTimeout(liveDebounceTimer);
  liveDebounceTimer = setTimeout(async () => {
    if (!state.currentRules) return;
    try {
      const res = await fetch("/api/evaluate-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: state.currentRules,
          input: state.liveInputState
        })
      });
      const data = await res.json();
      if (data.ok) {
        dom.liveLatencyBadge.textContent = `${data.latencyMs}ms`;
        renderLiveOutputCards(data.outputs);
      }
    } catch (err) {
      console.error("Live eval error:", err);
    }
  }, 20);
}

function renderLiveOutputCards(outputs) {
  dom.liveOutputsCards.innerHTML = "";
  renderDecisionCards(dom.liveOutputsCards, outputs);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}
