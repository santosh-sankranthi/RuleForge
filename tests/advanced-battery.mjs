#!/usr/bin/env node
/**
 * tests/advanced-battery.mjs — live compile+execute campaign over the 10
 * monster specs (20 rules each). Correct envelope-aware scoring built in;
 * artifacts persist to out/<id>.* ; results JSON for the report.
 *
 * ⚠ SPENDS OPENROUTER CREDITS (user-requested).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CASES } from "./advanced-cases.mjs";

const BASE = process.env.STUDIO_BASE || "http://localhost:3088";

/* ---- scoring (envelope-aware: batch wraps as {value}|{error}) ---- */
const unwrap = (outputs) => Object.fromEntries(Object.entries(outputs || {}).map(([k, v]) =>
  [k, v && typeof v === "object" && "value" in v ? v.value
    : v && typeof v === "object" && "error" in v ? { __error: true } : v]));
const approx = (a, b) => typeof a === "number" && typeof b === "number"
  ? Math.abs(a - b) < 1e-6 : a === b;

function checkPasses(ch, unwrapped) {
  for (const out of Object.values(unwrapped)) {
    if (out !== null && typeof out === "object" && !("__error" in out)) {
      const got = out[ch.field];
      if (got === undefined) continue;
      if (ch.contains ? String(got).includes(ch.value) : approx(got, ch.value)) return true;
    }
  }
  if (!ch.contains) {
    for (const out of Object.values(unwrapped)) {
      if (out !== null && typeof out !== "object" && approx(out, ch.value)) return true;
    }
  } else {
    for (const out of Object.values(unwrapped)) {
      if (typeof out === "string" && out.includes(ch.value)) return true;
    }
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
  return { status: res.status, json };
}

console.log(`\n🧪 ADVANCED BATTERY — ${CASES.length} monster specs vs ${BASE}`);
const pre = await jfetch("/api/presets");
if (!pre.json?.ok) { console.error("Studio unreachable"); process.exit(1); }
console.log(`   model: ${pre.json.model}\n`);

const results = [];
for (const [i, c] of CASES.entries()) {
  const R = { id: c.id, kind: c.kind, ok: false, compileMs: 0, rounds: 0,
              dmnBytes: 0, warnings: null, issues: null,
              scenariosTotal: c.checks.length, passed: 0, execAvgMs: null,
              hardErrors: 0, failures: [], note: "" };
  process.stdout.write(`[${String(i + 1).padStart(2, "0")}/${CASES.length}] ${c.id} … `);
  const t0 = Date.now();
  try {
    const comp = await jfetch("/api/compile", { name: c.id, spec: c.spec });
    R.compileMs = Date.now() - t0;
    if (!comp.json?.ok) {
      R.rounds = comp.json?.rounds ?? -1;
      R.issues = (comp.json?.issues || []).map(x => `${x.code}: ${String(x.message).slice(0, 120)}`);
      if (!R.issues.length) R.note = "no drafts produced (LLM-level failure, e.g. truncation)";
      console.log(`✗ COMPILE FAIL (${R.note || R.issues.join(" | ").slice(0, 90)})`);
      results.push(R); continue;
    }
    R.ok = true; R.rounds = comp.json.rounds; R.warnings = comp.json.warnings;
    R.dmnBytes = comp.json.dmn?.length || 0;

    const batch = await jfetch("/api/evaluate-batch", {
      rules: comp.json.rules,
      scenarios: c.checks.map(k => ({ name: k.name, input: k.input })),
    });
    if (!batch.json?.ok) { R.note = `batch failed: ${batch.json?.error}`; console.log("✗ BATCH"); results.push(R); continue; }

    const lats = [];
    for (const [si, r] of batch.json.results.entries()) {
      lats.push(r.latencyMs);
      const u = unwrap(r.outputs);
      if (Object.values(u).some(v => v && v.__error)) R.hardErrors++;
      const failed = c.checks[si].expect.filter(ch => !checkPasses(ch, u));
      if (!failed.length && !Object.values(u).some(v => v && v.__error)) R.passed++;
      else R.failures.push({ scenario: c.checks[si].name, input: c.checks[si].input,
        expectedMissing: failed.map(f => ({ [f.field]: f.contains ? `~${f.value}` : f.value })), actual: u });
    }
    R.execAvgMs = +(lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(1);
    console.log(`${R.passed}/${c.checks.length} exact · ${R.rounds}r · ${(R.compileMs / 1000).toFixed(0)}s · exec ${R.execAvgMs}ms`);
  } catch (e) { R.note = e.message; console.log(`✗ DRIVER: ${e.message}`); }
  results.push(R);
}

const ok = results.filter(r => r.ok);
const totC = results.reduce((a, r) => a + r.scenariosTotal, 0);
const totP = results.reduce((a, r) => a + r.passed, 0);
console.log(`
${"═".repeat(72)}
📊 ADVANCED SUMMARY
   compiled           : ${ok.length}/${CASES.length}
   semantic exactness : ${totP}/${totC} scenario checks
   rounds             : ${results.map(r => r.ok ? r.rounds + "r" : "FAIL").join(", ")}
   hard-error scen.   : ${results.reduce((a, r) => a + r.hardErrors, 0)}
${"═".repeat(72)}`);
writeFileSync(new URL("./advanced-results.json", import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE,
    maxTokens: process.env.QUERY_MAX_TOKENS || "(server-side default)", results }, null, 2));
console.log("details → tests/advanced-results.json");
