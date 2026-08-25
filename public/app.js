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

  renderManifestGraph(state.manifest);
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

      renderManifestGraph(data.manifest);
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
function renderManifestGraph(manifest) {
  if (!manifest || !manifest.decisions) return;
  dom.manifestNodes.innerHTML = "";

  const inputsCard = document.createElement("div");
  inputsCard.className = "drd-node";
  inputsCard.innerHTML = `
    <div class="drd-node-title">📥 Inputs (${manifest.inputs.length})</div>
    <div class="drd-node-desc">${manifest.inputs.map(i => `<span class="input-pill">${i}</span>`).join(" ")}</div>
  `;
  dom.manifestNodes.appendChild(inputsCard);

  manifest.decisions.forEach(d => {
    const node = document.createElement("div");
    node.className = "drd-node";
    const isFinal = d === manifest.final;
    node.innerHTML = `
      <div class="drd-node-title">${isFinal ? "🎯 Final Decision: " : "⚙️ Decision: "}${d}</div>
      <div class="drd-node-desc">Status: Formally verified node</div>
    `;
    dom.manifestNodes.appendChild(node);
  });
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
