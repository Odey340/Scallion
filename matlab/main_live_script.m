%% Scallion engine: run everything end to end
% Open matlab/Scallion.prj, then run this script. Zero errors from a clean
% start is the MathWorks "Functionality" criterion. Save as main_live_script.mlx
% from the Live Editor (Save As > MATLAB Live Code) for the judged version.
%
% Sections: 1 tests, 2 norms, 3 insulindemo, 4 sweep (Block 3), 5 surrogate
% (Block 3), 6 export.

if isempty(which('runtests')), restoredefaultpath; end   % mpm install without OS registration leaves the path empty
here = fileparts(mfilename('fullpath'));
addpath(genpath(here));
cd(here);

%% 1. Toolboxes and NHANES norms (downloads the public XPTs on first run, ~10 MB)
v = ver;
fprintf('%s\n', strjoin(unique({v.Name}), ' | '));
download_nhanes();
N = nhanes_norms();
fprintf('adults %d, complete fasting cases %d\n', N.n_adults, N.n_complete_fasting);

%% 2. Tests: reference vectors, waterfall identity, band, imputation, safety gates
results = runtests('tests/test_phenoage.m');
disp(table(results));
assert(all([results.Passed]), 'engine tests failed');

%% 3. One person through the clock
vals = struct('albumin', 44, 'creatinine', 80, 'glucose', 5.4, 'crp', 0.08, ...
    'lymph_pct', 30, 'mcv', 90, 'rdw', 13.1, 'alp', 70, 'wbc', 6.2);
o = phenoage(vals, 34, 'M', struct('norms', N));
fprintf('PhenoAge %.1f +/- %.1f (chronological 34): %s\n', o.phenoage, o.band, o.label);
disp(o.waterfall);
plot_waterfall(o, fullfile(here, '..', 'media', 'phenoage_waterfall.png'));

%% 4. SimBiology meal model (H6: two variants plotted)
run_insulindemo(78);

%% 5. Meal model: variant rule, walk calibration, the 144-cell sweep (loads the cache when present)
fprintf('variant for fasting 95 / 110 / 130 mg/dL: %s / %s / %s\n', variant_rule(95), variant_rule(110), variant_rule(130));
if isfile(fullfile(here, 'sweep', 'meal_grid.mat'))
    fprintf('using cached sweep/meal_grid.mat (delete it to re-run the ~2 min sweep)\n');
    S = load(fullfile(here, 'sweep', 'walk_calibration.mat')); W = S.W;
else
    M = meal_model();
    W = calibrate_walk(M);
    run_meal_sweep(M, W);
end
fprintf('walk: Vm0 x %.2f during 15-45 min -> peak -%.0f%%\n', W.vm0_factor, 100 * W.peak_reduction_achieved);

%% 6. Surrogate: Gaussian-process fit of the sweep table, validated against the simulation
fit_surrogate();

%% 7. Export every JSON the app reads
export_artifacts();

%% 8. The console (app/ScallionEngineer.m): opens in the desktop; in batch it only saves a snapshot
app = ScallionEngineer('nolive');
app.snapshot(fullfile(here, '..', 'media', 'app_console_tonight.png'), 1);
if usejava('desktop'), fprintf('console open; press Validate for the full simulation\n'); else, app.close(); end
