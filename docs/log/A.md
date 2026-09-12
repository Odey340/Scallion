# Lane A log

Append ten lines per session: done, blocked, next, contract changes needed.

## Session 1 (Fri H0-H1.5, agent, 2026-09-12)

1. Done: `matlab/` scaffold; `engine/phenoage.m` with the exact affine waterfall, 1-SD CV band, imputation, fasting rule, CRP floor, critical flags; `phenoage_constants.m` verified against Levine 2018 Table 1 and Supplement 1 via BioAge (k = 0.090165; the contract's 0.09165 is a typo).
2. Done: `engine/nhanes_norms.m` (weighted medians, imputation SDs, acceleration and analyte percentiles), `hunt_fitness_age.m` (Nes 2011 + Loe 2013 Table 2, transcribed from the PDF), `risk_years.m` (8 entries, sourced), `caffeine_curve.m` (closed form), `export_artifacts.m`, `plot_waterfall.m`, `models/run_insulindemo.m`, `tests/test_phenoage.m` (11 tests), `main_live_script.m`, `README.md` with the three norm rules.
3. Done: NHANES 2017-March 2020 XPTs downloaded (git-ignored), `fixtures/nhanes_2017_2020_labs.parquet` (8521 adults, no identifiers), `tests/vectors.json` (4 vectors), and all five JSON exports in `web/public/engine/`.
4. Blocked: MATLAB R2026a is not installed on this laptop and the Agentic Toolkit MCP is not registered, so nothing in `matlab/` has been executed by MATLAB yet. The exports were produced by `tools/crosscheck/crosscheck.py`, a line-for-line Python mirror (each file's `meta.generated_by` says so). Human: install MATLAB from the HackRice hub link, run `setupAgenticToolkit("install")`, then `main_live_script`; `git diff web/public/engine` must be numerically empty.
5. Blocked: H6 item "insulindemo simulates two variants" needs MATLAB; `run_insulindemo.m` is written blind (variant and dose names to confirm with `sbioselect`).
6. Human check still open: paste `ref_34M` from `tests/vectors.json` into a public PhenoAge calculator (expect 29.3).
7. Next: (a) run tests and `main_live_script` in real MATLAB, fix anything `xptread`/`jsonencode` complain about, regenerate exports, commit; (b) `run_insulindemo` figure into `media/` (H6); (c) Block 3 variant rule, walk calibration, sweep, surrogate.
8. Contract: `phenoage.json` gained additive keys `imputation_sd_by_age_sex`, `cohort_offset_rule`, `affine.A`, `a`, `offset`, `t_months` (was `t_days`), `k` corrected to 0.090165; `hunt.json` gained `see`, `reference`, `pai_options`; `risk_years.json` rows gained `label`. All additive; C should compute the cohort offset at the exact age (see README). Propose `[contract]` commit fixing `k` and `t_months`.
9. Told C: exports are live at `web/public/engine/`, provisional until MATLAB regenerates them; numbers will not change unless a bug is found.
10. Decisions logged in `matlab/Markdowns/block1_plan.md` (band = 1 SD, full-precision coefficients, weights, creatinine fallback 110 umol/L).
