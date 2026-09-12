function N = load_norms(path)
%LOAD_NORMS  Read the NHANES norms cache written by nhanes_norms.m.
%   N = load_norms()            reads matlab/engine/norms_cache.json
%   N = load_norms(path)        reads a specific file
%
%   Fields: reference.(sex).(bandkey).(analyte)      age-sex weighted medians
%           imputation_sd.(sex).(bandkey).(analyte)  SD of the model term (ln for CRP)
%           phenoage_accel.(sex).(bandkey).p5..p95    PhenoAge - age percentiles
%           analytes.(analyte).(sex).(bandkey).p5..p95
%   Band keys are MATLAB-safe ('b30_39'); export_artifacts.m converts them to
%   the labels in the contract ('30-39').
if nargin < 1 || isempty(path)
    path = fullfile(fileparts(mfilename('fullpath')), 'norms_cache.json');
end
assert(isfile(path), 'norms cache not found: %s (run nhanes_norms.m)', path);
N = jsondecode(fileread(path));
end
