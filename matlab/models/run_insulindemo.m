function [t, g, variants] = run_insulindemo(carbs_g, mediaDir)
%RUN_INSULINDEMO  Simulate the SimBiology insulindemo meal model for each variant.
%
%   [t, g, variants] = run_insulindemo()          78 g meal, figure saved to media/
%   [t, g, variants] = run_insulindemo(carbs_g)
%
%   H6 gate: "insulindemo curves for two variants plotted". The project ships
%   with MATLAB (Dalla Man 2007 glucose-insulin meal model). The base model is
%   the healthy subject; variants such as "Type 2 diabetic" override parameters.
%   TODO(A): run in MATLAB R2026a once installed; verify the variant names and
%   the dose target below with sbioselect and adjust.

here = fileparts(mfilename('fullpath'));
if nargin < 1 || isempty(carbs_g), carbs_g = 78; end
if nargin < 2 || isempty(mediaDir), mediaDir = fullfile(here, '..', '..', 'media'); end

sbioloadproject('insulindemo', 'm1');
cs = getconfigset(m1, 'active');
cs.StopTime = 24;                                  % hours; the model's time unit
cs.SolverOptions.OutputTimes = 0:0.05:cs.StopTime;

% Meal dose: the example ships a "Single Meal" dose of 78 g. Scale the amount.
meal = sbioselect(m1, 'Type', 'dose', 'Name', 'Single Meal');
assert(~isempty(meal), 'dose "Single Meal" not found; run sbioselect(m1,''Type'',''dose'') and fix the name');
meal.Amount = carbs_g;                             % grams of glucose, species Dose

allVariants = getvariant(m1);
names = arrayfun(@(v) v.Name, allVariants, 'UniformOutput', false);
fprintf('variants in insulindemo: %s\n', strjoin(names, ' | '));
variants = [{'normal'}, names(:)'];               % base model + every shipped variant
glucoseSpecies = sbioselect(m1, 'Type', 'species', 'Name', 'Plasma Glucose');
if isempty(glucoseSpecies), glucoseSpecies = sbioselect(m1, 'Type', 'species', 'Where', 'Name', 'regexp', 'Glucose'); glucoseSpecies = glucoseSpecies(1); end

figure('Color', 'w', 'Position', [100 100 800 450]); hold on;
g = cell(numel(variants), 1);
for i = 1:numel(variants)
    if i == 1
        sd = sbiosimulate(m1, cs, meal);
    else
        sd = sbiosimulate(m1, cs, allVariants(i - 1), meal);
    end
    [tt, gg] = selectbyname(sd, glucoseSpecies.Name);
    t = tt; g{i} = gg;
    plot(t * 60, gg, 'LineWidth', 2, 'DisplayName', variants{i});
end
xlabel('minutes after the meal'); ylabel(sprintf('%s (%s)', glucoseSpecies.Name, glucoseSpecies.Units));
title(sprintf('insulindemo: %d g meal, base model vs variants', carbs_g));
legend('Location', 'northeast'); grid on; xlim([0 300]);
if ~isfolder(mediaDir), mkdir(mediaDir); end
exportgraphics(gcf, fullfile(mediaDir, sprintf('insulindemo_%dg_variants.png', carbs_g)), 'Resolution', 150);
fprintf('saved %s\n', fullfile(mediaDir, sprintf('insulindemo_%dg_variants.png', carbs_g)));
end
