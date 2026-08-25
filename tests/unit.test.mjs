/**
 * Unit tests for copilot-lib.mjs — fully deterministic, no LLM calls.
 * Run: node --test tests/
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  ROOT, chat, extractRules, parseDecisions, parseInputs, parseModelManifest,
  parseInputTypes, buildInputTemplate, buildScenarioTemplate,
  verify, sanitizeTestInput, runDecision, exportDmn, isNetworkError,
  loadEnv, loadLlmConfig, buildAzureEndpoint, MAX_TOKENS,
  CreditError, TruncationError, LlmError,
} from "../copilot-lib.mjs";

const TMP = path.join(ROOT, "tests", ".tmp");
const CREDIT_RULES = path.join(ROOT, "feelc", "examples", "credit", "credit.rules");
const LOAN_RULES = path.join(ROOT, "out", "loan_approval.rules");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

/* ---------- extraction ---------- */
describe("extractRules", () => {
  test("strips fenced blocks", () => {
    const out = extractRules("Sure!\n```rules\nmodel \"x\" {}\ndecision d : number = 1\n```\nHope that helps");
    assert.match(out, /^model "x"/);
    assert.ok(!out.includes("Hope"));
  });
  test("accepts bare payloads", () => {
    const out = extractRules('decision d : number = 1');
    assert.equal(out, 'decision d : number = 1');
  });
  test("rejects non-model output", () => {
    assert.throws(() => extractRules("I cannot help with that."), LlmError);
  });
});

/* ---------- structural parsing ---------- */
describe("manifest parsing", () => {
  test("loan model: inputs, decisions, unique sink", () => {
    const m = parseModelManifest(readFileSync(LOAN_RULES, "utf8"));
    assert.deepEqual(m.inputs.sort(), ["age", "annual_income", "credit_score", "monthly_debt"]);
    assert.deepEqual(m.decisions.sort(), ["approval", "dti"]);
    assert.equal(m.final, "approval");
    assert.equal(m.ambiguous, false);
  });
  test("literal chain: a → b → table leaves exactly one sink", () => {
    const src = [
      'input n : number in [0..10]',
      'decision a : number = (n * 2)',
      'decision b : number = (a + 1)',
      'type R = context { ok: boolean, why: string }',
      'decision t : R {',
      '  needs: b',
      '  hit: first',
      '     >= 5 => true | "big"',
      '     default => false | "small"',
      '}',
    ].join("\n");
    const m = parseModelManifest(src);
    assert.equal(m.final, "t");
    assert.equal(m.ambiguous, false);
  });
  test("two independent tables are flagged ambiguous", () => {
    const src = [
      'input a : number in [0..10]',
      'type R = context { ok: boolean }',
      'decision t1 : R { needs: a  hit: first  >= 5 => true | default => false }',
      'decision t2 : R { needs: a  hit: first  >= 3 => true | default => false }',
    ].join("\n");
    const m = parseModelManifest(src);
    assert.equal(m.ambiguous, true);
  });
});

/* ---------- typed inputs & templates ---------- */
describe("parseInputTypes", () => {
  test("captures types, numeric domains, and string options", () => {
    const src = [
      'model "t" {}',
      'input age           : number in [18..100]',
      'input annual_income : number >= 0',
      'input threshold     : number <= 1000',
      'input tier          : string in ["gold", "silver"]',
      'input region        : string in {"urban", "rural"}',
      'input rain          : boolean',
      'input promo_code    : string',
      'input as_of         : date',
      'decision d : number = 1',
    ].join("\n");
    const t = parseInputTypes(src);
    assert.deepEqual(t, [
      { name: "age", type: "number", min: 18, max: 100 },
      { name: "annual_income", type: "number", min: 0 },
      { name: "threshold", type: "number", max: 1000 },
      { name: "tier", type: "string", options: ["gold", "silver"] },
      { name: "region", type: "string", options: ["urban", "rural"] },
      { name: "rain", type: "boolean" },
      { name: "promo_code", type: "string" },
      { name: "as_of", type: "date" },
    ]);
  });
  test("adjacent declarations are not swallowed (line-anchored)", () => {
    const src = 'input a : boolean\ninput b : string in ["x"]\ndecision d : number = 1';
    const names = parseInputTypes(src).map(t => t.name);
    assert.deepEqual(names, ["a", "b"]);
  });
  test("real ride_pricing model exposes traffic_level options", () => {
    const src = readFileSync(path.join(ROOT, "out", "ride_pricing.rules"), "utf8");
    const tl = parseInputTypes(src).find(t => t.name === "traffic_level");
    assert.deepEqual(tl, { name: "traffic_level", type: "string", options: ["low", "medium", "high"] });
  });
});

describe("buildInputTemplate / buildScenarioTemplate", () => {
  test("defaults respect declared domains", () => {
    const tpl = buildInputTemplate([
      { name: "credit_score", type: "number", min: 300, max: 850 },
      { name: "income", type: "number", min: 0 },
      { name: "cap", type: "number", max: 100 },
      { name: "free", type: "number" },
      { name: "tier", type: "string", options: ["gold", "silver"] },
      { name: "note", type: "string" },
      { name: "active", type: "boolean" },
      { name: "when", type: "date" },
    ]);
    assert.deepEqual(tpl, {
      credit_score: 575, income: 1, cap: 50, free: 1,
      tier: "gold", note: "", active: false, when: "",
    });
  });
  test("scenario template matches [{name, input}] suite shape", () => {
    const suite = buildScenarioTemplate("my_model", [{ name: "a", type: "number", min: 0 }]);
    assert.deepEqual(suite, [{ name: "my_model input template", input: { a: 1 } }]);
  });
  test("manifest carries typedInputs alongside legacy string array", () => {
    const m = parseModelManifest(readFileSync(LOAN_RULES, "utf8"));
    assert.ok(Array.isArray(m.inputs) && typeof m.inputs[0] === "string");
    assert.equal(m.typedInputs.find(t => t.name === "credit_score").min, 300);
    assert.equal(m.typedInputs.find(t => t.name === "credit_score").max, 850);
  });
});

/* ---------- feelc integration ---------- */
describe("verify()", () => {
  test("clean example → no issues", () => {
    assert.deepEqual(verify(CREDIT_RULES), []);
  });
  test("broken file → structured issues", () => {
    const f = path.join(TMP, "broken.rules");
    writeFileSync(f, 'model t {}\ninput age : number\ndecision ok : boolean { needs: age\n  >= 18 => true\n}');
    const issues = verify(f);
    assert.ok(issues.length >= 1 && issues[0].code && issues[0].message);
  });
});

describe("runDecision()", () => {
  test("executes real evaluation (credit example)", () => {
    const out = runDecision(CREDIT_RULES, "eligibility",
      { credit_score: 700, annual_income: 60000, monthly_debt: 1000, age: 30 });
    assert.deepEqual(out, { eligible: true, reason: "approved" });
  });
  test("engine errors come back as data", () => {
    const out = runDecision(CREDIT_RULES, "no_such_decision", { credit_score: 700, annual_income: 1, monthly_debt: 0, age: 30 });
    assert.ok(out.__error);
  });
});

describe("sanitizeTestInput()", () => {
  test("drops undeclared keys and non-scalars", () => {
    const clean = sanitizeTestInput(
      { credit_score: 700, hacker: "x", approval: { approved: true }, age: 30 },
      ["credit_score", "age"]
    );
    assert.deepEqual(clean, { credit_score: 700, age: 30 });
  });
});

describe("exportDmn()", () => {
  test("produces DMN 1.3 XML", () => {
    const outDmn = path.join(TMP, "c.dmn");
    exportDmn(CREDIT_RULES, outDmn);
    const xml = readFileSync(outDmn, "utf8");
    assert.match(xml, /xmlns="https:\/\/www\.omg\.org\/spec\/DMN\/20191111\/MODEL\/"/);
    assert.match(xml, /<decision name="eligibility">/);
  });
});

/* ---------- chat hardening (transport stubbed — no network) ---------- */
describe("chat() resilience", () => {
  const apiKey = "test-key";
  const okBody = (content = "ok") => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }) });
  /** Fake transport serving scripted responses and recording payloads. */
  const stubTransport = (script) => {
    const calls = [];
    const transport = async (payloadStr) => {
      calls.push(JSON.parse(payloadStr));
      const next = script[calls.length - 1];
      if (typeof next === "number") return { status: next, text: JSON.stringify({ error: { message: `HTTP ${next} boom` } }) };
      return next;
    };
    transport.calls = calls;
    return transport;
  };

  test("402 maps to CreditError immediately (no retry)", async () => {
    const t = stubTransport([{ status: 402, text: JSON.stringify({}) }]);
    await assert.rejects(chat([{ role: "user", content: "hi" }], { apiKey, transport: t }), CreditError);
    assert.equal(t.calls.length, 1);
  });

  test("finish_reason length → TruncationError (not retried)", async () => {
    const t = stubTransport([{ status: 200, text: JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] }) }]);
    await assert.rejects(chat([{ role: "user", content: "hi" }], { apiKey, transport: t }), TruncationError);
    assert.equal(t.calls.length, 1);
  });

  test("transient 500 then success (exponential backoff, jittered)", async () => {
    const t = stubTransport([500, okBody("recovered")]);
    assert.equal(await chat([{ role: "user", content: "hi" }], { apiKey, transport: t, backoffBaseMs: 1 }), "recovered");
    assert.equal(t.calls.length, 2);
  });

  test("network exception retries the same payload", async () => {
    let n = 0;
    const transport = async (p) => {
      if (++n === 1) throw new Error("ECONNRESET socket hang up");
      return okBody(await Promise.resolve("fine"));
    };
    transport.calls = [];
    assert.equal(await chat([{ role: "user", content: "hi" }], { apiKey, transport, backoffBaseMs: 1 }), "fine");
  });

  test("hard 400 fails fast with LlmError", async () => {
    const t = stubTransport([400]);
    await assert.rejects(chat([{ role: "user", content: "hi" }], { apiKey, transport: t }), LlmError);
    assert.equal(t.calls.length, 1);
  });

  test("provider rejecting max_tokens auto-degrades to 16000 once, attempt not consumed", async () => {
    const reject400 = { status: 400, text: JSON.stringify({ error: { message: "max_tokens too large: 50000 > limit" } }) };
    const t = stubTransport([reject400, okBody("degraded-ok")]);
    const out = await chat([{ role: "user", content: "hi" }], { apiKey, transport: t, backoffBaseMs: 1 });
    assert.equal(out, "degraded-ok");
    assert.equal(t.calls.length, 2);
    assert.equal(t.calls[0].max_tokens > 16000, true);
    assert.equal(t.calls[1].max_tokens, 16000);
  });

  test("sends the configured token ceiling by default", async () => {
    const t = stubTransport([okBody()]);
    await chat([{ role: "user", content: "hi" }], { apiKey, transport: t });
    assert.equal(t.calls[0].max_tokens, MAX_TOKENS());
  });

  test("timeout error is classified as a network error", () => {
    assert.equal(isNetworkError(new Error("chat timed out after 1800000 ms")), true);
    assert.equal(isNetworkError(new LlmError("LLM error: not a model")), false);
  });
});

/* ---------- Azure AI Foundry & Provider Configuration ---------- */
describe("Azure AI Foundry & Provider Configuration", () => {
  test("buildAzureEndpoint formats Azure OpenAI deployment URLs with API version", () => {
    const url = buildAzureEndpoint("https://mycompany.openai.azure.com", "gpt-4o", "2024-06-01");
    assert.equal(url, "https://mycompany.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-06-01");
  });

  test("buildAzureEndpoint formats Azure AI Foundry Model Inference endpoints", () => {
    const url1 = buildAzureEndpoint("https://my-foundry.services.ai.azure.com/models", "gpt-4o");
    assert.equal(url1, "https://my-foundry.services.ai.azure.com/models/chat/completions");

    const url2 = buildAzureEndpoint("https://my-foundry.services.ai.azure.com", "Meta-Llama-3.1-70B");
    assert.equal(url2, "https://my-foundry.services.ai.azure.com/models/chat/completions");

    const url3 = buildAzureEndpoint("https://llama3.eastus.models.ai.azure.com", "llama3");
    assert.equal(url3, "https://llama3.eastus.models.ai.azure.com/chat/completions");
  });

  test("buildAzureEndpoint preserves full completions URLs", () => {
    const full = "https://custom-gateway.local/v1/chat/completions";
    assert.equal(buildAzureEndpoint(full, "custom"), full);
  });

  test("loadLlmConfig detects Azure AI configuration and creates dual auth headers", () => {
    const origKey = process.env.AZURE_AI_API_KEY;
    const origEp = process.env.AZURE_AI_ENDPOINT;
    const origModel = process.env.AZURE_AI_MODEL;
    try {
      process.env.AZURE_AI_API_KEY = "test-azure-key-123";
      process.env.AZURE_AI_ENDPOINT = "https://my-hub.services.ai.azure.com/models";
      process.env.AZURE_AI_MODEL = "gpt-4o";

      const cfg = loadLlmConfig();
      assert.equal(cfg.provider, "azure");
      assert.equal(cfg.apiKey, "test-azure-key-123");
      assert.equal(cfg.model, "gpt-4o");
      assert.equal(cfg.url, "https://my-hub.services.ai.azure.com/models/chat/completions");
      assert.equal(cfg.headers["api-key"], "test-azure-key-123");
      assert.equal(cfg.headers["Authorization"], "Bearer test-azure-key-123");
    } finally {
      if (origKey !== undefined) process.env.AZURE_AI_API_KEY = origKey; else delete process.env.AZURE_AI_API_KEY;
      if (origEp !== undefined) process.env.AZURE_AI_ENDPOINT = origEp; else delete process.env.AZURE_AI_ENDPOINT;
      if (origModel !== undefined) process.env.AZURE_AI_MODEL = origModel; else delete process.env.AZURE_AI_MODEL;
    }
  });

  test("loadEnv parses key-value pairs ignoring comments and quotes", () => {
    const envFile = path.join(TMP, "test.env");
    writeFileSync(envFile, [
      "# Comment line",
      "TEST_VAR_A=hello",
      'TEST_VAR_B="quoted_value"',
      "TEST_VAR_C='single_quoted'",
      "",
    ].join("\n"));

    const parsed = loadEnv(envFile);
    assert.equal(parsed.TEST_VAR_A, "hello");
    assert.equal(parsed.TEST_VAR_B, "quoted_value");
    assert.equal(parsed.TEST_VAR_C, "single_quoted");
    delete process.env.TEST_VAR_A;
    delete process.env.TEST_VAR_B;
    delete process.env.TEST_VAR_C;
  });
});

/* ---------- unified prompt contract ---------- */
describe("unified prompt (prompts/feelc-copilot.prompt.md)", () => {
  const PROMPT_PATH = path.join(ROOT, "prompts", "feelc-copilot.prompt.md");
  const promptSrc = readFileSync(PROMPT_PATH, "utf8");

  test("exists and carries every deterministic section", () => {
    for (const section of [
      "OUTPUT CONTRACT", "TARGET GRAMMAR", "HARD BANS", "FACTOR-TABLE PATTERN",
      "SCALE DISCIPLINE", "SELF-CHECK", "REPAIR CODEBOOK", "COMPLETE WORKING EXAMPLES",
      "CONDITIONAL EXPRESSIONS",
    ]) assert.match(promptSrc, new RegExp(section));
    for (const code of ["CMP007", "CMP008", "DSL002", "DSL009", "DSL010", "CMP001"]) {
      assert.match(promptSrc, new RegExp(code), `codebook must mention ${code}`);
    }
  });

  test("both embedded example models verify CLEAN against the real engine", { timeout: 20000 }, () => {
    const sec = promptSrc.split("COMPLETE WORKING EXAMPLES")[1];
    const aBlock = sec.split("Example A")[1].split("Example B")[0].split("\n").slice(1).join("\n").trim();
    const bBlock = sec.split("Example B")[1].split("\n").slice(1).join("\n").trim();
    for (const [label, block] of [["A", aBlock], ["B", bBlock]]) {
      const f = path.join(TMP, `prompt_example_${label}.rules`);
      writeFileSync(f, block + "\n");
      verify(f).forEach(i => assert.fail(`prompt example ${label} failed verification: ${JSON.stringify(i)}`));
    }
  });
});
