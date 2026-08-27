Searched for "verify"
Viewed README.md:1-255

### 1. Is `feelc` just a "pre-checker"?

Not quite—**`feelc` is the entire compiler, formal verifier, and execution engine all in one** (the name stands for **FEEL Compiler**). 

Think of it like `rustc` (the Rust compiler):
* It doesn't just check syntax; it has a **deep mathematical verification pass** built directly into the compiler frontend (`feelc verify`).
* Once verified, `feelc` compiles the logic into an Intermediate Representation (IR), executes it on a deterministic Virtual Machine (`feelc run`), and exports it to standard **OMG DMN 1.3 XML** (`feelc export`).

---

### 2. The Detailed Checks Performed by `feelc`

When `feelc verify` runs, it subjects the rule model to **5 rigorous levels of checks**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          feelc Verification Stack                        │
├──────────────────────────────────────────────────────────────────────────┤
│ 1. Structural & DSL Syntax Checks (Grammar, Arity, Well-formedness)     │
│ 2. Static Type & Unit Safety (Type compatibility, Domains, Decimals)     │
│ 3. Dependency Graph & Topology (Cycle detection, Dangling references)   │
│ 4. Formal Verification / SMT (Totality/Gaps, Conflicts, Dead Rules)     │
│ 5. Decision Table Semantics (Hit policies, Context outputs, Literals)   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

#### Level 1: Formal Logic Proofs (Totality, Conflicts & SMT Solver)
*This is the most powerful part of `feelc`. It uses geometric hypercube partitioning and an **SMT solver (Z3)** to mathematically prove whether the logic has holes.*

1. **Completeness / Totality Check (Gap Detection):**
   * **What it checks:** Does the rule set provide an outcome for **100% of possible input combinations**?
   * **The Bug it Catches:** If Rule 1 handles `age < 18` and Rule 2 handles `age > 18`, what happens when a user is **exactly `18`**?
   * **Output:** It fails with a **concrete counterexample witness**:
     ```json
     {
       "code": "NON_TOTAL",
       "message": "Decision table is not exhaustive",
       "counterexample": { "age": 18, "income": 50000 }
     }
     ```

2. **Consistency & Overlap Check (Conflict Detection):**
   * **What it checks:** When using a `unique` hit policy, do two or more rules overlap on the same input with conflicting outputs?
   * **The Bug it Catches:** Rule A says `[500..700] => approve` and Rule B says `[600..800] => decline`. If a score is `650`, the engine cannot determine which decision is correct.

3. **Dead Rule / Subsumption Check (Shadowing):**
   * **What it checks:** Is there any rule that can **never be reached** because earlier rules completely swallow it?
   * **The Bug it Catches:** If Rule 1 says `income >= 0 => "low"` (which covers all positive numbers), Rule 2 saying `income >= 50000 => "high"` is dead code and will never trigger.

---

#### Level 2: Static Type & Domain Safety
*`feelc` enforces strict static typing and domain boundaries across all inputs and variables.*

1. **Input Domain Bounds:**
   * Validates that inputs stay within declared mathematical sets:
     * Numeric ranges: `input credit_score : number in [300..850]`
     * Non-negative bounds: `input annual_income : number >= 0`
     * String enumerations: `input tier : string in ["gold", "silver", "bronze"]`
2. **Exact Decimal Arithmetic (Money-Safe):**
   * Floating-point numbers in standard languages suffer from rounding errors (e.g. `0.1 + 0.2 = 0.30000000000000004`). `feelc` verifies arithmetic using exact fixed-point decimal rules (`half_even` banking rounding).
3. **Type Compatibility:**
   * Rejects illegal operations (e.g., trying to add a `string` to a `number`, or passing a `boolean` into a numeric interval).

---

#### Level 3: Graph Topology & Dependency Integrity
*In DMN, decisions feed into other decisions forming a Decision Requirements Graph (DRD).*

1. **Acyclic Verification (Cycle Detection):**
   * Proves that Decision A does not depend on Decision B while Decision B depends on Decision A (no infinite recursion loops).
2. **Dangling Reference Checking:**
   * Ensures every variable referenced in a table's `needs:` or in an expression has been explicitly declared as an `input` or a preceding `decision`.
3. **Sink Decision Resolution:**
   * Identifies the terminal output decision node(s) and verifies the entire evaluation pipeline converges into a valid final response.

---

#### Level 4: Decision Table Dimensions & Arity
*Validates the structural matrix of the decision tables.*

1. **Arity / Dimension Matching (`CMP004`, `DSL009`):**
   * If a table declares `needs: credit_score, dti, age` (3 inputs), **every single row must have exactly 3 condition cells** separated by `|`.
   * Rejects missing cells or empty spaces (must explicitly use `-` for "don't care").
2. **Context Output Width:**
   * If a table outputs a custom context type:
     ```dmn
     type DecisionResult = context { approved: boolean, rate: number, reason: string }
     ```
     Every row after `=>` must output exactly 3 values matching those exact types.

---

#### Level 5: Syntactic & Semantic Constraints (DSL Rules)

1. **Literal Output Enforcement (`CMP008`):**
   * Rejects dynamic math or variables placed inside table output cells. Table cells must be pure literal constants (e.g., `true`, `1.5`, `"approved"`), while dynamic math must be cleanly separated into dedicated literal decisions.
2. **Single-Line Context Types (`DSL010`) & Linear Expressions (`DSL002`):**
   * Enforces canonical single-line declarations so the model remains portable, deterministic, and easily git-diffable.
3. **Condition Expression Parenthesization (`CMP001`):**
   * Verifies that all compound conditional statements in FEEL expressions (`if ... then ... else ...`) are properly bracketed to prevent operator precedence ambiguities.

---

### Summary: Why This Matters for Natural Language

| Check Category | What `feelc verify` Does | What would happen without it |
| :--- | :--- | :--- |
| **Gaps / Totality** | Proves 100% of customer inputs are handled; gives counterexamples. | System crashes or returns `null` on unhandled edge cases in production. |
| **Conflicts / Overlaps** | Proves no two conflicting rules trigger at the same time. | Ambiguous decisions, nondeterministic behavior. |
| **Dead Rules** | Flags unreachable rules shadowed by previous logic. | Silent business logic failures and misleading rule books. |
| **Types & Arity** | Ensures table columns and variable types match the schema. | Broken XML export, runtime type cast errors. |
| **Cycle Detection** | Proves the decision dependency graph is a valid DAG. | Infinite loops or frozen decision engines. |

When the LLM generates a rule draft, `feelc verify` acts as the **mathematical gatekeeper**: if any of these checks fail, it generates structured diagnostics that force the LLM to self-heal until the model is 100% mathematically proven.