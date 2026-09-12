# Engine exports

Written by `matlab/export/export_artifacts.m` (Lane A) per `docs/contracts.md` §1. C reads these files and never re-derives coefficients.

## Status

- `hunt.json` — **real, from A** (generated 2026-09-12). Extends the contract's minimal example additively (`see` per sex, `pai_options`, `reference` norms, sources) — nothing in the base shape changed, so `computeFitnessAge` in `src/engine/fitness-age.ts` reads it directly. Units for waist/RHR are still unconfirmed with A (assumed cm/bpm).

Other engine files (`phenoage.json`, `nhanes_percentiles.json`, `risk_years.json`, `meal_grid.json`, `caffeine.json`) are not yet stubbed — added as later blocks need them.
