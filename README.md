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
- **OpenRouter API Key** (or any OpenAI-compatible endpoint)

### 2. Set Your API Key
```bash
export OPENROUTER_API_KEY="your-openrouter-api-key"
```

### 3. Launch the Web UI
```bash
npm start
# Opens RuleForge server at http://127.0.0.1:3000
```

### 4. Or Run CLI Compilation
```bash
node copilot.mjs nl-rules/loan-approval.txt
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
