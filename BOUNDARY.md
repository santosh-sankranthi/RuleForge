# BOUNDARY.md — Design envelope of the NL→DMN copilot

## What it IS built to handle

**Input contract:** a plain-English text file describing ONE self-contained decision domain:

| Dimension | Supported | Out of boundary |
|---|---|---|
| **Decision structure** | 1 final decision table + N intermediate literal decisions feeding it (a linear DRD) | Cyclic/meshed DRDs, multiple independent final tables, decision-table-in-the-middle graphs |
| **Input data types** | `number` (with range domains), `boolean`, `string` (equality/set membership) | Dates/timeouts, lists, composite input objects, ranges on strings |
| **Logic expressible** | FEEL subset: arithmetic (+ − × ÷), comparisons, interval ranges `[a..b)`, boolean and/or/not, string literals, if/then/else | Temporal functions (`between date and`), collection ops (`some…in…`), custom functions, external data lookups |
| **Hit policies** | first, unique, priority, any, collect, rule order | Output-order nuances; cross-row aggregates beyond COLLECT |
| **Outputs** | scalar OR one `context` type (≤ ~4 fields); every table must be TOTAL (default row) | Multiple context outputs, nested contexts in cells |
| **Model size** | ≤ ~3000 LLM output tokens (~60–100 lines of .rules) | Enterprise rule books with hundreds of rows (needs chunking strategy — not implemented) |
| **Language** | English NL specs | Other languages untested |
| **Engine** | feelc v1.11.4 verifier/exporter semantics | DMN features feelc rejects or approximates: input domains dropped by exporter, `default` row approximated as "all any" rule |

## Pipeline guarantees (the value proposition)

1. Any model that exits the pipeline has been **formally proven total & consistent** by feelc (SMT-backed) — never "looks right".
2. Exported DMN is **OMG DMN 1.3 XML** validated by round-tripping through the engine.
3. Smoke tests execute real evaluations against the exported logic before delivery.

## Known/accepted limitations (pre-hardening audit)

- LLM = gpt-4o-mini via OpenRouter; free-tier credit ceilings; no transient-error retry.
- Smoke-test inputs come from the same LLM — could be weakly distributed (mitigated: verdicts computed by feelc, not the LLM).
- Final-decision selection for smoke tests is heuristic (last `decision` line) — wrong for reordered models.
- Single-shot generation; no multi-file/chunked authoring.

*(This file is re-audited at the end of each hardening round.)*
