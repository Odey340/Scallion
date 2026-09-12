function [variant, R] = variant_rule(fasting_mgdL, diagnosed_t2d)
%VARIANT_RULE  Map fasting glucose to the meal-model variant.
%
%   variant = variant_rule(fasting_mgdL)              'normal' | 'low_si' | 't2d'
%   variant = variant_rule(fasting_mgdL, diagnosed)   diagnosed type 2 -> 't2d'
%   [~, R]  = variant_rule()                          the rule table for meal_grid.json
%
%   Thresholds are the ADA fasting-glucose categories (ADA Standards of Care
%   2024, Table 2.2): normal < 100 mg/dL, impaired fasting glucose 100-125,
%   diabetes >= 126. The SimBiology variants come from the insulindemo example:
%   "Low insulin sensitivity" (Vmx 0.0235, kp3 0.0045) stands in for impaired
%   fasting glucose; "Type 2 diabetic" is the Cobelli T2D parameter set (basal
%   glucose 164 mg/dL). The curve is "a typical curve for someone with your
%   fasting glucose and weight", never "your twin": the basal is the variant's,
%   not the user's.

R = struct( ...
    'normal', 'fasting < 100 mg/dL', ...
    'low_si', '100-125 mg/dL (impaired fasting glucose)', ...
    't2d',    '>= 126 mg/dL or diagnosed type 2', ...
    'source', 'ADA Standards of Care 2024, Table 2.2; variants from the SimBiology insulindemo example', ...
    'label',  'a typical curve for someone with your fasting glucose and weight');
if nargin == 0, variant = ''; return; end
if nargin < 2, diagnosed_t2d = false; end
if diagnosed_t2d || fasting_mgdL >= 126
    variant = 't2d';
elseif fasting_mgdL >= 100
    variant = 'low_si';
else
    variant = 'normal';
end
end
