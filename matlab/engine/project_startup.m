% Project startup for Scallion.prj: heal the empty path of an mpm install and
% silence the example model's dimensional-analysis notices.
if isempty(which('runtests')), restoredefaultpath; end
warning('off', 'SimBiology:DimAnalysisNotDone_MatlabFcn_Dimensionless');
warning('off', 'SimBiology:DimAnalysisNotDone_MatlabFcn_UnitConversion');
fprintf('Scallion engine project. Run main_live_script, or ScallionEngineer for the console.\n');
