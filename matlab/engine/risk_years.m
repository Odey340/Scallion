function R = risk_years()
%RISK_YEARS  Published all-cause mortality hazard ratios converted to risk-equivalent years.
%
%   years = MRDT * log2(HR), MRDT = 8 years (human Gompertz mortality-rate
%   doubling time, Finch 1990 / Strehler-Mildvan). A hazard ratio of 2 is
%   therefore "8 years older on the same clock". Label on screen: "risk-
%   equivalent years, if sustained, population estimate" (never "life lost").
%   Sanity check: current smoking HR 2.8 (Jha 2013) -> 11.9 years, in line with
%   Jha's reported ~10 years of life lost.
%
%   `condition` is the expression Lane C evaluates against the coach context.

MRDT = 8;
rows = {
 % layer       exposure              HR    source                                  condition
 'social',    'social_isolation',   1.29, 'Holt-Lunstad 2015, Perspect Psychol Sci 10:227', 'lsns_proxy < 12'
 'social',    'loneliness',         1.26, 'Holt-Lunstad 2015, Perspect Psychol Sci 10:227', 'lonely == true'
 'social',    'living_alone',       1.32, 'Holt-Lunstad 2015, Perspect Psychol Sci 10:227', 'lives_alone == true'
 'lifestyle', 'short_sleep',        1.12, 'Cappuccio 2010, Sleep 33:585',                  'sleep_h < 6'
 'lifestyle', 'long_sleep',         1.30, 'Cappuccio 2010, Sleep 33:585',                  'sleep_h > 9'
 'lifestyle', 'smoking',            2.80, 'Jha 2013, NEJM 368:341 (men; women 3.0)',        'smoker == true'
 'fitness',   'low_fitness',        1.70, 'Kodama 2009, JAMA 301:2024 (low vs high CRF)',  'vo2max < reference_p20'
 'fitness',   'per_met_fitness',    0.87, 'Kodama 2009, JAMA 301:2024 (per 1 MET)',        'per 3.5 mL/kg/min of VO2max'
};
R = struct('layer', rows(:,1), 'exposure', rows(:,2), 'hr', rows(:,3), 'years', [], ...
    'source', rows(:,4), 'condition', rows(:,5));
for i = 1:numel(R)
    R(i).years = round(MRDT * log2(R(i).hr), 1);
    R(i).label = 'risk-equivalent years, if sustained, population estimate';
end
R = R(:);
end
