function download_nhanes(dataDir)
%DOWNLOAD_NHANES  Fetch the five public NHANES 2017-March 2020 XPT files (about 10 MB).
%   download_nhanes()   ->  matlab/data/nhanes/*.xpt   (git-ignored; the derived
%   fixtures/nhanes_2017_2020_labs.parquet is what gets committed)
if nargin < 1, dataDir = fullfile(fileparts(mfilename('fullpath')), 'nhanes'); end
if ~isfolder(dataDir), mkdir(dataDir); end
base = 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/';
files = {'P_DEMO', 'P_CBC', 'P_BIOPRO', 'P_HSCRP', 'P_GLU'};
for i = 1:numel(files)
    dst = fullfile(dataDir, [files{i} '.xpt']);
    if isfile(dst), fprintf('have %s\n', dst); continue; end
    fprintf('downloading %s ...\n', files{i});
    websave(dst, [base files{i} '.xpt']);
end
end
