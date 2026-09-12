function plot_waterfall(o, outFile)
%PLOT_WATERFALL  Chronological age -> cohort offset -> nine analytes -> PhenoAge.
%   plot_waterfall(phenoage_output)            draws the figure
%   plot_waterfall(phenoage_output, outFile)   also saves it (png)
C = phenoage_constants();
names = [{'cohort_offset'}, C.analytes];
vals = cellfun(@(n) o.waterfall.(n), names);
labels = [{'cohort offset'}, strrep(C.analytes, '_', ' ')];
fig = figure('Color', 'w', 'Position', [100 100 900 420]); hold on;
try, fig.Theme = 'light'; catch, end                                       % batch mode otherwise picks the dark theme
set(gca, 'Color', 'w', 'XColor', [0.2 0.2 0.2], 'YColor', [0.2 0.2 0.2]);
base = o.age;
xs = 1:(numel(vals) + 2);
bar(xs(1), o.age, 'FaceColor', [0.45 0.45 0.45], 'EdgeColor', 'none');
for i = 1:numel(vals)
    y0 = base; y1 = base + vals(i);
    col = [0.80 0.30 0.25]; if vals(i) < 0, col = [0.25 0.60 0.40]; end
    patch([xs(i+1)-0.4 xs(i+1)+0.4 xs(i+1)+0.4 xs(i+1)-0.4], [y0 y0 y1 y1], col, 'EdgeColor', 'none');
    text(xs(i+1), max(y0, y1) + 0.15, sprintf('%+.1f', vals(i)), 'HorizontalAlignment', 'center', 'FontSize', 8);
    base = y1;
end
bar(xs(end), o.phenoage, 'FaceColor', [0.85 0.65 0.15], 'EdgeColor', 'none');
errorbar(xs(end), o.phenoage, o.band, 'k', 'LineWidth', 1.2);
set(gca, 'XTick', xs, 'XTickLabel', [{'age'}, labels, {'PhenoAge'}], 'XTickLabelRotation', 30);
ylabel('years'); grid on; box off;
lo = min([o.age, o.phenoage, o.age + cumsum(vals)]);
ylim([lo - 3, max([o.age, o.phenoage, o.age + cumsum(vals)]) + 3]);
title(sprintf('PhenoAge %.1f \\pm %.1f years (chronological %d, %s, %d of 9 markers)', ...
    o.phenoage, o.band, round(o.age), o.sex, o.markers_used));
subtitle('Estimate, not diagnosis. Levine 2018; bars are years relative to the NHANES age-sex median.');
if nargin > 1 && ~isempty(outFile)
    d = fileparts(outFile); if ~isfolder(d), mkdir(d); end
    exportgraphics(gcf, outFile, 'Resolution', 150);
end
end
