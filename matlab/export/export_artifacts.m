function export_artifacts(outDir)
%EXPORT_ARTIFACTS  Write every engine JSON that the app reads (contract section 1).
%
%   export_artifacts()          writes to ../web/public/engine/
%   export_artifacts(outDir)
%
%   Files: phenoage.json, nhanes_percentiles.json, hunt.json, risk_years.json,
%   caffeine.json, and (when sweep/meal_grid.mat exists) meal_grid.json.
%   Every number the app shows comes from one of these files.

here = fileparts(mfilename('fullpath'));
if nargin < 1 || isempty(outDir), outDir = fullfile(here, '..', '..', 'web', 'public', 'engine'); end
if ~isfolder(outDir), mkdir(outDir); end
C = phenoage_constants();
N = load_norms();
stamp = struct('generated_by', 'matlab/export/export_artifacts.m', 'generated_at', char(datetime('now', 'TimeZone', 'UTC', 'Format', 'yyyy-MM-dd''T''HH:mm:ss''Z''')));

% ---- phenoage.json --------------------------------------------------------
P = struct();
P.version = C.version;
P.source  = 'Levine 2018, Aging 10:573, Table 1 + Supplement 1';
P.units   = C.units;
P.coefficients = C.coefficients;
P.intercept = C.intercept;
P.gamma = C.gamma;
P.t_months = C.t_months;
P.k = C.k;
P.a = C.a;
P.offset = C.offset;
P.affine = struct('A', C.A, 'rule', 'phenoage = A + xb / k, where xb = intercept + sum(coef_i * term_i) + coef_age * age; term_crp = ln(max(crp, crp_floor_mgdL))');
P.crp_floor_mgdL = C.crp_floor_mgdL;
P.crp_acute_mgdL = C.crp_acute_mgdL;
P.reference_by_age_sex = relabel(N.reference, C);
P.imputation_sd_by_age_sex = relabel(N.imputation_sd, C);
P.cohort_offset_by_age_sex = cohort_offsets(N, C);
P.cohort_offset_rule = 'exact: phenoage(reference_by_age_sex[sex][band], age, sex) - age at the user''s exact age; the table above is the value at the band midpoint, for display only';
P.waterfall_rule = 'years_i = coef_i * (term_i(x_i) - term_i(reference_i)) / k; age + cohort_offset + sum(years_i) == phenoage exactly';
P.band_rule = '1 SD: sqrt(sum_i (coef_i/k * sd_i)^2); measured: sd_i = x_i * sqrt(cv_within^2 + cv_analytical^2) (crp: the cv itself, on the log term); imputed: sd_i = imputation_sd_by_age_sex';
P.cv = C.cv;
P.critical_ranges = C.critical_ranges;
P.creatinine_ref_high_default_umolL = C.creatinine_ref_high_default_umolL;
P.fasting_rule = 'glucose is imputed (greyed, "8 of 9 markers") unless the report states fasting';
P.labels = struct('estimate', 'Estimate, not diagnosis', 'critical', 'See a clinician first', 'imputed', '8 of 9 markers');
P.norms = struct('source', N.source, 'n_adults', N.n_adults, 'n_complete_fasting', N.n_complete_fasting);
P.meta = stamp;
writejson(fullfile(outDir, 'phenoage.json'), P);

% ---- nhanes_percentiles.json ---------------------------------------------
Q = struct();
Q.version = 1;
Q.source = N.source;
Q.phenoage_accel = relabel(N.phenoage_accel, C);
A = struct();
for i = 1:numel(C.analytes)
    a = C.analytes{i};
    A.(a) = relabel(N.analytes.(a), C);
end
Q.analytes = A;
Q.units = C.units;
Q.meta = stamp;
writejson(fullfile(outDir, 'nhanes_percentiles.json'), Q);

% ---- hunt.json --------------------------------------------------------------
[~, H] = hunt_fitness_age();
H.version = 1;
H.label = 'Estimate from age, waist, resting pulse and activity; not a fitness test';
H.meta = stamp;
writejson(fullfile(outDir, 'hunt.json'), H);

% ---- risk_years.json ---------------------------------------------------------
writejson(fullfile(outDir, 'risk_years.json'), risk_years());

% ---- caffeine.json -----------------------------------------------------------
K = caffeine_curve(); K.version = 1; K.meta = stamp;
writejson(fullfile(outDir, 'caffeine.json'), K);

% ---- meal_grid.json (Block 3) ------------------------------------------------
gridFile = fullfile(here, '..', 'sweep', 'meal_grid.mat');
if isfile(gridFile)
    G = load(gridFile); G = G.G; G.meta = stamp; %#ok<NASGU>
    writejson(fullfile(outDir, 'meal_grid.json'), G);
else
    fprintf('export_artifacts: sweep/meal_grid.mat not found, meal_grid.json skipped (Block 3)\n');
end
fprintf('export_artifacts: wrote %s\n', outDir);
end

% ---------------------------------------------------------------------------
function M = relabel(S, C)
% {M: {b30_39: ...}} -> containers.Map so jsonencode emits "30-39" keys.
M = struct();
for s = {'M','F'}
    m = containers.Map('KeyType', 'char', 'ValueType', 'any');
    for b = 1:numel(C.age_band_keys)
        m(C.age_bands{b}) = S.(s{1}).(C.age_band_keys{b});
    end
    M.(s{1}) = m;
end
end

function M = cohort_offsets(N, C)
% PhenoAge(reference, age) - age at each band midpoint (80+ uses 85).
mids = [25 35 45 55 65 75 85];
M = struct();
for s = {'M','F'}
    m = containers.Map('KeyType', 'char', 'ValueType', 'any');
    for b = 1:numel(C.age_band_keys)
        ref = N.reference.(s{1}).(C.age_band_keys{b});
        o = phenoage(ref, mids(b), s{1}, struct('norms', N));
        m(C.age_bands{b}) = round(o.waterfall.cohort_offset, 3);
    end
    M.(s{1}) = m;
end
end

function writejson(path, S)
fid = fopen(path, 'w'); fwrite(fid, jsonencode(S, 'PrettyPrint', true)); fclose(fid);
end
