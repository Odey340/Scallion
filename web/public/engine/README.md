# Engine exports

Written by `matlab/export/export_artifacts.m` (Lane A) per `docs/contracts.md` §1. C reads these files and never re-derives coefficients.

## Status

- `hunt.json` — **placeholder**, TODO(A). Contains only the two-entry example from the contract (`F` coefficients and lookup are empty). Do not trust the fitness ages it produces; the shape is real, the numbers are not. Replace wholesale when A's export lands.

Other engine files (`phenoage.json`, `nhanes_percentiles.json`, `risk_years.json`, `meal_grid.json`, `caffeine.json`) are not yet stubbed — added as later blocks need them.
