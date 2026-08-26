#!/usr/bin/env node
/**
 * check-connection.mjs — 2-second diagnostic tool for testing your LLM connection.
 * Usage: node check-connection.mjs (or npm run check)
 */
import { loadLlmConfig, postJson, FEELC } from "./copilot-lib.mjs";
import { execFileSync } from "node:child_process";

console.log("\n🔍 Testing RuleForge System & LLM Connection...");
console.log("================================================");

// 1. Engine Check
console.log("\n1️⃣  Checking feelc Rules Engine Binary:");
try {
  const version = execFileSync(FEELC, ["version"], { encoding: "utf8" }).trim();
  console.log(`   ✅ Engine Binary : ${FEELC}`);
  console.log(`   ✅ Engine Version: ${version}`);
} catch (e) {
  console.error(`   ❌ Engine Error  : Cannot execute '${FEELC}'`);
  console.error(`      Detail: ${e.message}`);
  console.error("\n👉 Fix for your OS (Linux/Windows/Intel Mac):");
  console.error("   Run:");
  console.error("     git clone https://github.com/maxgfr/feelc.git");
  console.error("     cd feelc && go build -o ../bin/feelc ./cmd/feelc\n");
}

// 2. LLM Config Check
console.log("\n2️⃣  Checking LLM Configuration (.env):");
const cfg = loadLlmConfig();
console.log(`   ▸ Provider : ${cfg.provider.toUpperCase()}`);
console.log(`   ▸ Model    : ${cfg.model}`);
console.log(`   ▸ Endpoint : ${cfg.url || "(none configured)"}`);
console.log(`   ▸ API Key  : ${cfg.apiKey ? cfg.apiKey.slice(0, 6) + "..." + cfg.apiKey.slice(-4) : "(missing)"}`);
console.log("------------------------------------------------");

if (!cfg.apiKey) {
  console.error("❌ ERROR: No API key found.");
  console.error("👉 Fix: Copy .env.example to .env and set AZURE_AI_API_KEY (or OPENROUTER_API_KEY).");
  process.exit(1);
}

if (!cfg.url) {
  console.error("❌ ERROR: No endpoint URL resolved.");
  console.error("👉 Fix: In .env set AZURE_AI_ENDPOINT (e.g. https://<your-resource>.services.ai.azure.com/models).");
  process.exit(1);
}

console.log("🚀 Sending ping request to endpoint...");
const t0 = Date.now();

try {
  const payload = JSON.stringify({
    model: cfg.model,
    max_tokens: 10,
    temperature: 0.1,
    messages: [{ role: "user", content: "Reply with the single word 'READY'." }],
  });

  const { status, text } = await postJson(cfg.url, cfg.headers, payload, { timeoutMs: 15_000 });
  const elapsed = Date.now() - t0;

  let body = {};
  try { body = JSON.parse(text); } catch {}

  if (status === 200) {
    const reply = body.choices?.[0]?.message?.content?.trim() || "(empty response)";
    console.log(`\n✅ SUCCESS! (HTTP 200 in ${elapsed}ms)`);
    console.log(`🤖 Model replied: "${reply}"`);
    console.log("\nYour RuleForge setup is fully working and ready to compile rules!\n");
  } else {
    console.error(`\n❌ REQUEST FAILED (HTTP ${status} in ${elapsed}ms)`);
    console.error(`Response body:\n${text}\n`);

    if (status === 401 || status === 403) {
      console.error("💡 Remediation: Check that AZURE_AI_API_KEY matches Key 1 / Key 2 from Azure Portal.");
    } else if (status === 404) {
      console.error(`💡 Remediation: The deployment '${cfg.model}' was not found at this endpoint.`);
      console.error("   Check your Azure Foundry 'Deployments' page and set AZURE_AI_MODEL to the exact Deployment Name.");
    } else if (status === 400) {
      console.error("💡 Remediation: Check model parameters or API version in .env.");
    }
    process.exit(1);
  }
} catch (e) {
  const elapsed = Date.now() - t0;
  console.error(`\n❌ NETWORK / TRANSPORT ERROR after ${elapsed}ms:`);
  console.error(e.message || e);
  if (/certificate|SSL|TLS/i.test(e.message)) {
    console.error("\n💡 Corporate SSL Inspection detected. Try running:");
    console.error("   NODE_TLS_REJECT_UNAUTHORIZED=0 node check-connection.mjs");
  }
  process.exit(1);
}
