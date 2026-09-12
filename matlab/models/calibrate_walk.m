function W = calibrate_walk(M, outDir, mediaDir)
%CALIBRATE_WALK  Find the Vm0 multiplier that makes a post-meal walk cut the peak by 15%.
%
%   W = calibrate_walk(M)   M from meal_model(); writes sweep/walk_calibration.mat
%                           and media/walk_calibration.png
%
%   Target: Buffey et al. 2022 (Sports Med 53:1-13, meta-analysis) found that
%   light walking after a meal lowers the postprandial glucose peak; the lane
%   target is a 10-20% lower peak, we calibrate to the midpoint 15%. The walk
%   window is 30 min starting 15 min after eating (Reynolds 2016 used 10 min
%   after each meal; Buffey's included trials used 2-30 min bouts within the
%   first hour). The reference cell is the example's 78 g meal, base model, 78 kg.
%   Mechanism: Vm0 is the insulin-independent glucose utilisation (mg/min per
%   kg); exercise raises muscle glucose uptake independently of insulin, and
%   the effect decays after the walk (meal_model.m, 60 min half-life). A first
%   version with an instant reset needed Vm0 x 12 and produced a dip-and-rebound
%   curve; the decaying version needs a smaller factor and a smooth curve.

here = fileparts(mfilename('fullpath'));
if nargin < 1 || isempty(M), M = meal_model(); end
if nargin < 2 || isempty(outDir), outDir = fullfile(here, '..', 'sweep'); end
if nargin < 3 || isempty(mediaDir), mediaDir = fullfile(here, '..', '..', 'media'); end
target = 0.15; window = [0.10 0.20];
M.walk.start.Value = 15 / 60; M.walk.end.Value = 45 / 60;

M.walk.calibrated_factor = 1;
g0 = simulate_meal(M, 78, 'normal', 78, false);
peak0 = max(g0);
drop = @(f) 1 - peakwith(M, f) / peak0;
lo = 1; hi = 2;
while drop(hi) < target && hi < 64, hi = hi * 2; end        % bracket
for it = 1:30                                                % bisection on the factor
    mid = (lo + hi) / 2;
    if drop(mid) < target, lo = mid; else, hi = mid; end
    if hi - lo < 1e-3, break; end
end
factor = (lo + hi) / 2;
M.walk.calibrated_factor = factor;
g1 = simulate_meal(M, 78, 'normal', 78, true);
achieved = 1 - max(g1) / peak0;
assert(achieved >= window(1) && achieved <= window(2), 'walk calibration outside 10-20%%: %.3f', achieved);

W = struct('vm0_factor', factor, 'walk_start_min', 15, 'walk_end_min', 45, ...
    'peak_reduction_target', target, 'peak_reduction_achieved', achieved, ...
    'peak_reduction_window', window, 'reference_cell', '78 g, normal, 78 kg', ...
    'peak_no_walk_mgdL', peak0, 'peak_walk_mgdL', max(g1), ...
    'source', 'Buffey 2022, Sports Med (meta-analysis); Reynolds 2016, Diabetologia 59:2572', ...
    'post_walk_half_life_min', round(60 * log(2) / M.walk.decay.Value), ...
    'mechanism', 'Vm0 (insulin-independent glucose utilisation) x factor during the walk, decaying afterwards with the stated half-life (assumption)');
if ~isfolder(outDir), mkdir(outDir); end
save(fullfile(outDir, 'walk_calibration.mat'), 'W');

fig = figure('Color', 'w', 'Position', [100 100 820 440]); hold on;
try, fig.Theme = 'light'; catch, end
set(gca, 'Color', 'w', 'XColor', [0.2 0.2 0.2], 'YColor', [0.2 0.2 0.2]);
plot(M.t_min, g0, 'LineWidth', 2.2, 'DisplayName', 'eat now');
plot(M.t_min, g1, 'LineWidth', 2.2, 'DisplayName', sprintf('plus a 30 min walk at 15 min (Vm0 x %.2f)', factor));
patch([15 45 45 15], [min(ylim) min(ylim) max(ylim) max(ylim)], [0.85 0.92 0.85], 'EdgeColor', 'none', 'FaceAlpha', 0.5, 'DisplayName', 'walk window');
uistack(findobj(gca, 'Type', 'patch'), 'bottom');
xlabel('minutes after the meal'); ylabel('plasma glucose (mg/dL)'); grid on; legend('Location', 'northeast');
title(sprintf('Walk calibration: peak %.0f -> %.0f mg/dL (-%.0f%%), target 10-20%% (Buffey 2022)', peak0, max(g1), 100 * achieved));
if ~isfolder(mediaDir), mkdir(mediaDir); end
exportgraphics(fig, fullfile(mediaDir, 'walk_calibration.png'), 'Resolution', 150);
fprintf('calibrate_walk: Vm0 x %.3f -> peak %.1f -> %.1f mg/dL (-%.1f%%)\n', factor, peak0, max(g1), 100 * achieved);
end

function p = peakwith(M, f)
M.walk.calibrated_factor = f;
p = max(simulate_meal(M, 78, 'normal', 78, true));
end
