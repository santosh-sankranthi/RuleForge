#!/usr/bin/env node
/**
 * battery.mjs — end-to-end NL→DMN test battery.
 *
 * For every tests/cases/<case>/: runs the full copilot pipeline on spec.txt,
 * then checks expectations by EXECUTING the produced model through feelc.
 *
 * Assertion philosophy: only assert values the SPEC pins (booleans, numbers,
 * exact vocabulary stated in the spec). Never assert LLM-invented phrasing.
 *
 * Run: node tests/battery.mjs [caseName ...]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT, parseModelManifest, sanitizeTestInput, runDecision } from "../copilot-lib.mjs";

const CASES_DIR = path.join(ROOT, "tests", "cases");
const filter = process.argv.slice(2);
const caseDirs = readdirSync(CASES_DIR).filter(d =>
  (!filter.length || filter.some(f => d.includes(f))) &&
  existsSync(path.join(CASES_DIR, d, "spec.txt")));

let pass = 0, fail = 0;
const report = [];

for (const dir of caseDirs) {
  const name = dir.replace(/^\d+-/, "");
  const spec = path.join(CASES_DIR, dir, "spec.txt");
  const expectFile = path.join(CASES_DIR, dir, "expect.json");
  const rulesFile = path.join(ROOT, "out", `${name}.rules`);
  const entry = { case: dir, pipeline: "—", checks: [], ok: false };

  // 1) run the pipeline as a real user would
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["copilot.mjs", spec, name], {
    cwd: ROOT, encoding: "utf8", timeout: 300000,
  });
  entry.ms = Date.now() - t0;
  entry.pipeline = r.status === 0 ? `ok (${entry.ms}ms)` : `EXIT ${r.status}`;
  if (r.stderr?.trim()) entry.pipelineErr = r.stderr.trim().slice(0, 200);

  // 2) structural + semantic checks
  if (r.status === 0 && existsSync(rulesFile)) {
    const src = readFileSync(rulesFile, "utf8");
    const manifest = parseModelManifest(src);
    const dmnFile = path.join(ROOT, "out", `${name}.dmn`);
    if (!manifest.final || manifest.ambiguous) entry.checks.push({ id: "manifest", ok: false, note: `sinks broken` });
    else if (!existsSync(dmnFile)) entry.checks.push({ id: "dmn-export", ok: false });
    else if (!/<decision[\s>]/.test(readFileSync(dmnFile, "utf8"))) entry.checks.push({ id: "dmn-content", ok: false });

    const expectations = JSON.parse(readFileSync(expectFile, "utf8"));
    for (const [i, exp] of expectations.entries()) {
      const input = sanitizeTestInput(exp.input, manifest.inputs);
      const result = runDecision(rulesFile, manifest.final, input);
      if (result.__error) { entry.checks.push({ id: `#${i}`, ok: false, input: exp.input, error: result.__error }); continue; }
      if (exp.noError) { entry.checks.push({ id: `#${i}`, ok: true }); continue; }
      const mismatches = Object.entries(exp.expect ?? {}).filter(([k, v]) => result[k] !== v);
      entry.checks.push({
        id: `#${i}`, ok: mismatches.length === 0, input: exp.input,
        got: result, want: exp.expect,
      });
    }
  }
  entry.ok = entry.pipeline.startsWith("ok") && entry.checks.length > 0 && entry.checks.every(c => c.ok);
  entry.ok ? pass++ : fail++;
  report.push(entry);
}

/* ---------- pretty matrix ---------- */
for (const e of report) {
  console.log(`\n${e.ok ? "✅" : "❌"} ${e.case} — pipeline ${e.pipeline}`);
  for (const c of e.checks) {
    console.log(`   ${c.ok ? "✓" : "✗"} ${c.id}${c.error ? ` error=${c.error}` : ""}`);
    if (!c.ok && c.want) console.log(`       got : ${JSON.stringify(c.got)}\n       want: ${JSON.stringify(c.want)} for ${JSON.stringify(c.input)}`);
    else if (!c.ok && c.input) console.log(`       got : ${JSON.stringify(c.got)} for ${JSON.stringify(c.input)}`);
  }
}
console.log(`\n=== BATTERY: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
