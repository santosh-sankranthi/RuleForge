#!/usr/bin/env node
/**
 * tests/complex-eval-fix.mjs — offline re-scorer for the complex battery.
 *
 * The battery's first-pass matcher forgot that /api/evaluate-batch wraps each
 * decision as {value}|{error}, so semantic counts were bogus. This script
 * re-runs ONLY execution+scoring against the already-compiled models in
 * out/<id>.rules — NO LLM calls, zero credit cost.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES } from "./complex-cases.mjs";

const BASE = process.env.STUDIO_BASE || "http://localhost:3088";
const ROOT = dirname(fileURLToPath(import.meta.url)); // tests/
const OUT = join(dirname(ROOT), "out");

/* ---- corrected helpers: unwrap {value}|{error} envelope first ---- */
const unwrap = (outputs) =>
  Object.fromEntries(Object.entries(outputs || {}).map(([k, v]) => [
    k, v && typeof v === "object" && "value" in v ? v.value
     : v && typeof v === "object" && "error" in v ? { __error: true } : v,
  ]));

function* leaves(v) {
  if (v === null || v === undefined || typeof v !== "object") { yield v; return; }
  if ("__error" in v) return;
  for (const x of Object.values(v)) yield* leaves(x);
}
const approx = (a, b) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b;

/** {field,value}: some object leaf has field ≈ value (fallback: some bare leaf ≈ value)
 *  {value}:      some leaf anywhere ≈ value */
function satisfied(check, unwrapped) {
  for (const out of Object.values(unwrapped)) {
    if (out !== null && typeof out === "object" && !("__error" in out)) {
      if (check.field && out[check.field] !== undefined && approx(out[check.field], check.value)) return true;
    }
  }
  for (const leaf of leaves(unwrapped)) {
    if (!check.field && approx(leaf, check.value)) return true;
  }
  // scalar sink fallback for field checks: single-number decision equal to value
  if (check.field) {
    const scalars = [...leaves(unwrapped)].filter(v => typeof v !== "object");
    return scalars.some(v => approx(v, check.value));
  }
  return false;
}

async function jfetch(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return json;
}

console.log(`\n🔍 OFFLINE RE-SCORE of ${CASES.length} compiled models vs ${BASE}\n`);
const scored = [];
for (const c of CASES) {
  const rulesPath = join(OUT, `${c.id}.rules`);
  if (!existsSync(rulesPath)) {
    console.log(`✗ ${c.id.padEnd(16)} no compiled model — skipped`);
    scored.push({ id: c.id, missing: true });
    continue;
  }
  const rules = readFileSync(rulesPath, "utf8");
  const batch = await jfetch("/api/evaluate-batch",
    { rules, scenarios: c.checks.map(k => ({ name: k.name, input: k.input })) });
  if (!batch?.ok) {
    console.log(`✗ ${c.id.padEnd(16)} batch failed: ${batch?.error}`);
    scored.push({ id: c.id, batchError: batch?.error });
    continue;
  }

  const detail = [];
  let passed = 0, hardErrors = 0;
  for (const [i, r] of batch.results.entries()) {
    const u = unwrap(r.outputs);
    if (Object.values(u).some(v => v && v.__error)) hardErrors++;
    const failed = c.checks[i].expect.filter(ch => !satisfied(ch, u));
    if (!failed.length && !hardErrorsOn(u)) passed++;
    else detail.push({
      scenario: c.checks[i].name,
      input: c.checks[i].input,
      expectedMissing: failed.map(f => ({ [f.field || "(any leaf)"]: f.value })),
      actual: u,
    });
  }
  function hardErrorsOn(u) { return Object.values(u).some(v => v && v.__error); }

  const lats = batch.results.map(r => r.latencyMs);
  scored.push({
    id: c.id, kind: c.kind,
    scenarios: c.checks.length, passed, hardErrors,
    execAvgMs: +(lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(1),
    failures: detail,
  });
  const flag = passed === c.checks.length ? "✓" : passed > 0 ? "~" : "✗";
  console.log(`${flag} ${c.id.padEnd(16)} ${passed}/${c.checks.length} scenarios exact · avg exec ${scored.at(-1).execAvgMs}ms${hardErrors ? ` · ${hardErrors} HARD-ERROR` : ""}`);
}

writeFileSync(join(ROOT, "complex-eval-results.json"), JSON.stringify(scored, null, 2));
const totS = scored.filter(s => s.scenarios).reduce((a, s) => a + s.scenarios, 0);
const totP = scored.filter(s => s.passed).reduce((a, s) => a + s.passed, 0);
console.log(`\nTOTAL: ${totP}/${totS} scenario checks exact · details → tests/complex-eval-results.json`);
