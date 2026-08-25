# NL→DMN Copilot Studio — Rigorous Test Report

**Date:** session of the full-stack test campaign
**Scope:** unit core · HTTP API (isolated server instance) · feelc engine (direct + via API) · frontend wiring · one user-approved **live LLM compile**
**Product code changed during testing:** none — findings reported, not patched

---

## 1. Results at a glance

| Layer | What ran | Result |
|---|---|---|
| Unit core (`copilot-lib.mjs`) | `node --test tests/unit.test.mjs` | ✅ **22/22 pass** |
| HTTP API + static delivery | `node --test tests/api.test.mjs` (**new**, spawns real server on ephemeral port) | ✅ **36/36 pass** |
| Engine, direct CLI | `feelc verify` both models; DMN re-export diff; `test-workflow.mjs` runner | ✅ clean · byte-identical export · 4/4 scenarios correct |
| Frontend wiring | syntax ×7 files · JS→HTML id cross-ref · subtab pairs · CSS braces | ✅ 42/42 ids resolve · no orphaned subtabs · 139/139 braces |
| Live compile E2E | `/api/compile` → spec persistence → evaluate fresh model | ✅ clean in **1 round**, 32 s, outputs exact |

**Total: 58 automated assertions green + 1 paid E2E verified end-to-end.**

---

## 2. What each layer proved

### 2.1 Decision logic — hand-computed expectations, all exact
Every value below was derived by hand from `out/*.rules`, then asserted against the running engine:

- **ride_pricing**: sunny `{3.5, 8, false, low}` → 15.5 / ×1.0 / 15.5, no surge · storm `{5,10,true,high}` → 20 / ×2.0 / **40** · dry rush `{4,15,false,high}` → 26.5 / ×1.5 / **39.75** · rain+medium → 23 / ×1.2 / **27.6** · all-zeros → 0 fare
- **loan_approval row priority**: age 17 with credit 720 → rejected **"minor"** even though finances are pristine (first-row precedence works); score 520 + rich income → "insufficient score"; dti 0.6 → "debt too high"
- **Tier boundaries**: 579 → reject · **580** → conditions · 679 → conditions · **680** → approved (interval `[580..680)` semantics exact)
- **Age boundary**: 17 minor / 18 approved
- **Zero-income branch**: income 0 + debt 0 → dti 0 → conditions; income 0 + debt >0 → dti **1** (100 % ratio rule) → "debt too high"

### 2.2 Batch pipeline
Preset 4-scenario suite → `passed: 4/4` with exact fares; a batch containing a broken scenario flags it (`passed:false`, error captured per-decision) while the healthy scenarios still execute; missing `rules`/`scenarios` → clean 400s.

### 2.3 Verify & graph endpoints
Both shipped models verify clean; garbage source returns a structured coded issue (`DSL006`), never a stack trace; `/api/graph` emits a valid `flowchart LR` naming all nodes.

### 2.4 Server robustness
Malformed JSON body → JSON error response (500) and **the process keeps serving**; unknown API route → structured 404; OPTIONS preflight → 204 with CORS headers; **10 parallel mixed-model evaluations never cross-contaminate** (the post-parse handler path is fully synchronous, so the `out/.tmp` scratch files can't race).

### 2.5 Static frontend delivery
`index.html` served with every Phase C/D hook present; `app.js`/`style.css` correct MIME types and symbols; all 42 `getElementById`/`#id` references in app.js resolve in index.html; all four subtab buttons have matching subviews; CSS braces balanced.

### 2.6 Spec persistence (the feature under test)
`my_model_1` (compiled earlier through the UI) serves its original NL spec back through `/api/models`; pre-feature models correctly report `spec: null`.

### 2.7 Live compile (paid, user-approved)
Tiny parking-fee spec through `/api/compile`:
- empty request → `400 "Specification text is required"` (free branch)
- real compile → **HTTP 200, rounds: 1** (no repair needed), manifest + typedInputs parsed correctly from the generated model, DMN contains `<definitions`
- `out/apitest_voucher.spec.txt` written **byte-identical** to the request spec
- immediately visible via My Models with spec attached
- fresh model executes correctly: weekday 3 h → **6**, weekend 9 h → **15**, template-defaults probe → 2
- artifacts cleaned up afterwards

---

## 3. Findings

### 🟡 F1 — Bug (minor): `null` input leaks engine envelope — `copilot-lib.mjs:257`
`runDecision` uses `parsed.output ?? parsed`; when the engine legitimately returns `output: null`, the whole `{decision, output}` wrapper reaches the client instead of `null` or an `__error`.
Repro: `evaluate-single` ride_pricing with `base_fare: null`.
Suggested one-line fix: `("output" in parsed) ? parsed.output : parsed`.
A regression sentinel asserting current behavior lives in the suite ("KNOWN QUIRK" test) — flip it when fixed.

### 🟠 F2 — Design gap (documented, by engine design): declared input domains are NOT enforced at runtime
Probed and pinned:
- `traffic_level: "banana"` → silently satisfies the catch-all table row (×1.0, no surge)
- `rain: "yes"` (string where boolean declared) → same silent fallback
- `base_fare: -5` (violates `>= 0`) → computes normally
- `credit_score: 900` (declared max 850) → **approved**

The declarations currently drive *form generation* (sliders/selects), not validation. Anyone hitting the raw API gets no guardrail. If desired later: validate/sanitize in `server.mjs` before execution using the already-parsed `typedInputs` (~15 lines).

### 🔵 F3 — Polish: malformed JSON bodies answer 500 instead of 400
Works safely (JSON error, server survives), just semantically imprecise.

### ⚪ F4 — Accepted quirks (pinned as regression tests)
SPA fallback serves `index.html` for any unknown non-API path; undeclared extra input keys are ignored.

---

## 4. Reproducing

```bash
node --test tests/unit.test.mjs          # free
node --test tests/api.test.mjs           # free — boots its own server on an ephemeral port
node tests/_probe.mjs                    # free — hostile-input discovery dump vs running server
node tests/_live-compile.mjs             # SPENDS CREDITS — one-shot paid E2E, self-cleaning
./bin/feelc verify --rules out/ride_pricing.rules --json
node test-workflow.mjs out/ride_pricing.rules tests/ride-scenarios.json
```

Not run: `tests/battery.mjs` (full 7-case NL→DMN battery) — each case costs an LLM compile; excluded to honor the approved credit budget. It remains available for a supervised full burn.
