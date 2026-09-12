function out = phenoage(values, age, sex, opts)
%PHENOAGE  Levine 2018 phenotypic age with an exact per-analyte waterfall and a +/- band.
%
%   out = phenoage(values, age, sex)
%   out = phenoage(values, age, sex, opts)
%
%   values : struct with any of albumin (g/L), creatinine (umol/L), glucose
%            (mmol/L), crp (mg/dL), lymph_pct (%), mcv (fL), rdw (%), alp (U/L),
%            wbc (10^9/L). Missing fields or NaN are imputed from the age-sex
%            NHANES median and listed in out.imputed ("8 of 9 markers").
%   age    : chronological age in years.        sex : 'M' or 'F'.
%   opts.fasting              true / false / [] (unknown). Anything but true
%                             treats glucose as non-fasting: greyed and imputed.
%   opts.norms                norms struct (default: load_norms()).
%   opts.creatinine_ref_high  the report's upper reference limit (umol/L) for
%                             the critical rule "creatinine > 2 x ref high".
%
%   out.phenoage          years (NaN when a critical flag suppresses it)
%   out.band              +/- years, 1 SD propagated from within-subject and
%                         analytical CV; imputed analytes contribute the
%                         population SD instead, so the band widens.
%   out.waterfall         cohort_offset plus one field per analyte, in years:
%                         age + cohort_offset + sum(analyte years) == phenoage
%                         exactly (affine identity, see phenoage_constants.m).
%   out.imputed           cellstr; out.markers_used = 9 - numel(out.imputed)
%   out.flags             critical, critical_analytes, crp_acute, non_fasting
%   out.xb, out.mortality_10y, out.phenoage_direct   the non-affine route, for self-checks

if nargin < 4, opts = struct(); end
C = phenoage_constants();
if ~isfield(opts, 'norms') || isempty(opts.norms), opts.norms = load_norms(); end
if ~isfield(opts, 'fasting'), opts.fasting = true; end
fasting = islogical(opts.fasting) && isscalar(opts.fasting) && opts.fasting;
sex = upper(char(sex));
assert(any(strcmp(sex, {'M','F'})), 'sex must be ''M'' or ''F''');
[bandLabel, bandKey] = age_band(age);
ref = opts.norms.reference.(sex).(bandKey);      % age-sex medians, canonical units
sdp = opts.norms.imputation_sd.(sex).(bandKey);  % SD of each model term in the band

% --- 1. Assemble the nine inputs, imputing where needed --------------------
x = struct(); imputed = {};
flags = struct('critical', false, 'critical_analytes', {{}}, 'crp_acute', false, 'non_fasting', false);
for i = 1:numel(C.analytes)
    a = C.analytes{i};
    have = isfield(values, a) && ~isempty(values.(a)) && ~isnan(values.(a));
    if strcmp(a, 'glucose') && have && ~fasting
        have = false; flags.non_fasting = true;     % rule 2: non-fasting glucose is imputed
    end
    if have
        x.(a) = double(values.(a));
    else
        x.(a) = ref.(a); imputed{end+1} = a; %#ok<AGROW>
    end
end
measured = @(a) ~any(strcmp(imputed, a));
flags.crp_acute = measured('crp') && x.crp > C.crp_acute_mgdL;

% --- 2. Critical ranges (rule 4: suppress the number, "see a clinician first")
crit = {};
g_mgdL = x.glucose * C.mgdL_per_mmolL_glucose;
if measured('glucose') && (g_mgdL < C.critical_ranges.glucose_mgdL(1) || g_mgdL > C.critical_ranges.glucose_mgdL(2))
    crit{end+1} = 'glucose';
end
if measured('wbc') && (x.wbc < C.critical_ranges.wbc(1) || x.wbc > C.critical_ranges.wbc(2))
    crit{end+1} = 'wbc';
end
crh = C.creatinine_ref_high_default_umolL;
if isfield(opts, 'creatinine_ref_high') && ~isempty(opts.creatinine_ref_high), crh = opts.creatinine_ref_high; end
if measured('creatinine') && x.creatinine > C.critical_ranges.creatinine_x_ref_high * crh
    crit{end+1} = 'creatinine';
end
flags.critical = ~isempty(crit);
flags.critical_analytes = crit;

% --- 3. Linear predictor, both routes ---------------------------------------
xb = linear_predictor(x, age, C);
pa_affine = C.A + xb / C.k;
M = 1 - exp(-exp(xb) * (exp(C.t_months * C.gamma) - 1) / C.gamma);
pa_direct = C.offset + log(-C.a * log(1 - M)) / C.k;

% --- 4. Waterfall: years relative to the age-sex reference person -----------
xb_ref = linear_predictor(ref, age, C);
wf = struct('cohort_offset', (C.A + xb_ref / C.k) - age);   % PhenoAge(reference, age) - age
for i = 1:numel(C.analytes)
    a = C.analytes{i};
    wf.(a) = (model_term(a, x.(a), C) - model_term(a, ref.(a), C)) / C.k;
end
s = age + wf.cohort_offset;
for i = 1:numel(C.analytes), s = s + wf.(C.analytes{i}); end
assert(abs(s - pa_affine) < 1e-9, 'waterfall does not reconcile');

% --- 5. Band: 1 SD from CV (measured) or population SD of the term (imputed)
v = 0;
for i = 1:numel(C.analytes)
    a = C.analytes{i};
    dydx = C.coefficients.(coef_name(a)) / C.k;     % years per unit of the model term
    if measured(a)
        cvt = hypot(C.cv.(a).within, C.cv.(a).analytical);
        if strcmp(a, 'crp'), sd_term = cvt; else, sd_term = cvt * x.(a); end   % d(ln x) = dx/x
    else
        sd_term = sdp.(a);
    end
    v = v + (dydx * sd_term)^2;
end

% --- 6. Output ---------------------------------------------------------------
out = struct();
out.phenoage        = pa_affine;
out.phenoage_direct = pa_direct;
out.band            = sqrt(v);
out.waterfall       = wf;
out.inputs          = x;
out.imputed         = imputed;
out.markers_used    = numel(C.analytes) - numel(imputed);
out.flags           = flags;
out.xb              = xb;
out.mortality_10y   = M;
out.age             = age;
out.sex             = sex;
out.age_band        = bandLabel;
out.label           = 'Estimate, not diagnosis';
if flags.critical
    out.phenoage = NaN; out.phenoage_direct = NaN;
    out.label = 'See a clinician first';
end
end

% ---------------------------------------------------------------------------
function xb = linear_predictor(x, age, C)
xb = C.intercept + C.coefficients.age * age;
for i = 1:numel(C.analytes)
    a = C.analytes{i};
    xb = xb + model_term(a, x.(a), C);
end
end

function t = model_term(a, val, C)
% One term coef_i * f(x_i); CRP is floored, then logged.
if strcmp(a, 'crp')
    t = C.coefficients.ln_crp * log(max(val, C.crp_floor_mgdL));
else
    t = C.coefficients.(a) * val;
end
end

function cf = coef_name(a)
if strcmp(a, 'crp'), cf = 'ln_crp'; else, cf = a; end
end
