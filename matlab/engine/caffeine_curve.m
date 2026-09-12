function K = caffeine_curve()
%CAFFEINE_CURVE  Closed-form one-compartment caffeine decay for caffeine.json.
%
%   This is the fallback named in the lane cut order. models/caffeine_pk.sbproj
%   (SimBiology) replaces the curve when built; the JSON shape is identical.
%   Half-life 5 h in healthy non-smoking adults (Fredholm 1999, Pharmacol Rev
%   51:83; IOM 2001). Smokers clear caffeine about twice as fast (half-life
%   x0.5, Benowitz 1989); oral contraceptives roughly double the half-life
%   (Abernethy & Todd 1985). The 50 mg bedtime threshold is a product
%   assumption (about half a cup of coffee left in the body), not a study
%   result; Drake 2013 (J Clin Sleep Med 9:1195) is the evidence that 400 mg
%   taken 6 h before bed still disrupts sleep.
K.half_life_h = 5.0;
K.modifiers = struct('smoker', 0.5, 'oral_contraceptive', 2.0);
K.bedtime_threshold_mg = 50;
K.threshold_note = 'assumption: ~half a cup of coffee remaining; evidence for the 6 h rule is Drake 2013';
K.source = 'Fredholm 1999; Benowitz 1989; Abernethy & Todd 1985; Drake 2013';
t = 0:0.5:16;
K.curve = struct('t_h', t, 'fraction', round(0.5 .^ (t / K.half_life_h), 4));
K.rule = 'last_coffee_h_before_bed = half_life_h * modifier * log2(dose_mg / bedtime_threshold_mg)';
end
