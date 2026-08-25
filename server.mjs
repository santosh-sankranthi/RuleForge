#!/usr/bin/env node
/**
 * server.mjs — Backend server for the NL→DMN Copilot Studio & Test Workbench.
 *
 * Exposes REST endpoints for:
 *   - Compiling NL specs to formally verified .rules + OMG DMN 1.3 XML
 *   - SMT verification & diagnostics
 *   - Batch multi-scenario test execution
 *   - Single-input live evaluation
 *   - Static web workbench UI delivery
 */
import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  ROOT, FEELC, MODEL, MAX_TOKENS, CHAT_TIMEOUT_MS, loadApiKey, loadLlmConfig, chat, extractRules, verify,
  parseDecisions, parseInputs, parseModelManifest, runDecision, exportDmn,
  CreditError, TruncationError, LlmError, isNetworkError,
} from "./copilot-lib.mjs";

const PORT = Number(process.env.PORT || 3088);
const PUBLIC_DIR = path.join(ROOT, "public");
const OUT_DIR = path.join(ROOT, "out");
const TMP_DIR = path.join(ROOT, "out", ".tmp");
const ROUNDS_DIR = path.join(OUT_DIR, ".rounds");   // per-round draft snapshots (hidden from My Models listing)
const PROMPT_FILE = path.join(ROOT, "prompts", "feelc-copilot.prompt.md");

/* ---------------- compile policy (user-directed scale targets) ---------------- */
/** Total LLM rounds per compile: 1 draft + up to N-1 repairs. Default 12 (user asked for ≥10 retries). */
const COMPILE_MAX_ROUNDS = () => Number(process.env.COMPILE_MAX_ROUNDS || 12);
/** Wall-clock budget for a whole compile; a new LLM round is never STARTED past it. Default 30 min. */
const COMPILE_BUDGET_MS = () => Number(process.env.COMPILE_BUDGET_MS || 30 * 60 * 1000);

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

/* ---------------- presets database ---------------- */
const PRESETS = [
  {
    id: "ride_pricing",
    title: "🚖 Ride-Sharing Surge Pricing",
    category: "Mobility & Transport",
    spec: `Ride-sharing surge pricing rules:

Inputs:
- base_fare: number in euros (>= 0)
- distance_km: number (>= 0)
- rain: boolean (true or false)
- traffic_level: text ("low", "medium", "high")

Rules:
- Standard cost is base_fare + (distance_km * 1.5).
- If traffic_level is "high" and rain is true, apply a 2.0x surge multiplier.
- If traffic_level is "high" and rain is false, apply a 1.5x surge multiplier.
- If rain is true but traffic_level is "medium", apply a 1.2x surge multiplier.
- In all other normal conditions, multiplier is 1.0x.

Output:
- total_fare (number)
- surge_applied (boolean)
- reason (text)`,
    scenarios: [
      { name: "Sunny Day Normal Commute", input: { base_fare: 3.5, distance_km: 8.0, rain: false, traffic_level: "low" } },
      { name: "Rainy Moderate Traffic", input: { base_fare: 5.0, distance_km: 12.0, rain: true, traffic_level: "medium" } },
      { name: "Friday Rush Hour (No Rain)", input: { base_fare: 4.0, distance_km: 15.0, rain: false, traffic_level: "high" } },
      { name: "Downtown Thunderstorm (Rain + High Traffic)", input: { base_fare: 5.0, distance_km: 10.0, rain: true, traffic_level: "high" } },
    ]
  },
  {
    id: "loan_approval",
    title: "🏦 Loan & Credit Approval",
    category: "Financial Services",
    spec: `Loan approval decision rules:

Inputs:
- credit_score: number in [300..850]
- annual_income: number (>= 0)
- monthly_debt: number (>= 0)
- age: number in [0..120]

Rules:
- Reject any applicant younger than 18 as a minor.
- Reject any applicant whose credit score is below 580 due to insufficient score.
- If the applicant's total monthly debt payments are more than 43% of their gross monthly income, reject for debt too high. If income is zero but they have debt, treat that as 100% ratio.
- Applicants with a credit score from 580 up to but not including 680, who pass the debt check and age check, are approved with conditions.
- Applicants with a credit score of 680 or above, who pass the debt and age checks, are fully approved.
- Any case not covered by the above is rejected as not covered.

Output:
- approved (boolean)
- reason (text)`,
    scenarios: [
      { name: "Prime Credit Tier (High Income)", input: { credit_score: 750, annual_income: 90000, monthly_debt: 1200, age: 34 } },
      { name: "Near-Prime Conditional", input: { credit_score: 620, annual_income: 55000, monthly_debt: 1000, age: 29 } },
      { name: "Underage Applicant", input: { credit_score: 720, annual_income: 40000, monthly_debt: 200, age: 17 } },
      { name: "High Debt-to-Income", input: { credit_score: 700, annual_income: 36000, monthly_debt: 1800, age: 45 } },
      { name: "Subprime Credit Score", input: { credit_score: 520, annual_income: 80000, monthly_debt: 500, age: 40 } },
    ]
  },
  {
    id: "shipping_rates",
    title: "📦 E-Commerce Shipping Calculator",
    category: "Logistics",
    spec: `Shipping cost decision for an online store:

Inputs:
- zone: text ("domestic" or "international")
- weight_kg: number (>= 0)

Rules:
- Domestic packages up to 10 kg cost 5 euros base. Domestic packages heavier than 10 kg cost 12 euros.
- International packages up to 10 kg cost 20 euros base. International packages heavier than 10 kg cost 45 euros.
- Any order with total weight above 30 kg is refused regardless of zone: status is "refused" and cost is 0.

Output:
- shipping_cost (number)
- status (text: "shippable" or "refused")`,
    scenarios: [
      { name: "Lightweight Domestic Parcel", input: { zone: "domestic", weight_kg: 2.5 } },
      { name: "Heavy Domestic Package", input: { zone: "domestic", weight_kg: 18.0 } },
      { name: "Standard International Airmail", input: { zone: "international", weight_kg: 4.0 } },
      { name: "Heavy International Freight", input: { zone: "international", weight_kg: 14.0 } },
      { name: "Overweight Package (> 30kg)", input: { zone: "international", weight_kg: 38.0 } },
    ]
  },
  {
    id: "discount_policy",
    title: "🏷️ Customer Loyalty & Tier Discount",
    category: "Retail & Sales",
    spec: `Customer loyalty discount policy:

Inputs:
- tier: text ("gold", "silver", "bronze")
- purchase_amount: number (>= 0)

Rules:
- Gold customers always get at least 15 percent discount.
- Silver customers get 10 percent discount.
- Bronze customers get 0 percent discount.
- On top of the tier discount, if the purchase amount exceeds 500 euros, add an extra 5 percentage points.
- Cap the final discount at 25 percentage points.

Output:
- discount_percent (number)
- tier_applied (text)`,
    scenarios: [
      { name: "Gold Member (Large Order > €500)", input: { tier: "gold", purchase_amount: 850 } },
      { name: "Gold Member (Small Order)", input: { tier: "gold", purchase_amount: 120 } },
      { name: "Silver Member (Large Order > €500)", input: { tier: "silver", purchase_amount: 600 } },
      { name: "Bronze Member (Normal Order)", input: { tier: "bronze", purchase_amount: 250 } },
    ]
  }
];

/* ---------------- unified prompt ---------------- */
/**
 * Single source of truth for ALL LLM interaction: grammar, hard bans, factor-table
 * architecture, scale discipline, self-check list and repair codebook live in ONE
 * deterministic document — used verbatim as the system prompt for drafting AND every
 * repair round. Re-read per request so it can be tuned live without a server restart.
 */
function loadPrompt() {
  try {
    return readFileSync(PROMPT_FILE, "utf8");
  } catch (e) {
    throw new Error(`Unified prompt missing at ${PROMPT_FILE}: ${e.message}`);
  }
}

/** Repair turn: verifier issues + pointer to the in-prompt codebook. No ad-hoc hint patching here. */
const repairTurn = (issues) => `The feelc verifier rejected the previous model with these issues:\n${JSON.stringify(issues)}\n\nApply the REPAIR CODEBOOK (Section 7 of your instructions) to each issue code, run the Section 6 self-check, then return the FULL corrected .rules file as one fenced block.`;

/* ---------------- request router ---------------- */
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // API endpoints
  if (pathname.startsWith("/api/")) {
    try {
      if (req.method === "GET" && pathname === "/api/presets") {
        sendJson(res, { ok: true, presets: PRESETS, model: MODEL() });
        return;
      }

      // Compile-policy introspection: the UI (and tests) can display honest limits.
      if (req.method === "GET" && pathname === "/api/config") {
        const llmCfg = loadLlmConfig();
        sendJson(res, {
          ok: true,
          provider: llmCfg.provider,
          model: llmCfg.model,
          endpoint: llmCfg.url ? llmCfg.url.replace(/\?.*$/, "") : "",
          maxTokens: MAX_TOKENS(),
          chatTimeoutMinutes: Math.round(CHAT_TIMEOUT_MS() / 60000),
          compileMaxRounds: COMPILE_MAX_ROUNDS(),
          compileBudgetMinutes: Math.round(COMPILE_BUDGET_MS() / 60000),
          promptFile: "prompts/feelc-copilot.prompt.md",
          promptBytes: existsSync(PROMPT_FILE) ? readFileSync(PROMPT_FILE, "utf8").length : 0,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/models") {
        const files = existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter(f => f.endsWith(".rules")) : [];
        const models = files.map(f => {
          const name = f.replace(/\.rules$/, "");
          const rulesPath = path.join(OUT_DIR, f);
          const dmnPath = path.join(OUT_DIR, `${name}.dmn`);
          const specPath = path.join(OUT_DIR, `${name}.spec.txt`);
          const src = readFileSync(rulesPath, "utf8");
          const manifest = parseModelManifest(src);
          return {
            id: name,
            name,
            rules: src,
            dmn: existsSync(dmnPath) ? readFileSync(dmnPath, "utf8") : null,
            // Original natural-language spec, when the model was compiled through this server
            spec: existsSync(specPath) ? readFileSync(specPath, "utf8") : null,
            manifest,
          };
        });
        sendJson(res, { ok: true, models });
        return;
      }

      if (req.method === "POST" && pathname === "/api/compile") {
        const body = await parseBody(req);
        const { spec, name = "custom_model" } = body;
        if (!spec || !spec.trim()) {
          sendJson(res, { ok: false, error: "Specification text is required" }, 400);
          return;
        }

        const modelName = name.toLowerCase().replace(/[^a-z0-9_]/g, "_") || "model";
        const apiKey = loadApiKey();
        const rulesFile = path.join(OUT_DIR, `${modelName}.rules`);
        const dmnFile = path.join(OUT_DIR, `${modelName}.dmn`);
        const maxRounds = COMPILE_MAX_ROUNDS();
        const budgetMs = COMPILE_BUDGET_MS();
        mkdirSync(path.join(ROUNDS_DIR, modelName), { recursive: true });

        // ONE unified system prompt for drafting AND every repair round (no ad-hoc patching).
        let messages = [
          { role: "system", content: loadPrompt() },
          { role: "user", content: `Write the complete feelc .rules model for these business rules:\n\n${spec}\n\nOutput ONLY the .rules file content.` },
        ];
        let issues = [];
        let clean = false;
        let finalRules = "";
        let roundsRun = 0;
        let stopReason = null;
        const history = [];
        const t0 = performance.now();

        for (let round = 1; round <= maxRounds && !clean; round++) {
          // Never START a new LLM round past the wall-clock budget; the in-flight round always finishes.
          if (round > 1 && performance.now() - t0 > budgetMs) {
            stopReason = `compile time budget of ${Math.round(budgetMs / 60000)} min exhausted before round ${round}`;
            break;
          }
          roundsRun = round;
          try {
            const draft = extractRules(await chat(messages, { apiKey }));
            finalRules = draft;
            writeFileSync(rulesFile, draft);
            writeFileSync(path.join(ROUNDS_DIR, modelName, `round-${round}.rules`), draft);
            issues = verify(rulesFile);
            history.push({
              round,
              outcome: issues.length ? "verifier_issues" : "clean",
              issueCodes: [...new Set(issues.map(i => i.code))],
              elapsedMs: Math.round(performance.now() - t0),
            });
            if (issues.length === 0) { clean = true; break; }
            messages.push({ role: "assistant", content: draft }, { role: "user", content: repairTurn(issues) });
          } catch (e) {
            if (e instanceof CreditError) throw e;   // never burn repair rounds on an empty wallet
            if (e instanceof TruncationError) {
              history.push({ round, outcome: "truncated", elapsedMs: Math.round(performance.now() - t0) });
              messages.push(
                { role: "assistant", content: "(previous reply omitted — it was cut off at the token ceiling)" },
                { role: "user", content: "Your previous answer was cut off before the closing fence. Re-emit the COMPLETE .rules model as ONE fenced block — more compact formatting (short string literals, tight table spacing), but still EVERY rule from the specification." },
              );
            } else if (isNetworkError(e)) {
              // Transport-level failure mid-round: conversation state is unchanged, so simply retry this round.
              history.push({ round, outcome: "network_retry", error: String(e.message || e).slice(0, 160), elapsedMs: Math.round(performance.now() - t0) });
              round--; // retry same round without advancing conversation state
            } else if (e instanceof LlmError) {
              history.push({ round, outcome: "invalid_output", elapsedMs: Math.round(performance.now() - t0) });
              messages.push({ role: "user", content: "That was not a valid .rules model. Return ONLY the full .rules file content in one fenced block." });
            } else {
              throw e;
            }
          }
        }

        if (!clean) {
          sendJson(res, {
            ok: false,
            error: stopReason || `Model failed SMT verification after ${roundsRun} round(s)`,
            rules: finalRules,
            issues,
            rounds: roundsRun,
            stopReason,
            history,
            elapsedMs: Math.round(performance.now() - t0),
            config: { maxRounds, budgetMinutes: Math.round(budgetMs / 60000), maxTokens: MAX_TOKENS() },
          }, stopReason ? 408 : 422);
          return;
        }

        const warnings = exportDmn(rulesFile, dmnFile);
        const dmnContent = existsSync(dmnFile) ? readFileSync(dmnFile, "utf8") : "";
        const manifest = parseModelManifest(finalRules);

        // Persist the original natural-language spec so "My Models" can restore it for re-editing.
        try { writeFileSync(path.join(OUT_DIR, `${modelName}.spec.txt`), spec); } catch { /* non-fatal */ }

        sendJson(res, {
          ok: true,
          name: modelName,
          rules: finalRules,
          dmn: dmnContent,
          spec,
          manifest,
          rounds: roundsRun,
          history,
          elapsedMs: Math.round(performance.now() - t0),
          config: { maxRounds, budgetMinutes: Math.round(budgetMs / 60000), maxTokens: MAX_TOKENS() },
          warnings: warnings || null,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/verify") {
        const body = await parseBody(req);
        const { rules } = body;
        if (!rules) {
          sendJson(res, { ok: false, error: "Rules content required" }, 400);
          return;
        }

        const tmpFile = path.join(TMP_DIR, `verify_${Date.now()}.rules`);
        writeFileSync(tmpFile, rules);
        const issues = verify(tmpFile);
        const manifest = parseModelManifest(rules);
        sendJson(res, { ok: issues.length === 0, clean: issues.length === 0, issues, manifest });
        return;
      }

      if (req.method === "POST" && pathname === "/api/evaluate-batch") {
        const body = await parseBody(req);
        const { rules, scenarios = [] } = body;
        if (!rules || !scenarios.length) {
          sendJson(res, { ok: false, error: "Rules and scenarios array required" }, 400);
          return;
        }

        const tmpFile = path.join(TMP_DIR, `eval_${Date.now()}.rules`);
        writeFileSync(tmpFile, rules);

        const manifest = parseModelManifest(rules);
        const allDecisions = manifest.decisions;
        const results = [];

        for (let i = 0; i < scenarios.length; i++) {
          const sc = scenarios[i];
          const name = sc.name || `Scenario #${i + 1}`;
          const input = sc.input || sc;
          const t0 = performance.now();

          const decisionResults = {};
          let hasError = false;

          for (const dec of allDecisions) {
            const out = runDecision(tmpFile, dec, input);
            if (out && out.__error) {
              hasError = true;
              decisionResults[dec] = { error: out.__error };
            } else {
              decisionResults[dec] = { value: out };
            }
          }

          const ms = Number((performance.now() - t0).toFixed(2));
          results.push({
            id: i + 1,
            name,
            input,
            outputs: decisionResults,
            latencyMs: ms,
            passed: !hasError,
          });
        }

        sendJson(res, { ok: true, manifest, results, total: results.length, passed: results.filter(r => r.passed).length });
        return;
      }

      if (req.method === "POST" && pathname === "/api/evaluate-single") {
        const body = await parseBody(req);
        const { rules, input } = body;
        if (!rules || !input) {
          sendJson(res, { ok: false, error: "Rules and input required" }, 400);
          return;
        }

        const tmpFile = path.join(TMP_DIR, `single_${Date.now()}.rules`);
        writeFileSync(tmpFile, rules);

        const manifest = parseModelManifest(rules);
        const decisionResults = {};
        const t0 = performance.now();

        for (const dec of manifest.decisions) {
          const out = runDecision(tmpFile, dec, input);
          decisionResults[dec] = out;
        }

        const ms = Number((performance.now() - t0).toFixed(2));
        sendJson(res, { ok: true, outputs: decisionResults, latencyMs: ms });
        return;
      }

      if (req.method === "POST" && pathname === "/api/graph") {
        const body = await parseBody(req);
        const { rules } = body;
        const tmpFile = path.join(TMP_DIR, `graph_${Date.now()}.rules`);
        writeFileSync(tmpFile, rules);
        try {
          const out = execFileSync(FEELC, ["graph", "--rules", tmpFile, "--format", "mermaid"], { encoding: "utf8" });
          sendJson(res, { ok: true, mermaid: out });
        } catch (e) {
          sendJson(res, { ok: false, error: e.message });
        }
        return;
      }

      sendJson(res, { ok: false, error: "API endpoint not found" }, 404);
      return;
    } catch (err) {
      console.error("API error:", err);
      if (err instanceof CreditError) {
        sendJson(res, { ok: false, error: err.message, credits: true }, 402);
        return;
      }
      sendJson(res, { ok: false, error: err.message || "Internal server error" }, 500);
      return;
    }
  }

  // Static files server
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (!existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found");
  }
});

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

/* Long-request hygiene: compiles legitimately run up to COMPILE_BUDGET_MS, so the
 * incoming-request timeouts must comfortably exceed that (Node defaults would cut
 * connections at 300 s). Response phase has no server-side timeout. */
server.headersTimeout = COMPILE_BUDGET_MS() + 120_000;
server.requestTimeout = COMPILE_BUDGET_MS() + 120_000;
server.keepAliveTimeout = 75_000;

server.listen(PORT, "0.0.0.0", () => {
  const llmCfg = loadLlmConfig();
  console.log(`\n✨ DMN Copilot Studio & Test Workbench is LIVE!`);
  console.log(`🔗 Local URL : http://localhost:${PORT}`);
  console.log(`🤖 Provider  : ${llmCfg.provider.toUpperCase()} (${llmCfg.model})`);
  if (llmCfg.url) console.log(`🌐 Endpoint  : ${llmCfg.url.replace(/\?.*$/, "")}`);
  console.log(`⚙️ Limits    : max_tokens ${MAX_TOKENS()} · ${CHAT_TIMEOUT_MS() / 60000} min/call`);
  console.log(`🔁 Compiles  : up to ${COMPILE_MAX_ROUNDS()} rounds within a ${COMPILE_BUDGET_MS() / 60000} min budget`);
  console.log(`📜 Prompt    : prompts/feelc-copilot.prompt.md (unified, engine-verified)`);
  console.log(`⚡ Engine    : ${FEELC}\n`);
});
