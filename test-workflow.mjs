#!/usr/bin/env node
/**
 * test-workflow.mjs — Ingest & execute multiple test scenarios against any verified .rules model.
 *
 * Usage:
 *   node test-workflow.mjs <rules-file> <inputs.json>
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDecisions, parseInputs, runDecision, ROOT } from "./copilot-lib.mjs";

const [, , rulesPath, inputsPath] = process.argv;
if (!rulesPath || !inputsPath) {
  console.error("Usage: node test-workflow.mjs <out/model.rules> <tests/inputs.json>");
  process.exit(1);
}

const fullRulesPath = path.resolve(rulesPath);
const fullInputsPath = path.resolve(inputsPath);

const src = readFileSync(fullRulesPath, "utf8");
const declaredInputs = parseInputs(src);
const allDecisions = parseDecisions(src);
const testCases = JSON.parse(readFileSync(fullInputsPath, "utf8"));

console.log(`\n══════════════════════════════════════════════════════════════════════`);
console.log(` 🚀 DMN WORKFLOW TEST RUNNER: ${path.basename(rulesPath)}`);
console.log(`    Inputs:    [${declaredInputs.join(", ")}]`);
console.log(`    Decisions: [${allDecisions.join(", ")}]`);
console.log(`    Scenarios: ${testCases.length} test cases`);
console.log(`══════════════════════════════════════════════════════════════════════\n`);

let passed = 0;
for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  const name = tc.name || `Case #${i + 1}`;
  const input = tc.input || tc;

  console.log(`▶ Scenario ${i + 1}: ${name}`);
  console.log(`  📥 Inputs: ${JSON.stringify(input)}`);

  const results = {};
  let hasError = false;

  for (const dec of allDecisions) {
    const res = runDecision(fullRulesPath, dec, input);
    if (res && res.__error) {
      hasError = true;
      results[dec] = `⚠️ ERROR: ${res.__error}`;
    } else {
      results[dec] = res;
    }
  }

  console.log(`  📤 Outputs:`);
  for (const [dec, val] of Object.entries(results)) {
    console.log(`     • ${dec.padEnd(18)} : ${JSON.stringify(val)}`);
  }

  if (hasError) {
    console.log(`  ❌ Status: FAILED\n`);
  } else {
    passed++;
    console.log(`  ✅ Status: PASSED\n`);
  }
}

console.log(`──────────────────────────────────────────────────────────────────────`);
console.log(` 🏁 Completed: ${passed}/${testCases.length} scenarios evaluated successfully.`);
console.log(`──────────────────────────────────────────────────────────────────────\n`);
