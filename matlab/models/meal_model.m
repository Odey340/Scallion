function M = meal_model(stop_min, step_min)
%MEAL_MODEL  The Cobelli meal model configured for Scallion: weight, variant, walk, accelerated.
%
%   M = meal_model()              6 h horizon, 5 min output grid
%   M = meal_model(stop_min, step_min)
%
%   Returns a struct of handles used by simulate_meal:
%     M.m1        SimBiology model (insulindemo, Dalla Man 2007 / Cobelli)
%     M.cs        active configset (hours; OutputTimes on the minute grid)
%     M.meal      the "Single Meal" RepeatDose, Amount in grams to species Dose
%     M.bw        parameter "Body Weight" (kg; the model is per kg on a 1 kg basis)
%     M.walk      parameters walkFactor, walkStart, walkEnd (hours), walkDecay (1/hour)
%     M.vmx0      the base model's insulin sensitivity Vmx
%     M.t_min     output grid in minutes
%
%   The walk. The example's rule "Vm = Vm0 + Vmx*[Interstitial Ins]" is the
%   insulin-dependent glucose utilisation, Vm0 its insulin-independent part
%   (exercise raises muscle glucose uptake without insulin). We rewrite it as
%       Vm = Vm0*walkMult + Vmx*[Interstitial Ins]
%       walkMult   = 1 + (walkFactor - 1)*walkEffect          (repeated assignment)
%       d(walkEffect)/dt = -walkDecay*walkDecayOn*walkEffect   (rate rule)
%   with events: at walkStart, walkEffect = 1 and walkDecayOn = 0; at walkEnd,
%   walkDecayOn = 1, so the extra uptake decays with half-life ln2/walkDecay
%   (60 min by default: post-exercise glucose uptake persists, an assumption
%   noted in matlab/README.md). walkFactor = 1 means no walk. Vm0 itself stays a
%   constant so the "Type 2 diabetic" variant can still override it (4.65).
%   calibrate_walk.m finds walkFactor so the peak drops 10-20% (Buffey 2022).

if nargin < 1 || isempty(stop_min), stop_min = 360; end
if nargin < 2 || isempty(step_min), step_min = 5; end
warning('off', 'SimBiology:DimAnalysisNotDone_MatlabFcn_Dimensionless');
warning('off', 'SimBiology:DimAnalysisNotDone_MatlabFcn_UnitConversion');

m1 = load_insulindemo();
cs = getconfigset(m1, 'active');
cs.StopTime = stop_min / 60;                                % model time unit is hour
cs.SolverOptions.OutputTimes = (0:step_min:stop_min) / 60;

meal = sbioselect(m1, 'Name', 'Single Meal'); meal = meal(1);
bw   = sbioselect(m1, 'Type', 'parameter', 'Name', 'Body Weight');
vmx  = sbioselect(m1, 'Type', 'parameter', 'Name', 'Vmx');

wf = addparameter(m1, 'walkFactor',  1,          'Units', 'dimensionless');
ws = addparameter(m1, 'walkStart',   15 / 60,    'Units', 'hour');
we = addparameter(m1, 'walkEnd',     45 / 60,    'Units', 'hour');
wd = addparameter(m1, 'walkDecay',   log(2) / 1, 'Units', '1/hour');            % 60 min half-life
addparameter(m1, 'walkEffect',  0, 'Units', 'dimensionless', 'ConstantValue', false);
addparameter(m1, 'walkDecayOn', 0, 'Units', 'dimensionless', 'ConstantValue', false);
addparameter(m1, 'walkMult',    1, 'Units', 'dimensionless', 'ConstantValue', false);

rules = get(m1, 'Rules');
iVm = find(arrayfun(@(r) strcmp(strrep(r.Rule, ' ', ''), 'Vm=Vm0+Vmx*[InterstitialIns]'), rules), 1);
assert(~isempty(iVm), 'meal_model: the Vm rule of insulindemo changed; update the walk rewrite');
rules(iVm).Rule = 'Vm = Vm0*walkMult + Vmx*[Interstitial Ins]';
addrule(m1, 'walkMult = 1 + (walkFactor - 1)*walkEffect', 'repeatedAssignment');
addrule(m1, 'walkEffect = -walkDecay*walkDecayOn*walkEffect', 'rate');
addevent(m1, 'time >= walkStart', {'walkEffect = 1', 'walkDecayOn = 0'});
addevent(m1, 'time >= walkEnd',   'walkDecayOn = 1');

sbioaccelerate(m1, cs);

M = struct('m1', m1, 'cs', cs, 'meal', meal, 'bw', bw, 'vmx0', vmx.Value, ...
    'walk', struct('factor', wf, 'start', ws, 'end', we, 'decay', wd, 'calibrated_factor', 1), ...
    't_min', (0:step_min:stop_min)', 'species', 'Plasma Glu Conc');
M.variants = struct('normal', [], ...
    'low_si', sbioselect(m1, 'Name', 'Low insulin sensitivity'), ...
    't2d',    sbioselect(m1, 'Name', 'Type 2 diabetic'));
end
