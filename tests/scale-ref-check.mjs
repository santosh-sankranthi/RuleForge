#!/usr/bin/env node
/**
 * scale-ref-check.mjs — FREE tier-0 scale benchmark (no LLM credits).
 *
 * Renders the generated case DIRECTLY as a .rules model, then proves:
 *   1. feelc verify accepts a model of this size,
 *   2. DMN export works,
 *   3. engine evaluation matches the generator's expectation engine exactly
 *      for every scenario (tolerance 1e-6 money / exact booleans).
 *
 * Any paid-benchmark compile failure above this tier is therefore purely an
 * LLM-translation problem, not an engine-capacity or math-mismatch one.
 *
 * Run: node tests/scale-ref-check.mjs [--sizes 50,100,250,500]
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { verify, exportDmn, runDecision } from "../copilot-lib.mjs";
import { genScaleCase, renderScaleModel } from "./scale-cases.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, "out", ".scale-ref");
const args = process.argv.slice(2);
const gi = args.indexOf("--sizes");
const SIZES = (gi >= 0 ? args[gi + 1] : "50,100,250,500").split(",").map(Number).filter(Boolean);

let failures = 0;
for (const n of SIZES) {
  const c = genScaleCase(n, 42);
  const rulesText = renderScaleModel(c);
  const rulesFile = path.join(OUT_DIR, `${c.name}_ref.rules`);
  writeFileSync(rulesFile, rulesText);

  const t0 = performance.now();
  const issues = verify(rulesFile);
  const verifyMs = Math.round(performance.now() - t0);
  const errorsOnly = issues.filter(i => i.severity !== "warning" && i.kind !== "dead-rule" || i.code !== undefined && !i.kind);
  const realErrors = issues.filter(i => i.code);          // code-bearing = verifier error; warnings have kind only
  console.log(`[${c.name}_ref] ${rulesText.split("\n").length} lines · verify ${realErrors.length === 0 ? "CLEAN" : "FAIL"} (${verifyMs} ms)${issues.length ? ` · ${issues.length} note(s)` : ""}`);
  if (realErrors.length) { console.log(realErrors.slice(0, 3)); failures++; continue; }

  const dmnMs0 = performance.now();
  const warn = exportDmn(rulesFile, path.join(OUT_DIR, `${c.name}_ref.dmn`));
  console.log(`  export: ${warn ? `warn: ${warn.slice(0, 120)}` : "ok"} (${Math.round(performance.now() - dmnMs0)} ms)`);

  let passed = 0, total = 0;
  const evalT0 = performance.now();
  for (const sc of c.scenarios) {
    const want = sc.expect;
    const fp = runDecision(rulesFile, "final_price", sc.input);
    const rv = runDecision(rulesFile, "review_required", sc.input);
    const fpVal = fp && fp.__error === undefined ? fp : (fp?.output ?? fp);
    const rvVal = rv && rv.__error === undefined ? rv : (rv?.output ?? rv);
    const okFp = typeof fpVal === "number" && Math.abs(fpVal - want.final_price) <= 1e-6;
    const okRv = typeof rvVal === "boolean" && rvVal === want.review_required;
    total += 2; passed += okFp + okRv;
    if (!okFp || !okRv) console.log(`  ✗ ${sc.name}: final_price=${JSON.stringify(fpVal)} want ${want.final_price} · review=${JSON.stringify(rvVal)} want ${want.review_required}`);
  }
  const evalMs = Math.round(performance.now() - evalT0);
  console.log(`  semantics: ${passed}/${total} exact across ${c.scenarios.length} scenarios (${evalMs} ms, ${(total / (evalMs / 1000)).toFixed(0)} evals/s incl. process spawn)`);
  if (passed !== total) failures++;
}

console.log(failures === 0 ? "\nTIER-0 PASS ✅ — engine handles this scale and matches the expectation engine" : `\nTIER-0 FAIL ❌ (${failures} size(s))`);
process.exit(failures ? 1 : 0);
