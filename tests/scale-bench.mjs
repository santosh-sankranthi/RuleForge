#!/usr/bin/env node
/**
 * scale-bench.mjs — scale benchmark runner for 50..500-rule specs.
 *
 * FREE (no LLM):   node tests/scale-bench.mjs --selftest
 * PAID (LLM):      node tests/scale-bench.mjs --sizes 50,100 [--scenarios 5] [--port 3088]
 *
 * Paid mode POSTs each generated spec to /api/compile (server must be running),
 * then /api/evaluate-batch with generated scenarios and scores engine outputs
 * against the generator's expectation engine (tolerance 1e-6 money).
 * Per-call HTTP patience: 35 min (stdlib transport — no undici 300 s cap).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requestJson } from "../copilot-lib.mjs";
import { genScaleCase } from "./scale-cases.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_JSON = path.join(ROOT, "tests", "scale-results.json");
const CALL_TIMEOUT_MS = 35 * 60 * 1000;

/* ---------------- CLI ---------------- */
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const SELFTEST = args.includes("--selftest");
const SIZES = (flag("sizes", "50,100,250,500")).split(",").map(Number).filter(Boolean);
const PORT = Number(flag("port", process.env.PORT || 3088));
const N_SCENARIOS = Number(flag("scenarios", 5));
const BASE = `http://127.0.0.1:${PORT}`;

/* ---------------- scoring (contract: unwrap {value}|{error}; object-field then scalar; 1e-6) ---- */
const unwrap = (v) => (v && typeof v === "object" && "value" in v) ? v.value
  : (v && typeof v === "object" && "error" in v) ? { __error: String(v.error) } : v;

function scoreScenario(expect, outputs) {
  const results = {};
  for (const [field, want] of Object.entries(expect)) {
    let got;
    for (const dec of Object.keys(outputs)) {
      const val = unwrap(outputs[dec]);
      if (val?.__error) continue;
      if (val && typeof val === "object" && field in val) { got = val[field]; break; }
    }
    if (got === undefined) {
      for (const dec of Object.keys(outputs)) {          // scalar/boolean sink fallback
        if (dec === field) { got = unwrap(outputs[dec]); break; }
      }
    }
    if (typeof want === "boolean") results[field] = { want, got: got === undefined ? null : Boolean(got), ok: got !== undefined && Boolean(got) === want };
    else results[field] = { want, got: got === undefined ? null : got, ok: got !== undefined && Math.abs(Number(got) - Number(want)) <= 1e-6 };
  }
  return results;
}

/* ---------------- free self-test ---------------- */
async function selftest() {
  console.log("== scale-cases self-test (free, no LLM) ==");
  let failures = 0;
  const check = (cond, msg) => { console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${msg}`); if (!cond) failures++; };

  for (const n of [50, 100, 250, 500]) {
    const a = genScaleCase(n, 42);
    const b = genScaleCase(n, 42);
    check(a.spec === b.spec, `${n}: deterministic (same seed ⇒ identical spec)`);

    const numbered = [...a.spec.matchAll(/- Rule (\d+):/g)].map(m => Number(m[1]));
    check(numbered.length === n, `${n}: exactly ${n} numbered rules rendered (got ${numbered.length})`);
    check(numbered.every((v, i) => v === i + 1), `${n}: rule numbers are 1..${n} contiguous`);

    // scenario inputs inside declared domains; expectations finite & consistent
    let domainOk = true, expectOk = true;
    for (const sc of a.scenarios) {
      for (const [k, v] of Object.entries(sc.input)) {
        const d = a.inputs[k];
        if (!d) { domainOk = false; continue; }
        if (d.type === "number" && (v < d.min || v > d.max)) domainOk = false;
        if (d.type === "string" && !d.options.includes(v)) domainOk = false;
        if (d.type === "boolean" && typeof v !== "boolean") domainOk = false;
      }
      const e = sc.expect;
      if (!(Number.isFinite(e.final_price) && e.final_price >= 0 && typeof e.review_required === "boolean")) expectOk = false;
    }
    check(domainOk, `${n}: all scenario inputs respect declared domains`);
    check(expectOk, `${n}: expectations finite, non-negative, boolean flags`);
    check(a.scenarios.length === 5, `${n}: 5 scenarios built`);
  }

  // semantic sanity: lapsed policy zeroes out, spec is substantive
  const c = genScaleCase(100, 7);
  const lapsed = c.scenarios.find(s => s.name.includes("lapsed"));
  check(lapsed && lapsed.expect.final_price === 0 && lapsed.expect.review_required === false,
    "100: lapsed-policy scenario expects exact zero-out");
  check(c.spec.length > 3000, `100: spec is substantive (${c.spec.length} bytes)`);

  console.log(failures === 0 ? "\nSELF-TEST PASS ✅" : `\nSELF-TEST FAIL ❌ (${failures})`);
  return failures;
}

/* ---------------- paid run ---------------- */
async function run() {
  console.log(`== scale benchmark (PAID) · sizes ${SIZES.join(", ")} · server ${BASE} ==`);
  const rows = [];
  for (const n of SIZES) {
    const t0 = Date.now();
    const c = genScaleCase(n, 42);
    process.stdout.write(`[${c.name}] compiling (${(c.spec.length / 1024).toFixed(1)} KB spec)... `);
    let compileRes;
    try {
      const res = await requestJson(`${BASE}/api/compile`, { "Content-Type": "application/json" },
        JSON.stringify({ spec: c.spec, name: c.name }), { timeoutMs: CALL_TIMEOUT_MS });
      compileRes = JSON.parse(res.text);
    } catch (e) {
      rows.push({ name: c.name, nRules: n, compiled: false, phase: "transport", error: String(e.message || e).slice(0, 200), ms: Date.now() - t0 });
      console.log(`TRANSPORT FAIL: ${e.message}`);
      continue;
    }
    const compileMs = Date.now() - t0;
    if (!compileRes.ok) {
      rows.push({ name: c.name, nRules: n, compiled: false, phase: "verify", error: compileRes.error, rounds: compileRes.rounds, history: compileRes.history, ms: compileMs });
      console.log(`COMPILE FAIL after ${compileRes.rounds} rounds (${(compileMs / 1000).toFixed(0)}s)`);
      continue;
    }
    console.log(`ok in ${(compileMs / 1000).toFixed(0)}s · ${compileRes.rounds} round(s) · ${(compileRes.rules.split("\n").length)} lines`);

    const scen = c.scenarios.slice(0, N_SCENARIOS);
    const evalT0 = Date.now();
    const evalRes = JSON.parse((await requestJson(`${BASE}/api/evaluate-batch`, { "Content-Type": "application/json" },
      JSON.stringify({ rules: compileRes.rules, scenarios: scen.map(s => ({ name: s.name, input: s.input })) }),
      { timeoutMs: 120_000 })).text);

    let checksPassed = 0, checksTotal = 0;
    const detail = [];
    evalRes.results?.forEach((r, i) => {
      const scored = scoreScenario(scen[i].expect, r.outputs || {});
      checksTotal += Object.keys(scored).length;
      checksPassed += Object.values(scored).filter(s => s.ok).length;
      detail.push({ scenario: scen[i].name, scored });
    });
    rows.push({
      name: c.name, nRules: n, compiled: true,
      rounds: compileRes.rounds, elapsedMs: compileRes.elapsedMs, lines: compileRes.rules.split("\n").length,
      decisions: compileRes.manifest.decisions.length,
      evalMs: Date.now() - evalT0, checksPassed, checksTotal, detail,
    });
    console.log(`  semantics: ${checksPassed}/${checksTotal} exact`);
  }

  writeFileSync(OUT_JSON, JSON.stringify({ sizes: SIZES, rows }, null, 2));
  console.log(`\nwrote ${path.relative(process.cwd(), OUT_JSON)}`);
  const summary = rows.map(r => `${r.name}: ${r.compiled ? `✅ compiled, ${r.checksPassed}/${r.checksTotal} exact` : "❌ not compiled"}`);
  console.log(summary.join("\n"));
}

if (SELFTEST) selftest().then(f => process.exit(f ? 1 : 0));
else run().catch(e => { console.error("runner crashed:", e); process.exit(1); });
