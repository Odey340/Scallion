# Block 1 plan (Fri H1): the clock, tests, exports

Decisions taken without asking (none change the design; all logged in `docs/log/A.md`):

1. **Exact waterfall via the affine identity.** `PhenoAge = A + xb/k`, so analyte years are `coef * (term(x) - term(ref)) / k` and the cohort offset is `PhenoAge(reference person, exact age) - age`. This is the only way `age + offset + sum == PhenoAge` holds to floating point for every age, not just band midpoints.
2. **Band = 1 SD** from within-subject plus analytical CV (Westgard), propagated through the same derivative; imputed analytes substitute the population SD of their term (IQR/1.349 from NHANES). The contract example's 2.4 years for a healthy 34-year-old man comes out at 2.3.
3. **k = 0.090165** (Levine Supplement 1 / BioAge), not the contract placeholder 0.09165.
4. **Full-precision coefficients** (e.g. ALP 0.001868778, not 0.00188) so MATLAB and TypeScript agree to the last digit.
5. **NHANES weights:** `WTMECPRP` for analyte norms, `WTSAFPRP` for the fasting-subsample PhenoAge acceleration; unweighted would have been simpler but the percentiles are shown to users.
6. **Critical creatinine fallback:** when the report has no reference range, "2 x ref high" uses 110 umol/L.
7. **Python cross-check** (`tools/crosscheck/crosscheck.py`) mirrors every MATLAB function and, until MATLAB is installed on this laptop, produced the provisional exports. It stays as the independent verification for the MathWorks "error-free, validated" story.

Reference vectors (tests/vectors.json), computed from the same code and checked by hand for `ref_34M`:

| name | age/sex | PhenoAge | band | cohort offset | note |
|---|---|---|---|---|---|
| ref_34M | 34 M | 29.31 | 2.29 | -3.34 | CRP 0.08 exercises the floor |
| ref_58F | 58 F | 58.60 | 2.44 | -4.35 | |
| ref_71M | 71 M | 82.61 | 2.59 | -1.02 | |
| imputed_crp_45F | 45 F | 37.61 | 2.59 | -2.76 | CRP missing -> "8 of 9 markers", wider band |

Human step still open: paste `ref_34M` into a public PhenoAge calculator (two minutes) as the third-party check the lane file asks for.
