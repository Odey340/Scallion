function m1 = load_insulindemo()
%LOAD_INSULINDEMO  Load the SimBiology example project insulindemo (Cobelli's Glucose-Insulin System).
%   sbioloadproject finds insulindemo.sbproj only when the example folder is on
%   the path. An mpm install ships no example files, so on first use this
%   downloads them with openExample('simbio/insulindemo') into userpath/Examples.
try
    sbioloadproject('insulindemo', 'm1');
    return
catch first
    d = dir(fullfile(userpath, 'Examples', '**', 'insulindemo.sbproj'));
    if isempty(d)
        try
            openExample('simbio/insulindemo');
            d = dir(fullfile(userpath, 'Examples', '**', 'insulindemo.sbproj'));
        catch
        end
    end
    if isempty(d), rethrow(first); end
    addpath(d(1).folder);
    sbioloadproject(fullfile(d(1).folder, 'insulindemo.sbproj'), 'm1');
end
end
