function [label, key] = age_band(age)
%AGE_BAND  Map an age in years to the NHANES norm band.
%   [label, key] = age_band(34)  ->  '30-39', 'b30_39'
%   Ages under 20 use the 20-29 band (PhenoAge is an adult clock; the app
%   labels this case).
C = phenoage_constants();
age = max(double(age), 20);
i = find(age >= C.age_band_edges(1:end-1) & age < C.age_band_edges(2:end), 1);
label = C.age_bands{i};
key   = C.age_band_keys{i};
end
