function [out, H] = hunt_fitness_age(age, sex, waist_cm, rhr_bpm, pai)
%HUNT_FITNESS_AGE  Estimated VO2max (Nes 2011) and the HUNT-style fitness age.
%
%   out = hunt_fitness_age(age, sex, waist_cm, rhr_bpm, pai)
%   [~, H] = hunt_fitness_age()      returns the constants exported to hunt.json
%
%   VO2max (mL/kg/min) without exercise testing, HUNT Fitness Study:
%     Nes BM et al., Scand J Med Sci Sports 2011;21:e1-e9 (Tables 3-4)
%       men:   100.27 - 0.296*age - 0.369*waist - 0.155*RHR + 0.226*PAI
%       women:  74.74 - 0.247*age - 0.259*waist - 0.114*RHR + 0.198*PAI
%     SEE 5.70 (men) and 5.14 (women) mL/kg/min.
%   PAI is the Kurtze 2008 physical-activity index (frequency x intensity x
%   duration, range 0-15). The app asks one question; hunt.json carries the
%   option-to-PAI mapping.
%   Fitness age = the age at which the sex-specific population mean VO2max
%   (Loe 2013, PLoS One 8:e64319, Table 2, HUNT3 Fitness) equals the user's
%   VO2max. Piecewise-linear on band midpoints, clamped to 20-90.

H.vo2max = struct( ...
    'M', struct('intercept', 100.27, 'age', -0.296, 'waist', -0.369, 'rhr', -0.155, 'pai', 0.226, 'see', 5.70), ...
    'F', struct('intercept',  74.74, 'age', -0.247, 'waist', -0.259, 'rhr', -0.114, 'pai', 0.198, 'see', 5.14));
H.vo2max_source = 'Nes 2011, Scand J Med Sci Sports 21:e1-e9';
% Loe 2013 Table 2, mean +/- SD by age group (20-29 ... 70+), mL/kg/min.
H.reference = struct( ...
    'age_mid', [25 35 45 55 65 75], ...
    'M', struct('mean', [54.4 49.1 47.2 42.6 39.2 35.3], 'sd', [8.4 7.5 7.7 7.4 6.7 6.5]), ...
    'F', struct('mean', [43.0 40.0 38.4 34.4 31.1 28.3], 'sd', [7.7 6.8 6.9 5.7 5.1 5.2]));
H.reference_source = 'Loe 2013, PLoS One 8(5):e64319, Table 2 (HUNT3 Fitness, n = 3678)';
% Kurtze 2008 index: frequency {never 0, <1/wk 0.5, 1/wk 1, 2-3/wk 2.5, ~daily 5}
% x intensity {easy 1, moderate 2, hard 3} x duration {<15 min 0.1, 15-29 0.38, 30-60 0.75, >60 1}.
H.pai_options = struct( ...
    'key',   {'none', 'light_weekly', 'moderate_2_3', 'hard_2_3', 'hard_daily'}, ...
    'label', {'Rarely or never', 'Light, about once a week', 'Moderate, 2-3 times a week, 30-60 min', ...
              'Hard, 2-3 times a week, 30-60 min', 'Hard, almost every day, over an hour'}, ...
    'pai',   {0, 1*1*0.75, 2.5*2*0.75, 2.5*3*0.75, 5*3*1});
H.pai_source = 'Kurtze 2008, Scand J Public Health 36:52-61 (HUNT PA index)';
H.age_range = [20 90];

% fitness_age_lookup for the contract: [age, median VO2max] rows, 20..90 by 5
ages = 20:5:90;
for s = {'M','F'}
    m = interp1(H.reference.age_mid, H.reference.(s{1}).mean, ages, 'linear', 'extrap');
    H.fitness_age_lookup.(s{1}) = [ages(:) round(m(:), 1)];
end

if nargin == 0, out = []; return; end
sex = upper(char(sex));
c = H.vo2max.(sex);
vo2 = c.intercept + c.age * age + c.waist * waist_cm + c.rhr * rhr_bpm + c.pai * pai;
lut = H.fitness_age_lookup.(sex);
% invert the monotone decreasing lookup (VO2max -> age), clamp to 20-90
[v, i] = unique(lut(:,2)); a = lut(i,1);
fa = interp1(v, a, vo2, 'linear', 'extrap');
fa = min(max(fa, H.age_range(1)), H.age_range(2));
slope = abs((lut(end,2) - lut(1,2)) / (lut(end,1) - lut(1,1)));   % mL/kg/min per year
out = struct('vo2max', vo2, 'fitness_age', fa, 'band_years', c.see / slope, ...
    'age', age, 'sex', sex, 'label', 'Estimate from age, waist, resting pulse and activity; not a fitness test');
end
