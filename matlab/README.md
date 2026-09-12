# Lane A: the MATLAB engine

Every number the Scallion app shows comes from a JSON file in `web/public/engine/`, and every one of those files is written by `export/export_artifacts.m` from the models in this directory. Nothing here runs at request time; the API never calls MATLAB.

## Run it

```matlab
openProject('matlab/Scallion.prj')  % paths, startup, and a shortcut to the live script
runtests('tests/test_phenoage.m')   % reference vectors, waterfall identity, safety gates
main_live_script                    % norms -> tests -> clock -> insulindemo -> sweep -> surrogate -> export -> console
ScallionEngineer                    % the console on its own
```
Batch equivalent (works without the desktop): `matlab -batch "restoredefaultpath; cd matlab; main_live_script"`.

Requirements: MATLAB R2026a, SimBiology, Statistics and Machine Learning Toolbox (for `xptread` and Regression Learner), Simulink (SimBiology dependency). MATLAB Compiler SDK is optional and unused.

**Machine status (Fri H2.5):** MATLAB R2026a Update 5 is installed at `C:\MATLAB\R2026a` (via `mpm`, products MATLAB, Simulink, SimBiology, Statistics and Machine Learning Toolbox) and licensed through the MathWorks sign-in. Two quirks of that install:

- The OS-registration step needs an admin prompt and was skipped, so a fresh session starts with an empty path. `main_live_script` calls `restoredefaultpath` when it detects this; for batch runs use `matlab -batch "restoredefaultpath; ..."`. To fix it for good run `C:\MATLAB\R2026a\bin\win64\registerWithOS.exe -matlabroot C:\MATLAB\R2026a` from an admin prompt.
- Example files are not shipped; `run_insulindemo` calls `openExample('simbio/insulindemo')` on first use, which downloads the project into `Documents\MATLAB\Examples\R2026a\simbio\insulindemo`.

All exports in `web/public/engine/` are now written by `export_artifacts.m` (see `meta.generated_by`). `python matlab/tools/crosscheck/crosscheck.py` is an independent Python mirror of the same equations; it recomputes the norms, the vectors and the small exports and reports `CROSSCHECK PASS` when they agree (norms to 1e-13, vectors exactly).

## Files and the screen each one drives

| File | What it is | Drives |
|---|---|---|
| `engine/phenoage_constants.m` | Levine 2018 coefficients, conversion constants, CRP floor, critical ranges, CVs | everything below |
| `engine/phenoage.m` | PhenoAge with the exact affine waterfall, the +/- band, imputation, fasting rule, critical flags | Labs result (waterfall, band, "8 of 9 markers", "see a clinician first") |
| `engine/nhanes_norms.m` | NHANES 2017-March 2020 -> age-sex reference medians, imputation SDs, percentiles | tap-an-analyte distributions; cohort offset |
| `engine/hunt_fitness_age.m` | Nes 2011 VO2max equation + Loe 2013 age lookup | `/start` fitness age, Camera screen |
| `engine/risk_years.m` | published hazard ratios -> years via `8 * log2(HR)` | Home levers ledger, Circle "what isolation costs" |
| `engine/caffeine_curve.m` | closed-form 5 h half-life decay (SimBiology `caffeine_pk.sbproj` replaces it if built) | Tonight: last-coffee line |
| `engine/plot_waterfall.m` | the waterfall figure for media/ and the console | Devpost, video |
| `models/run_insulindemo.m` | SimBiology glucose-insulin meal model, base vs variants (H6 gate) | Devpost figure |
| `models/load_insulindemo.m`, `models/meal_model.m`, `models/simulate_meal.m` | the Cobelli model configured for Scallion: weight parameter, variant, walk events on `Vm0`, accelerated; one cell = one call | Tonight |
| `models/variant_rule.m` | fasting glucose -> `normal` / `low_si` / `t2d` (ADA cut points) | Tonight, Labs review |
| `models/calibrate_walk.m` | bisection on the `Vm0` multiplier until a 30 min walk at 15 min cuts the reference peak 15% (Buffey 2022 window 10-20%) | Tonight: "plus a walk" |
| `sweep/run_meal_sweep.m` | 144 cells x 3 insulin-sensitivity scalings -> `sweep/meal_grid.mat`, `meal_sweep_table.csv`, `media/meal_sweep.png` | Tonight: both curves and the band |
| `surrogate/fit_surrogate.m`, `surrogate/predictMealResponse.m` | Gaussian-process surrogate of the sweep (5-fold CV, `media/surrogate_validation.png`); the app reads the grid, the surrogate is the smooth what-if model | MathWorks demo |
| `app/ScallionEngineer.m`, `app/meal_lookup.m` | the console: sidebar of inputs, tabs Tonight (grid curves + caffeine), Clock (waterfall), Validation (grid vs full simulation). `meal_lookup` interpolates exactly as Lane C does | MathWorks demo, video |
| `Scallion.prj`, `make_project.m`, `engine/project_startup.m` | the MATLAB project (built from code so it is reproducible): paths, files, startup, shortcut to the live script | judging: open the project, run the shortcut |
| `export/export_artifacts.m` | writes `phenoage.json`, `nhanes_percentiles.json`, `hunt.json`, `risk_years.json`, `caffeine.json`, `meal_grid.json` | the app |
| `tests/test_phenoage.m`, `tests/vectors.json` | the reference vectors Lane C's TypeScript port must reproduce to 0.05 years | C's unit test |
| `data/download_nhanes.m` | fetches the five public XPT files (git-ignored, ~10 MB) | `nhanes_norms.m` |
| `tools/crosscheck/crosscheck.py` | independent Python mirror; regenerates the same JSON for verification | verification only |

## The three norm rules (agreed with Lane D, Fri H1)

1. **CRP floor.** hs-CRP arrives in mg/L; divide by 10 to mg/dL and floor at **0.1 mg/dL** before taking the log. 27% of NHANES adults sit below that floor, so the same floor is applied when building the norms. CRP above **1.0 mg/dL** (10 mg/L) is flagged "possible acute inflammation, retest in two weeks" but still used.
2. **Fasting.** A CMP glucose is non-fasting unless the report says fasting. Non-fasting glucose is greyed on the review screen and **imputed**; the clock then says "8 of 9 markers". The norms use the NHANES fasting subsample (`P_GLU`, weight `WTSAFPRP`), never the random serum glucose.
3. **Imputation.** A missing analyte takes the age-sex NHANES weighted median (`reference_by_age_sex`) and contributes the population SD of its model term (`imputation_sd_by_age_sex`, IQR/1.349) to the band instead of its measurement CV, so the band widens. The label is "8 of 9 markers" (or fewer).

## The clock, in one screen

```
xb       = -19.90667 + sum(coef_i * term_i) + 0.08035356 * age      term_crp = ln(max(crp, 0.1))
M(10 y)  = 1 - exp(-exp(xb) * (exp(120 * 0.007692696) - 1) / 0.007692696)
PhenoAge = 141.50225 + ln(-0.0055305 * ln(1 - M)) / 0.090165
```

The last line is affine in `xb`: `PhenoAge = A + xb / 0.090165`. So each analyte's cost in years is `coef_i * (term_i(x) - term_i(reference)) / 0.090165`, the cohort offset is `PhenoAge(reference person, your age) - age`, and `age + cohort_offset + sum(analyte years) == PhenoAge` holds exactly. That is the waterfall. The band is one SD from within-subject plus analytical CV (Westgard database; band only, never the age).

Constants were checked against Levine 2018 Table 1 (coefficients, units) and Supplement 1 as implemented in the BioAge R package (full-precision coefficients, `0.090165`). The contract's `k: 0.09165` was a placeholder typo; the exported `phenoage.json` carries the correct value and `docs/contracts.md` needs the one-character fix.

## Sources behind every exported number

- PhenoAge: Levine ME et al., Aging 2018;10(4):573-591, Table 1 + Supplement 1.
- Norms: NHANES 2017-March 2020 pre-pandemic (`P_DEMO`, `P_CBC`, `P_BIOPRO`, `P_HSCRP`, `P_GLU`), adults 20+, weighted; rows with WBC > 50 or creatinine > 500 umol/L dropped.
- VO2max: Nes BM et al., Scand J Med Sci Sports 2011;21:e1-e9. Age reference: Loe U et al., PLoS One 2013;8:e64319, Table 2. Activity index: Kurtze 2008.
- Risk years: Holt-Lunstad 2015, Cappuccio 2010, Jha 2013, Kodama 2009; conversion `years = 8 * log2(HR)` from the human Gompertz mortality doubling time (~8 years). Sanity check: smoking HR 2.8 -> 11.9 years, matching Jha's ~10 years.
- Caffeine: Fredholm 1999 (5 h), Benowitz 1989 (smokers x0.5), Abernethy & Todd 1985 (oral contraceptives x2), Drake 2013 (6 h rule). The 50 mg bedtime threshold is a labelled assumption.
- Meal curves: the SimBiology `insulindemo` example (Cobelli / Dalla Man 2007 meal model) with its own variants. Variant rule: ADA fasting cut points (< 100, 100-125, >= 126 mg/dL). Weight: the model's `Body Weight` parameter (per-kg model). Walk: `Vm0` (insulin-independent glucose utilisation) x 4.68 during a 30 min walk starting 15 min after eating, decaying with a 60 min half-life afterwards; the factor is calibrated so the reference peak drops 15%, inside the 10-20% window from Buffey 2022 (Sports Med meta-analysis). The decay half-life and the exact window are assumptions and are stated in `meal_grid.json`. The band is insulin sensitivity `Vmx` +/-20%, not a statistical percentile. The curve keeps the variant's basal glucose (not the user's), hence the label "a typical curve for someone with your fasting glucose and weight".

## Regenerate the exports

```matlab
download_nhanes(); nhanes_norms(); export_artifacts();
```
or run `main_live_script`. Then `python matlab/tools/crosscheck/crosscheck.py` and confirm it reports no differences (it recomputes the same numbers independently).

## Contract notes for C (additive keys in `phenoage.json`)

- `imputation_sd_by_age_sex`: needed to widen the band for an imputed analyte.
- `cohort_offset_rule` and `affine.A`: compute the cohort offset at the user's exact age (`phenoage(reference, age) - age`), not from the band-midpoint table, or the waterfall will not reconcile.
- `vectors.json` entries carry `fasting`, `imputed`, `markers_used`, `xb`, `mortality_10y` for finer-grained checks.
