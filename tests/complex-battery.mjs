#!/usr/bin/env node
/**
 * tests/complex-battery.mjs — 12-domain complex compile-and-execute battery.
 *
 * For each case: live NL→rules→verify→DMN compile through the RUNNING studio
 * server, then immediate execution of hand-computed scenarios through the
 * engine. Every expectation is derived from the spec's own pinned numbers, so
 * a mismatch means LLM miscompile OR engine bug — generated .rules are kept
 * for diagnosis either way.
 *
 * Compiled models stay in out/ (they are user-facing deliverables).
 * Full machine-readable results → tests/complex-battery-results.json
 *
 * ⚠ SPENDS OPENROUTER CREDITS (12 compiles × ≤3 rounds). User-approved.
 */
const BASE = process.env.STUDIO_BASE || "http://localhost:3088";
const { writeFileSync } = await import("node:fs");
import { CASES } from "./complex-cases.mjs";

/* ---------------- matcher helpers ---------------- */
function* leaves(v) {
  if (v === null || v === undefined || typeof v !== "object") { yield v; return; }
  if ("__error" in v) return;
  for (const x of Object.values(v)) yield* leaves(x);
}
function approx(a, b) { return typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b; }
/** check: {field,value} any object leaf having that field ≈ value | {value} any leaf ≈ value */
function satisfied(check, outputs) {
  const wantField = check.field;
  for (const out of Object.values(outputs)) {
    if (out === null || typeof out !== "object") continue;
    if (wantField) {
      const got = out[wantField];
      if (got !== undefined && approx(got, check.value)) return true;
    } else {
      for (const leaf of leaves(out)) if (approx(leaf, check.value)) return true;
    }
  }
  return false;
}

/* ---------------- runner ---------------- */
async function jfetch(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

console.log(`\n🧪 COMPLEX BATTERY — ${CASES.length} domains vs ${BASE}`);
const pre = await jfetch("/api/presets");
if (!pre.json?.ok) { console.error("Studio server not reachable — aborting."); process.exit(1); }
console.log(`   model: ${pre.json.model}\n`);

const results = [];
for (const [idx, c] of CASES.entries()) {
  const R = { id: c.id, kind: c.kind, compileMs: 0, rounds: 0, ok: false,
              dmnBytes: 0, warnings: null, issues: null,
              scenariosTotal: c.checks.length, semanticPassed: 0, execLatencies: [], note: "" };
  process.stdout.write(`[${String(idx + 1).padStart(2, "0")}/${CASES.length}] ${c.id} (${c.kind.split("—")[0].trim()}) … `);
  const t0 = Date.now();
  try {
    const comp = await jfetch("/api/compile", { name: c.id, spec: c.spec });
    R.compileMs = Date.now() - t0;
    if (!comp.json?.ok) {
      R.rounds = comp.json?.rounds ?? 0;
      R.issues = (comp.json?.issues || []).map(i => `${i.code}: ${String(i.message).slice(0, 110)}`);
      console.log(`✗ COMPILE FAILED after ${R.rounds} rounds (${(R.compileMs / 1000).toFixed(1)}s)`);
      results.push(R); continue;
    }
    R.ok = true; R.rounds = comp.json.rounds; R.warnings = comp.json.warnings;
    R.dmnBytes = comp.json.dmn ? comp.json.dmn.length : 0;

    // execute immediately — compiled rules straight from the compile response
    const batch = await jfetch("/api/evaluate-batch", {
      rules: comp.json.rules,
      scenarios: c.checks.map(k => ({ name: k.name, input: k.input })),
    });
    if (!batch.json?.ok) { R.note = `batch endpoint failed: ${batch.json?.error}`; console.log(`✗ BATCH FAIL`); results.push(R); continue; }

    let hardErrors = 0;
    for (const [i, r] of batch.json.results.entries()) {
      R.execLatencies.push(r.latencyMs);
      const outs = Object.fromEntries(Object.entries(r.outputs).map(([k, v]) => [k, v && v.__error ? { __error: true } : v]));
      if (Object.values(r.outputs).some(v => v && v.__error)) hardErrors++;
      const failedChecks = c.checks[i].expect.filter(ch => !satisfied(ch, r.outputs));
      if (!failedChecks.length && !(r.outputs && Object.values(r.outputs).some(v => v && v.__error))) R.semanticPassed++;
      else if (!R.badScenarios) R.badScenarios = [];
      if (failedChecks.length) R.badScenarios.push({
        scenario: c.checks[i].name, input: c.checks[i].input,
        expected: failedChecks.map(f => ({ [f.field || "(any leaf)"]: f.value })),
        actual: r.outputs,
      });
    }
    R.hardErrorScenarios = hardErrors;
    const avg = ms => ms.length ? (ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1) : "–";
    console.log(`${R.semanticPassed}/${c.checks.length} checks ✓ · ${R.rounds} round(s) · ${(R.compileMs / 1000).toFixed(1)}s · exec avg ${avg(R.execLatencies)}ms`);
  } catch (e) {
    R.note = e.message;
    console.log(`✗ DRIVER ERROR: ${e.message}`);
  }
  results.push(R);
}

/* ---------------- summary ---------------- */
const okN = results.filter(r => r.ok).length;
const checksOnOk = results.filter(r => r.ok).reduce((a, r) => a + r.scenariosTotal, 0);
const passedN = results.filter(r => r.ok).reduce((a, r) => a + r.semanticPassed, 0);
const roundsOf = results.filter(r => r.ok).map(r => r.rounds);
const compS = results.filter(r => r.ok).map(r => r.compileMs / 1000);
const lat = results.filter(r => r.ok).flatMap(r => r.execLatencies);
const stat = (a) => a.length ? `${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(a[0] > 50 ? 0 : 2)}${typeof a[0] === "number" && a[0] > 50 ? "s" : ""} avg` : "–";

console.log(`\n${"═".repeat(74)}
📊 SUMMARY
   compiled OK        : ${okN}/${CASES.length}
   rounds used        : ${roundsOf.join(", ") || "–"}  (1 = clean first draft)
   semantic accuracy  : ${passedN}/${checksOnOk} scenario checks on compiled models
   engine exec latency: min ${Math.min(...lat).toFixed(1)}ms · max ${Math.max(...lat).toFixed(1)}ms · ${stat(lat)}
   DMN exported       : ${results.filter(r => r.dmnBytes > 0).length}/${okN} · total ${(results.reduce((a, r) => a + r.dmnBytes, 0) / 1024).toFixed(1)} KB
${"═".repeat(74)}\n`);

writeFileSync(new URL("./complex-battery-results.json", import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, results }, null, 2));
console.log("full details → tests/complex-battery-results.json");
