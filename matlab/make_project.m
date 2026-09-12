function proj = make_project()
%MAKE_PROJECT  Create (or refresh) matlab/Scallion.prj from code, so it is reproducible.
%   Adds every .m/.mat/.json/.csv in engine, models, sweep, surrogate, app, export,
%   tests, data and the live script; puts the source folders on the project
%   path; sets main_live_script as the project startup shortcut target.
%   Run once; the .prj and resources/project are committed.

here = fileparts(mfilename('fullpath'));
prjFile = fullfile(here, 'Scallion.prj');
if isfile(prjFile)
    proj = openProject(prjFile);
else
    try
        proj = matlab.project.createProject('Name', 'Scallion', 'Folder', here);
    catch
        proj = matlab.project.createProject(here);       % older syntax: creates blank_project.prj in matlab/
        proj.Name = 'Scallion';
        close(proj);
        d = dir(fullfile(here, '*.prj'));
        movefile(fullfile(here, d(1).name), prjFile);   % the .prj may be renamed on disk
        proj = openProject(prjFile);
    end
end
proj.Description = 'Scallion (HackRice 16): PhenoAge clock, NHANES norms, HUNT fitness age, risk years, SimBiology meal model with a calibrated walk and a 144-cell sweep, caffeine decay, console. Run main_live_script.';

folders = {'engine', 'models', 'sweep', 'surrogate', 'app', 'export', 'tests', 'data', 'Markdowns', 'tools'};
for f = folders
    p = fullfile(here, f{1});
    if ~isfolder(p), continue; end
    files = [dir(fullfile(p, '**', '*.m')); dir(fullfile(p, '**', '*.mat')); dir(fullfile(p, '**', '*.json')); ...
             dir(fullfile(p, '**', '*.csv')); dir(fullfile(p, '**', '*.md')); dir(fullfile(p, '**', '*.py'))];
    for k = 1:numel(files)
        fp = fullfile(files(k).folder, files(k).name);
        if contains(fp, [filesep 'data' filesep 'nhanes' filesep]), continue; end   % raw XPTs are git-ignored
        try, addFile(proj, fp); catch, end
    end
    if any(strcmp(f{1}, {'engine', 'models', 'sweep', 'surrogate', 'app', 'export', 'tests', 'data'}))
        try, addPath(proj, p); catch, end
    end
end
for f = {'main_live_script.m', 'README.md', 'make_project.m'}
    try, addFile(proj, fullfile(here, f{1})); catch, end
end
try, addShortcut(proj, fullfile(here, 'main_live_script.m')); catch, end
try, addStartupFile(proj, fullfile(here, 'engine', 'project_startup.m')); catch, end
fprintf('make_project: %s with %d files\n', prjFile, numel(proj.Files));
end
