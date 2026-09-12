function q = wquantile(x, w, p)
%WQUANTILE  Weighted quantile: smallest x whose cumulative weight reaches p.
%   q = wquantile(x, w, p) with x, w column vectors (NaNs in x dropped) and p
%   a vector of probabilities in [0,1]. Same definition as the Python
%   cross-check in tools/crosscheck so the two agree exactly.
ok = ~isnan(x) & ~isnan(w);
x = x(ok); w = w(ok);
[x, i] = sort(x); w = w(i);
cw = cumsum(w) / sum(w);
q = zeros(size(p));
for j = 1:numel(p)
    k = find(cw >= p(j), 1, 'first');
    q(j) = x(k);
end
end
