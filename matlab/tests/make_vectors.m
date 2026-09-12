function V = make_vectors(outFile)
%MAKE_VECTORS  Regenerate tests/vectors.json from the MATLAB engine (the source of truth).
%   Lane C's TypeScript port and tools/crosscheck/crosscheck.py must reproduce
%   these to 0.05 years. Run after nhanes_norms() whenever the norms change.
here = fileparts(mfilename('fullpath'));
if nargin < 1, outFile = fullfile(here, 'vectors.json'); end
N = load_norms();
cases = {
  'ref_34M', 34, 'M', struct('albumin',44,'creatinine',80,'glucose',5.4,'crp',0.08,'lymph_pct',30,'mcv',90,'rdw',13.1,'alp',70,'wbc',6.2)
  'ref_58F', 58, 'F', struct('albumin',41,'creatinine',62,'glucose',6.1,'crp',0.35,'lymph_pct',27,'mcv',91,'rdw',14.2,'alp',88,'wbc',7.4)
  'ref_71M', 71, 'M', struct('albumin',39,'creatinine',105,'glucose',6.8,'crp',0.6,'lymph_pct',22,'mcv',94,'rdw',15.0,'alp',95,'wbc',8.1)
  'imputed_crp_45F', 45, 'F', struct('albumin',42,'creatinine',66,'glucose',5.2,'lymph_pct',33,'mcv',89,'rdw',13.0,'alp',64,'wbc',5.9)
};
V = struct('name', {}, 'age', {}, 'sex', {}, 'fasting', {}, 'values', {}, 'phenoage', {}, 'band', {}, ...
    'waterfall', {}, 'imputed', {}, 'markers_used', {}, 'xb', {}, 'mortality_10y', {});
for i = 1:size(cases, 1)
    o = phenoage(cases{i,4}, cases{i,2}, cases{i,3}, struct('norms', N, 'fasting', true));
    wf = structfun(@(v) round(v, 4), o.waterfall, 'UniformOutput', false);
    V(i) = struct('name', cases{i,1}, 'age', cases{i,2}, 'sex', cases{i,3}, 'fasting', true, ...
        'values', cases{i,4}, 'phenoage', round(o.phenoage, 4), 'band', round(o.band, 4), ...
        'waterfall', wf, 'imputed', {o.imputed}, 'markers_used', o.markers_used, ...
        'xb', round(o.xb, 6), 'mortality_10y', round(o.mortality_10y, 6));
end
fid = fopen(outFile, 'w'); fwrite(fid, jsonencode(V, 'PrettyPrint', true)); fclose(fid);
fprintf('make_vectors: %d vectors -> %s\n', numel(V), outFile);
end
