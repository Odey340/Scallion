# Lane A: the MATLAB engine

Every number the Scallion app shows comes from a JSON file in `web/public/engine/`, and every one of those files is written by `export/export_artifacts.m` from the models in this directory. Nothing here runs at request time; the API never calls MATLAB.

## Run it

```matlab
cd matlab                      % or open Scallion.prj
addpath(genpath(pwd))
runtests('tests/test_phenoage.m')   % reference vectors, waterfall identity, safety gates
main_live_script                    % tests -> norms -> insulindemo -> (sweep) -> export
```

Requirements: MATLAB R2026a, SimBiology, Statistics and Machine Learning Toolbox (for `xptread` and Regression Learner), Simulink (SimBiology dependency). MATLAB Compiler SDK is optional and unused.

**Machine status (Fri H1):** MATLAB is not installed on the Lane A laptop yet and the Agentic Toolkit MCP is not registered. Until it is, `matlab/tools/crosscheck/crosscheck.py` (an independent Python mirror of the same equations) produced the current exports; each file says so in `meta.generated_by`. First thing after installing MATLAB: `main_live_script`, then `git diff web/public/engine` must be numerically empty.

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
| `models/run_insulindemo.m` | SimBiology glucose-insulin meal model, base vs variants (H6 gate) | Tonight: plate curves (via Block 3 sweep) |
| `sweep/`, `surrogate/`, `app/` | Block 3-4: parameter sweep, Regression Learner surrogate, App Designer console | Tonight; MathWorks demo |
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

## Regenerate the exports

```matlab
download_nhanes(); nhanes_norms(); export_artifacts();
```
or run `main_live_script`. Then `python matlab/tools/crosscheck/crosscheck.py` and confirm it reports no differences (it recomputes the same numbers independently).

## Contract notes for C (additive keys in `phenoage.json`)

- `imputation_sd_by_age_sex`: needed to widen the band for an imputed analyte.
- `cohort_offset_rule` and `affine.A`: compute the cohort offset at the user's exact age (`phenoage(reference, age) - age`), not from the band-midpoint table, or the waterfall will not reconcile.
- `vectors.json` entries carry `fasting`, `imputed`, `markers_used`, `xb`, `mortality_10y` for finer-grained checks.
