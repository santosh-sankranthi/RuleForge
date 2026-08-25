#!/usr/bin/env node
/**
 * copilot.mjs — CLI orchestrator: NL rules → verified feelc model → DMN 1.3 XML
 *
 * Pipeline:
 *   1. LLM drafts .rules from your plain-English spec        (OpenRouter)
 *   2. feelc formally verifies (totality / consistency / FEEL)
 *   3. Verifier issues feed back to the LLM                  (≤ 3 repair rounds)
 *   4. Structural manifest picks inputs + FINAL decision     (deterministic)
 *   5. Export OMG DMN 1.3 XML + engine-executed smoke tests
 *
 * Usage: node copilot.mjs <nl-rules.txt> <model-name>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  ROOT, MODEL, MAX_TOKENS, loadApiKey, chat, extractRules, verify,
  parseModelManifest, sanitizeTestInput, runDecision, exportDmn,
  CreditError, TruncationError, LlmError,
} from "./copilot-lib.mjs";

const OUT = path.join(ROOT, "out");
const [, , nlFile, rawName] = process.argv;
if (!nlFile || !rawName) { console.error("usage: node copilot.mjs <nl-rules.txt> <model-name>"); process.exit(1); }
const modelName = rawName.toLowerCase().replace(/[^a-z0-9_]/g, "_");

const apiKey = loadApiKey();
const nlRules = readFileSync(path.resolve(nlFile), "utf8");
console.log(`▸ NL rules: ${nlFile} (${nlRules.length} chars)\n▸ Drafting feelc model with ${MODEL()}…`);

/* ---------------- generation prompts ---------------- */
const SYNTAX_GUIDE = `You are writing a model for the "feelc" compiled rules engine (DMN/FEEL paradigm).
SYNTAX REFERENCE (follow exactly):
model "<name>" { rounding: half_even }
input <var> : number|boolean|string in [<lo>..<hi>]   // domain optional but recommended, e.g. in [300..850], >= 0
type <Name> = context { <field>: <type>, ... }       // CRITICAL: MUST be on ONE single line!
decision <name> : <type> = <FEEL expression>          // intermediate literal decision; MUST be on ONE single line!
decision <name> : <Type> {
  needs: <inputVar>, <otherDecision>
  hit: first                                          // unique | first | priority | collect
  #  colA      | colB   => out1    | out2
     < 580     | -      => false   | "why"
     [580..680)| <= 0.43 => true   | "why"
     -         | -      => false   | "fallback reason" // or default | ...
}
RULES:
- CRITICAL: a decision-table row MUST contain EXACTLY one condition cell per variable listed in "needs",
  in the same order, separated by "|". Use "-" for don't-care cells. NEVER leave empty cells (DSL009).
  GOOD (3 needs):    < 580     | -      | -     => false | "insufficient score"
  BAD  (3 needs):    < 580                       => false | "insufficient score"
- CONTEXT DECISIONS: to output a context type, you MUST write a decision table with one output column per context field.
  NEVER write literal record constructors like "decision x : MyContext = context { ... }" (CMP007).
- OUTPUT CELLS: each row lists ONE output value PER CONTEXT FIELD after =>, separated by "|".
  Output cells MUST be PURE LITERAL CONSTANTS ONLY (e.g. true, false, 2.0, "surge applied").
  NEVER put arithmetic formulas, expressions, or variable names in table cells (CMP008: literal expected).
  Compute dynamic formulas in literal decisions instead:
  GOOD: decision total_fare : number = (base_fare + (distance_km * 1.5)) * multiplier
  BAD in table cell: => (base_fare + distance * 1.5) | true | "why"   // CMP008 error!
  BAD in table cell: => total_fare                  | true | "why"   // CMP008 error!
  BAD in table cell: => context { ... }                             // CMP007 error!
- FEEL GOTCHA: literal decision expressions MUST be on ONE continuous line. Parenthesize any if/then/else arithmetic branches:
  GOOD: decision dti : number = if income > 0 then (debt / (income / 12)) else (if debt > 0 then 1 else 0)
  BAD:  decision dti : number = if income > 0
                                  then debt / income
                                  else 1

COMPLETE WORKING EXAMPLE (copy this shape exactly):
model "credit" { rounding: half_even }
input credit_score  : number in [300..850]
input annual_income : number >= 0
input monthly_debt  : number >= 0
input age           : number in [0..120]
type Eligibility = context { eligible: boolean, reason: string }
decision dti : number = if annual_income > 0 then (monthly_debt / (annual_income / 12)) else (if monthly_debt > 0 then 1 else 0)
decision eligibility : Eligibility {
  needs: credit_score, dti, age
  hit: first
     < 580        | -       | -     => false    | "insufficient score"
     -            | > 0.43  | -     => false    | "debt too high"
     -            | -       | < 18  => false    | "minor"
     [580..680)   | <= 0.43 | >= 18 => true     | "approved with conditions"
     >= 680       | <= 0.43 | >= 18 => true     | "approved"
     -            | -       | -     => false    | "not covered"
}`;

/* ---------------- verify→repair loop ---------------- */
mkdirSync(OUT, { recursive: true });
const rulesFile = path.join(OUT, `${modelName}.rules`);
const dmnFile = path.join(OUT, `${modelName}.dmn`);

let messages = [
  { role: "system", content: SYNTAX_GUIDE },
  { role: "user", content: `Write the complete feelc .rules model for these business rules:\n\n${nlRules}\n\nOutput ONLY the .rules file content.` },
];
let maxTokens = MAX_TOKENS();
let issues = [];
let clean = false;

for (let round = 1; round <= 3 && !clean; round++) {
  try {
    const draft = extractRules(await chat(messages, { apiKey }));
    writeFileSync(rulesFile, draft);
    issues = verify(rulesFile);
    if (issues.length === 0) { console.log(`✓ round ${round}: model verifies clean (formally checked)`); clean = true; break; }
    console.log(`✗ round ${round}: ${issues.length} issue(s) — feeding back to LLM for repair`);
    console.log("  " + issues.map(i => `[line ${i.line ?? "?"}] ${i.code}: ${i.message}`).join("\n  ").slice(0, 600));
    messages.push({ role: "assistant", content: draft },
      { role: "user", content: `The verifier rejected this model:\n${JSON.stringify(issues)}\n` +
        `Hints:\n` +
        `- DSL010: "type Name = context { ... }" MUST be defined entirely on ONE single line.\n` +
        `- CMP008: Output cells after "=>" must be PURE LITERAL CONSTANTS ONLY (e.g. 2.0, true, "surge"). NEVER put formulas, arithmetic, or variables inside table cells. Dynamic math belongs in a literal decision (e.g. decision total_fare : number = standard_cost * multiplier).\n` +
        `- CMP007: NEVER write "context { ... }" constructors in cells or literal decisions.\n` +
        `- CMP004 / DSL009: Table row cells must match the "needs" list count with "-" for don't-care (never empty).\n` +
        `- DSL002: Literal decisions "decision name : type = expr" must be on ONE single line with parenthesized arithmetic branches.\n` +
        `Return the FULL corrected .rules file only.` });
  } catch (e) {
    if (e instanceof TruncationError) {
      maxTokens = Math.min(maxTokens * 2, 8000);
      process.env.QUERY_MAX_TOKENS = String(maxTokens);
      console.log(`✗ round ${round}: output truncated — retrying with max_tokens=${maxTokens}`);
      messages.push({ role: "user", content: "Your previous answer was cut off. Return the FULL corrected .rules file only." });
    } else if (e instanceof LlmError) {
      console.log(`✗ round ${round}: unparseable LLM output (${e.message.slice(0, 120)}) — asking again`);
      messages.push({ role: "user", content: "That was not a valid .rules model. Return ONLY the full .rules file content." });
    } else { throw e; }
  }
}
if (!clean) { console.error(`\n✗ still failing after 3 rounds — inspect ${rulesFile}`); process.exit(2); }

/* ---------------- deterministic manifest ---------------- */
const src = readFileSync(rulesFile, "utf8");
const manifest = parseModelManifest(src);
if (!manifest.final || manifest.ambiguous)
  console.log(`(!) final decision ambiguous (sinks: ${manifest.decisions.join(", ") || "none"}) — review the model`);
else console.log(`✓ manifest: inputs=[${manifest.inputs.join(", ")}] final="${manifest.final}"`);

/* ---------------- export ---------------- */
const warnings = exportDmn(rulesFile, dmnFile);
console.log(`✓ exported DMN 1.3 XML → ${dmnFile}${warnings ? `\n  exporter notes: ${warnings.trim().slice(0, 300)}` : ""}`);

/* ---------------- engine-executed smoke tests ---------------- */
if (manifest.final && manifest.inputs.length) {
  const casesRaw = await chat([
    { role: "system", content: "Reply with ONLY a JSON array of 3 input objects whose keys are EXACTLY these declared inputs and no others: [" +
      manifest.inputs.join(", ") + "] (values: plain numbers/booleans/strings). Choose inputs that exercise different outcomes." },
    { role: "user", content: src.slice(0, 4000) },
  ], { apiKey });
  let testInputs = [];
  try {
    testInputs = JSON.parse(casesRaw.match(/\[[\s\S]*\]/)[0])
      .map(o => sanitizeTestInput(o, manifest.inputs));
  } catch { console.log("(!) could not parse suggested test inputs — skipping smoke tests"); }

  console.log(`\nSmoke tests (final decision: ${manifest.final}):`);
  let failures = 0;
  for (const input of testInputs.slice(0, 3)) {
    const result = runDecision(rulesFile, manifest.final, input);
    const bad = result && result.__error;
    if (bad) failures++;
    console.log(`  in=${JSON.stringify(input)}\n    → ${JSON.stringify(result)}`);
  }
  if (failures) { console.error(`\n✗ ${failures} smoke test(s) errored`); process.exit(3); }
}

console.log(`\nDone.\n  rules : ${rulesFile}\n  dmn   : ${dmnFile}  ← reusable in Camunda/Drools/any DMN 1.3 engine`);
