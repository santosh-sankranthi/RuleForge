/**
 * scale-cases.mjs — deterministic large-spec generator for scale benchmarks.
 *
 * Produces business-style NL specs of EXACTLY nRules numbered rules in the
 * factor-table-friendly style the unified prompt teaches (independent rating
 * factors composed multiplicatively/additively), PLUS an independent JS
 * expectation engine so compiled models can be scored without human math.
 *
 * Pure module — no I/O, no LLM calls. Same seed ⇒ byte-identical spec.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REGIONS = ["north", "south", "east", "west", "central"];
const SEGMENTS = ["basic", "standard", "premium", "elite"];
const TIERS = ["poor", "fair", "good", "excellent"];

/* Core rating structures — each entry renders as ONE numbered rule. */
const AGE_BANDS = [[16, 21, 1.80], [22, 24, 1.50], [25, 39, 1.00], [40, 59, 0.95], [60, 70, 1.05], [71, 90, 1.20]];
const TENURE_BANDS = [[0, 0, 1.00], [1, 2, 0.97], [3, 5, 0.93], [6, 10, 0.90], [11, 40, 0.85]];
const CLAIMS_LADDER = [[0, 0], [1, 120], [2, 250], [3, 500], [4, 800]];   // >4 → 1200
const SEGMENT_MULT = { basic: 1.00, standard: 0.95, premium: 0.88, elite: 0.80 };
const REGION_MULT = { north: 1.15, south: 0.92, east: 1.05, west: 1.00, central: 0.98 };
const TIER_MULT = { poor: 1.35, fair: 1.12, good: 1.00, excellent: 0.90 };
const FEE_BANDS = [[0, 1000, 25], [1000.01, 5000, 60], [5000.01, 15000, 140], [15000.01, 30000, 260], [30000.01, 60000, 480], [60000.01, 100000, 750]];

/**
 * Generate a scale case.
 * @param {number} nRules exact number of numbered business rules
 * @param {number} seed RNG seed
 * @returns {{name, nRules, inputs: object, spec: string, scenarios: Array<{name, input, expect}>}}
 */
export function genScaleCase(nRules, seed = 42) {
  const rnd = mulberry32(seed);
  let ruleNo = 0;
  const next = () => ++ruleNo;

  /* ---- extra generic metric factors until we hit EXACTLY nRules ---- */
  const CORE_RULES =
    AGE_BANDS.length + REGIONS.length + SEGMENTS.length + TIERS.length +
    TENURE_BANDS.length + CLAIMS_LADDER.length + 1 /* claims catch-all */ +
    FEE_BANDS.length + 4 /* gates */;
  const metrics = [];
  let remaining = nRules - CORE_RULES;
  if (remaining < 0) throw new Error(`nRules must be ≥ ${CORE_RULES} (core structure), got ${nRules}`);
  while (remaining > 0) {
    const k = metrics.length + 1;
    const take = Math.min(remaining, 3 + Math.floor(rnd() * 3)); // 3..5 bands, never overshoot
    // Contiguous bands covering [0..100] exactly, edges spread round-robin.
    const edges = Array.from({ length: take - 1 }, (_, j) => Math.round((100 * (j + 1)) / take));
    const bands = [];
    let lo = 0;
    for (let j = 0; j < take; j++) {
      const hi = j === take - 1 ? 100 : edges[j] - (edges[j] === lo ? 0 : 1);
      bands.push([lo, hi, Number((0.85 + rnd() * 0.30).toFixed(2))]);
      lo = hi + 1 > 100 ? 100 : hi + 1;
      if (lo > 100) break; // safety; cannot happen with spread edges
    }
    metrics.push({ k, bands });
    remaining -= take;
  }

  /* ---- input domain map (also drives scenario validity checks) ---- */
  const inputs = {
    base_amount: { type: "number", min: 0, max: 100000 },
    customer_age: { type: "number", min: 16, max: 90 },
    tenure_years: { type: "number", min: 0, max: 40 },
    prior_claims: { type: "number", min: 0, max: 10 },
    region: { type: "string", options: REGIONS },
    segment: { type: "string", options: SEGMENTS },
    credit_tier: { type: "string", options: TIERS },
    active_policy: { type: "boolean" },
    autopay_enrolled: { type: "boolean" },
  };
  for (const m of metrics) inputs[`metric_${m.k}`] = { type: "number", min: 0, max: 100 };

  /* ---- spec text ---- */
  const L = [];
  L.push(`Commercial rating engine for portfolio pricing (policy quotation):`);
  L.push(``);
  L.push(`Inputs:`);
  L.push(`- base_amount: number (0 to 100000)`);
  L.push(`- customer_age: number (16 to 90)`);
  L.push(`- tenure_years: number (0 to 40)`);
  L.push(`- prior_claims: number (0 to 10)`);
  L.push(`- region: text (${REGIONS.map(r => `"${r}"`).join(", ")})`);
  L.push(`- segment: text (${SEGMENTS.map(r => `"${r}"`).join(", ")})`);
  L.push(`- credit_tier: text (${TIERS.map(r => `"${r}"`).join(", ")})`);
  L.push(`- active_policy: boolean`);
  L.push(`- autopay_enrolled: boolean`);
  for (const m of metrics) {
    L.push(`- metric_${m.k}: number (0 to 100)`);
  }
  L.push(``);
  L.push(`Rules:`);

  L.push(`Age experience factor (multiply the risk factor):`);
  for (const [lo, hi, m] of AGE_BANDS) L.push(`- Rule ${next()}: if customer_age is ${lo} to ${hi}, the age factor is ${m.toFixed(2)}.`);

  L.push(`Regional load factor:`);
  for (const r of REGIONS) L.push(`- Rule ${next()}: if region is "${r}", the region factor is ${REGION_MULT[r].toFixed(2)}.`);

  L.push(`Segment factor:`);
  for (const s of SEGMENTS) L.push(`- Rule ${next()}: if segment is "${s}", the segment factor is ${SEGMENT_MULT[s].toFixed(2)}.`);

  L.push(`Credit tier factor:`);
  for (const t of TIERS) L.push(`- Rule ${next()}: if credit_tier is "${t}", the credit factor is ${TIER_MULT[t].toFixed(2)}.`);

  L.push(`Loyalty tenure discount factor:`);
  for (const [lo, hi, m] of TENURE_BANDS) L.push(`- Rule ${next()}: if tenure_years is ${lo} to ${hi}, the tenure factor is ${m.toFixed(2)}.`);

  for (const m of metrics) {
    L.push(`Metric ${m.k} adjustment factor:`);
    for (const [lo, hi, v] of m.bands) {
      L.push(lo === hi
        ? `- Rule ${next()}: if metric_${m.k} equals exactly ${lo}, the metric_${m.k} factor is ${v.toFixed(2)}.`
        : `- Rule ${next()}: if metric_${m.k} is ${lo} to ${hi}, the metric_${m.k} factor is ${v.toFixed(2)}.`);
    }
  }

  L.push(`Claims surcharge (flat euros added):`);
  for (const [c, amt] of CLAIMS_LADDER) L.push(`- Rule ${next()}: if prior_claims equals ${c}, add ${amt} euros surcharge.`);
  L.push(`- Rule ${next()}: if prior_claims is greater than 4, add 1200 euros surcharge.`);

  L.push(`Processing fee by amount band (flat euros added):`);
  for (const [lo, hi, fee] of FEE_BANDS) L.push(`- Rule ${next()}: if base_amount is ${lo} to ${hi}, add ${fee} euros processing fee.`);

  L.push(`Policy status gating and discounts:`);
  L.push(`- Rule ${next()}: if active_policy is false, the final price is exactly 0 regardless of all other rules.`);
  L.push(`- Rule ${next()}: if autopay_enrolled is true, apply a 2 percent discount on the composed price (multiply by 0.98).`);
  L.push(`- Rule ${next()}: if autopay_enrolled is false, apply no autopay adjustment.`);
  L.push(`- Rule ${next()}: the final price is base_amount multiplied by every factor above, plus the claims surcharge and the processing fee, then the autopay adjustment; a manual review flag is raised when the final price exceeds 20000.`);

  L.push(``);
  L.push(`Output:`);
  L.push(`- final_price (number)`);
  L.push(`- review_required (boolean)`);

  /* ---- expectation engine (mirrors the rules EXACTLY, same source structures) ---- */
  const bandLookup = (bands, v) => bands.find(([lo, hi]) => v >= lo && v <= hi);
  const expectFor = (inp) => {
    if (!inp.active_policy) return { final_price: 0, review_required: false };
    let mult = 1;
    const age = bandLookup(AGE_BANDS, inp.customer_age);
    if (!age) throw new Error(`age ${inp.customer_age} outside bands`);
    mult *= age[2];
    mult *= REGION_MULT[inp.region];
    mult *= SEGMENT_MULT[inp.segment];
    mult *= TIER_MULT[inp.credit_tier];
    const ten = bandLookup(TENURE_BANDS, inp.tenure_years);
    if (!ten) throw new Error(`tenure ${inp.tenure_years} outside bands`);
    mult *= ten[2];
    for (const m of metrics) {
      const b = bandLookup(m.bands, inp[`metric_${m.k}`]);
      if (!b) throw new Error(`metric_${m.k}=${inp["metric_" + m.k]} outside bands`);
      mult *= b[2];
    }
    const claimAmt = inp.prior_claims > 4 ? 1200 : (CLAIMS_LADDER.find(([c]) => c === inp.prior_claims)?.[1] ?? 0);
    const feeBand = FEE_BANDS.find(([lo, hi]) => inp.base_amount >= lo && inp.base_amount <= hi);
    if (!feeBand) throw new Error(`base_amount ${inp.base_amount} outside fee bands`);
    let price = inp.base_amount * mult + claimAmt + feeBand[2];
    if (inp.autopay_enrolled) price *= 0.98;
    return { final_price: price, review_required: price > 20000 };
  };

  /* ---- scenarios: distinct feature combinations incl. boundaries ---- */
  const mkInput = (over = {}) => {
    const base = {
      base_amount: 8000,
      customer_age: 35,
      tenure_years: 4,
      prior_claims: 0,
      region: "west",
      segment: "standard",
      credit_tier: "good",
      active_policy: true,
      autopay_enrolled: false,
    };
    for (const m of metrics) base[`metric_${m.k}`] = Math.round(((m.bands[1] || m.bands[0])[0] + (m.bands[1] || m.bands[0])[1]) / 2); // middle band
    return { ...base, ...over };
  };
  const scenDefs = [
    ["baseline mid-market", {}],
    ["young high-risk north", { customer_age: 18, region: "north", credit_tier: "poor", prior_claims: 5, base_amount: 45000 }],
    ["elite senior long-tenure", { customer_age: 68, segment: "elite", credit_tier: "excellent", tenure_years: 15, base_amount: 900, autopay_enrolled: true }],
    ["lapsed policy zero-out", { active_policy: false, base_amount: 70000 }],
    ["boundary band edges", { customer_age: 25, tenure_years: 6, prior_claims: 2, base_amount: 1000.01 }],
  ];
  const scenarios = scenDefs.slice(0, 5).map(([name, over]) => {
    const input = mkInput(over);
    return { name: `${name}`, input, expect: expectFor(input) };
  });

  return {
    name: `scale_${nRules}`,
    nRules,
    inputs,
    spec: L.join("\n"),
    scenarios,
    __metrics: metrics,   // consumed by renderScaleModel (free tier-0 benchmark)
  };
}

/**
 * Render the SAME structures as a hand-written feelc .rules model following the
 * unified prompt's factor-table architecture. Free tier-0 benchmark: proves the
 * ENGINE accepts & evaluates this scale, and that the expectation engine matches
 * engine semantics — independent of any LLM.
 */
export function renderScaleModel(c, { modelName } = {}) {
  const metrics = c.__metrics;
  const L = [];
  L.push(`model "${modelName || `${c.name}_ref`}" { rounding: half_even }`);
  L.push(`input base_amount : number >= 0`);
  L.push(`input customer_age : number in [16..90]`);
  L.push(`input tenure_years : number in [0..40]`);
  L.push(`input prior_claims : number in [0..10]`);
  L.push(`input region : string in [${REGIONS.map(r => `"${r}"`).join(", ")}]`);
  L.push(`input segment : string in [${SEGMENTS.map(r => `"${r}"`).join(", ")}]`);
  L.push(`input credit_tier : string in [${TIERS.map(r => `"${r}"`).join(", ")}]`);
  L.push(`input active_policy : boolean`);
  L.push(`input autopay_enrolled : boolean`);
  for (const m of metrics) L.push(`input metric_${m.k} : number in [0..100]`);

  const table = (name, needs, rows, comment) => {
    L.push(`decision ${name} : number {`);
    L.push(`  needs: ${needs}`);
    L.push(`  hit: first`);
    if (comment) L.push(`  #  ${comment}`);
    for (const [cell, out] of rows) L.push(`     ${cell} => ${out}`);
    L.push(`}`);
  };

  table("age_factor", "customer_age", [
    ...AGE_BANDS.map(([lo, hi, m]) => ([`[${lo}..${hi}]`, m.toFixed(2)])),
    [`-`, `1.00`],
  ], "customer_age  => factor");
  table("region_factor", "region", [
    ...REGIONS.map(r => ([`"${r}"`, REGION_MULT[r].toFixed(2)])),
    [`-`, `1.00`],
  ], "region  => factor");
  table("segment_factor", "segment", [
    ...SEGMENTS.map(s => ([`"${s}"`, SEGMENT_MULT[s].toFixed(2)])),
    [`-`, `1.00`],
  ], "segment  => factor");
  table("credit_factor", "credit_tier", [
    ...TIERS.map(t => ([`"${t}"`, TIER_MULT[t].toFixed(2)])),
    [`-`, `1.00`],
  ], "credit_tier  => factor");
  table("tenure_factor", "tenure_years", [
    ...TENURE_BANDS.map(([lo, hi, m]) => ([`[${lo}..${hi}]`, m.toFixed(2)])),
    [`-`, `1.00`],
  ], "tenure_years  => factor");
  for (const m of metrics) {
    table(`metric_${m.k}_factor`, `metric_${m.k}`, [
      ...m.bands.map(([lo, hi, v]) => (
        lo === hi ? [`${lo}`, v.toFixed(2)]
          : (lo === 0 && hi === 100) ? [`-`, v.toFixed(2)] /* single total band */
            : [`[${lo}..${hi}]`, v.toFixed(2)])),
      [`-`, `1.00`],
    ], `metric_${m.k}  => factor`);
  }
  table("claims_surcharge", "prior_claims", [
    ...CLAIMS_LADDER.map(([cnt, amt]) => ([`${cnt}`, `${amt}`])),
    [`-`, `1200`],
  ], "prior_claims  => surcharge");
  table("processing_fee", "base_amount", [
    ...FEE_BANDS.map(([lo, hi, fee]) => ([`[${lo}..${hi}]`, `${fee}`])),
    [`-`, `750`],
  ], "base_amount  => fee");

  L.push(`decision autopay_gate : number = if (autopay_enrolled) then 0.98 else 1`);
  L.push(`decision active_gate : number = if (active_policy) then 1 else 0`);

  const factors = ["age_factor", "region_factor", "segment_factor", "credit_factor", "tenure_factor",
    ...metrics.map(m => `metric_${m.k}_factor`)];
  let expr = "base_amount";
  for (const f of factors) expr = `(${expr} * ${f})`;
  L.push(`decision composed_amount : number = ${expr}`);
  L.push(`decision final_price : number = ((((composed_amount + claims_surcharge) + processing_fee) * autopay_gate) * active_gate)`);
  L.push(`decision review_required : boolean = final_price > 20000`);
  return L.join("\n") + "\n";
}
