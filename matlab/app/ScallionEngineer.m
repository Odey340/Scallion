classdef ScallionEngineer < handle
%SCALLIONENGINEER  The Lane A console: every number the app shows, live from the models.
%
%   app = ScallionEngineer            opens the console
%   app = ScallionEngineer('nolive')  skip the SimBiology model (grid only; fast start)
%
%   Explorer layout (after the MathWorks StiffLungClassifierApp): a sidebar of
%   inputs and a main area with three tabs.
%     Tonight     the two glucose curves for the plate (eat now, plus a walk) with
%                 the insulin-sensitivity band, read from sweep/meal_grid.mat the
%                 way Lane C reads meal_grid.json; the caffeine decay line.
%     Clock       the PhenoAge waterfall for the nine analytes (engine/phenoage.m).
%     Validation  the grid-interpolated curve against a fresh full SimBiology run
%                 at the exact inputs (models/simulate_meal.m), with the peak error.
%   Built with uifigure components in code so it runs from a script and from the
%   project; Save As from App Designer is not needed for the demo.

properties
    Fig; Grid; Norms; Walk; Caffeine; Model = [];
    % sidebar controls
    Fasting; Weight; Carbs; WalkSwitch; VariantLabel
    CaffDose; CaffHours; Smoker; OC
    Age; Sex; Analytes = struct(); FastingFlag
    ValidateBtn; ExportBtn; Status
    % main
    Tabs; AxTonight; AxCaffeine; AxClock; AxValid; ValidText
end

methods
    function app = ScallionEngineer(mode)
        if nargin < 1, mode = 'live'; end
        here = fileparts(mfilename('fullpath'));
        root = fullfile(here, '..');
        addpath(genpath(root));
        gridMat = fullfile(root, 'sweep', 'meal_grid.mat');
        if isfile(gridMat)
            S = load(gridMat); app.Grid = S.G;
            S = load(fullfile(root, 'sweep', 'walk_calibration.mat')); app.Walk = S.W;
        else                                             % fresh clone without the sweep: read the export instead
            app.Grid = jsondecode(fileread(fullfile(root, '..', 'web', 'public', 'engine', 'meal_grid.json')));
            app.Walk = app.Grid.walk_calibration;
        end
        app.Norms = load_norms();
        app.Caffeine = caffeine_curve();
        app.build();
        app.update();
        if strcmp(mode, 'live'), app.Status.Text = 'Grid loaded. The full simulation loads on the first Validate.'; end
    end

    function build(app)
        app.Fig = uifigure('Name', 'Scallion engine console (Lane A)', 'Position', [60 60 1280 780]);
        try, app.Fig.Theme = 'light'; catch, end
        g = uigridlayout(app.Fig, [1 2]); g.ColumnWidth = {330, '1x'}; g.Padding = [8 8 8 8];

        % ---- sidebar -------------------------------------------------------
        side = uigridlayout(g, [3 1]); side.RowHeight = {'fit', 'fit', '1x'}; side.Padding = [0 0 0 0]; side.RowSpacing = 8;

        p1 = uipanel(side, 'Title', 'Tonight''s plate');
        s1 = uigridlayout(p1, [6 2]); s1.ColumnWidth = {150, '1x'}; s1.RowHeight = repmat({24}, 1, 6); s1.RowSpacing = 4;
        uilabel(s1, 'Text', 'Fasting glucose (mg/dL)'); app.Fasting = uieditfield(s1, 'numeric', 'Value', 92, 'Limits', [40 400]);
        uilabel(s1, 'Text', 'Weight (kg)');             app.Weight = uispinner(s1, 'Value', 78, 'Limits', [40 200], 'Step', 1);
        uilabel(s1, 'Text', 'Carbs (g)');               app.Carbs = uislider(s1, 'Limits', [20 120], 'Value', 60, 'MajorTicks', 20:20:120);
        uilabel(s1, 'Text', 'Plus a walk');             app.WalkSwitch = uiswitch(s1, 'slider', 'Items', {'off', 'on'}, 'Value', 'off');
        uilabel(s1, 'Text', 'Variant');                 app.VariantLabel = uilabel(s1, 'Text', 'normal', 'FontWeight', 'bold');
        uilabel(s1, 'Text', 'Caffeine: dose (mg), h to bed'); c = uigridlayout(s1, [1 2]); c.Padding = [0 0 0 0]; c.ColumnSpacing = 4;
        app.CaffDose = uieditfield(c, 'numeric', 'Value', 120, 'Limits', [0 800]); app.CaffHours = uieditfield(c, 'numeric', 'Value', 8, 'Limits', [0 24]);

        p2 = uipanel(side, 'Title', 'Your clock (PhenoAge inputs)');
        C = phenoage_constants();
        s2 = uigridlayout(p2, [numel(C.analytes) + 3, 2]); s2.ColumnWidth = {150, '1x'}; s2.RowHeight = repmat({22}, 1, numel(C.analytes) + 3); s2.RowSpacing = 3;
        uilabel(s2, 'Text', 'Age (years)'); app.Age = uieditfield(s2, 'numeric', 'Value', 34, 'Limits', [18 110]);
        uilabel(s2, 'Text', 'Sex'); app.Sex = uidropdown(s2, 'Items', {'M', 'F'}, 'Value', 'M');
        defaults = struct('albumin', 44, 'creatinine', 80, 'glucose', 5.4, 'crp', 0.08, 'lymph_pct', 30, 'mcv', 90, 'rdw', 13.1, 'alp', 70, 'wbc', 6.2);
        for i = 1:numel(C.analytes)
            a = C.analytes{i};
            uilabel(s2, 'Text', sprintf('%s (%s)', strrep(a, '_', ' '), C.units.(a)));
            app.Analytes.(a) = uieditfield(s2, 'numeric', 'Value', defaults.(a), 'AllowEmpty', 'on');
        end
        uilabel(s2, 'Text', 'Glucose was fasting'); app.FastingFlag = uicheckbox(s2, 'Text', '', 'Value', true);

        p3 = uigridlayout(side, [4 1]); p3.RowHeight = {30, 30, '1x', 'fit'}; p3.Padding = [0 0 0 0];
        app.ValidateBtn = uibutton(p3, 'Text', 'Validate against the full SimBiology simulation', 'ButtonPushedFcn', @(~, ~) app.validate());
        app.ExportBtn = uibutton(p3, 'Text', 'Export every JSON (export_artifacts)', 'ButtonPushedFcn', @(~, ~) app.export());
        uilabel(p3, 'Text', '');
        app.Status = uilabel(p3, 'Text', '', 'WordWrap', 'on', 'FontColor', [0.3 0.3 0.3]);

        % ---- main ------------------------------------------------------------
        app.Tabs = uitabgroup(g);
        t1 = uitab(app.Tabs, 'Title', 'Tonight');
        g1 = uigridlayout(t1, [2 1]); g1.RowHeight = {'3x', '1x'};
        app.AxTonight = uiaxes(g1); app.AxCaffeine = uiaxes(g1);
        t2 = uitab(app.Tabs, 'Title', 'Clock');
        g2 = uigridlayout(t2, [1 1]); app.AxClock = uiaxes(g2);
        t3 = uitab(app.Tabs, 'Title', 'Validation');
        g3 = uigridlayout(t3, [2 1]); g3.RowHeight = {'1x', 60};
        app.AxValid = uiaxes(g3); app.ValidText = uilabel(g3, 'Text', 'Press Validate to run the full simulation at these exact inputs.', 'WordWrap', 'on');

        % callbacks
        ctrls = [app.Fasting, app.Weight, app.Carbs, app.WalkSwitch, app.CaffDose, app.CaffHours, app.Age, app.Sex, app.FastingFlag];
        for h = ctrls, h.ValueChangedFcn = @(~, ~) app.update(); end
        for i = 1:numel(C.analytes), app.Analytes.(C.analytes{i}).ValueChangedFcn = @(~, ~) app.update(); end
    end

    function [carbs, variant, weight, walk] = inputs(app)
        carbs = round(app.Carbs.Value); weight = app.Weight.Value;
        variant = variant_rule(app.Fasting.Value); walk = strcmp(app.WalkSwitch.Value, 'on');
    end

    function update(app)
        [carbs, variant, weight, ~] = app.inputs();
        app.VariantLabel.Text = sprintf('%s  (%s)', variant, app.Grid.variant_rule.(variant));
        G = app.Grid; t = G.t_min(:)';
        [c0, s0] = meal_lookup(G, carbs, variant, weight, 0);
        [c1, s1] = meal_lookup(G, carbs, variant, weight, 1);
        ax = app.AxTonight; cla(ax); hold(ax, 'on');
        band(ax, t, c0, [0.20 0.45 0.80]); band(ax, t, c1, [0.85 0.50 0.15]);
        plot(ax, t, c0.p50, 'Color', [0.20 0.45 0.80], 'LineWidth', 2.2, 'DisplayName', sprintf('eat now: peak %.0f mg/dL at %.0f min', s0.peak_mgdL, s0.t_peak_min));
        plot(ax, t, c1.p50, 'Color', [0.85 0.50 0.15], 'LineWidth', 2.2, 'DisplayName', sprintf('%s: peak %.0f mg/dL (-%.0f%%)', G.labels.walk, s1.peak_mgdL, 100 * (1 - s1.peak_mgdL / s0.peak_mgdL)));
        xlabel(ax, 'minutes after the meal'); ylabel(ax, 'plasma glucose (mg/dL)'); grid(ax, 'on');
        legend(ax, 'Location', 'northeast'); xlim(ax, [0 240]);
        title(ax, sprintf('%d g carbs, %s, %d kg: %s', carbs, variant, weight, G.labels.curve));
        subtitle(ax, sprintf('band: insulin sensitivity +/-20%%; walk: Vm0 x %.2f during %d-%d min (Buffey 2022 target 10-20%%)', ...
            G.walk_calibration.vm0_factor, G.walk_calibration.walk_start_min, G.walk_calibration.walk_end_min));
        hold(ax, 'off');

        % caffeine
        K = app.Caffeine; dose = app.CaffDose.Value; hb = app.CaffHours.Value;
        hl = K.half_life_h;
        th = 0:0.25:16; mg = dose * 0.5 .^ (th / hl);
        atbed = dose * 0.5 ^ (hb / hl);
        last = hl * log2(max(dose, 1) / K.bedtime_threshold_mg);
        ax = app.AxCaffeine; cla(ax); hold(ax, 'on');
        plot(ax, th, mg, 'LineWidth', 2, 'Color', [0.35 0.25 0.15]);
        yline(ax, K.bedtime_threshold_mg, '--', sprintf('%d mg', K.bedtime_threshold_mg), 'Color', [0.5 0.5 0.5]);
        xline(ax, hb, '-', 'bedtime', 'Color', [0.2 0.2 0.2]);
        xlabel(ax, 'hours after the coffee'); ylabel(ax, 'caffeine (mg)'); grid(ax, 'on'); xlim(ax, [0 16]);
        title(ax, sprintf('%d mg now: %.0f mg left at bedtime (%.1f h). Last coffee no later than %.1f h before bed (half-life %.0f h).', dose, atbed, hb, max(last, 0), hl));
        hold(ax, 'off');

        % clock
        C = phenoage_constants(); vals = struct();
        for i = 1:numel(C.analytes), v = app.Analytes.(C.analytes{i}).Value; if ~isempty(v), vals.(C.analytes{i}) = v; end; end
        o = phenoage(vals, app.Age.Value, app.Sex.Value, struct('norms', app.Norms, 'fasting', app.FastingFlag.Value));
        plot_waterfall(o, [], app.AxClock);
        if isnan(o.phenoage), app.Status.Text = sprintf('Clock: %s', o.label);
        else, app.Status.Text = sprintf('PhenoAge %.1f +/- %.1f years, %d of 9 markers. %s', o.phenoage, o.band, o.markers_used, o.label); end
    end

    function validate(app)
        if isempty(app.Model)
            app.Status.Text = 'Loading the SimBiology model (about 10 s)...'; drawnow;
            app.Model = meal_model();
            app.Model.walk.calibrated_factor = app.Walk.vm0_factor;
            app.Model.walk.start.Value = app.Walk.walk_start_min / 60; app.Model.walk.end.Value = app.Walk.walk_end_min / 60;
        end
        [carbs, variant, weight, walk] = app.inputs();
        G = app.Grid; t = G.t_min(:)';
        [c, s, cell] = meal_lookup(G, carbs, variant, weight, walk);
        tic; [g, ~, tm] = simulate_meal(app.Model, carbs, variant, weight, walk); simSeconds = toc;
        keep = tm <= 240;
        ax = app.AxValid; cla(ax); hold(ax, 'on');
        band(ax, t, c, [0.20 0.45 0.80]);
        plot(ax, t, c.p50, 'Color', [0.20 0.45 0.80], 'LineWidth', 2.2, 'DisplayName', 'grid, interpolated as the app does');
        plot(ax, tm(keep), g(keep), 'k--', 'LineWidth', 2, 'DisplayName', 'full SimBiology simulation at the exact inputs');
        xlabel(ax, 'minutes after the meal'); ylabel(ax, 'plasma glucose (mg/dL)'); grid(ax, 'on'); legend(ax, 'Location', 'northeast');
        title(ax, sprintf('Validation: %d g, %s, %d kg, walk %d (nearest cell %s)', carbs, variant, weight, walk, cell));
        hold(ax, 'off');
        err = max(abs(c.p50 - g(keep)'));
        app.ValidText.Text = sprintf('Interpolated peak %.1f vs simulated %.1f mg/dL; max pointwise error %.1f mg/dL over 0-240 min; simulation %.2f s.', ...
            s.peak_mgdL, max(g(keep)), err, simSeconds);
        app.Tabs.SelectedTab = app.Tabs.Children(3);
        app.Status.Text = 'Validation done.';
    end

    function export(app)
        app.Status.Text = 'Exporting...'; drawnow;
        export_artifacts();
        app.Status.Text = 'Wrote web/public/engine/*.json';
    end

    function snapshot(app, outFile, tab)
        % Export the console to a PNG (for media/ and the Devpost).
        if nargin > 2, app.Tabs.SelectedTab = app.Tabs.Children(tab); end
        drawnow;
        exportapp(app.Fig, outFile);
    end

    function close(app), delete(app.Fig); end
end
end

function band(ax, t, c, col)
p = patch(ax, [t fliplr(t)], [c.p10 fliplr(c.p90)], col, 'FaceAlpha', 0.18, 'EdgeColor', 'none');
p.Annotation.LegendInformation.IconDisplayStyle = 'off';   % cla only clears visible handles, so keep it visible
end
