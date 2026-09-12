# Lane A: MATLAB engine

**Mission.** Every model and every number the app shows lives in `matlab/` and reaches the browser as JSON. You build the PhenoAge clock with its exact waterfall and noise band, the NHANES norms, the HUNT fitness age, the risk-years table, the SimBiology glucose-insulin meal model with an agent-driven parameter sweep and a Regression Learner surrogate, a caffeine PK model, an App Designer console, and a `.prj` whose live script runs all of it end to end with no errors. This lane is the MathWorks prize on its own (rubric in `CLAUDE.md`).

**You produce:** `web/public/engine/*.json` (shapes in `docs/contracts.md` section 1), `matlab/tests/vectors.json`, `matlab/Scallion.prj`, `matlab/main_live_script.mlx`, `matlab/app/ScallionEngineer.mlapp`, `matlab/README.md`, figures in `media/`.
**You consume:** nothing from other lanes. NHANES XPT files (public), Levine 2018 (open access), the SimBiology `insulindemo` example, the MathWorks workshop repo `armandogarcia17/Medical-Ventilator-Agentic` as the template.

## Setup (H0-1)

- [ ] MATLAB R2026a from the classroom license link on the MathWorks HackRice hub. Run `ver` and note SimBiology, Statistics and Machine Learning, Simulink; note whether MATLAB Compiler SDK is present (it only matters for an optional runtime path; JSON export is the default).
- [ ] Install `agenticToolkitInstaller.mltbx`, run `setupAgenticToolkit("install")` (Claude Code is auto-configured). Confirm the agent can call `detect_matlab_toolboxes` and `evaluate_matlab_code`.
- [ ] Clone the ventilator workshop repo next to ours as the layout reference. Ours: `matlab/{engine,models,sweep,surrogate,app,export,tests,Markdowns}`, `Scallion.prj`, `main_live_script.mlx`, `README.md`.
- [ ] Decide with D, before anything else, the three rules that shape the NHANES norms: CRP floor 0.1 mg/dL before the log; fasting rule (CMP glucose is usually non-fasting: greyed and imputed unless the report says fasting); imputation = age-sex NHANES median with widened band, labelled "8 of 9 markers". Write them into `matlab/README.md`.

## Block 1 (H1-6): the clock and the model load. Gate H6.

- [ ] `engine/phenoage.m`: linear predictor, mortality score, PhenoAge; the affine identity (`ln(-0.00553 ln(1-M))` collapses to `xb + c`) gives per-analyte years exactly; cohort offset per age-sex band; CV propagation to a +/- band; imputation and CRP floor; critical-range flags. Verify coefficient units against Levine 2018 Table 1.
- [ ] `tests/test_phenoage.m`: three reference vectors from public PhenoAge calculators, tolerance 0.05 years; the waterfall must sum exactly. Run via the MCP `run_matlab_test_file` tool and keep the output.
- [ ] `models/`: `sbioloadproject('insulindemo')`, simulate normal vs type-2 variant for a 78 g meal, plot plasma glucose. Save the figure to `media/`.
- [ ] Write `tests/vectors.json` (contract section 1) so C can cross-check the TypeScript port.
- **Gate H6:** three references match; insulindemo curves for two variants plotted.

## Block 2 (H6-12): norms and first export

- [ ] `engine/nhanes_norms.m`: read NHANES 2017-March 2020 XPTs (CBC, biochemistry, hs-CRP, demographics) into `fixtures/nhanes_2017_2020_labs.parquet`; apply the same CRP floor and fasting subsample; compute PhenoAge for every respondent; percentiles of PhenoAge acceleration and of each analyte by sex and 10-year age band.
- [ ] `engine/hunt_fitness_age.m` (Nes 2011 coefficients, fitness-age lookup) and `engine/risk_years.m` (the table with sources; `years = 8*log2(HR)`).
- [ ] `export/export_artifacts.m` writes `phenoage.json`, `nhanes_percentiles.json`, `hunt.json`, `risk_years.json` to `web/public/engine/`. Commit them; tell C.
- [ ] Sleep shift 2-6 am.

## Block 3 (H12-19): the meal model the workshop's way. Gate H19.

- [ ] 9:30 am Saturday (H13.5): attend the MathWorks workshop in Keck 100 with the model open; ask Armando Garcia Noguera to look at the variant choice and the walk parameter.
- [ ] Variant rule from fasting glucose (normal / low insulin sensitivity / type-2); body-weight scaling from the model's 1 kg basis; meal dose = carbs in grams to species `Dose`.
- [ ] Walk calibration: raise the glucose-utilisation parameter until the postprandial peak drops 10-20% (Buffey 2022); record the value and the figure.
- [ ] Agent-driven sweep `sweep/run_meal_sweep.m`: carbs 20-120 g x 3 variants x weight 50-120 kg x walk on/off; store peak, AUC, time-to-baseline and the p10/p50/p90 curve per cell (the band comes from perturbing insulin sensitivity +/-20%). Keep the agent's plan in `Markdowns/`.
- [ ] Regression Learner surrogate on the sweep table; export `surrogate/predictMealResponse.m`; validation plot (surrogate vs full simulation) into `media/`.
- [ ] `models/caffeine_pk.sbproj`: one-compartment, 5 h half-life, modifiers for smoking and oral contraceptives; export the decay curve.
- [ ] Export `meal_grid.json` and `caffeine.json`; tell C.
- **Gate H19:** Tonight's plate in the app draws from your grid.

## Block 4 (H19-27): console, live script, README. Freeze H27.

- [ ] `app/ScallionEngineer.mlapp` (App Designer, explorer layout like `StiffLungClassifierApp`): sidebar = fasting glucose, weight, carbs, walk toggle, caffeine dose and time; main = glucose curve band, PhenoAge waterfall, validation plot.
- [ ] `main_live_script.mlx` runs: tests, norms, sweep (or loads the cached sweep), surrogate fit, validation, export. Zero errors from a clean MATLAB start. This is the 20 Functionality points.
- [ ] `matlab/README.md`: what each file is and which app screen it drives; the three norm rules; how to regenerate the exports.
- [ ] Figures for the Devpost (waterfall, sweep, validation, caffeine).

## Block 5 (H27-37)

- [ ] Record the MATLAB segment of the video: open the `.prj`, run the live script, show the app, drag carbs, show the validation plot (60-90 s).
- [ ] Rehearse the 20-second MathWorks swap-in. Bring the laptop that runs MATLAB to judging.

## Your cut order

Compiler SDK runtime path (never start it) -> caffeine PK (fall back to a closed-form decay in `caffeine.json`) -> surrogate (export the raw sweep grid and interpolate) -> App Designer polish.

## Kickoff prompt (paste into Claude Code in the repo root)

```
Read CLAUDE.md, docs/contracts.md, docs/lanes/A.md and docs/log/A.md. You are the Lane A agent (MATLAB engine). First call detect_matlab_toolboxes and tell me which of SimBiology, Statistics and Machine Learning Toolbox, Simulink and MATLAB Compiler SDK are installed. Then restate in ten lines: what this lane produces, what it consumes, the three tasks in Block 1 in order, and what the H6 gate requires. Then plan Block 1 task one (engine/phenoage.m with the affine waterfall and the CV band) in plan mode and ask me only the questions that change the design. Use the MATLAB MCP tools to run code and tests; do not paste MATLAB code for me to run by hand.
```

## Session-restart prompt

```
Read docs/log/A.md and docs/contracts.md. Continue Lane A from the "next" line of the last log entry. Restate the next gate and the next task in three lines, then proceed.
```
