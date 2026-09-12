function C = phenoage_constants()
%PHENOAGE_CONSTANTS  Levine 2018 PhenoAge model constants (single source of truth).
%
%   Source: Levine ME et al. "An epigenetic biomarker of aging for lifespan
%   and healthspan", Aging 2018;10(4):573-591, Table 1 and Supplement 1.
%   Full-precision values are the ones in Supplement 1, as used by the
%   reference implementation in the BioAge R package (Kwon & Belsky 2021,
%   R/phenoage_calc.R). Table 1 prints them rounded (e.g. ALP 0.0019); we
%   keep full precision so the TypeScript port and this engine agree.
%
%   Model:  xb  = intercept + sum(coef_i * x_i) + coef_age * age
%           M   = 1 - exp(-exp(xb) * (exp(t_months*gamma) - 1) / gamma)   (10-year mortality)
%           PhenoAge = 141.50225 + ln(-0.0055305 * ln(1 - M)) / 0.090165
%   Because ln(-a*ln(1-M)) = ln(a) + xb + ln((exp(t*gamma)-1)/gamma), PhenoAge
%   is AFFINE in xb:  PhenoAge = A + xb / k.  phenoage.m uses this for an
%   exact per-analyte waterfall.

C.version = 1;

% Canonical analyte order and units (docs/contracts.md section 1).
C.analytes = {'albumin','creatinine','glucose','crp','lymph_pct','mcv','rdw','alp','wbc'};
C.units = struct('albumin','g/L','creatinine','umol/L','glucose','mmol/L', ...
    'crp','mg/dL','lymph_pct','%','mcv','fL','rdw','%','alp','U/L','wbc','10^9/L','age','years');

% Cox weights (Supplement 1 / BioAge). CRP enters as ln(CRP in mg/dL).
C.coefficients = struct( ...
    'albumin',    -0.03359355, ...
    'creatinine',  0.009506491, ...
    'glucose',     0.1953192, ...
    'ln_crp',      0.09536762, ...
    'lymph_pct',  -0.01199984, ...
    'mcv',         0.02676401, ...
    'rdw',         0.3306156, ...
    'alp',         0.001868778, ...
    'wbc',         0.05542406, ...
    'age',         0.08035356);
C.intercept = -19.90667;
C.gamma     = 0.007692696;
C.t_months  = 120;          % 10-year mortality horizon
C.k         = 0.090165;     % divisor in the years conversion (contract placeholder 0.09165 was a typo)
C.a         = 0.0055305;    % multiplier inside the log
C.offset    = 141.50225;

% Affine identity: PhenoAge = A + xb / k
C.log_term  = log(C.a) + log((exp(C.t_months * C.gamma) - 1) / C.gamma);
C.A         = C.offset + C.log_term / C.k;

% Product rules agreed with Lane D (matlab/README.md, "three norm rules").
C.crp_floor_mgdL = 0.1;   % hs-CRP below 1 mg/L is floored before the log (27% of NHANES adults sit there)
C.crp_acute_mgdL = 1.0;   % above 10 mg/L: flag possible acute inflammation, suggest a retest

% Critical ranges (contract section 1). The age number is suppressed when hit.
C.critical_ranges = struct('glucose_mgdL', [55 250], 'wbc', [2 30], 'creatinine_x_ref_high', 2);
C.creatinine_ref_high_default_umolL = 110;   % typical lab upper limit (~1.24 mg/dL) when the report has none
C.mgdL_per_mmolL_glucose = 18.016;

% Within-subject (CVI) and analytical (CVA) coefficients of variation, used ONLY
% for the +/- band. CVI from the Westgard biological-variation database (Ricos
% et al.); CVA = 0.5 * CVI (Fraser's desirable imprecision). They shape the
% band, never the age. TODO(A): re-check against the EFLM BV database.
C.cv = struct( ...
    'albumin',    struct('within', 0.031, 'analytical', 0.016), ...
    'creatinine', struct('within', 0.043, 'analytical', 0.022), ...
    'glucose',    struct('within', 0.045, 'analytical', 0.023), ...
    'crp',        struct('within', 0.422, 'analytical', 0.211), ...
    'lymph_pct',  struct('within', 0.104, 'analytical', 0.052), ...
    'mcv',        struct('within', 0.013, 'analytical', 0.007), ...
    'rdw',        struct('within', 0.035, 'analytical', 0.018), ...
    'alp',        struct('within', 0.064, 'analytical', 0.032), ...
    'wbc',        struct('within', 0.109, 'analytical', 0.055));

% Age bands for the norms. Labels are what the JSON exports use; keys are the
% MATLAB-safe struct field names used inside norms_cache.json.
C.age_bands      = {'20-29','30-39','40-49','50-59','60-69','70-79','80+'};
C.age_band_keys  = {'b20_29','b30_39','b40_49','b50_59','b60_69','b70_79','b80p'};
C.age_band_edges = [20 30 40 50 60 70 80 Inf];
end
