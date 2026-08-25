/**
 * tests/advanced-cases.mjs — pure data: 10 monster NL specs (20 rules each)
 * + hand-computed scenarios. No side effects; safe to import.
 *
 * Expectations were computed BY HAND from each spec's pinned numbers BEFORE
 * compiling. A mismatch = LLM miscompile, spec ambiguity, or engine bug.
 * checks: {field,value} equality (1e-6 tol) | {field,value,contains:true} substring.
 */
export const CASES = [
{
  id: "expense_routing", kind: "Corporate expense approval routing",
  spec: `Corporate expense report approval routing:

Inputs:
- expense_amount: number in USD (>= 0)
- expense_category: text ("flights", "hotels", "meals", "software", "entertainment")
- employee_level: text ("junior", "mid_level", "director", "vp", "c_level")
- has_receipt: boolean
- contains_alcohol: boolean
- days_since_incurred: number (>= 0)
- budget_remaining: number in USD
- prior_violations_count: number (>= 0)

Rules:
- If has_receipt is false and expense_amount > 25.00, flag as "Rejected" with rejection_reason "Missing Receipt".
- If days_since_incurred > 90, flag as "Rejected" with rejection_reason "Out of Policy Window".
- If prior_violations_count >= 3, status is "Audit Hold" regardless of amount, and requires_manual_audit is true.
- If expense_amount > budget_remaining, flag as "Rejected" with rejection_reason "Exceeds Budget".
- If expense_category is "meals" and contains_alcohol is true and employee_level is "junior", flag as "Rejected" with rejection_reason "Alcohol Policy".
- If expense_category is "meals" and expense_amount > 100.00 per person, require "Manager Approval".
- If expense_category is "hotels" and expense_amount <= 250.00, base status "Auto-Approved".
- If expense_category is "hotels" and expense_amount > 250.00 and <= 400.00, require "Manager Approval".
- If expense_category is "hotels" and expense_amount > 400.00, require "Director Approval".
- If expense_category is "flights" and expense_amount > 1000.00, require "Director Approval".
- If expense_category is "flights" and expense_amount > 3000.00, require "VP Approval".
- If expense_category is "software" and expense_amount > 500.00, require "IT Department Approval".
- If expense_category is "entertainment" and contains_alcohol is true, require "Director Approval" regardless of amount.
- If employee_level is "c_level", bypass all limits up to 10000 and status is "Auto-Approved".
- If a report requires both Manager Approval and Director Approval from category rules, escalate to "Director Approval".
- If no specific rejection or escalation rule triggered and expense_amount <= 50.00, status is "Auto-Approved".
- In all other unhandled combinations, default to "Manager Approval".

Output:
- routing_status (text)
- requires_manual_audit (boolean)
- rejection_reason (text)`,
  checks: [
    { name: "missing receipt reject", input: { expense_amount: 100, expense_category: "meals", employee_level: "junior", has_receipt: false, contains_alcohol: false, days_since_incurred: 5, budget_remaining: 5000, prior_violations_count: 0 }, expect: [{ field: "routing_status", value: "Rejected" }, { field: "rejection_reason", value: "Missing Receipt" }] },
    { name: "out of policy window", input: { expense_amount: 200, expense_category: "hotels", employee_level: "mid_level", has_receipt: true, contains_alcohol: false, days_since_incurred: 95, budget_remaining: 10000, prior_violations_count: 0 }, expect: [{ field: "routing_status", value: "Rejected" }, { field: "rejection_reason", value: "Out of Policy Window" }] },
    { name: "3 violations audit hold wins", input: { expense_amount: 50, expense_category: "meals", employee_level: "mid_level", has_receipt: true, contains_alcohol: false, days_since_incurred: 10, budget_remaining: 5000, prior_violations_count: 3 }, expect: [{ field: "routing_status", value: "Audit Hold" }] },
    { name: "c_level bypass under 10k", input: { expense_amount: 9000, expense_category: "flights", employee_level: "c_level", has_receipt: true, contains_alcohol: false, days_since_incurred: 2, budget_remaining: 20000, prior_violations_count: 0 }, expect: [{ field: "routing_status", value: "Auto-Approved" }] },
    { name: "hotel mid band manager", input: { expense_amount: 300, expense_category: "hotels", employee_level: "junior", has_receipt: true, contains_alcohol: false, days_since_incurred: 5, budget_remaining: 5000, prior_violations_count: 0 }, expect: [{ field: "routing_status", value: "Manager Approval" }] },
    { name: "flight over 3000 escalates to VP", input: { expense_amount: 3500, expense_category: "flights", employee_level: "director", has_receipt: true, contains_alcohol: false, days_since_incurred: 5, budget_remaining: 50000, prior_violations_count: 0 }, expect: [{ field: "routing_status", value: "VP Approval" }] },
    { name: "entertainment with alcohol director", input: { expense_amount: 80, expense_category: "entertainment", employee_level: "junior", has_receipt: true, contains_alcohol: true, days_since_incurred: 5, budget_remaining: 5000, prior_violations_count: 0 }, expect: [{ field: "routing_status", value: "Director Approval" }] },
  ],
},
{
  id: "insurance_underwriting", kind: "Auto insurance sequential multipliers",
  spec: `Auto insurance premium underwriting:

Inputs:
- base_premium: number
- driver_age: number (>= 16)
- vehicle_age_years: number (>= 0)
- vehicle_type: text ("sedan", "suv", "sports_car", "truck")
- marital_status: text ("single", "married", "divorced")
- accidents_last_3_years: number (>= 0)
- speeding_tickets_last_3_years: number (>= 0)
- dui_convictions: number (>= 0)
- daily_commute_miles: number (>= 0)
- credit_tier: text ("poor", "fair", "good", "excellent")

Rules:
- The initial premium equals base_premium.
- If dui_convictions > 0 the application is declined: final_premium 0 and is_declined true.
- If accidents_last_3_years > 2 AND driver_age < 25, the application is declined.
- Age multiplier: driver_age 16 to 21 applies 2.0x; 22 to 24 applies 1.5x; 25 to 65 applies 1.0x; above 65 applies 1.2x.
- Vehicle type multiplier: sports_car 1.6x; suv or truck 1.1x; sedan 1.0x.
- Vehicle age multiplier: below 3 years 1.2x; above 15 years 0.8x; otherwise 1.0x.
- If marital_status is married AND driver_age < 25 apply 0.85x discount multiplier.
- Credit tier multiplier: poor 1.4x; excellent 0.8x; fair and good 1.0x.
- Add a flat 150 surcharge per speeding ticket in the last 3 years.
- Add a flat 300 surcharge for the first accident and an additional flat 500 surcharge for the second accident in the last 3 years.
- Commute multiplier applied after all surcharges: above 30 miles 1.15x; below 5 miles 0.9x; otherwise 1.0x.
- After all calculations, if final_premium exceeds 5000 set requires_manual_review true, otherwise false.

Output:
- final_premium (number)
- is_declined (boolean)
- requires_manual_review (boolean)`,
  checks: [
    { name: "DUI instant decline", input: { base_premium: 1000, driver_age: 40, vehicle_age_years: 5, vehicle_type: "sedan", marital_status: "single", accidents_last_3_years: 0, speeding_tickets_last_3_years: 0, dui_convictions: 1, daily_commute_miles: 10, credit_tier: "good" }, expect: [{ field: "is_declined", value: true }, { field: "final_premium", value: 0 }] },
    { name: "baseline middle-aged sedan", input: { base_premium: 1000, driver_age: 40, vehicle_age_years: 5, vehicle_type: "sedan", marital_status: "single", accidents_last_3_years: 0, speeding_tickets_last_3_years: 0, dui_convictions: 0, daily_commute_miles: 10, credit_tier: "good" }, expect: [{ field: "final_premium", value: 1000 }, { field: "is_declined", value: false }, { field: "requires_manual_review", value: false }] },
    { name: "young sports poor credit tickets commute", input: { base_premium: 800, driver_age: 20, vehicle_age_years: 2, vehicle_type: "sports_car", marital_status: "married", accidents_last_3_years: 0, speeding_tickets_last_3_years: 2, dui_convictions: 0, daily_commute_miles: 35, credit_tier: "poor" }, expect: [{ field: "final_premium", value: 4549.032 }, { field: "requires_manual_review", value: false }] },
    { name: "senior truck excellent low mileage accident", input: { base_premium: 1200, driver_age: 70, vehicle_age_years: 16, vehicle_type: "truck", marital_status: "divorced", accidents_last_3_years: 1, speeding_tickets_last_3_years: 0, dui_convictions: 0, daily_commute_miles: 3, credit_tier: "excellent" }, expect: [{ field: "final_premium", value: 1182.384 }] },
    { name: "teen sports car over 5000 review", input: { base_premium: 3000, driver_age: 18, vehicle_age_years: 1, vehicle_type: "sports_car", marital_status: "single", accidents_last_3_years: 0, speeding_tickets_last_3_years: 0, dui_convictions: 0, daily_commute_miles: 40, credit_tier: "fair" }, expect: [{ field: "final_premium", value: 13248 }, { field: "requires_manual_review", value: true }] },
    { name: "3 accidents under 25 decline", input: { base_premium: 500, driver_age: 22, vehicle_age_years: 4, vehicle_type: "sedan", marital_status: "single", accidents_last_3_years: 3, speeding_tickets_last_3_years: 0, dui_convictions: 0, daily_commute_miles: 10, credit_tier: "fair" }, expect: [{ field: "is_declined", value: true }] },
  ],
},
{
  id: "invoice_processing", kind: "Invoice variance & exception routing",
  spec: `Automated invoice processing and exceptions:

Inputs:
- invoice_amount: number
- matched_po_amount: number
- vendor_trust_score: number in [1..100]
- is_tax_id_present: boolean
- country_of_origin: text
- bank_account_changed: boolean
- days_past_due: number
- contains_restricted_items: boolean

Rules:
- If is_tax_id_present is false, invoice_status is "Exception - Missing Compliance Data".
- If bank_account_changed is true, invoice_status is "High Risk Hold".
- If country_of_origin is "North Korea" or "Iran", invoice_status is "Rejected - Sanctions".
- If contains_restricted_items is true, invoice_status is "Legal Review Required".
- calculated_variance = invoice_amount - matched_po_amount.
- If calculated_variance is exactly 0 and no holds exist, invoice_status is "Ready for Payment".
- If calculated_variance > 0 and <= 50, auto-approve the variance.
- If calculated_variance > 50 and <= 500, invoice_status is "Procurement Review".
- If calculated_variance > 500, invoice_status is "Department Head Review".
- If invoice_amount > 100000, invoice_status is "CFO Final Sign-off" regardless of PO match.
- If invoice_amount < 0 it is a credit memo applied to vendor balance; prioritize_payment is false.
- If invoice_amount is exactly 0, invoice_status is "Invalid Invoice Amount".
- If bank_account_changed is true AND vendor_trust_score < 50, vendor_profile_frozen is true, otherwise false.
- If no flags or variances apply, prioritize_payment is false.

Output:
- invoice_status (text)
- calculated_variance (number)
- prioritize_payment (boolean)
- vendor_profile_frozen (boolean)`,
  checks: [
    { name: "clean exact match", input: { invoice_amount: 1000, matched_po_amount: 1000, vendor_trust_score: 85, is_tax_id_present: true, country_of_origin: "USA", bank_account_changed: false, days_past_due: 0, contains_restricted_items: false }, expect: [{ field: "invoice_status", value: "Ready for Payment" }, { field: "calculated_variance", value: 0 }, { field: "vendor_profile_frozen", value: false }] },
    { name: "large variance department head", input: { invoice_amount: 2000, matched_po_amount: 1000, vendor_trust_score: 85, is_tax_id_present: true, country_of_origin: "USA", bank_account_changed: false, days_past_due: 0, contains_restricted_items: false }, expect: [{ field: "calculated_variance", value: 1000 }, { field: "invoice_status", value: "Department Head Review" }] },
    { name: "bank change freezes low-trust vendor", input: { invoice_amount: 700, matched_po_amount: 700, vendor_trust_score: 45, is_tax_id_present: true, country_of_origin: "USA", bank_account_changed: true, days_past_due: 0, contains_restricted_items: false }, expect: [{ field: "vendor_profile_frozen", value: true }, { field: "invoice_status", value: "High Risk Hold" }] },
    { name: "sanctioned country", input: { invoice_amount: 5000, matched_po_amount: 5000, vendor_trust_score: 90, is_tax_id_present: true, country_of_origin: "Iran", bank_account_changed: false, days_past_due: 0, contains_restricted_items: false }, expect: [{ field: "invoice_status", value: "Rejected - Sanctions" }] },
    { name: "over 100k CFO signoff", input: { invoice_amount: 150000, matched_po_amount: 150000, vendor_trust_score: 90, is_tax_id_present: true, country_of_origin: "USA", bank_account_changed: false, days_past_due: 0, contains_restricted_items: false }, expect: [{ field: "invoice_status", value: "CFO Final Sign-off", contains: true }] },
    { name: "zero amount invalid", input: { invoice_amount: 0, matched_po_amount: 0, vendor_trust_score: 80, is_tax_id_present: true, country_of_origin: "USA", bank_account_changed: false, days_past_due: 0, contains_restricted_items: false }, expect: [{ field: "invoice_status", value: "Invalid Invoice Amount" }] },
  ],
},
{
  id: "fraud_detection", kind: "Card fraud additive risk scoring",
  spec: `Credit card transaction fraud detection:

Inputs:
- transaction_amount: number
- user_account_age_days: number
- distance_from_home_km: number
- is_international: boolean
- card_present: boolean
- mcc_code: text
- transactions_last_24h: number
- failed_pin_attempts: number
- is_vpn_detected: boolean
- time_of_day_local: number in [0..23]

Rules:
- final_risk_score starts at 0.
- If failed_pin_attempts >= 3, SET final_risk_score to 100.
- If transactions_last_24h > 15, add 30.
- If transactions_last_24h > 30, add 60 more.
- If user_account_age_days < 7, add 20.
- If transaction_amount > 5000, add 25.
- If transaction_amount < 2, add 15.
- If distance_from_home_km > 500 AND card_present, add 40.
- If is_international AND user_account_age_days < 30, add 50.
- If card_present is false AND is_vpn_detected, add 35.
- If time_of_day_local >= 1 AND <= 4, add 15.
- If mcc_code is "Jewelry" or "Electronics" and transaction_amount > 1000, add 25.
- If mcc_code is "Cryptocurrency Exchange", add 30.
- If mcc_code is "Grocery" or "Gas Station", subtract 10.
- If distance_from_home_km < 10, subtract 15.
- Action thresholds on the FINAL score: at least 85 → "Decline & Lock Card"; 65 to 84 → "Decline & Send SMS Verification"; 40 to 64 → "Approve but Flag for Review"; below 40 → "Approve".

Output:
- final_risk_score (number)
- action_taken (text)`,
  checks: [
    { name: "3 failed PINs score exactly 100 lock", input: { transaction_amount: 50, user_account_age_days: 400, distance_from_home_km: 50, is_international: false, card_present: true, mcc_code: "Restaurant", transactions_last_24h: 1, failed_pin_attempts: 3, is_vpn_detected: false, time_of_day_local: 14 }, expect: [{ field: "final_risk_score", value: 100 }, { field: "action_taken", value: "Decline & Lock Card" }] },
    { name: "online VPN night electronics jackpot 200", input: { transaction_amount: 6000, user_account_age_days: 5, distance_from_home_km: 800, is_international: true, card_present: false, mcc_code: "Electronics", transactions_last_24h: 20, failed_pin_attempts: 0, is_vpn_detected: true, time_of_day_local: 3 }, expect: [{ field: "final_risk_score", value: 200 }, { field: "action_taken", value: "Decline & Lock Card" }] },
    { name: "local grocery goes negative approve", input: { transaction_amount: 60, user_account_age_days: 1000, distance_from_home_km: 5, is_international: false, card_present: true, mcc_code: "Grocery", transactions_last_24h: 2, failed_pin_attempts: 0, is_vpn_detected: false, time_of_day_local: 14 }, expect: [{ field: "final_risk_score", value: -25 }, { field: "action_taken", value: "Approve" }] },
    { name: "big amount small hours flag review 40", input: { transaction_amount: 5500, user_account_age_days: 500, distance_from_home_km: 20, is_international: false, card_present: true, mcc_code: "Furniture", transactions_last_24h: 2, failed_pin_attempts: 0, is_vpn_detected: false, time_of_day_local: 2 }, expect: [{ field: "final_risk_score", value: 40 }, { field: "action_taken", value: "Approve but Flag for Review" }] },
    { name: "velocity plus new international SMS 80", input: { transaction_amount: 100, user_account_age_days: 20, distance_from_home_km: 30, is_international: true, card_present: false, mcc_code: "Clothing", transactions_last_24h: 18, failed_pin_attempts: 0, is_vpn_detected: false, time_of_day_local: 12 }, expect: [{ field: "final_risk_score", value: 80 }, { field: "action_taken", value: "Decline & Send SMS Verification" }] },
  ],
},
{
  id: "dynamic_pricing", kind: "E-commerce pricing stack with caps",
  spec: `E-commerce dynamic pricing and discounting:

Inputs:
- base_price: number
- inventory_level: number
- customer_ltv_tier: text ("new", "bronze", "silver", "gold", "vip")
- cart_abandonment_recovery: boolean
- seasonality_factor: text ("off_peak", "normal", "peak")
- product_category: text ("electronics", "apparel", "home", "clearance")
- user_device: text ("mobile", "desktop")
- traffic_source: text ("organic", "paid_ads", "affiliate")

Rules:
- calculated_price starts equal to base_price.
- If inventory_level == 0, is_out_of_stock is true and final_display_price is 0.
- VIP customers get a flat 10 percent discount on calculated_price; gold gets 5 percent.
- If cart_abandonment_recovery is true, apply a one-time 20 percent discount.
- If traffic_source is "affiliate", the cart_abandonment_recovery discount does not stack (remove it).
- If product_category is "apparel" AND seasonality_factor is "peak", remove all LTV tier discounts.
- If base_price < 10.00, do not apply any percentage discounts regardless of tier or other rules.
- Shipping: vip AND cart_abandonment_recovery → "Free Overnight"; calculated_price > 500 → "Free Standard Shipping"; otherwise "Standard".
- Set final_display_price to calculated_price rounded to the nearest value ending in .99.

Output:
- final_display_price (number)
- shipping_offer (text)
- is_out_of_stock (boolean)`,
  checks: [
    { name: "out of stock zeroes everything", input: { base_price: 100, inventory_level: 0, customer_ltv_tier: "gold", cart_abandonment_recovery: false, seasonality_factor: "normal", product_category: "home", user_device: "desktop", traffic_source: "organic" }, expect: [{ field: "is_out_of_stock", value: true }, { field: "final_display_price", value: 0 }] },
    { name: "600 dollar order free standard shipping", input: { base_price: 600, inventory_level: 50, customer_ltv_tier: "silver", cart_abandonment_recovery: false, seasonality_factor: "normal", product_category: "apparel", user_device: "desktop", traffic_source: "organic" }, expect: [{ field: "is_out_of_stock", value: false }, { field: "shipping_offer", value: "Free Standard Shipping" }] },
    { name: "vip abandonment free overnight 143.99", input: { base_price: 200, inventory_level: 30, customer_ltv_tier: "vip", cart_abandonment_recovery: true, seasonality_factor: "normal", product_category: "home", user_device: "mobile", traffic_source: "organic" }, expect: [{ field: "shipping_offer", value: "Free Overnight" }, { field: "final_display_price", value: 143.99 }] },
    { name: "sub-10 dollar price blocks all discounts", input: { base_price: 5, inventory_level: 80, customer_ltv_tier: "vip", cart_abandonment_recovery: false, seasonality_factor: "normal", product_category: "home", user_device: "mobile", traffic_source: "organic" }, expect: [{ field: "final_display_price", value: 4.99 }, { field: "shipping_offer", value: "Standard" }] },
  ],
},
{
  id: "saas_deal_desk", kind: "B2B SaaS deal desk approvals",
  spec: `B2B SaaS deal desk approval:

Inputs:
- mrr_amount: number
- contract_term_months: number in [12..36]
- requested_discount_percent: number
- includes_premium_support: boolean
- payment_terms: text ("Net_30", "Net_60", "Net_90", "Upfront_Annual")
- non_standard_legal_terms: boolean
- is_competitor_replacement: boolean
- partner_sourced: boolean
- region: text ("NA", "EMEA", "APAC", "LATAM")
- account_executive_quota_attainment: number

Rules:
- Base maximum allowed discount is 10 percent.
- contract_term_months 24 adds 5 percent to the max; 36 adds 10 percent.
- payment_terms Upfront_Annual adds 5 percent; Net_90 subtracts 5 percent.
- is_competitor_replacement true adds 5 percent win-back budget.
- Discount approval bands versus requested_discount_percent: at or below max → "Auto-Approved"; up to max+10 → "Sales Director Approval"; above max+10 → "VP of Sales Approval"; above 40 → "CFO Approval" regardless.
- If non_standard_legal_terms is true, legal_routing is "Legal Department Review"; otherwise legal_routing is "None".
- Region LATAM or APAC with payment_terms Net_90 is automatically rejected.
- If account_executive_quota_attainment > 100 AND band was "Sales Director Approval", override pricing_approval to "Auto-Approved".
- Contract status: if any review or approval beyond Auto-Approved is required, contract_status is "Draft - Pending"; otherwise "Ready for Signature".

Output:
- contract_status (text)
- pricing_approval_routing (text)
- legal_routing (text)
- calculated_max_discount (number)`,
  checks: [
    { name: "24mo auto-approved ready to sign", input: { mrr_amount: 5000, contract_term_months: 24, requested_discount_percent: 12, includes_premium_support: true, payment_terms: "Net_30", non_standard_legal_terms: false, is_competitor_replacement: false, partner_sourced: false, region: "NA", account_executive_quota_attainment: 80 }, expect: [{ field: "pricing_approval_routing", value: "Auto-Approved" }, { field: "contract_status", value: "Ready for Signature" }, { field: "calculated_max_discount", value: 15 }] },
    { name: "director band draft pending", input: { mrr_amount: 20000, contract_term_months: 24, requested_discount_percent: 18, includes_premium_support: true, payment_terms: "Net_30", non_standard_legal_terms: false, is_competitor_replacement: false, partner_sourced: false, region: "NA", account_executive_quota_attainment: 80 }, expect: [{ field: "pricing_approval_routing", value: "Sales Director Approval" }, { field: "contract_status", value: "Draft - Pending" }] },
    { name: "45 percent goes straight to CFO", input: { mrr_amount: 80000, contract_term_months: 36, requested_discount_percent: 45, includes_premium_support: true, payment_terms: "Upfront_Annual", non_standard_legal_terms: false, is_competitor_replacement: false, partner_sourced: false, region: "NA", account_executive_quota_attainment: 60 }, expect: [{ field: "pricing_approval_routing", value: "CFO Approval" }, { field: "calculated_max_discount", value: 25 }] },
    { name: "top performer perk overrides director", input: { mrr_amount: 20000, contract_term_months: 24, requested_discount_percent: 18, includes_premium_support: true, payment_terms: "Net_30", non_standard_legal_terms: false, is_competitor_replacement: false, partner_sourced: false, region: "NA", account_executive_quota_attainment: 120 }, expect: [{ field: "pricing_approval_routing", value: "Auto-Approved" }] },
    { name: "non-standard legal routes to legal", input: { mrr_amount: 50000, contract_term_months: 12, requested_discount_percent: 5, includes_premium_support: true, payment_terms: "Net_30", non_standard_legal_terms: true, is_competitor_replacement: false, partner_sourced: false, region: "NA", account_executive_quota_attainment: 70 }, expect: [{ field: "legal_routing", value: "Legal Department Review" }, { field: "contract_status", value: "Draft - Pending" }] },
    { name: "LATAM Net90 max drops to 5", input: { mrr_amount: 9000, contract_term_months: 12, requested_discount_percent: 4, includes_premium_support: true, payment_terms: "Net_90", non_standard_legal_terms: false, is_competitor_replacement: false, partner_sourced: false, region: "LATAM", account_executive_quota_attainment: 60 }, expect: [{ field: "calculated_max_discount", value: 5 }] },
  ],
},
{
  id: "aml_alerting", kind: "Anti-money-laundering scoring",
  spec: `AML transaction alerting:

Inputs:
- transaction_amount_usd: number
- transaction_type: text ("wire", "crypto", "cash_deposit", "internal_transfer")
- sender_country: text
- receiver_country: text
- sender_account_age_days: number
- is_pep: boolean
- prior_sar_filed: boolean
- structured_transaction_flag: boolean
- velocity_30_days: number
- kyc_completeness_score: number in [0..100]

Rules:
- final_aml_risk_score starts at 0.
- If prior_sar_filed is true, SET final_aml_risk_score to 100.
- If sender_country or receiver_country is "Iran" or "North Korea", SET final_aml_risk_score to 100.
- If sender_country or receiver_country is "Syria" or "Yemen", add 40.
- If is_pep is true, add 50.
- If transaction_amount_usd > 10000 AND transaction_type is "cash_deposit", add 30.
- If structured_transaction_flag is true, add 60.
- If transaction_type is "crypto" AND kyc_completeness_score < 80, add 45.
- If kyc_completeness_score < 50, add 30.
- If sender_country equals receiver_country, subtract 10.
- If transaction_type is "internal_transfer", subtract 20.
- If transaction_amount_usd < 500, subtract 10.
- If sender_account_age_days > 3650 AND prior_sar_filed is false, subtract 15.
- Action thresholds on the FINAL score: at least 85 → "Freeze Funds and File SAR" with regulatory_filing_required true; 60 to 84 → "Hold for Compliance Review"; 40 to 59 → "Process but Log as Elevated Risk"; below 40 → "Process Normally". Filing is false for all actions below 85.

Output:
- final_aml_risk_score (number)
- compliance_action (text)
- regulatory_filing_required (boolean)`,
  checks: [
    { name: "prior SAR instant 100 freeze", input: { transaction_amount_usd: 9000, transaction_type: "wire", sender_country: "USA", receiver_country: "USA", sender_account_age_days: 500, is_pep: false, prior_sar_filed: true, structured_transaction_flag: false, velocity_30_days: 4, kyc_completeness_score: 95 }, expect: [{ field: "final_aml_risk_score", value: 100 }, { field: "compliance_action", value: "Freeze Funds and File SAR" }, { field: "regulatory_filing_required", value: true }] },
    { name: "blacklist receiver 100 freeze", input: { transaction_amount_usd: 12000, transaction_type: "wire", sender_country: "USA", receiver_country: "North Korea", sender_account_age_days: 900, is_pep: false, prior_sar_filed: false, structured_transaction_flag: false, velocity_30_days: 2, kyc_completeness_score: 90 }, expect: [{ field: "final_aml_risk_score", value: 100 }, { field: "regulatory_filing_required", value: true }] },
    { name: "decade-old domestic internal transfer negative", input: { transaction_amount_usd: 300, transaction_type: "internal_transfer", sender_country: "USA", receiver_country: "USA", sender_account_age_days: 4000, is_pep: false, prior_sar_filed: false, structured_transaction_flag: false, velocity_30_days: 5, kyc_completeness_score: 95 }, expect: [{ field: "final_aml_risk_score", value: -55 }, { field: "compliance_action", value: "Process Normally" }, { field: "regulatory_filing_required", value: false }] },
    { name: "PEP alone elevated log 40", input: { transaction_amount_usd: 2000, transaction_type: "wire", sender_country: "USA", receiver_country: "USA", sender_account_age_days: 100, is_pep: true, prior_sar_filed: false, structured_transaction_flag: false, velocity_30_days: 3, kyc_completeness_score: 90 }, expect: [{ field: "final_aml_risk_score", value: 40 }, { field: "compliance_action", value: "Process but Log as Elevated Risk" }] },
    { name: "PEP plus weak KYC hold 70", input: { transaction_amount_usd: 2000, transaction_type: "wire", sender_country: "USA", receiver_country: "USA", sender_account_age_days: 100, is_pep: true, prior_sar_filed: false, structured_transaction_flag: false, velocity_30_days: 3, kyc_completeness_score: 45 }, expect: [{ field: "final_aml_risk_score", value: 70 }, { field: "compliance_action", value: "Hold for Compliance Review" }] },
  ],
},
{
  id: "inventory_reordering", kind: "Supply-chain reorder quantities",
  spec: `Supply chain and inventory automated reordering:

Inputs:
- current_stock_level: number
- units_in_transit: number
- forecast_demand_30_days: number
- safety_stock_minimum: number
- supplier_lead_time_days: number
- supplier_reliability_score: number in [1..100]
- unit_cost: number
- bulk_discount_threshold_units: number
- warehouse_capacity_remaining: number
- is_perishable: boolean

Rules:
- effective_stock = current_stock_level + units_in_transit.
- If effective_stock > forecast_demand_30_days + safety_stock_minimum, reorder_decision is "Do Not Reorder" and final_reorder_quantity is 0.
- If effective_stock <= safety_stock_minimum, stock_status is "Critical Stock-Out Risk".
- basic_reorder_qty = forecast_demand_30_days + safety_stock_minimum - effective_stock.
- If supplier_lead_time_days > 30, increase basic_reorder_qty by 20 percent.
- If supplier_reliability_score < 70, increase basic_reorder_qty by 15 percent.
- If is_perishable, cap basic_reorder_qty at exactly forecast_demand_30_days.
- If basic_reorder_qty > warehouse_capacity_remaining, cap it at warehouse_capacity_remaining.
- If capped quantity < 0, set to 0.
- Bulk bump: if quantity is at least 80 percent of bulk_discount_threshold_units AND not perishable AND capacity allows, raise quantity to bulk_discount_threshold_units.
- If unit_cost > 1000 AND quantity > 50, reorder_decision is "Finance Approval".
- If effective_stock == 0 AND forecast_demand_30_days > 0, reorder_decision is "Emergency Drop-Ship Protocol".
- Otherwise if quantity > 0, reorder_decision is "Generate Purchase Order".
- Shipping: critical stock-out AND unit_cost < 500 → "Expedited Air Freight"; otherwise "Ground".

Output:
- reorder_decision (text)
- final_reorder_quantity (number)
- shipping_method (text)`,
  checks: [
    { name: "healthy stock no reorder", input: { current_stock_level: 500, units_in_transit: 0, forecast_demand_30_days: 100, safety_stock_minimum: 50, supplier_lead_time_days: 10, supplier_reliability_score: 90, unit_cost: 50, bulk_discount_threshold_units: 100, warehouse_capacity_remaining: 1000, is_perishable: false }, expect: [{ field: "reorder_decision", value: "Do Not Reorder" }, { field: "final_reorder_quantity", value: 0 }] },
    { name: "bulk bump to threshold 100", input: { current_stock_level: 60, units_in_transit: 0, forecast_demand_30_days: 100, safety_stock_minimum: 40, supplier_lead_time_days: 10, supplier_reliability_score: 90, unit_cost: 50, bulk_discount_threshold_units: 100, warehouse_capacity_remaining: 1000, is_perishable: false }, expect: [{ field: "reorder_decision", value: "Generate Purchase Order" }, { field: "final_reorder_quantity", value: 100 }] },
    { name: "critical stock-out expedited 150", input: { current_stock_level: 30, units_in_transit: 0, forecast_demand_30_days: 100, safety_stock_minimum: 50, supplier_lead_time_days: 5, supplier_reliability_score: 85, unit_cost: 100, bulk_discount_threshold_units: 150, warehouse_capacity_remaining: 500, is_perishable: false }, expect: [{ field: "final_reorder_quantity", value: 150 }, { field: "shipping_method", value: "Expedited Air Freight" }] },
    { name: "expensive large PO finance approval", input: { current_stock_level: 200, units_in_transit: 0, forecast_demand_30_days: 400, safety_stock_minimum: 50, supplier_lead_time_days: 10, supplier_reliability_score: 90, unit_cost: 1500, bulk_discount_threshold_units: 1000, warehouse_capacity_remaining: 10000, is_perishable: false }, expect: [{ field: "reorder_decision", value: "Finance Approval" }, { field: "final_reorder_quantity", value: 250 }] },
    { name: "perishable capped at demand 80", input: { current_stock_level: 20, units_in_transit: 0, forecast_demand_30_days: 80, safety_stock_minimum: 30, supplier_lead_time_days: 5, supplier_reliability_score: 90, unit_cost: 20, bulk_discount_threshold_units: 200, warehouse_capacity_remaining: 900, is_perishable: true }, expect: [{ field: "final_reorder_quantity", value: 80 }, { field: "shipping_method", value: "Expedited Air Freight" }] },
    { name: "stock zero emergency drop-ship", input: { current_stock_level: 0, units_in_transit: 0, forecast_demand_30_days: 60, safety_stock_minimum: 20, supplier_lead_time_days: 7, supplier_reliability_score: 88, unit_cost: 30, bulk_discount_threshold_units: 120, warehouse_capacity_remaining: 800, is_perishable: false }, expect: [{ field: "reorder_decision", value: "Emergency Drop-Ship Protocol" }] },
  ],
},
{
  id: "mortgage_llpa", kind: "Mortgage LLPA rate adjustments",
  spec: `Mortgage pricing and margin adjustment:

Inputs:
- base_interest_rate: number
- loan_amount: number
- fico_score: number in [300..850]
- ltv_ratio: number
- property_type: text ("single_family", "condo", "multi_family", "manufactured")
- occupancy_type: text ("primary", "second_home", "investment")
- loan_purpose: text ("purchase", "rate_term_refi", "cash_out_refi")
- dti_ratio: number
- is_self_employed: boolean
- reserves_months: number

Rules:
- calculated_rate starts equal to base_interest_rate.
- Declines: fico_score < 620 → "Declined"; ltv_ratio > 97 → "Declined"; dti_ratio > 50 → "Declined".
- FICO adjustment: >= 780 subtract 0.250; >= 740 and < 780 subtract 0.125; >= 680 and < 700 add 0.250; < 680 add 0.500. (700 to 739 has no adjustment.)
- LTV adjustment: <= 60 subtract 0.125; > 80 and <= 90 add 0.250; > 90 add 0.500.
- Property: condo with ltv_ratio > 75 add 0.125; multi_family add 0.250; manufactured add 0.500.
- Occupancy: investment add 0.750; second_home add 0.375.
- Purpose: cash_out_refi with ltv_ratio > 70 add 0.375.
- If self-employed AND reserves_months < 6, add 0.125.
- If dti_ratio > 45 AND fico_score < 700, add 0.250.
- llpa_total_adjustments is the signed sum of all adjustments applied.
- If not declined and calculated_rate > 9.0, cap final_interest_rate at 9.0 and final_decision is "High-Cost Mortgage Review"; if not declined and rate <= 9.0, final_decision is "Approved".

Output:
- final_decision (text)
- final_interest_rate (number)
- llpa_total_adjustments (number)`,
  checks: [
    { name: "pristine borrower discounts", input: { base_interest_rate: 6.0, loan_amount: 300000, fico_score: 780, ltv_ratio: 60, property_type: "single_family", occupancy_type: "primary", loan_purpose: "purchase", dti_ratio: 30, is_self_employed: false, reserves_months: 12 }, expect: [{ field: "final_decision", value: "Approved" }, { field: "final_interest_rate", value: 5.625 }, { field: "llpa_total_adjustments", value: -0.375 }] },
    { name: "DTI 52 decline", input: { base_interest_rate: 6.5, loan_amount: 250000, fico_score: 720, ltv_ratio: 70, property_type: "single_family", occupancy_type: "primary", loan_purpose: "purchase", dti_ratio: 52, is_self_employed: false, reserves_months: 6 }, expect: [{ field: "final_decision", value: "Declined" }] },
    { name: "manufactured investment stacking 8.0", input: { base_interest_rate: 6.5, loan_amount: 200000, fico_score: 700, ltv_ratio: 85, property_type: "manufactured", occupancy_type: "investment", loan_purpose: "purchase", dti_ratio: 40, is_self_employed: false, reserves_months: 10 }, expect: [{ field: "final_interest_rate", value: 8.0 }, { field: "llpa_total_adjustments", value: 1.5 }, { field: "final_decision", value: "Approved" }] },
    { name: "adjustment pile capped at 9.0 review", input: { base_interest_rate: 7.0, loan_amount: 150000, fico_score: 660, ltv_ratio: 92, property_type: "multi_family", occupancy_type: "investment", loan_purpose: "cash_out_refi", dti_ratio: 47, is_self_employed: true, reserves_months: 2 }, expect: [{ field: "final_decision", value: "High-Cost Mortgage Review" }, { field: "final_interest_rate", value: 9.0 }, { field: "llpa_total_adjustments", value: 2.75 }] },
    { name: "FICO 740 boundary minus 0.125", input: { base_interest_rate: 6.0, loan_amount: 250000, fico_score: 740, ltv_ratio: 75, property_type: "single_family", occupancy_type: "primary", loan_purpose: "purchase", dti_ratio: 35, is_self_employed: false, reserves_months: 8 }, expect: [{ field: "final_interest_rate", value: 5.875 }, { field: "llpa_total_adjustments", value: -0.125 }] },
  ],
},
{
  id: "esi_triage", kind: "Emergency severity min-wins override",
  spec: `Healthcare clinical triage ESI levels:

Inputs:
- patient_age_years: number
- heart_rate_bpm: number
- systolic_bp: number
- respiratory_rate: number
- spo2_percent: number
- temperature_celsius: number
- pain_scale: number in [0..10]
- consciousness_level: text ("alert", "verbal", "pain", "unresponsive")
- chest_pain: boolean
- active_bleeding: boolean

Rules:
- triage_acuity starts at 5 (lowest urgency). Numerically LOWER means MORE urgent; when multiple rules assign levels, the minimum value wins.
- If consciousness_level is "unresponsive", acuity is 1.
- If active_bleeding is true, acuity is at most 2.
- If chest_pain is true AND patient_age_years > 30, acuity is at most 2.
- If spo2_percent < 90, acuity is at most 2.
- If heart_rate_bpm > 130 OR heart_rate_bpm < 40, acuity is at most 2.
- If systolic_bp < 80 OR systolic_bp > 200, acuity is at most 2.
- If respiratory_rate > 30 OR respiratory_rate < 10, acuity is at most 2.
- If consciousness_level is "verbal" or "pain", acuity is at most 2.
- If pain_scale >= 8, acuity is at most 3.
- If heart_rate_bpm > 100 AND <= 130, acuity is at most 3.
- Bed mapping: acuity 1 → "Trauma Bay"; acuity 2 → "Acute Care"; acuity 3, 4 or 5 → "Fast Track / General".
- immediate_intervention_required is true only for acuity 1.

Output:
- final_esi_triage_level (number)
- recommended_bed_type (text)
- immediate_intervention_required (boolean)`,
  checks: [
    { name: "unresponsive resuscitation level 1", input: { patient_age_years: 60, heart_rate_bpm: 90, systolic_bp: 130, respiratory_rate: 16, spo2_percent: 97, temperature_celsius: 36.8, pain_scale: 0, consciousness_level: "unresponsive", chest_pain: false, active_bleeding: false }, expect: [{ field: "final_esi_triage_level", value: 1 }, { field: "recommended_bed_type", value: "Trauma Bay" }, { field: "immediate_intervention_required", value: true }] },
    { name: "chest pain over 30 emergent", input: { patient_age_years: 55, heart_rate_bpm: 92, systolic_bp: 138, respiratory_rate: 18, spo2_percent: 96, temperature_celsius: 36.9, pain_scale: 4, consciousness_level: "alert", chest_pain: true, active_bleeding: false }, expect: [{ field: "final_esi_triage_level", value: 2 }, { field: "recommended_bed_type", value: "Acute Care" }] },
    { name: "tachycardic 140 emergent", input: { patient_age_years: 33, heart_rate_bpm: 140, systolic_bp: 126, respiratory_rate: 18, spo2_percent: 97, temperature_celsius: 37.1, pain_scale: 3, consciousness_level: "alert", chest_pain: false, active_bleeding: false }, expect: [{ field: "final_esi_triage_level", value: 2 }] },
    { name: "walking well stays 5", input: { patient_age_years: 28, heart_rate_bpm: 78, systolic_bp: 118, respiratory_rate: 14, spo2_percent: 99, temperature_celsius: 36.6, pain_scale: 2, consciousness_level: "alert", chest_pain: false, active_bleeding: false }, expect: [{ field: "final_esi_triage_level", value: 5 }, { field: "recommended_bed_type", value: "Fast Track / General" }, { field: "immediate_intervention_required", value: false }] },
    { name: "HR 110 urgent band 3", input: { patient_age_years: 41, heart_rate_bpm: 110, systolic_bp: 132, respiratory_rate: 17, spo2_percent: 98, temperature_celsius: 37.0, pain_scale: 4, consciousness_level: "alert", chest_pain: false, active_bleeding: false }, expect: [{ field: "final_esi_triage_level", value: 3 }] },
    { name: "min-wins bleeding beats pain 9", input: { patient_age_years: 47, heart_rate_bpm: 96, systolic_bp: 128, respiratory_rate: 17, spo2_percent: 97, temperature_celsius: 37.0, pain_scale: 9, consciousness_level: "alert", chest_pain: false, active_bleeding: true }, expect: [{ field: "final_esi_triage_level", value: 2 }, { field: "recommended_bed_type", value: "Acute Care" }] },
  ],
},
];
