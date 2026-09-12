function [g, basal, t_min] = simulate_meal(M, carbs_g, variant, weight_kg, walk, vmx_scale)
%SIMULATE_MEAL  Plasma glucose (mg/dL) after a meal for one cell of the Scallion grid.
%
%   [g, basal, t_min] = simulate_meal(M, carbs_g, variant, weight_kg, walk)
%   [...] = simulate_meal(M, carbs_g, variant, weight_kg, walk, vmx_scale)
%
%   M          from meal_model()
%   carbs_g    grams of carbohydrate (dose to species Dose)
%   variant    'normal' | 'low_si' | 't2d'   (see variant_rule.m)
%   weight_kg  body weight; the model is per kg, so this scales the meal
%   walk       true/false: apply the calibrated walkFactor on Vm0 during the walk window
%   vmx_scale  multiplier on the variant's insulin sensitivity Vmx (band: 0.8 / 1 / 1.2)
%
%   g is the curve on M.t_min; basal is g(1) (the variant's fasting glucose).

if nargin < 6 || isempty(vmx_scale), vmx_scale = 1; end
M.meal.Amount = carbs_g;
M.bw.Value = weight_kg;
if walk, M.walk.factor.Value = M.walk.calibrated_factor; else, M.walk.factor.Value = 1; end

vars = {};
base = M.variants.(variant);
vmx = M.vmx0;
if ~isempty(base)
    vars{end+1} = base;
    c = base.Content;
    for i = 1:numel(c)
        if strcmp(c{i}{2}, 'Vmx'), vmx = c{i}{4}; end
    end
end
if vmx_scale ~= 1
    v = sbiovariant('vmx_band');
    addcontent(v, {'parameter', 'Vmx', 'Value', vmx * vmx_scale});
    vars{end+1} = v;
end
if isempty(vars), vars = []; else, vars = [vars{:}]; end

sd = sbiosimulate(M.m1, M.cs, vars, M.meal);
[~, g] = selectbyname(sd, M.species);
g = g(:); basal = g(1); t_min = M.t_min;
end
