/**
 * copilot-lib.mjs — testable core of the NL→DMN copilot pipeline.
 *
 * Exports pure/deterministic building blocks so the pipeline can be unit-tested
 * without spending LLM credits, plus hardened LLM/network primitives.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { existsSync } from "node:fs";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- Environment file loader (.env) ---------------- */
export function loadEnv(envPath = path.join(ROOT, ".env")) {
  if (!existsSync(envPath)) return {};
  try {
    const content = readFileSync(envPath, "utf8");
    const parsed = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      parsed[key] = val;
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

// Auto-load .env at module evaluation time
loadEnv();

export const FEELC = process.env.FEELC_BIN || path.join(ROOT, "bin", "feelc");

/**
 * Output-token ceiling per LLM call. Default 50_000 — sized for real-world specs
 * of 100–500 rules (override via QUERY_MAX_TOKENS env).
 */
export const MAX_TOKENS = () => Number(process.env.QUERY_MAX_TOKENS || 50000);

/** Wall-clock patience for ONE LLM call. Default 30 min — long compiles are expected, not failures. */
export const CHAT_TIMEOUT_MS = () => Number(process.env.CHAT_TIMEOUT_MS || 30 * 60 * 1000);

/** Transient-failure retry attempts per LLM call (so ≥5 total tries). */
export const CHAT_RETRIES = () => Number(process.env.CHAT_RETRIES ?? 4);

export class LlmError extends Error {}
export class CreditError extends LlmError {}
export class TruncationError extends LlmError {}

/* ---------------- Provider & credentials resolution ---------------- */

/**
 * Normalizes Azure AI Foundry / Azure OpenAI endpoint URLs.
 */
export function buildAzureEndpoint(endpoint, model, apiVersion = "2024-06-01") {
  let clean = (endpoint || "").trim().replace(/\/+$/, "");
  if (!clean) return "";

  // If it's already a full completions URL
  if (clean.includes("/chat/completions")) {
    if (apiVersion && !clean.includes("api-version=") && clean.includes("openai.azure.com")) {
      const sep = clean.includes("?") ? "&" : "?";
      return `${clean}${sep}api-version=${apiVersion}`;
    }
    return clean;
  }

  // Azure OpenAI service: https://<resource>.openai.azure.com
  if (clean.includes("openai.azure.com")) {
    const deployment = model || "gpt-4o";
    const ver = apiVersion ? `?api-version=${apiVersion}` : "";
    return `${clean}/openai/deployments/${deployment}/chat/completions${ver}`;
  }

  // Azure AI Foundry / AI Studio: services.ai.azure.com or models.ai.azure.com
  if (clean.endsWith("/models")) {
    return `${clean}/chat/completions`;
  }
  if (clean.includes("services.ai.azure.com")) {
    return `${clean}/models/chat/completions`;
  }

  // Default OpenAI-compatible path
  return `${clean}/chat/completions`;
}

/**
 * Resolves the active LLM provider configuration from .env / process.env.
 * Prioritizes Azure AI Foundry / Azure OpenAI, then OpenRouter / OpenAI.
 */
export function loadLlmConfig(credPath = path.join(process.env.HOME || "", ".dsh/.credentials.yaml")) {
  // 1. Azure AI Foundry / Azure OpenAI
  const azureKey = process.env.AZURE_AI_API_KEY || process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_API_KEY;
  const azureEndpoint = process.env.AZURE_AI_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
  if (azureKey || azureEndpoint) {
    const model = process.env.AZURE_AI_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || process.env.AZURE_OPENAI_MODEL || process.env.QUERY_MODEL || "gpt-4o";
    const apiVersion = process.env.AZURE_AI_API_VERSION || process.env.AZURE_OPENAI_API_VERSION || "2024-06-01";
    const url = buildAzureEndpoint(azureEndpoint, model, apiVersion);
    return {
      provider: "azure",
      apiKey: azureKey || "",
      model,
      url,
      headers: {
        "Content-Type": "application/json",
        "api-key": azureKey || "",
        Authorization: `Bearer ${azureKey || ""}`,
      },
    };
  }

  // 2. OpenRouter
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    const model = process.env.QUERY_MODEL || "stealth/ox-alpha";
    return {
      provider: "openrouter",
      apiKey: openrouterKey,
      model,
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openrouterKey}`,
      },
    };
  }

  // 3. OpenAI / Generic OpenAI-compatible endpoint
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = process.env.QUERY_MODEL || "gpt-4o";
    return {
      provider: "openai",
      apiKey: openaiKey,
      model,
      url: baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
    };
  }

  // 4. Legacy fallback from credentials file
  try {
    const fileKey = readFileSync(credPath, "utf8").match(/OPENROUTER_API_KEY:\s*(\S+)/)?.[1];
    if (fileKey) {
      return {
        provider: "openrouter",
        apiKey: fileKey,
        model: process.env.QUERY_MODEL || "stealth/ox-alpha",
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fileKey}`,
        },
      };
    }
  } catch {}

  // Unconfigured stub
  return {
    provider: "unconfigured",
    apiKey: "",
    model: process.env.QUERY_MODEL || "gpt-4o",
    url: "",
    headers: { "Content-Type": "application/json" },
  };
}

export function loadApiKey(credPath) {
  const cfg = loadLlmConfig(credPath);
  if (!cfg.apiKey) {
    throw new LlmError("No API key configured. Set AZURE_AI_API_KEY in your .env file or environment.");
  }
  return cfg.apiKey;
}

export const MODEL = () => loadLlmConfig().model;
export const CHAT_URL = () => loadLlmConfig().url;

/* ---------------- OpenRouter chat (hardened) ---------------- */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Stdlib JSON POST with absolute wall-clock timeout. Used instead of globalThis
 * fetch because Node's bundled undici kills requests whose response headers
 * take > ~300 s — fatal for long compiles. node:http(s) has no such cap.
 */
export function requestJson(urlStr, headers = {}, bodyStr = "", { timeoutMs = CHAT_TIMEOUT_MS(), method } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const mod = url.protocol === "http:" ? http : https;
    const req = mod.request(url, {
      method: method || (bodyStr ? "POST" : "GET"),
      headers: { ...headers, ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}) },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    const killer = setTimeout(() => req.destroy(new LlmError(`request timed out after ${timeoutMs} ms`)), timeoutMs);
    req.on("close", () => clearTimeout(killer));
    req.on("error", (e) => { clearTimeout(killer); reject(e); });
    if (bodyStr) req.end(bodyStr); else req.end();
  });
}

export const postJson = (urlStr, headers, bodyStr, opts = {}) => requestJson(urlStr, headers, bodyStr, opts);

const NETWORK_ERR_RE = /timed out|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|\bnetwork\b|\btransient\b| aborted/i;
const isTransient = (e) =>
  e instanceof LlmError && /\btransient\b/.test(e.message)
  || (e instanceof Error && !(e instanceof TruncationError) && !(e instanceof CreditError) && NETWORK_ERR_RE.test(e.message));

/** True for transport-level failures where retrying the SAME conversation state is meaningful. */
export const isNetworkError = (e) =>
  e instanceof Error && !(e instanceof TruncationError) && !(e instanceof CreditError) && NETWORK_ERR_RE.test(String(e.message || e));

const FALLBACK_MAX_TOKENS = 16000;

/* Model output-token metadata (cached 6 h). */
let _modelMaxCache = { at: 0, value: null };
export async function getModelMaxOutput(model = MODEL()) {
  const cfg = loadLlmConfig();
  if (cfg.provider !== "openrouter") return null;
  if (Date.now() - _modelMaxCache.at < 6 * 3600_000) return _modelMaxCache.value;
  try {
    const { status, text } = await postJson("https://openrouter.ai/api/v1/models", {}, "", { timeoutMs: 10_000 });
    if (status === 200) {
      const entry = (JSON.parse(text)?.data || []).find(m => m.id === model);
      _modelMaxCache = {
        at: Date.now(),
        value: entry?.top_provider?.max_completion_tokens ?? entry?.architecture?.max_output_tokens ?? null,
      };
    }
  } catch { /* metadata is best-effort; never block a compile on it */ }
  return _modelMaxCache.value;
}

/** Effective max_tokens: requested ceiling clamped down to the model's real limit when known. */
export async function resolveMaxTokens(requested = MAX_TOKENS()) {
  const modelMax = await getModelMaxOutput();
  return modelMax ? Math.min(requested, modelMax) : requested;
}

/**
 * One chat completion with production-grade hardening:
 *  - Supports Azure AI Foundry, Azure OpenAI, OpenRouter, and OpenAI endpoints
 *  - stdlib transport immune to undici's ~300 s header cap; per-call patience CHAT_TIMEOUT_MS (default 30 min)
 *  - transient retries (network / 408 / 409 / 429 / 5xx) with exponential backoff + jitter, CHAT_RETRIES (default 4 → 5 tries)
 *  - 402 → CreditError immediately; finish_reason "length" → TruncationError (not retried)
 *  - auto-degrade once to FALLBACK_MAX_TOKENS if the provider rejects the requested ceiling
 *
 * @returns {Promise<string>} assistant message content
 */
export async function chat(messages, { temperature = 0.2, apiKey, model, endpoint, headers, retries = CHAT_RETRIES(), timeoutMs = CHAT_TIMEOUT_MS(), backoffBaseMs = 2000, transport } = {}) {
  const cfg = loadLlmConfig();
  const targetUrl = endpoint || cfg.url;
  const targetModel = model || cfg.model;
  const targetHeaders = headers || (apiKey ? {
    "Content-Type": "application/json",
    "api-key": apiKey,
    Authorization: `Bearer ${apiKey}`,
  } : cfg.headers);

  const send = transport || ((payload) => postJson(targetUrl, targetHeaders, payload, { timeoutMs }));

  let ceiling = await resolveMaxTokens();
  let degraded = false;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const payload = JSON.stringify({ model: targetModel, temperature, max_tokens: ceiling, messages });
      const { status, text } = await send(payload);
      const body = safeParse(text);
      if (status === 402) throw new CreditError("API credits exhausted. Please verify billing in your provider portal.");
      const choice = body.choices?.[0];
      const content = choice?.message?.content;
      if (choice?.finish_reason === "length") throw new TruncationError(`output truncated at ${ceiling} tokens — raise QUERY_MAX_TOKENS`);
      if (!content) {
        if (status === 400 && /max_tokens/i.test(JSON.stringify(body.error || {})) && !degraded) {
          const rejected = ceiling;              // provider rejected our ceiling: one silent fallback, attempt not consumed
          degraded = true;
          ceiling = FALLBACK_MAX_TOKENS;
          console.warn(`[copilot-lib] provider rejected max_tokens=${rejected}; retrying with ${FALLBACK_MAX_TOKENS}`);
          continue;
        }
        if ([408, 409, 429].includes(status) || status >= 500) {
          throw new LlmError(`transient HTTP ${status}: ${JSON.stringify(body.error || {}).slice(0, 200)}`);
        }
        throw new LlmError(`LLM error: ${JSON.stringify(body.error || body).slice(0, 300)}`);
      }
      return content;
    } catch (e) {
      lastErr = e;
      if (e instanceof CreditError || e instanceof TruncationError) throw e;
      if (!isTransient(e) || attempt === retries) break;
      await sleep(backoffBaseMs * 2 ** attempt + Math.floor(Math.random() * Math.max(1, backoffBaseMs / 4)));
    }
  }
  throw lastErr;
}

function safeParse(text) { try { return JSON.parse(text); } catch { return {}; } }

/* ---------------- .rules extraction & parsing (pure) ---------------- */

/** Strip markdown fences / surrounding prose; throws when payload lacks any decision. */
export function extractRules(text) {
  const fenced = text.match(/```[a-zA-Z0-9]*\r?\n([\s\S]*?)```/);
  const rules = (fenced ? fenced[1] : text).trim();
  if (!/\bdecision\b/.test(rules)) throw new LlmError("LLM output does not look like a .rules model");
  return rules;
}

/** All declared decision names, in file order (case-sensitive identifiers). */
export function parseDecisions(src) {
  return [...src.matchAll(/^\s*decision\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map(m => m[1]);
}

/** Declared input variables, in file order (case-sensitive identifiers). */
export function parseInputs(src) {
  return [...src.matchAll(/^\s*input\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map(m => m[1]);
}

/**
 * Declared inputs WITH their declared types and domain constraints, in file order.
 *
 * Understood declarations (all optional except name/type):
 *   input age           : number in [18..100]     -> {min:18, max:100}
 *   input annual_income : number >= 0             -> {min:0}
 *   input threshold     : number <= 1000          -> {max:1000}
 *   input tier          : string in ["gold","silver"] -> {options:["gold","silver"]}
 *   input region        : string in {"urban","rural"} -> {options:["urban","rural"]}
 * Unknown types (e.g. date) are passed through verbatim so callers can degrade gracefully.
 * @returns {Array<{name:string, type:string, min?:number, max?:number, options?:string[]}>}
 */
export function parseInputTypes(src) {
  const out = [];
  const num = "-?\\d+(?:\\.\\d+)?";
  // NOTE: [ \t] (not \s) between tokens — \s would cross newlines and swallow the next declaration.
  const re = new RegExp(
    `^[ \\t]*input[ \\t]+([A-Za-z_][A-Za-z0-9_]*)[ \\t]*:[ \\t]*([A-Za-z_][A-Za-z0-9_]*)[ \\t]*([^\\n]*)$`, "gm"
  );
  for (const m of src.matchAll(re)) {
    const [, name, rawType, restRaw] = m;
    const entry = { name, type: rawType.toLowerCase() };
    const rest = restRaw || "";

    if (entry.type === "number") {
      const range = rest.match(new RegExp(`in\\s*\\[\\s*(${num})\\s*\\.\\.\\s*(${num})\\s*\\]`));
      if (range) {
        entry.min = Number(range[1]);
        entry.max = Number(range[2]);
      } else {
        const lower = rest.match(new RegExp(`>\\s*=\\s*(${num})`)) || rest.match(new RegExp(`>\\s*(${num})`));
        const upper = rest.match(new RegExp(`<\\s*=\\s*(${num})`)) || rest.match(new RegExp(`<\\s*(${num})`));
        if (lower) entry.min = Number(lower[1]);
        if (upper) entry.max = Number(upper[1]);
      }
    } else if (entry.type === "string") {
      const list = rest.match(/in\s*(\[[^\]]*\]|\{[^}]*\})/);
      if (list) entry.options = [...list[1].matchAll(/"([^"]*)"/g)].map(x => x[1]).filter(Boolean);
    }
    out.push(entry);
  }
  return out;
}

/** Sensible editable default for a numeric input, clamped into its declared domain when known. */
function defaultForNumber({ min, max } = {}) {
  if (min != null && max != null) {
    const mid = (min + max) / 2;
    return Number.isInteger(min) && Number.isInteger(max)
      ? Math.round(mid)
      : Number(mid.toFixed(2));
  }
  if (min != null) return min > 0 ? min : 1;
  if (max != null) return Math.max(0, Math.min(max, Math.round(max / 2)));
  return 1;
}

/**
 * JSON input template for a model: one key per declared input with a valid,
 * editable default derived from its declared type/domain (not from its name).
 */
export function buildInputTemplate(typedInputs = []) {
  const tpl = {};
  for (const t of typedInputs) {
    switch (t.type) {
      case "boolean": tpl[t.name] = false; break;
      case "string":  tpl[t.name] = t.options?.length ? t.options[0] : ""; break;
      case "number":  tpl[t.name] = defaultForNumber(t); break;
      default:        tpl[t.name] = ""; // unknown types (e.g. date) start as text
    }
  }
  return tpl;
}

/**
 * Scenario-suite skeleton in the exact shape consumed by the Batch Studio's
 * "Import JSON" button and tests/test-workflow.mjs: [{name, input}].
 */
export function buildScenarioTemplate(modelName, typedInputs = []) {
  return [{
    name: `${modelName || "model"} input template`,
    input: buildInputTemplate(typedInputs),
  }];
}

/**
 * Structural manifest of a verified model — the single source of truth for
 * smoke testing (replaces the old "last decision line" heuristic).
 *
 * Parsing strategy: split the source into TOP-LEVEL BLOCKS by header keywords,
 * then compute the dependency graph over CASE-SENSITIVE whole-word references.
 * A decision is a "sink" (candidate final) iff no other decision's block
 * references it.
 */
export function parseModelManifest(src) {
  const inputs = parseInputs(src);
  const typedInputs = parseInputTypes(src);
  const blocks = topLevelBlocks(src);
  const decBlocks = blocks.filter(b => b.kind === "decision");
  const decisions = decBlocks.map(b => b.name);
  const referenced = new Set();
  for (const d of decisions) {
    for (const other of decBlocks) {
      if (other.name === d) continue;
      if (new RegExp(`\\b${escapeRe(d)}\\b`).test(other.text)) { referenced.add(d); break; }
    }
    // Also referenced if used before any decision appears (rare, e.g. in a type default) — skip; types can't call decisions.
  }
  const sinks = decisions.filter(d => !referenced.has(d));
  return {
    inputs, decisions, typedInputs,
    final: sinks.length >= 1 ? sinks[sinks.length - 1] : null,
    ambiguous: sinks.length !== 1,
  };
}

/** Split source into top-level blocks: [{kind, name, text}] where text = header + body. */
function topLevelBlocks(src) {
  const headerRe = /^[ \t]*(model|input|type|decision)\b[^\n]*/gm;
  const marks = [];
  let m;
  while ((m = headerRe.exec(src)) !== null) {
    marks.push({ kind: m[1], start: m.index, contentStart: headerRe.lastIndex });
  }
  return marks.map((mark, i) => {
    const text = src.slice(mark.start, i + 1 < marks.length ? marks[i + 1].start : src.length);
    let name;
    if (mark.kind === "decision") name = /^\s*decision\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(text)?.[1];
    else if (mark.kind === "input") name = /^\s*input\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(text)?.[1];
    return { ...mark, text, name };
  });
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/* ---------------- feelc integration ---------------- */

/**
 * Run `feelc verify`. @returns {Array<{line?:any, code:string, message:string}>} issues ([] = clean)
 */
export function verify(rulesFile) {
  try {
    execFileSync(FEELC, ["verify", "--rules", rulesFile, "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    return [];
  } catch (e) {
    const raw = (e.stdout || "").toString().trim();
    if (!raw) return [{ code: "CRASH", message: (e.stderr || e.message).toString().slice(0, 400) }];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [{ code: "PARSE", message: raw.slice(0, 400) }];
    }
  }
}

/** Keep only keys the model actually declares as inputs, scalars only. */
export function sanitizeTestInput(inputObj, declaredInputs) {
  return Object.fromEntries(
    Object.entries(inputObj || {})
      .filter(([k, v]) => declaredInputs.includes(k) && ["number", "boolean", "string"].includes(typeof v))
  );
}

/** Execute one evaluation through the engine. Never throws — errors come back as data. */
export function runDecision(rulesFile, decision, inputObj) {
  try {
    const out = execFileSync(FEELC, ["run", "--rules", rulesFile, "--decision", decision,
      "--input", JSON.stringify(inputObj), "--json"], { encoding: "utf8" });
    const parsed = JSON.parse(out);
    return parsed.output ?? parsed;
  } catch (e) {
    return { __error: (e.stderr || e.stdout || e.message).toString().slice(0, 200) };
  }
}

/** Export .rules → DMN 1.3 XML. @returns {string} stderr warnings ("" when none) */
export function exportDmn(rulesFile, dmnFile) {
  try {
    execFileSync(FEELC, ["export", "--rules", rulesFile, "-o", dmnFile], { stdio: ["ignore", "ignore", "pipe"] });
    return "";
  } catch (e) {
    return (e.stderr || e.message).toString();
  }
}
