# Engine exports

Written by `matlab/export/export_artifacts.m` (Lane A) per `docs/contracts.md` §1. C reads these files and never re-derives coefficients.

## Status

- `hunt.json` — **real, from A** (generated 2026-09-12). Extends the contract's minimal example additively (`see` per sex, `pai_options`, `reference` norms, sources) — nothing in the base shape changed, so `computeFitnessAge` in `src/engine/fitness-age.ts` reads it directly. Units for waist/RHR are still unconfirmed with A (assumed cm/bpm).

- `phenoage.json` — **real, from A** (Levine 2018 Supplement 1 coefficients, NHANES 2017-2020 norms, contract v8 additive keys). Read by `src/engine/phenoage.ts`; `src/engine/phenoage.test.ts` reproduces `matlab/tests/vectors.json` to the contract's 0.05-year tolerance (`npm test`).
- `meal_grid.json`, `caffeine.json` — **real, from A**. Read by `src/engine/meal.ts` and `src/engine/caffeine.ts` (the `/scan` screen).
- `nhanes_percentiles.json`, `risk_years.json` — **real, from A**, not read by any screen yet (Labs result distributions, Home levers ledger).
