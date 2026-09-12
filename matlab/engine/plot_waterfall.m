function plot_waterfall(o, outFile, ax)
%PLOT_WATERFALL  Chronological age -> cohort offset -> nine analytes -> PhenoAge.
%   plot_waterfall(phenoage_output)            draws the figure
%   plot_waterfall(phenoage_output, outFile)   also saves it (png)
%   plot_waterfall(phenoage_output, [], ax)    draws into an existing axes (the console)
C = phenoage_constants();
names = [{'cohort_offset'}, C.analytes];
vals = cellfun(@(n) o.waterfall.(n), names);
labels = [{'cohort offset'}, strrep(C.analytes, '_', ' ')];
if nargin < 3 || isempty(ax)
    fig = figure('Color', 'w', 'Position', [100 100 900 420]);
    try, fig.Theme = 'light'; catch, end                                   % batch mode otherwise picks the dark theme
    ax = axes(fig);
end
cla(ax); hold(ax, 'on');
set(ax, 'Color', 'w', 'XColor', [0.2 0.2 0.2], 'YColor', [0.2 0.2 0.2]);
base = o.age;
xs = 1:(numel(vals) + 2);
bar(ax, xs(1), o.age, 'FaceColor', [0.45 0.45 0.45], 'EdgeColor', 'none');
for i = 1:numel(vals)
    y0 = base; y1 = base + vals(i);
    col = [0.80 0.30 0.25]; if vals(i) < 0, col = [0.25 0.60 0.40]; end
    patch(ax, [xs(i+1)-0.4 xs(i+1)+0.4 xs(i+1)+0.4 xs(i+1)-0.4], [y0 y0 y1 y1], col, 'EdgeColor', 'none');
    text(ax, xs(i+1), max(y0, y1) + 0.15, sprintf('%+.1f', vals(i)), 'HorizontalAlignment', 'center', 'FontSize', 8);
    base = y1;
end
pa = o.phenoage; if isnan(pa), pa = base; end
bar(ax, xs(end), pa, 'FaceColor', [0.85 0.65 0.15], 'EdgeColor', 'none');
errorbar(ax, xs(end), pa, o.band, 'k', 'LineWidth', 1.2);
set(ax, 'XTick', xs, 'XTickLabel', [{'age'}, labels, {'PhenoAge'}], 'XTickLabelRotation', 30);
ylabel(ax, 'years'); grid(ax, 'on'); box(ax, 'off');
lo = min([o.age, pa, o.age + cumsum(vals)]);
ylim(ax, [lo - 3, max([o.age, pa, o.age + cumsum(vals)]) + 3]);
xlim(ax, [0.4, xs(end) + 0.6]);
if isnan(o.phenoage)
    title(ax, sprintf('%s (critical: %s)', o.label, strjoin(o.flags.critical_analytes, ', ')));
else
    title(ax, sprintf('PhenoAge %.1f \\pm %.1f years (chronological %d, %s, %d of 9 markers)', ...
        o.phenoage, o.band, round(o.age), o.sex, o.markers_used));
end
subtitle(ax, 'Estimate, not diagnosis. Levine 2018; bars are years relative to the NHANES age-sex median.');
hold(ax, 'off');
if nargin > 1 && ~isempty(outFile)
    d = fileparts(outFile); if ~isfolder(d), mkdir(d); end
    exportgraphics(ax, outFile, 'Resolution', 150);
end
end
