function make_video(outFile)
%MAKE_VIDEO  Render the 60-90 s MATLAB segment of the Devpost video from the real artifacts.
%
%   make_video()   writes media/matlab_segment.mp4 (1280x780, 15 fps, H.264)
%
%   Storyboard (lane file, Block 5): open the project, run the live script (the
%   tests really run here and their output is what you see), the figures the
%   engine produced, then the console: drag carbs, toggle the walk, change the
%   fasting glucose, validate against the full simulation, the clock tab.
%   Everything on screen is rendered by MATLAB from the same files the app
%   reads; nothing is mocked. The team edits this into the 3-4 min video.

here = fileparts(mfilename('fullpath'));
root = fullfile(here, '..'); media = fullfile(root, '..', 'media');
if nargin < 1 || isempty(outFile), outFile = fullfile(media, 'matlab_segment.mp4'); end
addpath(genpath(root)); cd(root);
warning('off', 'all');
W = 1280; H = 780; FPS = 15; CAP = 64;
vw = VideoWriter(outFile, 'MPEG-4'); vw.FrameRate = FPS; vw.Quality = 92; open(vw);
push = @(img, secs) writeframes(vw, img, max(1, round(secs * FPS)));
bg = [0.07 0.09 0.12]; fg = [0.96 0.95 0.92]; gold = [0.85 0.65 0.15];

% ---- 1. title ---------------------------------------------------------------
push(card({'Scallion engine', '', 'MATLAB R2026a  |  SimBiology  |  Statistics and Machine Learning  |  Simulink', '', ...
    'Every number the app shows is a MATLAB export.'}, W, H, bg, fg, gold), 3.5);

% ---- 2. project and live script: run the tests for real -------------------
txt = evalc('r = runtests(''tests/test_phenoage.m'');');
txt = regexprep(txt, '<[^>]*>', '');                       % the test runner prints HTML links
lines = splitlines(string(txt)); lines = lines(strlength(strtrim(lines)) > 0); lines = lines(:);
head = ["  >> openProject('Scallion.prj')", "  Scallion engine project. Run main_live_script, or ScallionEngineer for the console.", "  >> main_live_script", ""]';
push(codecard([head; "  " + lines(1:min(6, numel(lines)))], W, H, bg, fg), 3);
summary = sprintf('  %d of %d tests passed: reference vectors, waterfall identity, band, imputation, CRP floor, safety gates', nnz([r.Passed]), numel(r));
push(codecard([head; "  " + lines(1:min(10, numel(lines))); ""; string(summary)], W, H, bg, fg), 4);

% ---- 3. the figures the engine produced ------------------------------------
pics = {
 'phenoage_waterfall.png',        'PhenoAge (Levine 2018): age + cohort offset + nine analyte bars = PhenoAge, exactly. Band = 1 SD from within-subject CV.'
 'insulindemo_78g_variants.png',  'SimBiology insulindemo (Cobelli meal model): base model and every shipped variant for a 78 g meal.'
 'walk_calibration.png',          'Walk calibration: insulin-independent glucose uptake x4.68 for 30 min, decaying after; peak -15% (Buffey 2022: 10-20%).'
 'meal_sweep.png',                'Sweep: 144 cells (carbs x variant x weight x walk) x insulin sensitivity +/-20%, 432 runs in 24 s on the accelerated model.'
 'surrogate_validation.png',      'Gaussian-process surrogate of the sweep, 5-fold cross-validation: R^2 0.9997 on the peak.'
};
for i = 1:size(pics, 1)
    f = fullfile(media, pics{i, 1});
    if isfile(f), push(captioned(imread(f), pics{i, 2}, W, H, CAP, bg, fg), 5); end
end

% ---- 4. the console ----------------------------------------------------------
app = ScallionEngineer('nolive');
tmp = [tempname '.png'];
snap = @(tab) shot(app, tmp, tab);
app.Fasting.Value = 92; app.Weight.Value = 78; app.WalkSwitch.Value = 'off'; app.Carbs.Value = 20; app.update();
push(captioned(snap(1), 'The console (app/ScallionEngineer.m): Tonight''s plate reads meal_grid.json exactly as the app does.', W, H, CAP, bg, fg), 3);
for c = 20:5:120
    app.Carbs.Value = c; app.update();
    push(captioned(snap(1), sprintf('Drag carbs: %d g. The curve and its band come straight from the SimBiology sweep.', c), W, H, CAP, bg, fg), 0.35);
end
push(captioned(snap(1), 'Drag carbs: 120 g. The curve and its band come straight from the SimBiology sweep.', W, H, CAP, bg, fg), 1.5);
app.Carbs.Value = 80; app.WalkSwitch.Value = 'on'; app.update();
push(captioned(snap(1), 'Plus a walk: the second curve is the same model with the calibrated walk events.', W, H, CAP, bg, fg), 3);
app.Fasting.Value = 112; app.update();
push(captioned(snap(1), 'Fasting glucose 112 mg/dL: the variant rule switches to "low insulin sensitivity" (ADA cut points).', W, H, CAP, bg, fg), 3.5);
app.Fasting.Value = 130; app.update();
push(captioned(snap(1), 'Fasting glucose 130 mg/dL: the "Type 2 diabetic" variant of the Cobelli model.', W, H, CAP, bg, fg), 3);
app.Fasting.Value = 112; app.update();
app.validate();
push(captioned(snap(3), 'Validate: the interpolated grid curve against a fresh full SimBiology run at these exact inputs.', W, H, CAP, bg, fg), 5);
push(captioned(snap(3), app.ValidText.Text, W, H, CAP, bg, fg), 3);
push(captioned(snap(2), 'The clock tab: the PhenoAge waterfall from engine/phenoage.m, the same code that produced the app''s vectors.', W, H, CAP, bg, fg), 4.5);
app.close();

% ---- 5. close ----------------------------------------------------------------
push(card({'Know your biological age. Know your circle. Then move both.', '', ...
    'matlab/  ->  web/public/engine/*.json', 'Estimate, not diagnosis.'}, W, H, bg, fg, gold), 3.5);
close(vw);
fprintf('make_video: %s (%.0f s)\n', outFile, vw.FrameCount / FPS);
end

% =============================================================================
function writeframes(vw, img, n)
img = im2uint8c(img);
for k = 1:n, writeVideo(vw, img); end
end

function img = shot(app, tmp, tab)
app.snapshot(tmp, tab); img = imread(tmp);
end

function out = captioned(img, caption, W, H, CAP, bg, fg)
top = fitimg(img, W, H - CAP, [1 1 1]);
bar = textimg(caption, W, CAP, bg, fg, 15, 'left');
out = [top; bar];
end

function out = card(lines, W, H, bg, fg, gold)
fig = figure('Visible', 'off', 'Color', bg, 'Position', [50 50 W H], 'Units', 'pixels');
try, fig.Theme = 'dark'; catch, end
ax = axes(fig, 'Position', [0 0 1 1], 'Visible', 'off', 'XLim', [0 1], 'YLim', [0 1]);
y = 0.62;
for i = 1:numel(lines)
    fs = 24; col = fg; if i == 1, fs = 44; col = gold; end
    text(ax, 0.5, y, lines{i}, 'Color', col, 'FontSize', fs, 'HorizontalAlignment', 'center', 'FontName', 'Segoe UI', 'Interpreter', 'none');
    y = y - 0.11;
end
out = fitimg(print(fig, '-RGBImage'), W, H, bg); close(fig);
end

function out = codecard(lines, W, H, bg, fg)
fig = figure('Visible', 'off', 'Color', bg, 'Position', [50 50 W H], 'Units', 'pixels');
try, fig.Theme = 'dark'; catch, end
ax = axes(fig, 'Position', [0 0 1 1], 'Visible', 'off', 'XLim', [0 1], 'YLim', [0 1]);
text(ax, 0.03, 0.95, strjoin(cellstr(lines), newline), 'Color', fg, 'FontSize', 14, 'FontName', 'Consolas', ...
    'VerticalAlignment', 'top', 'Interpreter', 'none');
out = fitimg(print(fig, '-RGBImage'), W, H, bg); close(fig);
end

function out = textimg(str, W, Hbar, bg, fg, fs, align)
fig = figure('Visible', 'off', 'Color', bg, 'Position', [50 50 W Hbar], 'Units', 'pixels');
try, fig.Theme = 'dark'; catch, end
ax = axes(fig, 'Position', [0 0 1 1], 'Visible', 'off', 'XLim', [0 1], 'YLim', [0 1]);
x = 0.02; if strcmp(align, 'center'), x = 0.5; end
text(ax, x, 0.5, str, 'Color', fg, 'FontSize', fs, 'FontName', 'Segoe UI', 'HorizontalAlignment', align, 'Interpreter', 'none');
out = fitimg(print(fig, '-RGBImage'), W, Hbar, bg); close(fig);
end

function out = fitimg(img, W, H, bgcol)
% Letterbox img into a W x H uint8 RGB canvas (no Image Processing Toolbox needed).
img = im2uint8c(img);
if size(img, 3) == 1, img = repmat(img, 1, 1, 3); end
[h, w, ~] = size(img);
s = min(W / w, H / h); nw = max(1, round(w * s)); nh = max(1, round(h * s));
if nw ~= w || nh ~= h
    [X, Y] = meshgrid(linspace(1, w, nw), linspace(1, h, nh));
    r = zeros(nh, nw, 3, 'uint8');
    for c = 1:3, r(:, :, c) = uint8(interp2(double(img(:, :, c)), X, Y, 'linear')); end
    img = r;
end
out = zeros(H, W, 3, 'uint8');
for c = 1:3, out(:, :, c) = uint8(round(255 * bgcol(c))); end
y0 = floor((H - nh) / 2); x0 = floor((W - nw) / 2);
out(y0 + (1:nh), x0 + (1:nw), :) = img;
end

function img = im2uint8c(img)
if isa(img, 'double') || isa(img, 'single'), img = uint8(round(255 * min(max(img, 0), 1))); end
if ~isa(img, 'uint8'), img = uint8(img); end
end
