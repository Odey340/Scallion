%% Scallion engine: run everything end to end
% Open matlab/Scallion.prj, then run this script. Zero errors from a clean
% start is the MathWorks "Functionality" criterion. Save as main_live_script.mlx
% from the Live Editor (Save As > MATLAB Live Code) for the judged version.
%
% Sections: 1 tests, 2 norms, 3 insulindemo, 4 sweep (Block 3), 5 surrogate
% (Block 3), 6 export.

here = fileparts(mfilename('fullpath'));
addpath(genpath(here));
cd(here);

%% 1. Toolboxes and tests
v = ver;
fprintf('%s\n', strjoin(unique({v.Name}), ' | '));
results = runtests('tests/test_phenoage.m');
disp(table(results));
assert(all([results.Passed]), 'engine tests failed');

%% 2. NHANES norms (downloads the public XPTs on first run, ~10 MB)
download_nhanes();
N = nhanes_norms();
fprintf('adults %d, complete fasting cases %d\n', N.n_adults, N.n_complete_fasting);

%% 3. One person through the clock
vals = struct('albumin', 44, 'creatinine', 80, 'glucose', 5.4, 'crp', 0.08, ...
    'lymph_pct', 30, 'mcv', 90, 'rdw', 13.1, 'alp', 70, 'wbc', 6.2);
o = phenoage(vals, 34, 'M', struct('norms', N));
fprintf('PhenoAge %.1f +/- %.1f (chronological 34): %s\n', o.phenoage, o.band, o.label);
disp(o.waterfall);
plot_waterfall(o, fullfile(here, '..', 'media', 'phenoage_waterfall.png'));

%% 4. SimBiology meal model (H6: two variants plotted)
run_insulindemo(78);

%% 5. Meal sweep and surrogate (Block 3; loads the cached sweep when present)
if isfile(fullfile(here, 'sweep', 'meal_grid.mat'))
    fprintf('using cached sweep/meal_grid.mat\n');
elseif exist('run_meal_sweep', 'file')
    run_meal_sweep();
end

%% 6. Export every JSON the app reads
export_artifacts();
