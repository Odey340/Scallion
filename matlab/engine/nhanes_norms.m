function N = nhanes_norms(dataDir, outFile)
%NHANES_NORMS  Build the age-sex norms from NHANES 2017-March 2020 (pre-pandemic).
%
%   N = nhanes_norms()                   reads matlab/data/nhanes/*.xpt, writes
%                                        engine/norms_cache.json and
%                                        fixtures/nhanes_2017_2020_labs.parquet
%   N = nhanes_norms(dataDir, outFile)
%
%   Files (public, https://wwwn.cdc.gov/nchs/nhanes/): P_DEMO, P_CBC, P_BIOPRO,
%   P_HSCRP, P_GLU. Get them with data/download_nhanes.m.
%
%   The three norm rules (matlab/README.md):
%     1. hs-CRP (mg/L) / 10 -> mg/dL, floored at 0.1 mg/dL before the log.
%     2. Glucose comes from the fasting subsample (P_GLU, LBDGLUSI), never the
%        random serum glucose in the biochemistry profile.
%     3. Reference = weighted age-sex median; imputation SD = IQR/1.349 of the
%        model term (ln CRP for CRP), so an imputed analyte widens the band.
%   Weights: WTMECPRP for analyte norms; WTSAFPRP (fasting subsample) for the
%   PhenoAge-acceleration percentiles. Rows with implausible values (WBC > 50,
%   creatinine > 500 umol/L) or a saturated mortality score are dropped.

here = fileparts(mfilename('fullpath'));
if nargin < 1 || isempty(dataDir), dataDir = fullfile(here, '..', 'data', 'nhanes'); end
if nargin < 2 || isempty(outFile), outFile = fullfile(here, 'norms_cache.json'); end
C = phenoage_constants();

rd = @(f) xptread(fullfile(dataDir, [f '.xpt']));   % SAS XPORT reader, Statistics and Machine Learning Toolbox
demo = rd('P_DEMO');  demo = demo(:, {'SEQN','RIAGENDR','RIDAGEYR','WTMECPRP'});
cbc  = rd('P_CBC');   cbc  = cbc(:,  {'SEQN','LBXWBCSI','LBXLYPCT','LBXMCVSI','LBXRDW'});
bio  = rd('P_BIOPRO'); bio = bio(:,  {'SEQN','LBDSALSI','LBDSCRSI','LBXSAPSI'});
crp  = rd('P_HSCRP'); crp  = crp(:,  {'SEQN','LBXHSCRP'});
glu  = rd('P_GLU');   glu  = glu(:,  {'SEQN','LBDGLUSI','WTSAFPRP'});

T = innerjoin(demo, cbc, 'Keys', 'SEQN');
T = innerjoin(T, bio, 'Keys', 'SEQN');
T = outerjoin(T, crp, 'Keys', 'SEQN', 'MergeKeys', true, 'Type', 'left');
T = outerjoin(T, glu, 'Keys', 'SEQN', 'MergeKeys', true, 'Type', 'left');
T = T(T.RIDAGEYR >= 20, :);

% canonical columns
L = table();
L.seqn       = T.SEQN;
L.sex        = repmat("F", height(T), 1); L.sex(T.RIAGENDR == 1) = "M";
L.age        = T.RIDAGEYR;
L.w_mec      = T.WTMECPRP;
L.w_fast     = T.WTSAFPRP;
L.albumin    = T.LBDSALSI;
L.creatinine = T.LBDSCRSI;
L.glucose    = T.LBDGLUSI;                        % fasting subsample only
crp_mgdL     = T.LBXHSCRP / 10;                    % keep NaN as missing: max() would silently drop it
crp_mgdL(crp_mgdL < C.crp_floor_mgdL) = C.crp_floor_mgdL;
L.crp        = crp_mgdL;
L.lymph_pct  = T.LBXLYPCT;
L.mcv        = T.LBXMCVSI;
L.rdw        = T.LBXRDW;
L.alp        = T.LBXSAPSI;
L.wbc        = T.LBXWBCSI;
plaus = ~(L.wbc > 50 | L.creatinine > 500);
L = L(plaus, :);

% write the redacted-by-construction fixture (no identifiers beyond SEQN)
fixDir = fullfile(here, '..', '..', 'fixtures');
if ~isfolder(fixDir), mkdir(fixDir); end
parquetwrite(fullfile(fixDir, 'nhanes_2017_2020_labs.parquet'), L);

% percentiles
P = [0.05 0.25 0.50 0.75 0.95]; pn = {'p5','p25','p50','p75','p95'};
N = struct('version', 1, 'source', 'NHANES 2017-March 2020 pre-pandemic (P_DEMO, P_CBC, P_BIOPRO, P_HSCRP, P_GLU)', ...
    'weights', 'WTMECPRP for analytes and reference medians; WTSAFPRP for PhenoAge acceleration', ...
    'crp_floor_mgdL', C.crp_floor_mgdL, 'n_adults', height(L));
sexes = {'M','F'};
for s = 1:2
    for b = 1:numel(C.age_band_keys)
        key = C.age_band_keys{b};
        inb = L.sex == sexes{s} & L.age >= C.age_band_edges(b) & L.age < C.age_band_edges(b+1);
        R = struct(); S = struct();
        for i = 1:numel(C.analytes)
            a = C.analytes{i};
            v = L.(a)(inb); w = L.w_mec(inb);
            if strcmp(a, 'glucose'), w = L.w_fast(inb); end
            q = wquantile(v, w, P);
            R.(a) = q(3);
            if strcmp(a, 'crp'), ql = wquantile(log(v), w, [0.25 0.75]); S.(a) = (ql(2) - ql(1)) / 1.349;
            else,                 S.(a) = (q(4) - q(2)) / 1.349; end
            N.analytes.(a).(sexes{s}).(key) = cell2struct(num2cell(q(:)), pn(:), 1);
        end
        N.reference.(sexes{s}).(key) = R;
        N.imputation_sd.(sexes{s}).(key) = S;
        N.n.(sexes{s}).(key) = nnz(inb);
    end
end

% PhenoAge acceleration on complete fasting cases
cc = L(all(~isnan([L.albumin L.creatinine L.glucose L.crp L.lymph_pct L.mcv L.rdw L.alp L.wbc]), 2) & ~isnan(L.w_fast), :);
xb = C.intercept + C.coefficients.age * cc.age ...
   + C.coefficients.albumin * cc.albumin + C.coefficients.creatinine * cc.creatinine ...
   + C.coefficients.glucose * cc.glucose + C.coefficients.ln_crp * log(cc.crp) ...
   + C.coefficients.lymph_pct * cc.lymph_pct + C.coefficients.mcv * cc.mcv ...
   + C.coefficients.rdw * cc.rdw + C.coefficients.alp * cc.alp + C.coefficients.wbc * cc.wbc;
pa = C.A + xb / C.k;                      % affine route == direct route
accel = pa - cc.age;
ok = isfinite(accel);
cc = cc(ok, :); accel = accel(ok);
N.n_complete_fasting = height(cc);
for s = 1:2
    for b = 1:numel(C.age_band_keys)
        key = C.age_band_keys{b};
        inb = cc.sex == sexes{s} & cc.age >= C.age_band_edges(b) & cc.age < C.age_band_edges(b+1);
        q = wquantile(accel(inb), cc.w_fast(inb), P);
        N.phenoage_accel.(sexes{s}).(key) = cell2struct(num2cell(q(:)), pn(:), 1);
    end
end

fid = fopen(outFile, 'w'); fwrite(fid, jsonencode(N, 'PrettyPrint', true)); fclose(fid);
fprintf('nhanes_norms: %d adults, %d complete fasting cases -> %s\n', height(L), height(cc), outFile);
end
