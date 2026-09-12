function [curve, summary, cell] = meal_lookup(G, carbs_g, variant, weight_kg, walk)
%MEAL_LOOKUP  Read a curve from the meal grid the way Lane C does: linear in carbs and weight, nearest variant.
%
%   [curve, summary] = meal_lookup(G, carbs_g, variant, weight_kg, walk)
%   G from sweep/meal_grid.mat (or jsondecode of meal_grid.json with the same keys).
%   curve.p10/p50/p90 on G.t_min; summary is interpolated the same way.
%   Values outside the axes are clamped to the grid edge (C does the same).

cg = G.axes.carbs_g(:)'; wg = G.axes.weight_kg(:)';
carbs_g = min(max(carbs_g, cg(1)), cg(end));
weight_kg = min(max(weight_kg, wg(1)), wg(end));
[ci, cw] = bracket(cg, carbs_g);
[wi, ww] = bracket(wg, weight_kg);
walk = double(logical(walk));
key = @(c, w) sprintf('%d|%s|%d|%d', c, variant, w, walk);
corners = {key(cg(ci(1)), wg(wi(1))), cw(1) * ww(1); key(cg(ci(2)), wg(wi(1))), cw(2) * ww(1); ...
           key(cg(ci(1)), wg(wi(2))), cw(1) * ww(2); key(cg(ci(2)), wg(wi(2))), cw(2) * ww(2)};
curve = struct('p10', 0, 'p50', 0, 'p90', 0);
summary = struct('peak_mgdL', 0, 't_peak_min', 0, 'auc_mgdL_min', 0, 't_baseline_min', 0, 'basal_mgdL', 0);
for i = 1:4
    k = corners{i, 1}; a = corners{i, 2};
    if a == 0, continue; end
    c = getcell(G.curves, k); s = getcell(G.summary, k);
    for f = fieldnames(curve)', curve.(f{1}) = curve.(f{1}) + a * c.(f{1})(:)'; end
    for f = fieldnames(summary)', summary.(f{1}) = summary.(f{1}) + a * s.(f{1}); end
end
cell = key(cg(ci(1 + (cw(2) > cw(1)))), wg(wi(1 + (ww(2) > ww(1)))));   % nearest grid cell
end

function [idx, w] = bracket(grid, x)
i = find(grid <= x, 1, 'last'); if i == numel(grid), i = i - 1; end
t = (x - grid(i)) / (grid(i + 1) - grid(i));
idx = [i, i + 1]; w = [1 - t, t];
end

function v = getcell(store, k)
if isa(store, 'containers.Map'), v = store(k);
else, v = store.(matlab.lang.makeValidName(k)); end   % jsondecode'd struct keys
end
