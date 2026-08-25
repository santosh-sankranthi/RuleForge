# RuleForge ⚡

> **RuleForge** is an AI-native compiler and copilot that transforms natural-language business rules into provably sound, formally verified **DMN 1.3** and **FEEL** models using the deterministic `feelc` rules engine.

---

## 🎯 Key Highlights

- **Natural Language to Verified Rules:** Write specifications in plain English (e.g., mortgage approvals, dynamic ride pricing, tax tiers).
- **Formal Verification (SMT / Totality / Consistency):** Mathematical proofs guarantee no logic gaps and no conflicting rules before execution.
- **Autonomous Repair Loop:** If the engine finds an edge case or counterexample, it automatically feeds structured compiler diagnostics back to the LLM to self-heal.
- **Interactive UI & Visual Decision Graph:** Built-in web interface featuring live decision graphs, manual test evaluation consoles, and batch scenario runners.
- **Standard DMN 1.3 XML Export:** Clean, one-click export for execution on enterprise BPMN/DMN engines (Camunda, Drools, Trisotech).
- **Zero-Runtime-Dependency Core:** Powered by native Node.js and a self-contained static `feelc` binary.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: `v18.0.0` or higher
- **Azure AI Foundry / Azure OpenAI** (or OpenRouter / OpenAI) API credentials

### 2. Configure Credentials (Single Place)
Copy `.env.example` to `.env` and enter your Azure AI Foundry details:

```bash
cp .env.example .env
```

Edit `.env`:
```env
AZURE_AI_ENDPOINT=https://your-resource-name.services.ai.azure.com/models
AZURE_AI_API_KEY=your_azure_ai_api_key_here
AZURE_AI_MODEL=gpt-4o
AZURE_AI_API_VERSION=2024-06-01
```

> **Note:** RuleForge supports both Azure AI Model Inference endpoints (`*.services.ai.azure.com`, `*.models.ai.azure.com`) and Azure OpenAI Service deployments (`*.openai.azure.com`).

### 3. Launch the Web UI
```bash
npm start
# Opens RuleForge Studio at http://localhost:3088
```

### 4. Or Run CLI Compilation
```bash
node copilot.mjs nl-rules/loan-approval.txt loan_approval
```

---

## 🧪 Testing

Run the test suite:
```bash
npm test
```

---

## 📁 Repository Structure

```
├── bin/                       # feelc compiler & verifier engine binaries
├── nl-rules/                  # Sample natural language rule specifications
├── prompts/                   # Compiler prompt definitions and syntax rules
├── public/                    # Interactive web UI and decision visualizer
├── tests/                     # Unit and integration test suites
├── copilot.mjs                # CLI orchestrator
├── copilot-lib.mjs            # Core compiler library & feelc bridge
├── server.mjs                 # HTTP API server & web application
├── package.json               # Project manifest and scripts
└── requirements.txt           # Environment requirements
```

---

## 📜 License
Apache-2.0
