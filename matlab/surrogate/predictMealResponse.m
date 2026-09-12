function out = predictMealResponse(carbs_g, weight_kg, variant, walk)
%PREDICTMEALRESPONSE  Surrogate prediction of the meal response (peak and incremental AUC).
%
%   out = predictMealResponse(60, 78, 'normal', true)
%   out.peak_mgdL, out.iauc_mgdL_min, plus the cross-validated RMSE of each.
%   Trained by surrogate/fit_surrogate.m on the 144-cell sweep. Inputs may be
%   vectors of equal length. The app itself reads the grid; this is the smooth
%   model for what-if sliders and for the console's validation story.
persistent S
if isempty(S), L = load(fullfile(fileparts(mfilename('fullpath')), 'mealSurrogate.mat')); S = L.S; end
X = table(carbs_g(:), weight_kg(:), categorical(cellstr(string(variant(:))), S.variants), double(logical(walk(:))), ...
    'VariableNames', {'carbs_g', 'weight_kg', 'variant', 'walk'});
out = struct('peak_mgdL', predict(S.peak_mgdL.model, X), 'iauc_mgdL_min', predict(S.iauc_mgdL_min.model, X), ...
    'cv_rmse', struct('peak_mgdL', S.peak_mgdL.cv_rmse, 'iauc_mgdL_min', S.iauc_mgdL_min.cv_rmse));
end
