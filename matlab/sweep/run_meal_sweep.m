function G = run_meal_sweep(M, W, outDir, mediaDir)
%RUN_MEAL_SWEEP  Simulate the Scallion meal grid and write sweep/meal_grid.mat (+ csv, figure).
%
%   G = run_meal_sweep()          builds the model, calibrates the walk, runs the grid
%   G = run_meal_sweep(M, W)      reuse a model and a walk calibration
%
%   Grid (contract meal_grid.json): carbs 20:20:120 g x variant {normal, low_si,
%   t2d} x weight {50, 70, 90, 110} kg x walk {0, 1} = 144 cells. Each cell is
%   simulated three times with the variant's insulin sensitivity Vmx scaled by
%   0.8, 1.0, 1.2; p50 is the nominal curve and p10/p90 the pointwise min/max of
%   the three (the band is "how much insulin sensitivity varies", not a
%   statistical percentile). Summary per cell: peak, time to peak, incremental
%   AUC above basal over 0-240 min, time back to within 5 mg/dL of basal.
%   Key format: 'carbs|variant|weight|walk'. Lane C interpolates linearly on
%   carbs and weight and takes the nearest variant.

here = fileparts(mfilename('fullpath'));
if nargin < 1 || isempty(M), M = meal_model(); end
if nargin < 2 || isempty(W), W = calibrate_walk(M); end
if nargin < 3 || isempty(outDir), outDir = here; end
if nargin < 4 || isempty(mediaDir), mediaDir = fullfile(here, '..', '..', 'media'); end
M.walk.calibrated_factor = W.vm0_factor;
M.walk.start.Value = W.walk_start_min / 60; M.walk.end.Value = W.walk_end_min / 60;

carbs = 20:20:120; variants = {'normal', 'low_si', 't2d'}; weights = [50 70 90 110]; walks = [0 1];
scales = [0.8 1.0 1.2];
t = M.t_min; keep = t <= 240; tk = t(keep);
curves = containers.Map('KeyType', 'char', 'ValueType', 'any');
summary = containers.Map('KeyType', 'char', 'ValueType', 'any');
rows = {};
n = numel(carbs) * numel(variants) * numel(weights) * numel(walks); k = 0; tic;
for c = carbs
    for v = 1:numel(variants)
        for w = weights
            for wk = walks
                gg = zeros(numel(tk), numel(scales));
                for s = 1:numel(scales)
                    g = simulate_meal(M, c, variants{v}, w, logical(wk), scales(s));
                    gg(:, s) = g(keep);
                end
                p50 = gg(:, 2); basal = p50(1);
                [peak, ip] = max(p50);
                iauc = trapz(tk, max(p50 - basal, 0));
                back = find(tk > tk(ip) & abs(p50 - basal) <= 5, 1, 'first');
                if isempty(back), tb = tk(end); else, tb = tk(back); end
                key = sprintf('%d|%s|%d|%d', c, variants{v}, w, wk);
                curves(key) = struct('p10', round(min(gg, [], 2), 1)', 'p50', round(p50, 1)', 'p90', round(max(gg, [], 2), 1)');
                summary(key) = struct('peak_mgdL', round(peak, 1), 't_peak_min', tk(ip), ...
                    'auc_mgdL_min', round(iauc), 't_baseline_min', tb, 'basal_mgdL', round(basal, 1));
                rows(end+1, :) = {c, variants{v}, w, wk, basal, peak, tk(ip), iauc, tb}; %#ok<AGROW>
                k = k + 1;
            end
        end
    end
    fprintf('run_meal_sweep: %d / %d cells, %.0f s\n', k, n, toc);
end

[~, R] = variant_rule();
G = struct();
G.version = 1;
G.model = 'SimBiology insulindemo (Cobelli / Dalla Man 2007 meal model), variants from the example';
G.axes = struct('carbs_g', carbs, 'variant', {variants}, 'weight_kg', weights, 'walk', walks);
G.t_min = tk';
G.curves = curves;
G.summary = summary;
G.band_rule = 'p10/p90 = pointwise min/max over Vmx x {0.8, 1.0, 1.2} (insulin sensitivity +/-20%); p50 = nominal';
G.summary_rule = 'auc = incremental AUC above basal 0-240 min; t_baseline = first time after the peak within 5 mg/dL of basal (240 if never)';
G.variant_rule = R;
G.walk_calibration = struct('peak_reduction_target', W.peak_reduction_window, 'achieved', W.peak_reduction_achieved, ...
    'vm0_factor', W.vm0_factor, 'walk_start_min', W.walk_start_min, 'walk_end_min', W.walk_end_min, ...
    'source', 'Buffey 2022', 'mechanism', W.mechanism);
G.labels = struct('curve', R.label, 'walk', 'plus a 30 min walk starting 15 min after eating', ...
    'medication', 'discuss timing with your clinician');
save(fullfile(outDir, 'meal_grid.mat'), 'G');
T = cell2table(rows, 'VariableNames', {'carbs_g', 'variant', 'weight_kg', 'walk', 'basal_mgdL', 'peak_mgdL', 't_peak_min', 'iauc_mgdL_min', 't_baseline_min'});
writetable(T, fullfile(outDir, 'meal_sweep_table.csv'));
fprintf('run_meal_sweep: %d cells -> %s\n', n, fullfile(outDir, 'meal_grid.mat'));

% figure: peak vs carbs by variant at 70 kg, walk off (solid) vs on (dashed)
fig = figure('Color', 'w', 'Position', [100 100 820 440]); hold on;
try, fig.Theme = 'light'; catch, end
set(gca, 'Color', 'w', 'XColor', [0.2 0.2 0.2], 'YColor', [0.2 0.2 0.2]);
cols = lines(3);
for v = 1:numel(variants)
    for wk = walks
        pk = arrayfun(@(c) getfield(summary(sprintf('%d|%s|%d|%d', c, variants{v}, 70, wk)), 'peak_mgdL'), carbs); %#ok<GFLD>
        ls = '-'; if wk, ls = '--'; end
        plot(carbs, pk, ls, 'Color', cols(v, :), 'LineWidth', 2, 'Marker', 'o', ...
            'DisplayName', sprintf('%s%s', variants{v}, ternary(wk, ' + walk', '')));
    end
end
xlabel('carbohydrate (g)'); ylabel('peak plasma glucose (mg/dL)'); grid on; legend('Location', 'northwest');
title('Meal sweep at 70 kg: peak vs carbs by variant, with and without the walk');
if ~isfolder(mediaDir), mkdir(mediaDir); end
exportgraphics(fig, fullfile(mediaDir, 'meal_sweep.png'), 'Resolution', 150);
end

function s = ternary(c, a, b)
if c, s = a; else, s = b; end
end
