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

## 🚀 Setup & Quick Start

### 1. Prerequisites
- **Node.js**: `v18.0.0` or higher
- **Go**: `v1.23` or higher (required if compiling `feelc` for Linux/Windows/Intel Mac)
- **Azure AI Foundry / Azure OpenAI** (or OpenRouter / OpenAI) API credentials

---

### 2. Setting Up the `feelc` Engine (Cross-Platform)

RuleForge uses the compiled **`feelc`** binary for formal SMT verification and execution.

- **macOS Apple Silicon (M1/M2/M3/M4):** A pre-built binary is already included at `bin/feelc`. Make sure it is executable:
  ```bash
  chmod +x bin/feelc
  ```

- **Linux / Windows / Intel macOS / Custom Build:**
  If you are running on Linux, Windows, or Intel Mac, clone and build `feelc` natively:
  ```bash
  # 1. Clone the feelc engine repository
  git clone https://github.com/maxgfr/feelc.git

  # 2. Build the feelc binary directly into RuleForge's bin/ folder
  cd feelc
  go build -o ../bin/feelc ./cmd/feelc
  cd ..
  ```
  *(On Windows, build as `go build -o ../bin/feelc.exe ./cmd/feelc`)*

---

### 3. Optional: Setting Up `dmn-js-mcp` (MCP Diagram Server)

If you plan to use the Model Context Protocol (MCP) server for DMN diagram rendering and interactive editing:

```bash
# 1. Clone the dmn-js-mcp repository
git clone https://github.com/datakurre/dmn-js-mcp.git

# 2. Install dependencies and build
cd dmn-js-mcp
npm install
npm run build
cd ..
```

---

### 4. Configure Credentials (`.env`)
Copy `.env.example` to `.env` in the root folder:

```bash
cp .env.example .env
```

Edit `.env` with your Azure AI Foundry or OpenAI credentials:
```env
AZURE_AI_ENDPOINT=https://your-resource-name.services.ai.azure.com/models
AZURE_AI_API_KEY=your_azure_ai_api_key_here
AZURE_AI_MODEL=gpt-4o
AZURE_AI_API_VERSION=2024-06-01
```

---

### 5. Verify Your Setup (2-Second Diagnostic)

Run the built-in system and connection tester:
```bash
npm run check
```
This confirms both your local `feelc` binary and your LLM API credentials are functioning properly.

---

### 6. Launch RuleForge

**Web UI & Workbench:**
```bash
npm start
# Opens RuleForge Studio at http://localhost:3088
```

**CLI Compilation:**
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
