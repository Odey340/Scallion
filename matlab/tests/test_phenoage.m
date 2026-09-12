function tests = test_phenoage
%TEST_PHENOAGE  Reference vectors, waterfall identity, band, imputation, safety gates.
%   Run:  cd matlab; addpath(genpath(pwd)); results = runtests('tests/test_phenoage.m')
tests = functiontests(localfunctions);
end

function setupOnce(t)
here = fileparts(mfilename('fullpath'));
addpath(genpath(fullfile(here, '..')));
t.TestData.vectors = jsondecode(fileread(fullfile(here, 'vectors.json')));
t.TestData.norms = load_norms();
end

function test_reference_vectors(t)
% Every vector in tests/vectors.json reproduces to 0.05 years (the same
% tolerance Lane C's TypeScript port must meet).
V = t.TestData.vectors;
for i = 1:numel(V)
    v = V(i);
    o = phenoage(v.values, v.age, v.sex, struct('norms', t.TestData.norms, 'fasting', true));
    t.verifyEqual(o.phenoage, v.phenoage, 'AbsTol', 0.05, sprintf('%s phenoage', v.name));
    t.verifyEqual(o.band, v.band, 'AbsTol', 0.05, sprintf('%s band', v.name));
    f = fieldnames(v.waterfall);
    for j = 1:numel(f)
        t.verifyEqual(o.waterfall.(f{j}), v.waterfall.(f{j}), 'AbsTol', 0.05, sprintf('%s waterfall.%s', v.name, f{j}));
    end
end
end

function test_affine_equals_direct(t)
% The affine shortcut and the full mortality-score route agree to 1e-9.
V = t.TestData.vectors;
for i = 1:numel(V)
    o = phenoage(V(i).values, V(i).age, V(i).sex, struct('norms', t.TestData.norms));
    t.verifyEqual(o.phenoage, o.phenoage_direct, 'AbsTol', 1e-9);
end
end

function test_waterfall_sums_exactly(t)
V = t.TestData.vectors;
C = phenoage_constants();
for i = 1:numel(V)
    o = phenoage(V(i).values, V(i).age, V(i).sex, struct('norms', t.TestData.norms));
    s = V(i).age + o.waterfall.cohort_offset;
    for j = 1:numel(C.analytes), s = s + o.waterfall.(C.analytes{j}); end
    t.verifyEqual(s, o.phenoage, 'AbsTol', 1e-9);
end
end

function test_reference_person_has_zero_analyte_years(t)
% Feeding the age-sex medians back in gives all-zero analyte bars and
% phenoage == age + cohort_offset.
N = t.TestData.norms;
ref = N.reference.M.b40_49;
o = phenoage(ref, 45, 'M', struct('norms', N));
C = phenoage_constants();
for j = 1:numel(C.analytes), t.verifyEqual(o.waterfall.(C.analytes{j}), 0, 'AbsTol', 1e-12); end
t.verifyEqual(o.phenoage, 45 + o.waterfall.cohort_offset, 'AbsTol', 1e-9);
end

function test_imputation_widens_band(t)
v = t.TestData.vectors(1);
full = phenoage(v.values, v.age, v.sex, struct('norms', t.TestData.norms));
vals = rmfield(v.values, 'crp');
part = phenoage(vals, v.age, v.sex, struct('norms', t.TestData.norms));
t.verifyEqual(part.markers_used, 8);
t.verifyEqual(part.imputed, {'crp'});
t.verifyGreaterThan(part.band, full.band);
end

function test_non_fasting_glucose_is_imputed(t)
v = t.TestData.vectors(1);
o = phenoage(v.values, v.age, v.sex, struct('norms', t.TestData.norms, 'fasting', false));
t.verifyTrue(o.flags.non_fasting);
t.verifyEqual(o.imputed, {'glucose'});
o2 = phenoage(v.values, v.age, v.sex, struct('norms', t.TestData.norms, 'fasting', []));
t.verifyEqual(o2.imputed, {'glucose'});
end

function test_crp_floor(t)
v = t.TestData.vectors(1);
lo = v.values; lo.crp = 0.02;
fl = v.values; fl.crp = 0.1;
a = phenoage(lo, v.age, v.sex, struct('norms', t.TestData.norms));
b = phenoage(fl, v.age, v.sex, struct('norms', t.TestData.norms));
t.verifyEqual(a.phenoage, b.phenoage, 'AbsTol', 1e-12);
end

function test_critical_suppresses_number(t)
v = t.TestData.vectors(1);
bad = v.values; bad.glucose = 300 / 18.016;
o = phenoage(bad, v.age, v.sex, struct('norms', t.TestData.norms));
t.verifyTrue(o.flags.critical);
t.verifyEqual(o.flags.critical_analytes, {'glucose'});
t.verifyTrue(isnan(o.phenoage));
t.verifyEqual(o.label, 'See a clinician first');
bad = v.values; bad.creatinine = 250;
o = phenoage(bad, v.age, v.sex, struct('norms', t.TestData.norms, 'creatinine_ref_high', 110));
t.verifyEqual(o.flags.critical_analytes, {'creatinine'});
end

function test_crp_acute_flag(t)
v = t.TestData.vectors(1);
hi = v.values; hi.crp = 1.5;
o = phenoage(hi, v.age, v.sex, struct('norms', t.TestData.norms));
t.verifyTrue(o.flags.crp_acute);
t.verifyFalse(o.flags.critical);
end

function test_risk_years_gompertz(t)
R = risk_years();
i = strcmp({R.exposure}, 'social_isolation');
t.verifyEqual(R(i).years, round(8 * log2(1.29), 1));
t.verifyEqual(R(i).years, 2.9, 'AbsTol', 1e-9);
end

function test_hunt_fitness_age_roundtrip(t)
% A person whose predicted VO2max equals the 45-year-old male mean gets fitness age ~45.
[~, H] = hunt_fitness_age();
target = H.reference.M.mean(3);
c = H.vo2max.M;
pai = (target - (c.intercept + c.age * 45 + c.waist * 95 + c.rhr * 62)) / c.pai;
o = hunt_fitness_age(45, 'M', 95, 62, pai);
t.verifyEqual(o.vo2max, target, 'AbsTol', 1e-9);
t.verifyEqual(o.fitness_age, 45, 'AbsTol', 0.5);
end
