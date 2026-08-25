/**
 * tests/api.test.mjs — offline integration suite for server.mjs.
 *
 * Spawns a REAL server instance on an ephemeral port and exercises every API
 * route plus static delivery. All expectations below were HAND-COMPUTED from
 * out/ride_pricing.rules and out/loan_approval.logic, and hostile-input
 * behavior is PINNED to engine behavior discovered via tests/_probe.mjs.
 *
 * No LLM is called anywhere in this suite (compile endpoint intentionally
 * untested here — see tests/_live-compile.mjs) so it is free to re-run.
 *
 * Run: node --test tests/unit.test.mjs tests/api.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Numeric-tolerant assertion used throughout this suite.
assert.approx = (actual, expected, msgOrEps, maybeMsg) => {
  const eps = typeof msgOrEps === "number" ? msgOrEps : 1e-9;
  const msg = typeof msgOrEps === "string" ? msgOrEps : maybeMsg;
  assert.ok(Math.abs(actual - expected) < eps,
    `${msg ? msg + ": " : ""}expected ~${expected}, got ${actual}`);
};

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TESTS_DIR);
const rideRules = readFileSync(path.join(ROOT, "out", "ride_pricing.rules"), "utf8");
const loanRules = readFileSync(path.join(ROOT, "out", "loan_approval.rules"), "utf8");

/* ---------- boot an isolated server ---------- */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}

const PORT = await getFreePort();
const BASE = `http://127.0.0.1:${PORT}`;
const serverLogs = [];

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", d => serverLogs.push(d.toString()));
server.stderr.on("data", d => serverLogs.push(d.toString()));

test.after(() => { try { server.kill("SIGTERM"); } catch { /* already gone */ } });

async function waitForServer(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/presets`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 120));
  }
  throw new Error(`server did not start on ${PORT}; logs:\n${serverLogs.join("")}`);
}
await waitForServer();

async function api(pathname, { method = "GET", body, raw } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  const headers = Object.fromEntries(res.headers.entries());
  if (raw) return { status: res.status, text: await res.text(), headers };
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json, headers };
}

const evalSingle = (rules, input) =>
  api("/api/evaluate-single", { method: "POST", body: { rules, input } });

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

function expectSunny(outputs) {
  assert.equal(outputs.standard_cost, 15.5);
  assert.equal(outputs.multiplier, 1);
  assert.equal(outputs.total_fare, 15.5);
  assert.deepEqual(outputs.surge_outcome,
    { reason: "normal conditions: no surge applied", surge_applied: false });
}

/* ================= PRESETS ================= */

test("GET /api/config advertises the scale-targeted compile policy", async () => {
  const { status, json } = await api("/api/config");
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.maxTokens, Number(process.env.QUERY_MAX_TOKENS || 50000));
  assert.equal(json.compileMaxRounds >= 10, true, "must allow ≥10 LLM rounds");
  assert.equal(json.compileBudgetMinutes >= 30, true, "budget must be ≥30 min");
  assert.equal(json.chatTimeoutMinutes >= 30, true, "per-call patience must be ≥30 min");
  assert.ok(json.promptBytes > 4000, "unified prompt must be loaded (non-trivial size)");
});

test("GET /api/presets returns 4 complete presets", async () => {
  const { status, json } = await api("/api/presets");
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.presets.length, 4);
  const ids = json.presets.map(p => p.id);
  for (const id of ["ride_pricing", "loan_approval", "shipping_rates", "discount_policy"]) {
    assert.ok(ids.includes(id), `missing preset ${id}`);
  }
  for (const p of json.presets) {
    assert.ok(typeof p.spec === "string" && p.spec.length > 40, `${p.id}: spec too short`);
    assert.ok(Array.isArray(p.scenarios) && p.scenarios.length > 0, `${p.id}: no scenarios`);
    for (const sc of p.scenarios) {
      assert.ok(sc.name && sc.input && Object.keys(sc.input).length > 0, `${p.id}: malformed scenario`);
    }
  }
});

/* ================= MODELS ================= */

test("GET /api/models lists saved models with typed manifests", async () => {
  const { status, json } = await api("/api/models");
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  const byId = Object.fromEntries(json.models.map(m => [m.id, m]));

  // Core bundled models exist
  assert.ok(byId.ride_pricing, "ride_pricing missing");
  assert.ok(byId.loan_approval, "loan_approval missing");

  // Decisions enumerated in file order
  assert.deepEqual(byId.ride_pricing.manifest.decisions,
    ["standard_cost", "multiplier", "total_fare", "surge_outcome"]);
  assert.deepEqual(byId.loan_approval.manifest.decisions, ["dti", "approval"]);

  // Typed inputs parsed from declarations (Phase A contract)
  assert.deepEqual(byId.ride_pricing.manifest.typedInputs, [
    { name: "base_fare", type: "number", min: 0 },
    { name: "distance_km", type: "number", min: 0 },
    { name: "rain", type: "boolean" },
    { name: "traffic_level", type: "string", options: ["low", "medium", "high"] },
  ]);
  assert.deepEqual(byId.loan_approval.manifest.typedInputs, [
    { name: "credit_score", type: "number", min: 300, max: 850 },
    { name: "annual_income", type: "number", min: 0 },
    { name: "monthly_debt", type: "number", min: 0 },
    { name: "age", type: "number", min: 0, max: 120 },
  ]);

  // DMN exports exist and look like DMN 1.3
  assert.match(byId.ride_pricing.dmn, /<definitions/);
  assert.match(byId.loan_approval.dmn, /<definitions/);
});

test("spec persistence: UI-compiled model exposes its original NL spec", async () => {
  const { json } = await api("/api/models");
  const m = json.models.find(x => x.id === "my_model_1");
  assert.ok(m, "my_model_1 missing from /api/models");
  assert.ok(typeof m.spec === "string" && m.spec.includes("cart_total"),
    "saved spec.txt was not served back");
  // Models compiled before Phase B legitimately have spec:null — field must exist either way
  for (const model of json.models) assert.ok("spec" in model, `${model.id}: no spec field`);
});

/* ================= EVALUATE-SINGLE — ride_pricing (hand-computed) ================= */
// standard_cost = base_fare + distance_km*1.5 ; multiplier table hit:first ;
// total_fare = standard_cost * multiplier

test("ride_pricing sunny baseline → no surge", async () => {
  const { status, json } = await evalSingle(rideRules,
    { base_fare: 3.5, distance_km: 8, rain: false, traffic_level: "low" });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  expectSunny(json.outputs);
});

test("ride_pricing rain+high → 2.0x surge", async () => {
  const { json } = await evalSingle(rideRules,
    { base_fare: 5, distance_km: 10, rain: true, traffic_level: "high" });
  assert.equal(json.outputs.standard_cost, 20);
  assert.equal(json.outputs.multiplier, 2);
  assert.equal(json.outputs.total_fare, 40);
  assert.deepEqual(json.outputs.surge_outcome,
    { reason: "high traffic and rain: 2.0x surge applied", surge_applied: true });
});

test("ride_pricing dry rush-hour → 1.5x surge", async () => {
  const { json } = await evalSingle(rideRules,
    { base_fare: 4, distance_km: 15, rain: false, traffic_level: "high" });
  assert.equal(json.outputs.standard_cost, 26.5);
  assert.equal(json.outputs.multiplier, 1.5);
  assert.equal(json.outputs.total_fare, 39.75);
  assert.equal(json.outputs.surge_outcome.reason, "high traffic, no rain: 1.5x surge applied");
});

test("ride_pricing rain+medium → 1.2x surge", async () => {
  const { json } = await evalSingle(rideRules,
    { base_fare: 5, distance_km: 12, rain: true, traffic_level: "medium" });
  assert.equal(json.outputs.standard_cost, 23);
  assert.equal(json.outputs.multiplier, 1.2);
  assert.approx(json.outputs.total_fare, 27.6, 1e-9);
  assert.equal(json.outputs.surge_outcome.reason, "rain with medium traffic: 1.2x surge applied");
});

test("ride_pricing all-zero inputs → zero fare", async () => {
  const { json } = await evalSingle(rideRules,
    { base_fare: 0, distance_km: 0, rain: false, traffic_level: "low" });
  assert.equal(json.outputs.standard_cost, 0);
  assert.equal(json.outputs.total_fare, 0);
  assert.equal(json.outputs.surge_outcome.surge_applied, false);
});

/* ================= EVALUATE-SINGLE — loan_approval (boundaries & priority) ================= */
// Row order is age<18 FIRST, then score<580, then dti>0.43, then tiers.

const loanPrime = { credit_score: 750, annual_income: 90000, monthly_debt: 1200, age: 34 };

test("loan prime applicant → fully approved, dti 0.16", async () => {
  const { json } = await evalSingle(loanRules, loanPrime);
  assert.approx(json.outputs.dti, 0.16);
  assert.deepEqual(json.outputs.approval, { approved: true, reason: "approved" });
});

test("age<18 wins over everything (row priority)", async () => {
  // Great score, low debt — still rejected as minor because that row is first
  const { json } = await evalSingle(loanRules,
    { credit_score: 720, annual_income: 40000, monthly_debt: 200, age: 17 });
  assert.deepEqual(json.outputs.approval, { approved: false, reason: "minor" });
});

test("score<580 rejected even with strong finances", async () => {
  const { json } = await evalSingle(loanRules,
    { credit_score: 520, annual_income: 80000, monthly_debt: 500, age: 40 });
  assert.deepEqual(json.outputs.approval, { approved: false, reason: "insufficient score" });
});

test("dti>0.43 rejected as debt too high", async () => {
  const { json } = await evalSingle(loanRules,
    { credit_score: 700, annual_income: 36000, monthly_debt: 1800, age: 45 });
  assert.approx(json.outputs.dti, 0.6); // 1800 / (36000/12)
  assert.deepEqual(json.outputs.approval, { approved: false, reason: "debt too high" });
});

test("near-prime 620 → approved with conditions", async () => {
  const { json } = await evalSingle(loanRules,
    { credit_score: 620, annual_income: 55000, monthly_debt: 1000, age: 29 });
  assert.approx(json.outputs.dti, 1000 / (55000 / 12));
  assert.deepEqual(json.outputs.approval, { approved: true, reason: "approved with conditions" });
});

test("credit-score tier boundaries 579/580/679/680", async () => {
  const base = { annual_income: 60000, monthly_debt: 500, age: 30 }; // dti = 0.1
  const expectOf = (reason) => ({ approved: true, reason });
  const cases = [
    [579, { approved: false, reason: "insufficient score" }],
    [580, expectOf("approved with conditions")],
    [679, expectOf("approved with conditions")],
    [680, expectOf("approved")],
  ];
  for (const [score, expected] of cases) {
    const { json } = await evalSingle(loanRules, { ...base, credit_score: score });
    assert.deepEqual(json.outputs.approval, expected, `credit_score=${score}`);
  }
});

test("age boundary 17 vs 18", async () => {
  const base = { credit_score: 750, annual_income: 60000, monthly_debt: 500 };
  const young = await evalSingle(loanRules, { ...base, age: 17 });
  const adult = await evalSingle(loanRules, { ...base, age: 18 });
  assert.equal(young.json.outputs.approval.reason, "minor");
  assert.equal(adult.json.outputs.approval.reason, "approved");
});

test("zero-income edge cases (dti formula branch)", async () => {
  const noDebt = await evalSingle(loanRules, { credit_score: 600, annual_income: 0, monthly_debt: 0, age: 30 });
  assert.equal(noDebt.json.outputs.dti, 0);
  assert.equal(noDebt.json.outputs.approval.reason, "approved with conditions");

  const withDebt = await evalSingle(loanRules, { credit_score: 600, annual_income: 0, monthly_debt: 2000, age: 30 });
  assert.equal(withDebt.json.outputs.dti, 1); // treated as 100% ratio
  assert.equal(withDebt.json.outputs.approval.reason, "debt too high");
});

/* ================= HOSTILE INPUTS — pinned engine behavior ================= */
// Discovered via tests/_probe.mjs. The engine does NOT validate inputs against
// declared domains/types; undeclared enum values fall into catch-all rows.

test("PINNED: unknown enum option falls into default table row (no error)", async () => {
  const { json } = await evalSingle(rideRules,
    { base_fare: 3.5, distance_km: 8, rain: false, traffic_level: "banana" });
  expectSunny(json.outputs); // same as "low" — catch-all row applies
});

test("PINNED: string where boolean declared falls into default row (no error)", async () => {
  const { json } = await evalSingle(rideRules,
    { base_fare: 3.5, distance_km: 8, rain: "yes", traffic_level: "low" });
  expectSunny(json.outputs);
});

test("PINNED: declared numeric domains are NOT enforced at runtime", async () => {
  const neg = await evalSingle(rideRules,
    { base_fare: -5, distance_km: 8, rain: false, traffic_level: "low" });
  assert.equal(neg.json.outputs.standard_cost, 7); // -5 + 12 computed happily

  const over = await evalSingle(loanRules, { ...loanPrime, credit_score: 900 }); // max 850
  assert.equal(over.json.outputs.approval.reason, "approved");

  const under = await evalSingle(loanRules, { ...loanPrime, credit_score: 200 }); // min 300
  assert.equal(under.json.outputs.approval.reason, "insufficient score");
});

test("missing inputs → every dependent decision reports __error", async () => {
  const { json } = await evalSingle(rideRules, {});
  assert.equal(json.ok, true); // API succeeds; errors arrive as data
  for (const dec of ["standard_cost", "multiplier", "total_fare", "surge_outcome"]) {
    assert.ok(json.outputs[dec]?.__error, `${dec} should carry __error`);
    assert.match(json.outputs[dec].__error, /missing input/);
  }
});

test("KNOWN QUIRK: null input leaks engine envelope instead of value/__error", async () => {
  // runDecision uses `parsed.output ?? parsed`, so an explicit null output
  // returns the WHOLE {decision,output} wrapper. Pinned as a regression
  // sentinel — flip this test when the quirk is fixed.
  const { json } = await evalSingle(rideRules,
    { base_fare: null, distance_km: 8, rain: false, traffic_level: "low" });
  const sc = json.outputs.standard_cost;
  assert.equal(sc.decision, "standard_cost");
  assert.equal(sc.output, null);
  assert.equal(sc.__error, undefined);
  assert.equal(json.outputs.multiplier, 1); // untouched decisions stay clean
});

test("extra unknown keys are ignored", async () => {
  const { json } = await evalSingle(rideRules,
    { base_fare: 3.5, distance_km: 8, rain: false, traffic_level: "low", injected: "<script>alert(1)</script>" });
  expectSunny(json.outputs);
});

/* ================= EVALUATE-BATCH ================= */

test("batch executes preset ride scenarios with exact expected values", async () => {
  const scenarios = [
    { name: "Sunny Day Normal Commute", input: { base_fare: 3.5, distance_km: 8.0, rain: false, traffic_level: "low" } },
    { name: "Rainy Moderate Traffic", input: { base_fare: 5.0, distance_km: 12.0, rain: true, traffic_level: "medium" } },
    { name: "Friday Rush Hour (No Rain)", input: { base_fare: 4.0, distance_km: 15.0, rain: false, traffic_level: "high" } },
    { name: "Downtown Thunderstorm", input: { base_fare: 5.0, distance_km: 10.0, rain: true, traffic_level: "high" } },
  ];
  const { status, json } = await api("/api/evaluate-batch",
    { method: "POST", body: { rules: rideRules, scenarios } });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.total, 4);
  assert.equal(json.passed, 4);
  const [sunny, wetMed, dryRush, storm] = json.results;
  assert.equal(sunny.outputs.total_fare.value, 15.5);
  assert.approx(wetMed.outputs.total_fare.value, 27.6);
  assert.equal(dryRush.outputs.total_fare.value, 39.75);
  assert.equal(storm.outputs.total_fare.value, 40);
  for (const r of json.results) {
    assert.equal(r.passed, true);
    assert.equal(typeof r.latencyMs, "number");
  }
});

test("batch flags failing scenarios but keeps executing the rest", async () => {
  const scenarios = [
    { name: "good", input: { base_fare: 3.5, distance_km: 8, rain: false, traffic_level: "low" } },
    { name: "bad-missing-input", input: { base_fare: 1 } }, // distance etc. missing
    { name: "good-too", input: { base_fare: 5, distance_km: 10, rain: true, traffic_level: "high" } },
  ];
  const { json } = await api("/api/evaluate-batch",
    { method: "POST", body: { rules: rideRules, scenarios } });
  assert.equal(json.total, 3);
  assert.equal(json.passed, 2);
  const bad = json.results.find(r => r.name === "bad-missing-input");
  assert.equal(bad.passed, false);
  assert.ok(bad.outputs.standard_cost.error);
});

test("batch validation: missing rules/scenarios → 400", async () => {
  const noScen = await api("/api/evaluate-batch", { method: "POST", body: { rules: rideRules } });
  assert.equal(noScen.status, 400);
  const noRules = await api("/api/evaluate-batch", { method: "POST", body: { scenarios: [] } });
  assert.equal(noRules.status, 400);
});

/* ================= VERIFY & GRAPH ================= */

test("verify accepts both shipped models as clean", async () => {
  for (const rules of [rideRules, loanRules]) {
    const { status, json } = await api("/api/verify", { method: "POST", body: { rules } });
    assert.equal(status, 200);
    assert.equal(json.clean, true, JSON.stringify(json.issues));
    assert.deepEqual(json.issues, []);
    assert.ok(Array.isArray(json.manifest.decisions) && json.manifest.decisions.length >= 2);
  }
});

test("verify rejects garbage with a structured issue", async () => {
  const { json } = await api("/api/verify",
    { method: "POST", body: { rules: "decision broken :" } });
  assert.equal(json.ok, false);
  assert.equal(json.clean, false);
  assert.ok(json.issues.length >= 1 && json.issues[0].code, "expected coded issue");
});

test("graph endpoint emits mermaid flowchart naming nodes", async () => {
  const { json } = await api("/api/graph", { method: "POST", body: { rules: rideRules } });
  assert.equal(json.ok, true);
  assert.match(json.mermaid, /^flowchart LR/);
  assert.match(json.mermaid, /standard_cost/);
  assert.match(json.mermaid, /surge_outcome/);
});

/* ================= HTTP PLUMBING & STATIC DELIVERY ================= */

test("unknown API route → structured 404", async () => {
  const { status, json } = await api("/api/definitely-not-a-route");
  assert.equal(status, 404);
  assert.equal(json.ok, false);
});

test("malformed JSON body → 500 json error, server stays alive", async () => {
  const bad = await api("/api/evaluate-single", { method: "POST", body: "{not json" });
  assert.equal(bad.status, 500);
  assert.equal(bad.json.ok, false);
  const followUp = await api("/api/presets"); // must not have crashed the process
  assert.equal(followUp.json.ok, true);
});

test("CORS preflight answered 204 with permissive headers", async () => {
  const res = await fetch(`${BASE}/api/models`, { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("index.html served with all new Phase C/D hooks", async () => {
  const { status, text, headers } = await api("/", { raw: true });
  assert.equal(status, 200);
  assert.match(headers["content-type"], /text\/html/);
  for (const hook of ["myModelsSelect", "presetSelect", "newModelBtn",
    "view-input", "templateFormFields", "runTemplateBtn",
    "templateJsonPreview", "sendToBatchBtn"]) {
    assert.ok(text.includes(hook), `index.html lacks ${hook}`);
  }
});

test("app.js and style.css delivered with correct types and new symbols", async () => {
  const js = await api("/app.js", { raw: true });
  assert.equal(js.status, 200);
  assert.match(js.headers["content-type"], /javascript/);
  for (const fn of ["renderTemplateStudio", "handleRunTemplate", "applyLoadedModel",
    "getTypeEntries", "renderDecisionCards", "refreshSavedModelOptions"]) {
    assert.ok(js.text.includes(fn), `app.js lacks ${fn}`);
  }
  const css = await api("/style.css", { raw: true });
  assert.equal(css.status, 200);
  assert.match(css.headers["content-type"], /text\/css/);
  assert.ok(css.text.includes(".input-studio-layout"));
  assert.ok(css.text.includes(".selector-toolbar"));
});

test("SPA fallback: unknown static path serves index.html (documented quirk)", async () => {
  const { status, text, headers } = await api("/this/path/does/not/exist", { raw: true });
  assert.equal(status, 200);
  assert.match(headers["content-type"], /text\/html/);
  assert.ok(text.includes("<!DOCTYPE html>") || text.includes("<html"));
});

/* ================= CONCURRENCY ================= */

test("8 parallel identical evaluations all return exact results", async () => {
  const jobs = Array.from({ length: 8 }, () => evalSingle(rideRules,
    { base_fare: 3.5, distance_km: 8, rain: false, traffic_level: "low" }));
  const responses = await Promise.all(jobs);
  for (const r of responses) {
    assert.equal(r.status, 200);
    expectSunny(r.json.outputs);
  }
});

test("10 parallel MIXED-model evaluations never cross-contaminate", async () => {
  const stormIn = { base_fare: 5, distance_km: 10, rain: true, traffic_level: "high" };
  const jobs = Array.from({ length: 10 }, (_, i) =>
    i % 2 === 0 ? evalSingle(rideRules, stormIn) : evalSingle(loanRules, loanPrime));
  const responses = await Promise.all(jobs);
  responses.forEach((r, i) => {
    assert.equal(r.status, 200, `job ${i}`);
    if (i % 2 === 0) {
      assert.equal(r.json.outputs.total_fare, 40, `ride job ${i} contaminated`);
      assert.equal(r.json.outputs.multiplier, 2);
    } else {
      assert.approx(r.json.outputs.dti, 0.16, `loan job ${i} contaminated`);
      assert.equal(r.json.outputs.approval.reason, "approved");
      assert.equal(r.json.outputs.total_fare, undefined);
    }
  });
});
