#!/usr/bin/env node
/**
 * tests/advanced-rescore.mjs — offline re-scorer for the advanced campaign.
 * Scores whatever compiled models exist in out/<id>.rules against
 * tests/advanced-cases.mjs expectations. NO LLM calls — free to run.
 * Recovers cases whose compiles finished server-side after client timeouts.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES } from "./advanced-cases.mjs";

const BASE = process.env.STUDIO_BASE || "http://localhost:3088";
const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(dirname(ROOT), "out");

const unwrap = (outputs) => Object.fromEntries(Object.entries(outputs || {}).map(([k, v]) =>
  [k, v && typeof v === "object" && "value" in v ? v.value
    : v && typeof v === "object" && "error" in v ? { __error: true } : v]));
const approx = (a, b) => typeof a === "number" && typeof b === "number"
  ? Math.abs(a - b) < 1e-6 : a === b;
function checkPasses(ch, u) {
  // object leaves first
  for (const out of Object.values(u)) {
    if (out !== null && typeof out === "object" && !("__error" in out)) {
      const got = out[ch.field];
      if (got === undefined) continue;
      if (ch.contains ? String(got).includes(ch.value) : approx(got, ch.value)) return true;
    }
  }
  // scalar/boolean sinks: a decision whose UNWRAPPED value equals directly
  if (!ch.contains) {
    for (const out of Object.values(u)) {
      if (out !== null && typeof out !== "object" && approx(out, ch.value)) return true;
    }
  } else {
    for (const out of Object.values(u)) {
      if (typeof out === "string" && out.includes(ch.value)) return true;
    }
  }
  return false;
}
const jfetch = async (p, b) => {
  const r = await fetch(BASE + p, { method: b ? "POST" : "GET",
    headers: b ? { "Content-Type": "application/json" } : {},
    body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return j;
};

console.log(`\n🔍 OFFLINE RE-SCORE of advanced models vs ${BASE}\n`);
const scored = [];
for (const c of CASES) {
  const p = join(OUT, `${c.id}.rules`);
  if (!existsSync(p)) { console.log(`· ${c.id.padEnd(24)} not on disk`); scored.push({ id: c.id, missing: true }); continue; }
  const rules = readFileSync(p, "utf8");
  const batch = await jfetch("/api/evaluate-batch",
    { rules, scenarios: c.checks.map(k => ({ name: k.name, input: k.input })) });
  if (!batch?.ok) { console.log(`✗ ${c.id.padEnd(24)} batch failed`); scored.push({ id: c.id, batchError: batch?.error }); continue; }
  const detail = [];
  let passed = 0, hardErrors = 0;
  const lats = [];
  for (const [i, r] of batch.results.entries()) {
    lats.push(r.latencyMs);
    const u = unwrap(r.outputs);
    if (Object.values(u).some(v => v && v.__error)) hardErrors++;
    const failed = c.checks[i].expect.filter(ch => !checkPasses(ch, u));
    if (!failed.length && !Object.values(u).some(v => v && v.__error)) passed++;
    else detail.push({ scenario: c.checks[i].name, expectedMissing: failed.map(f => ({ [f.field]: f.contains ? `~${f.value}` : f.value })), actual: u });
  }
  scored.push({ id: c.id, scenarios: c.checks.length, passed, hardErrors,
    execAvgMs: +(lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(1), failures: detail });
  const flag = passed === c.checks.length ? "✓" : passed ? "~" : "✗";
  console.log(`${flag} ${c.id.padEnd(24)} ${passed}/${c.checks.length} exact · exec ${scored.at(-1).execAvgMs}ms${hardErrors ? ` · ${hardErrors} HARD-ERR` : ""}`);
}
writeFileSync(join(ROOT, "advanced-eval-results.json"), JSON.stringify(scored, null, 2));
console.log("\ndetails → tests/advanced-eval-results.json");
