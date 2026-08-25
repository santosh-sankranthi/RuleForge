/**
 * tests/complex-cases.mjs — pure data module: the 12 complex NL specs +
 * hand-computed scenario expectations. No side effects; safe to import.
 */
/* ---------------- the 12 cases ---------------- */
export const CASES = [
  {
    id: "er_triage", kind: "Healthcare triage — context output, enum+bool gates",
    spec: `Emergency room triage rules:

Inputs:
- heart_rate: number in [30..220]
- temperature_c: number in [35..42]
- is_unresponsive: boolean
- symptoms: text ("chest_pain", "shortness_of_breath", "fever", "injury")

Rules:
- Any unresponsive patient is level 1 critical with action "immediate resuscitation".
- A responsive patient whose symptoms are chest_pain or shortness_of_breath is level 2 emergency with action "cardiac workup now".
- A patient with fever and temperature at least 39.5 is level 3 urgent with action "isolation and antipyretics".
- All other patients are level 5 routine with action "standard queue".

Output:
- triage_level (number)
- action (text)`,
    checks: [
      { name: "unresponsive dominates", input: { heart_rate: 80, temperature_c: 36.8, is_unresponsive: true, symptoms: "injury" }, expect: [{ field: "triage_level", value: 1 }, { field: "action", value: "immediate resuscitation" }] },
      { name: "chest pain → level 2", input: { heart_rate: 95, temperature_c: 37, is_unresponsive: false, symptoms: "chest_pain" }, expect: [{ field: "triage_level", value: 2 }, { field: "action", value: "cardiac workup now" }] },
      { name: "fever boundary 39.5 → urgent", input: { heart_rate: 90, temperature_c: 39.5, is_unresponsive: false, symptoms: "fever" }, expect: [{ field: "triage_level", value: 3 }, { field: "action", value: "isolation and antipyretics" }] },
      { name: "fever 39.4 below threshold → routine", input: { heart_rate: 90, temperature_c: 39.4, is_unresponsive: false, symptoms: "fever" }, expect: [{ field: "triage_level", value: 5 }] },
      { name: "plain injury → routine", input: { heart_rate: 70, temperature_c: 36.5, is_unresponsive: false, symptoms: "injury" }, expect: [{ field: "action", value: "standard queue" }] },
    ],
  },
  {
    id: "roaming_data", kind: "Telecom — rate lookup table feeding arithmetic chain",
    spec: `Mobile roaming data charges:

Inputs:
- zone: text ("eu", "usa", "asia", "world")
- mb_used: number (>= 0)

Rules:
- The per_mb_rate depends on zone: eu costs 0.05 per MB, usa costs 0.10 per MB, asia costs 0.15 per MB, world costs 0.25 per MB.
- The base_charge is mb_used multiplied by the per_mb_rate.
- If mb_used exceeds 500, a flat overuse_fee of 8 euros applies, otherwise it is 0.
- The total_charge is base_charge plus the overuse_fee.

Output:
- total_charge (number)
- per_mb_rate (number)`,
    checks: [
      { name: "eu 100MB", input: { zone: "eu", mb_used: 100 }, expect: [{ field: "total_charge", value: 5 }, { field: "per_mb_rate", value: 0.05 }] },
      { name: "usa 600MB with overuse fee", input: { zone: "usa", mb_used: 600 }, expect: [{ field: "total_charge", value: 68 }] },
      { name: "asia 0MB", input: { zone: "asia", mb_used: 0 }, expect: [{ field: "total_charge", value: 0 }] },
      { name: "world 200MB", input: { zone: "world", mb_used: 200 }, expect: [{ field: "total_charge", value: 50 }] },
    ],
  },
  {
    id: "payroll_ot", kind: "Payroll — capped regular hours + 1.5x overtime split",
    spec: `Weekly payroll with overtime:

Inputs:
- hourly_rate: number (>= 0)
- hours_worked: number in [0..80]
- worked_weekend: boolean

Rules:
- Regular pay covers hours up to 40 at hourly_rate; regular_pay is hourly_rate multiplied by the paid regular hours (hours above 40 count as 40).
- Overtime hours are hours_worked minus 40 when above 40, otherwise 0; overtime_pay is overtime hours multiplied by 1.5 multiplied by hourly_rate.
- Weekend workers get a flat weekend_allowance of 100 euros added; others get 0.
- gross_pay is regular_pay plus overtime_pay plus the weekend_allowance.

Output:
- gross_pay (number)
- overtime_pay (number)`,
    checks: [
      { name: "exactly 40h no weekend", input: { hourly_rate: 20, hours_worked: 40, worked_weekend: false }, expect: [{ field: "gross_pay", value: 800 }, { field: "overtime_pay", value: 0 }] },
      { name: "50h + weekend", input: { hourly_rate: 20, hours_worked: 50, worked_weekend: true }, expect: [{ field: "overtime_pay", value: 300 }, { field: "gross_pay", value: 1200 }] },
      { name: "40h + weekend", input: { hourly_rate: 20, hours_worked: 40, worked_weekend: true }, expect: [{ field: "gross_pay", value: 900 }] },
      { name: "0h weekend-only allowance", input: { hourly_rate: 20, hours_worked: 0, worked_weekend: true }, expect: [{ field: "gross_pay", value: 100 }, { field: "overtime_pay", value: 0 }] },
    ],
  },
  {
    id: "energy_slab", kind: "Utility — progressive slab if-chain arithmetic",
    spec: `Progressive electricity billing:

Inputs:
- kwh_consumed: number in [0..5000]

Rules:
- The first 100 kWh cost 0.20 per kWh.
- Consumption above 100 up to and including 300 kWh costs 0.30 per kWh for that band.
- Consumption above 300 kWh costs 0.50 per kWh for that band.
- energy_cost is the sum across the three bands.
- A fixed meter fee of 5 euros is always added.
- bill_total is energy_cost plus the meter fee.

Output:
- bill_total (number)
- energy_cost (number)`,
    checks: [
      { name: "50 kWh first slab only", input: { kwh_consumed: 50 }, expect: [{ field: "energy_cost", value: 10 }, { field: "bill_total", value: 15 }] },
      { name: "100 kWh exact slab edge", input: { kwh_consumed: 100 }, expect: [{ field: "energy_cost", value: 20 }, { field: "bill_total", value: 25 }] },
      { name: "250 kWh two slabs", input: { kwh_consumed: 250 }, expect: [{ field: "energy_cost", value: 65 }, { field: "bill_total", value: 70 }] },
      { name: "400 kWh three slabs", input: { kwh_consumed: 400 }, expect: [{ field: "energy_cost", value: 130 }, { field: "bill_total", value: 135 }] },
      { name: "0 kWh only meter fee", input: { kwh_consumed: 0 }, expect: [{ field: "bill_total", value: 5 }] },
    ],
  },
  {
    id: "baggage_fees", kind: "Airline — open/closed weight intervals + clamp at zero",
    spec: `Airline checked baggage fees:

Inputs:
- cabin_class: text ("economy", "business", "first")
- bag_weight_kg: number in [0..45]
- is_club_member: boolean

Rules:
- Economy passengers pay 30 euros for a bag up to 23 kg, 60 euros above 23 kg up to and including 32 kg, and 120 euros above 32 kg.
- Business passengers pay 0 euros up to and including 32 kg and 100 euros above 32 kg.
- First passengers always pay 0 euros.
- A bag above 32 kg is flagged as overweight, otherwise not.
- Club members get 10 euros off the final fee, but the fee never goes below zero.

Output:
- fee (number)
- overweight (boolean)`,
    checks: [
      { name: "economy light club", input: { cabin_class: "economy", bag_weight_kg: 20, is_club_member: true }, expect: [{ field: "fee", value: 20 }, { field: "overweight", value: false }] },
      { name: "economy mid band", input: { cabin_class: "economy", bag_weight_kg: 25, is_club_member: false }, expect: [{ field: "fee", value: 60 }] },
      { name: "economy heavy club", input: { cabin_class: "economy", bag_weight_kg: 40, is_club_member: true }, expect: [{ field: "fee", value: 110 }, { field: "overweight", value: true }] },
      { name: "business within free band", input: { cabin_class: "business", bag_weight_kg: 30, is_club_member: false }, expect: [{ field: "fee", value: 0 }] },
      { name: "business overweight club", input: { cabin_class: "business", bag_weight_kg: 40, is_club_member: true }, expect: [{ field: "fee", value: 90 }] },
      { name: "first never below zero", input: { cabin_class: "first", bag_weight_kg: 44, is_club_member: true }, expect: [{ field: "fee", value: 0 }, { field: "overweight", value: true }] },
    ],
  },
  {
    id: "risk_premium", kind: "Insurance — points accumulation chained into tier table into premium table",
    spec: `Insurance risk scoring and premium:

Inputs:
- driver_age: number in [18..90]
- accident_count: number in [0..10]
- uses_car_for_business: boolean

Rules:
- Age points are 2 for drivers under 25, otherwise 0.
- Accident points are 2 per accident.
- Business use adds 1 point, private use adds 0.
- risk_points is age points plus accident points plus business points.
- Risk tier: risk_points of 0 is "low", 1 to 3 is "medium", 4 or more is "high".
- Premium: low tier pays 400, medium pays 700, high pays 1200 euros.

Output:
- risk_tier (text)
- premium (number)
- risk_points (number)`,
    checks: [
      { name: "clean adult private", input: { driver_age: 30, accident_count: 0, uses_car_for_business: false }, expect: [{ field: "risk_tier", value: "low" }, { field: "premium", value: 400 }, { field: "risk_points", value: 0 }] },
      { name: "young driver medium", input: { driver_age: 22, accident_count: 0, uses_car_for_business: false }, expect: [{ field: "risk_points", value: 2 }, { field: "risk_tier", value: "medium" }, { field: "premium", value: 700 }] },
      { name: "accidents + business high", input: { driver_age: 40, accident_count: 2, uses_car_for_business: true }, expect: [{ field: "risk_points", value: 5 }, { field: "risk_tier", value: "high" }, { field: "premium", value: 1200 }] },
      { name: "age 25 boundary counts as adult", input: { driver_age: 25, accident_count: 0, uses_car_for_business: false }, expect: [{ field: "risk_tier", value: "low" }] },
    ],
  },
  {
    id: "plan_recommender", kind: "SaaS — boolean combinatorics with interacting discounts",
    spec: `Subscription plan recommender:

Inputs:
- devices: number in [1..10]
- wants_4k: boolean
- is_student: boolean

Rules:
- Users with more than 3 devices or wanting 4K need the "premium" plan.
- Students who do not need premium get the "student" plan.
- Everyone else gets the "basic" plan.
- The base monthly price is basic 8, student 5, premium 16.
- Premium subscribers who are also students pay a discounted student_premium price of 12 instead.

Output:
- plan (text)
- monthly_price (number)`,
    checks: [
      { name: "student small household", input: { devices: 2, wants_4k: false, is_student: true }, expect: [{ field: "plan", value: "student" }, { field: "monthly_price", value: 5 }] },
      { name: "student needing premium gets discount", input: { devices: 2, wants_4k: true, is_student: true }, expect: [{ field: "plan", value: "premium" }, { field: "monthly_price", value: 12 }] },
      { name: "many devices non-student", input: { devices: 5, wants_4k: false, is_student: false }, expect: [{ field: "plan", value: "premium" }, { field: "monthly_price", value: 16 }] },
      { name: "plain basic", input: { devices: 1, wants_4k: false, is_student: false }, expect: [{ field: "plan", value: "basic" }, { field: "monthly_price", value: 8 }] },
      { name: "4-device student still premium-discounted", input: { devices: 4, wants_4k: false, is_student: true }, expect: [{ field: "plan", value: "premium" }, { field: "monthly_price", value: 12 }] },
    ],
  },
  {
    id: "hotel_cancel", kind: "Hospitality — day bands + percentage-of-rate arithmetic override",
    spec: `Hotel cancellation refunds:

Inputs:
- days_before_checkin: number in [0..365]
- room_rate: number (>= 0)
- is_flexible_rate: boolean

Rules:
- Cancellations 14 or more days before check-in get a refund_percent of 100.
- Cancellations 7 to 13 days before get a refund_percent of 50.
- Less than 7 days before gets a refund_percent of 0.
- Flexible-rate bookings always get a refund_percent of 100 regardless of timing.
- refund_amount is room_rate multiplied by refund_percent divided by 100.

Output:
- refund_percent (number)
- refund_amount (number)`,
    checks: [
      { name: "flexible beats late cancellation", input: { days_before_checkin: 2, room_rate: 200, is_flexible_rate: true }, expect: [{ field: "refund_percent", value: 100 }, { field: "refund_amount", value: 200 }] },
      { name: "14-day full refund", input: { days_before_checkin: 14, room_rate: 200, is_flexible_rate: false }, expect: [{ field: "refund_percent", value: 100 }, { field: "refund_amount", value: 200 }] },
      { name: "13-day half refund", input: { days_before_checkin: 13, room_rate: 200, is_flexible_rate: false }, expect: [{ field: "refund_percent", value: 50 }, { field: "refund_amount", value: 100 }] },
      { name: "7-day half refund boundary", input: { days_before_checkin: 7, room_rate: 240, is_flexible_rate: false }, expect: [{ field: "refund_percent", value: 50 }, { field: "refund_amount", value: 120 }] },
      { name: "6-day zero refund", input: { days_before_checkin: 6, room_rate: 300, is_flexible_rate: false }, expect: [{ field: "refund_percent", value: 0 }, { field: "refund_amount", value: 0 }] },
    ],
  },
  {
    id: "uni_admission", kind: "Education — fully-populated matrix table with legacy override",
    spec: `University admission scoring:

Inputs:
- gpa: number in [0..4]
- sat_score: number in [400..1600]
- alumni_legacy: boolean

Rules:
- Applicants with gpa at least 3.5 and sat_score at least 1400 are "accepted".
- Applicants with gpa at least 3.5 but sat_score below 1400 are "waitlisted".
- Applicants with gpa below 3.5 but sat_score at least 1400 are "waitlisted", except legacy applicants in this group who are "accepted".
- Everyone else is "rejected".
- Scholarship: accepted non-legacy students receive 5000, accepted legacy students receive 6500, all other statuses receive 0.

Output:
- status (text)
- scholarship_amount (number)`,
    checks: [
      { name: "strong both accepted", input: { gpa: 3.8, sat_score: 1500, alumni_legacy: false }, expect: [{ field: "status", value: "accepted" }, { field: "scholarship_amount", value: 5000 }] },
      { name: "strong both legacy bonus", input: { gpa: 3.8, sat_score: 1500, alumni_legacy: true }, expect: [{ field: "status", value: "accepted" }, { field: "scholarship_amount", value: 6500 }] },
      { name: "high gpa low sat waitlisted", input: { gpa: 3.8, sat_score: 1200, alumni_legacy: false }, expect: [{ field: "status", value: "waitlisted" }, { field: "scholarship_amount", value: 0 }] },
      { name: "legacy rescues low-gpa/high-sat", input: { gpa: 3.0, sat_score: 1500, alumni_legacy: true }, expect: [{ field: "status", value: "accepted" }, { field: "scholarship_amount", value: 6500 }] },
      { name: "non-legacy same profile waitlisted", input: { gpa: 3.0, sat_score: 1500, alumni_legacy: false }, expect: [{ field: "status", value: "waitlisted" }] },
      { name: "weak both rejected", input: { gpa: 2.5, sat_score: 1000, alumni_legacy: false }, expect: [{ field: "status", value: "rejected" }, { field: "scholarship_amount", value: 0 }] },
      { name: "exact boundaries accepted", input: { gpa: 3.5, sat_score: 1400, alumni_legacy: false }, expect: [{ field: "status", value: "accepted" }] },
    ],
  },
  {
    id: "cold_chain", kind: "Logistics — layered surcharges summed then capped via min()",
    spec: `Cold-chain shipping surcharge:

Inputs:
- transport_temp_c: number in [-30..40]
- distance_km: number (>= 0)
- is_hazmat: boolean

Rules:
- The refrigeration surcharge is 50 when transport_temp_c is below 0, 20 when it is 0 to 10 inclusive, and 0 above 10 degrees.
- The distance surcharge is 0.10 per km.
- Hazmat goods add a flat 75 surcharge, non-hazmat add 0.
- raw_total is refrigeration plus distance plus hazmat surcharges.
- final_surcharge is raw_total capped at a maximum of 300 euros.

Output:
- final_surcharge (number)`,
    checks: [
      { name: "frozen hazmat short haul", input: { transport_temp_c: -10, distance_km: 100, is_hazmat: true }, expect: [{ field: "final_surcharge", value: 135 }] },
      { name: "chilled long haul", input: { transport_temp_c: 5, distance_km: 1000, is_hazmat: false }, expect: [{ field: "final_surcharge", value: 120 }] },
      { name: "cap kicks in", input: { transport_temp_c: -20, distance_km: 5000, is_hazmat: false }, expect: [{ field: "final_surcharge", value: 300 }] },
      { name: "ambient zero-km floor", input: { transport_temp_c: 20, distance_km: 0, is_hazmat: false }, expect: [{ field: "final_surcharge", value: 0 }] },
      { name: "temp boundary exactly 10", input: { transport_temp_c: 10, distance_km: 0, is_hazmat: true }, expect: [{ field: "final_surcharge", value: 95 }] },
    ],
  },
  {
    id: "traffic_fine", kind: "Traffic law — excess bands with rush-hour multipliers incl. neutralized negative excess",
    spec: `Speeding fine schedule:

Inputs:
- speed_kmh: number in [30..250]
- limit_kmh: number in [30..130]
- is_rush_hour: boolean

Rules:
- The excess is speed_kmh minus limit_kmh.
- Excess of 0 or less is not speeding: fine 0 with status "ok".
- Excess from 1 to 10: fine 30 with status "minor".
- Excess from 11 to 20: fine 80 with status "moderate".
- Excess above 20: fine 180 with status "severe".
- During rush hour the fine doubles for minor and moderate, and triples for severe.
- Not-speeding stays a fine of 0 even during rush hour.

Output:
- fine (number)
- status (text)`,
    checks: [
      { name: "at limit during rush", input: { speed_kmh: 100, limit_kmh: 100, is_rush_hour: true }, expect: [{ field: "fine", value: 0 }, { field: "status", value: "ok" }] },
      { name: "below limit", input: { speed_kmh: 95, limit_kmh: 100, is_rush_hour: false }, expect: [{ field: "fine", value: 0 }, { field: "status", value: "ok" }] },
      { name: "minor doubled in rush", input: { speed_kmh: 105, limit_kmh: 100, is_rush_hour: true }, expect: [{ field: "fine", value: 60 }, { field: "status", value: "minor" }] },
      { name: "moderate off-rush base", input: { speed_kmh: 115, limit_kmh: 100, is_rush_hour: false }, expect: [{ field: "fine", value: 80 }, { field: "status", value: "moderate" }] },
      { name: "moderate doubled in rush", input: { speed_kmh: 115, limit_kmh: 100, is_rush_hour: true }, expect: [{ field: "fine", value: 160 }] },
      { name: "severe tripled in rush", input: { speed_kmh: 125, limit_kmh: 100, is_rush_hour: true }, expect: [{ field: "fine", value: 540 }, { field: "status", value: "severe" }] },
    ],
  },
  {
    id: "smart_thermostat", kind: "IoT — deadband control states with eco power scaling",
    spec: `Smart thermostat control:

Inputs:
- current_temp_c: number in [-20..45]
- target_temp_c: number in [10..30]
- someone_home: boolean
- eco_mode: boolean

Rules:
- When nobody is home the mode is "off".
- When someone is home and current_temp_c is more than 2 degrees below target_temp_c the mode is "heating".
- When someone is home and current_temp_c is more than 2 degrees above target_temp_c the mode is "cooling".
- Otherwise the mode is "idle".
- Heating power is 2000 watts normally but 1200 watts in eco mode.
- Cooling power is always 1500 watts. Off and idle use 0 watts.

Output:
- mode (text)
- power_watts (number)`,
    checks: [
      { name: "away overrides everything", input: { current_temp_c: 10, target_temp_c: 24, someone_home: false, eco_mode: true }, expect: [{ field: "mode", value: "off" }, { field: "power_watts", value: 0 }] },
      { name: "heat needed eco", input: { current_temp_c: 18, target_temp_c: 21, someone_home: true, eco_mode: true }, expect: [{ field: "mode", value: "heating" }, { field: "power_watts", value: 1200 }] },
      { name: "heat needed normal", input: { current_temp_c: 18, target_temp_c: 21, someone_home: true, eco_mode: false }, expect: [{ field: "mode", value: "heating" }, { field: "power_watts", value: 2000 }] },
      { name: "cooling always full power", input: { current_temp_c: 26, target_temp_c: 22, someone_home: true, eco_mode: true }, expect: [{ field: "mode", value: "cooling" }, { field: "power_watts", value: 1500 }] },
      { name: "within deadband idle", input: { current_temp_c: 22, target_temp_c: 22, someone_home: true, eco_mode: false }, expect: [{ field: "mode", value: "idle" }, { field: "power_watts", value: 0 }] },
      { name: "deadband edge exactly 2 degrees", input: { current_temp_c: 20, target_temp_c: 22, someone_home: true, eco_mode: true }, expect: [{ field: "mode", value: "idle" }, { field: "power_watts", value: 0 }] },
    ],
  },
];

