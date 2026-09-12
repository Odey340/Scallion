# Block 3 plan (Fri H3): the meal model the workshop's way

Goal: `meal_grid.json` so Tonight's plate draws two curves (eat now, plus a walk) from a MATLAB export.

## What the probe of `insulindemo` showed (models/probe, Fri H2.5)

| Fact | Value | Consequence |
|---|---|---|
| Model | Cobelli's Glucose-Insulin System (Dalla Man 2007), time unit hour | 6 h horizon, 5 min grid |
| Meal | dose "Single Meal", 78 g to species `Dose` | `Amount` = carbs in grams |
| Weight | parameter `Body Weight` 78 kg on `basis` 1 kg | set it; 50 kg -> peak 188, 110 kg -> 140 mg/dL |
| Insulin sensitivity | `Vmx` 0.047 (low_si 0.0235, t2d 0.034), `kp3` | band = Vmx x {0.8, 1, 1.2} |
| Insulin-independent utilisation | `Vm0` 2.51 mg/min/kg, constant | walk = events multiplying `Vm0` |
| T2D variant | sets basal glucose 164 mg/dL | curves keep the variant's basal; label "typical curve" |
| Speed | 0.2 s per simulation after `sbioaccelerate` | 432 runs ~ 2 min |

## Decisions

1. **Variant rule** = ADA fasting categories: < 100 normal, 100-125 low_si ("Low insulin sensitivity" variant), >= 126 or diagnosed t2d. The basal is the variant's, not the user's; the contract label already says "a typical curve for someone with your fasting glucose and weight".
2. **Walk** = 30 min starting 15 min after eating. First version: two events multiplying `Vm0` by a factor and dividing it back. x3 for 20 min only cut the peak 3%; bisection to a 15% cut needed x12.2 and gave a dip-and-rebound curve (glucose fell during the walk, then a second peak at 120 min). Second version (kept): the example's rule `Vm = Vm0 + Vmx*[Interstitial Ins]` becomes `Vm = Vm0*walkMult + ...` with `walkMult = 1 + (walkFactor-1)*walkEffect`, `walkEffect` set to 1 at the walk start and decaying with a 60 min half-life after the walk ends (post-exercise glucose uptake persists; an assumption). Bisection then targets the same 15% on the 78 g / normal / 78 kg reference cell and the run asserts the 10-20% window.
3. **Band** = pointwise min/max over insulin sensitivity +/-20%, called p10/p90 to match the contract shape, documented as a sensitivity band rather than a percentile.
4. **Surrogate** (Regression Learner) is deferred; the raw 144-cell grid is exported and C interpolates, which the lane's cut order allows.
5. Dimensional-analysis warnings from the example's own MATLAB-function rate are silenced by id in `meal_model.m`; they are warnings, not errors.

## Files

`models/load_insulindemo.m`, `models/meal_model.m`, `models/simulate_meal.m`, `models/variant_rule.m`, `models/calibrate_walk.m`, `sweep/run_meal_sweep.m` -> `sweep/meal_grid.mat`, `sweep/meal_sweep_table.csv`, `sweep/walk_calibration.mat`, `media/walk_calibration.png`, `media/meal_sweep.png`; `export_artifacts.m` writes `meal_grid.json`.
