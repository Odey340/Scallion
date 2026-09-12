function S = fit_surrogate(tableFile, mediaDir)
%FIT_SURROGATE  Gaussian-process surrogate of the meal sweep (what Regression Learner would export).
%
%   S = fit_surrogate()   reads sweep/meal_sweep_table.csv, fits peak_mgdL and
%   iauc_mgdL_min on (carbs_g, weight_kg, variant, walk) with fitrgp (ARD squared
%   exponential kernel, standardized inputs), reports 5-fold cross-validated RMSE
%   and R^2, writes surrogate/mealSurrogate.mat (used by predictMealResponse.m)
%   and media/surrogate_validation.png (predicted vs simulated, held-out folds).
%
%   Why a surrogate at all: the app reads the 144-cell grid directly, so this
%   is the MathWorks "fit a model to your sweep" step, and its validation plot
%   is evidence that a smooth model reproduces the simulation between cells.

here = fileparts(mfilename('fullpath'));
if nargin < 1 || isempty(tableFile), tableFile = fullfile(here, '..', 'sweep', 'meal_sweep_table.csv'); end
if nargin < 2 || isempty(mediaDir), mediaDir = fullfile(here, '..', '..', 'media'); end
T = readtable(tableFile, 'TextType', 'string');
T.variant = categorical(T.variant, {'normal', 'low_si', 't2d'});
X = T(:, {'carbs_g', 'weight_kg', 'variant', 'walk'});
targets = {'peak_mgdL', 'iauc_mgdL_min'};
S = struct('inputs', {X.Properties.VariableNames}, 'variants', {categories(T.variant)'}, 'trained_on', tableFile);
rng(16);                                                    % HackRice 16
cvp = cvpartition(height(T), 'KFold', 5);
fig = figure('Color', 'w', 'Position', [100 100 900 420]);
try, fig.Theme = 'light'; catch, end
for k = 1:numel(targets)
    y = T.(targets{k});
    pred = zeros(size(y));
    for f = 1:cvp.NumTestSets
        m = fitrgp(X(training(cvp, f), :), y(training(cvp, f)), 'KernelFunction', 'ardsquaredexponential', 'Standardize', true);
        pred(test(cvp, f)) = predict(m, X(test(cvp, f), :));
    end
    rmse = sqrt(mean((pred - y).^2)); r2 = 1 - sum((pred - y).^2) / sum((y - mean(y)).^2);
    S.(targets{k}) = struct('model', compact(fitrgp(X, y, 'KernelFunction', 'ardsquaredexponential', 'Standardize', true)), ...
        'cv_rmse', rmse, 'cv_r2', r2, 'n', height(T));
    ax = subplot(1, 2, k, 'Parent', fig); hold(ax, 'on');
    set(ax, 'Color', 'w', 'XColor', [0.2 0.2 0.2], 'YColor', [0.2 0.2 0.2]);
    scale = 1; unit = 'mg/dL'; if k == 2, scale = 1000; unit = 'x1000 mg/dL min'; end   % keep the axes free of x10^4 exponents
    scatter(ax, y / scale, pred / scale, 18, double(T.variant), 'filled'); colormap(ax, lines(3));
    lim = [min([y; pred]) max([y; pred])] / scale; plot(ax, lim, lim, 'k--');
    ax.XAxis.Exponent = 0; ax.YAxis.Exponent = 0;
    name = strrep(strrep(targets{k}, 'iauc_mgdL_min', 'incremental AUC'), 'peak_mgdL', 'peak');
    xlabel(ax, sprintf('simulated %s (%s)', name, unit)); ylabel(ax, sprintf('surrogate, held-out fold (%s)', unit));
    title(ax, sprintf('%s: 5-fold RMSE %.1f, R^2 %.4f', name, rmse / scale, r2)); grid(ax, 'on'); axis(ax, 'square');
    fprintf('fit_surrogate: %s  CV RMSE %.2f  R^2 %.4f  (n = %d)\n', targets{k}, rmse, r2, height(T));
end
sgtitle(fig, 'Surrogate vs full SimBiology simulation (colour = variant)');
if ~isfolder(mediaDir), mkdir(mediaDir); end
exportgraphics(fig, fullfile(mediaDir, 'surrogate_validation.png'), 'Resolution', 150);
save(fullfile(here, 'mealSurrogate.mat'), 'S');
end
