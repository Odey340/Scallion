function [t, g, variants, m1] = run_insulindemo(carbs_g, mediaDir)
%RUN_INSULINDEMO  Simulate the SimBiology insulindemo meal model for the base model and each variant.
%
%   [t, g, variants, m1] = run_insulindemo()          78 g meal, figure saved to media/
%   [t, g, variants, m1] = run_insulindemo(carbs_g)
%
%   H6 gate: "insulindemo curves for two variants plotted". The project is the
%   MathWorks example "Simulating the Glucose-Insulin Response" (Dalla Man 2007
%   meal simulation model): model m1, dose "Single Meal" (78 g), variants
%   "Type 2 diabetic", "Low insulin sensitivity", "High insulin sensitivity",
%   "High/Low beta cell responsivity"; plotted species "Plasma Glu Conc".
%   The example files are downloaded on demand with openExample('simbio/insulindemo')
%   into userpath/Examples; this function finds them there when the project is
%   not on the path (an mpm install ships no example files).

here = fileparts(mfilename('fullpath'));
if nargin < 1 || isempty(carbs_g), carbs_g = 78; end
if nargin < 2 || isempty(mediaDir), mediaDir = fullfile(here, '..', '..', 'media'); end

m1 = load_insulindemo();
cs = getconfigset(m1, 'active');
cs.StopTime = 24;                                  % model time unit is hour
cs.SolverOptions.OutputTimes = 0:0.05:cs.StopTime;

meal = sbioselect(m1, 'Name', 'Single Meal');     % a RepeatDose object; the docs select it by name
assert(~isempty(meal), 'dose "Single Meal" not found in insulindemo');
meal = meal(1);
fprintf('Single Meal: %g %s to %s at t = %g %s\n', meal.Amount, meal.AmountUnits, meal.TargetName, meal.StartTime, meal.TimeUnits);
meal.Amount = carbs_g;                             % grams of carbohydrate to species Dose (in memory only; the project is never saved)

allVariants = getvariant(m1);
names = arrayfun(@(v) v.Name, allVariants, 'UniformOutput', false);
fprintf('insulindemo variants: %s\n', strjoin(names, ' | '));
variants = [{'normal'}, names(:)'];
glu = sbioselect(m1, 'Type', 'species', 'Name', 'Plasma Glu Conc');
assert(~isempty(glu), 'species "Plasma Glu Conc" not found');

fig = figure('Color', 'w', 'Position', [100 100 820 460]); hold on;
try, fig.Theme = 'light'; catch, end                 % batch mode otherwise picks the dark theme
set(gca, 'Color', 'w', 'XColor', [0.2 0.2 0.2], 'YColor', [0.2 0.2 0.2]);
g = cell(numel(variants), 1); t = [];
for i = 1:numel(variants)
    if i == 1, sd = sbiosimulate(m1, cs, [], meal);
    else,      sd = sbiosimulate(m1, cs, allVariants(i - 1), meal); end
    [tt, gg] = selectbyname(sd, glu.Name);
    t = tt; g{i} = gg;
    lw = 1.5; if any(strcmp(variants{i}, {'normal', 'Type 2 diabetic', 'Low insulin sensitivity'})), lw = 2.5; end
    plot(t * 60, gg, 'LineWidth', lw, 'DisplayName', variants{i});
end
xlabel('minutes after the meal'); ylabel(sprintf('%s (%s)', glu.Name, glu.Units));
title(sprintf('SimBiology insulindemo, %g g meal: base model vs variants', carbs_g));
legend('Location', 'northeast'); grid on; xlim([0 360]);
if ~isfolder(mediaDir), mkdir(mediaDir); end
out = fullfile(mediaDir, sprintf('insulindemo_%gg_variants.png', carbs_g));
exportgraphics(fig, out, 'Resolution', 150);
fprintf('saved %s\n', out);
end

% ---------------------------------------------------------------------------
function m1 = load_insulindemo()
% sbioloadproject finds insulindemo.sbproj only when the example folder is on
% the path; otherwise look under userpath/Examples (openExample puts it there).
try
    sbioloadproject('insulindemo', 'm1');
    return
catch first
    d = dir(fullfile(userpath, 'Examples', '**', 'insulindemo.sbproj'));
    if isempty(d)
        try
            openExample('simbio/insulindemo');           % downloads the example files
            d = dir(fullfile(userpath, 'Examples', '**', 'insulindemo.sbproj'));
        catch
        end
    end
    if isempty(d), rethrow(first); end
    addpath(d(1).folder);
    sbioloadproject(fullfile(d(1).folder, 'insulindemo.sbproj'), 'm1');
end
end
