"""Independent cross-check of the MATLAB engine (Lane A).

This is NOT the engine. It mirrors engine/phenoage.m, engine/nhanes_norms.m,
engine/hunt_fitness_age.m, engine/risk_years.m, engine/caffeine_curve.m and
export/export_artifacts.m line for line so that:
  * the numbers MATLAB exports can be verified by a second implementation, and
  * before MATLAB is installed on a machine, the same JSON files can be produced
    provisionally (meta.generated_by says which). export_artifacts.m overwrites
    them; the diff must be zero within floating point.

Run from the repo root:  python matlab/tools/crosscheck/crosscheck.py [--provisional-export]
"""
import json, math, sys, datetime
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
MATLAB = ROOT / "matlab"
DATA = MATLAB / "data" / "nhanes"

# ---------------------------------------------------------------- constants (phenoage_constants.m)
ANALYTES = ["albumin", "creatinine", "glucose", "crp", "lymph_pct", "mcv", "rdw", "alp", "wbc"]
UNITS = {"albumin": "g/L", "creatinine": "umol/L", "glucose": "mmol/L", "crp": "mg/dL", "lymph_pct": "%",
         "mcv": "fL", "rdw": "%", "alp": "U/L", "wbc": "10^9/L", "age": "years"}
COEF = {"albumin": -0.03359355, "creatinine": 0.009506491, "glucose": 0.1953192, "ln_crp": 0.09536762,
        "lymph_pct": -0.01199984, "mcv": 0.02676401, "rdw": 0.3306156, "alp": 0.001868778,
        "wbc": 0.05542406, "age": 0.08035356}
INTERCEPT, GAMMA, T_MONTHS, K, A_CONST, OFFSET = -19.90667, 0.007692696, 120, 0.090165, 0.0055305, 141.50225
LOG_TERM = math.log(A_CONST) + math.log((math.exp(T_MONTHS * GAMMA) - 1) / GAMMA)
AFFINE_A = OFFSET + LOG_TERM / K
CRP_FLOOR, CRP_ACUTE = 0.1, 1.0
CRIT = {"glucose_mgdL": [55, 250], "wbc": [2, 30], "creatinine_x_ref_high": 2}
CREAT_REF_HIGH_DEFAULT = 110
MGDL_PER_MMOL = 18.016
CV = {"albumin": (0.031, 0.016), "creatinine": (0.043, 0.022), "glucose": (0.045, 0.023), "crp": (0.422, 0.211),
      "lymph_pct": (0.104, 0.052), "mcv": (0.013, 0.007), "rdw": (0.035, 0.018), "alp": (0.064, 0.032),
      "wbc": (0.109, 0.055)}
BANDS = ["20-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80+"]
BAND_KEYS = ["b20_29", "b30_39", "b40_49", "b50_59", "b60_69", "b70_79", "b80p"]
EDGES = [20, 30, 40, 50, 60, 70, 80, math.inf]


def age_band(age):
    age = max(float(age), 20)
    for i in range(7):
        if EDGES[i] <= age < EDGES[i + 1]:
            return BANDS[i], BAND_KEYS[i]


def term(a, val):
    return COEF["ln_crp"] * math.log(max(val, CRP_FLOOR)) if a == "crp" else COEF[a] * val


def linear_predictor(x, age):
    return INTERCEPT + COEF["age"] * age + sum(term(a, x[a]) for a in ANALYTES)


# ---------------------------------------------------------------- phenoage.m
def phenoage(values, age, sex, norms, fasting=True, creatinine_ref_high=None):
    label, key = age_band(age)
    ref = norms["reference"][sex][key]
    sdp = norms["imputation_sd"][sex][key]
    x, imputed = {}, []
    flags = {"critical": False, "critical_analytes": [], "crp_acute": False, "non_fasting": False}
    for a in ANALYTES:
        have = a in values and values[a] is not None and not (isinstance(values[a], float) and math.isnan(values[a]))
        if a == "glucose" and have and fasting is not True:
            have = False
            flags["non_fasting"] = True
        if have:
            x[a] = float(values[a])
        else:
            x[a] = ref[a]
            imputed.append(a)
    measured = lambda a: a not in imputed
    flags["crp_acute"] = measured("crp") and x["crp"] > CRP_ACUTE
    crit = []
    g = x["glucose"] * MGDL_PER_MMOL
    if measured("glucose") and (g < CRIT["glucose_mgdL"][0] or g > CRIT["glucose_mgdL"][1]):
        crit.append("glucose")
    if measured("wbc") and (x["wbc"] < CRIT["wbc"][0] or x["wbc"] > CRIT["wbc"][1]):
        crit.append("wbc")
    crh = creatinine_ref_high or CREAT_REF_HIGH_DEFAULT
    if measured("creatinine") and x["creatinine"] > CRIT["creatinine_x_ref_high"] * crh:
        crit.append("creatinine")
    flags["critical"], flags["critical_analytes"] = bool(crit), crit

    xb = linear_predictor(x, age)
    pa = AFFINE_A + xb / K
    M = 1 - math.exp(-math.exp(xb) * (math.exp(T_MONTHS * GAMMA) - 1) / GAMMA)
    pa_direct = OFFSET + math.log(-A_CONST * math.log(1 - M)) / K
    xb_ref = linear_predictor(ref, age)
    wf = {"cohort_offset": (AFFINE_A + xb_ref / K) - age}
    for a in ANALYTES:
        wf[a] = (term(a, x[a]) - term(a, ref[a])) / K
    assert abs(age + sum(wf.values()) - pa) < 1e-9
    v = 0.0
    for a in ANALYTES:
        dydx = COEF["ln_crp" if a == "crp" else a] / K
        if measured(a):
            cvt = math.hypot(*CV[a])
            sd = cvt if a == "crp" else cvt * x[a]
        else:
            sd = sdp[a]
        v += (dydx * sd) ** 2
    out = {"phenoage": pa, "phenoage_direct": pa_direct, "band": math.sqrt(v), "waterfall": wf, "inputs": x,
           "imputed": imputed, "markers_used": 9 - len(imputed), "flags": flags, "xb": xb, "mortality_10y": M,
           "age": age, "sex": sex, "age_band": label, "label": "Estimate, not diagnosis"}
    if flags["critical"]:
        out["phenoage"] = out["phenoage_direct"] = float("nan")
        out["label"] = "See a clinician first"
    return out


# ---------------------------------------------------------------- wquantile.m / nhanes_norms.m
def wquantile(x, w, ps):
    x, w = np.asarray(x, float), np.asarray(w, float)
    ok = ~np.isnan(x) & ~np.isnan(w)
    x, w = x[ok], w[ok]
    i = np.argsort(x, kind="stable")
    x, w = x[i], w[i]
    cw = np.cumsum(w) / w.sum()
    return [float(x[np.argmax(cw >= p)]) for p in ps]


def nhanes_norms(write_fixture=True):
    rd = lambda f: pd.read_sas(DATA / f"{f}.xpt", format="xport")
    demo = rd("P_DEMO")[["SEQN", "RIAGENDR", "RIDAGEYR", "WTMECPRP"]]
    cbc = rd("P_CBC")[["SEQN", "LBXWBCSI", "LBXLYPCT", "LBXMCVSI", "LBXRDW"]]
    bio = rd("P_BIOPRO")[["SEQN", "LBDSALSI", "LBDSCRSI", "LBXSAPSI"]]
    crp = rd("P_HSCRP")[["SEQN", "LBXHSCRP"]]
    glu = rd("P_GLU")[["SEQN", "LBDGLUSI", "WTSAFPRP"]]
    T = demo.merge(cbc, on="SEQN").merge(bio, on="SEQN").merge(crp, on="SEQN", how="left").merge(glu, on="SEQN", how="left")
    T = T[T.RIDAGEYR >= 20]
    L = pd.DataFrame({
        "seqn": T.SEQN.astype(int), "sex": np.where(T.RIAGENDR == 1, "M", "F"), "age": T.RIDAGEYR,
        "w_mec": T.WTMECPRP, "w_fast": T.WTSAFPRP, "albumin": T.LBDSALSI, "creatinine": T.LBDSCRSI,
        "glucose": T.LBDGLUSI, "crp": np.maximum(T.LBXHSCRP / 10, CRP_FLOOR), "lymph_pct": T.LBXLYPCT,
        "mcv": T.LBXMCVSI, "rdw": T.LBXRDW, "alp": T.LBXSAPSI, "wbc": T.LBXWBCSI})
    L = L[~((L.wbc > 50) | (L.creatinine > 500))].reset_index(drop=True)
    if write_fixture:
        L.to_parquet(ROOT / "fixtures" / "nhanes_2017_2020_labs.parquet", index=False)
    P, PN = [0.05, 0.25, 0.50, 0.75, 0.95], ["p5", "p25", "p50", "p75", "p95"]
    N = {"version": 1, "source": "NHANES 2017-March 2020 pre-pandemic (P_DEMO, P_CBC, P_BIOPRO, P_HSCRP, P_GLU)",
         "weights": "WTMECPRP for analytes and reference medians; WTSAFPRP for PhenoAge acceleration",
         "crp_floor_mgdL": CRP_FLOOR, "n_adults": int(len(L)), "analytes": {a: {"M": {}, "F": {}} for a in ANALYTES},
         "reference": {"M": {}, "F": {}}, "imputation_sd": {"M": {}, "F": {}}, "n": {"M": {}, "F": {}}}
    for s in ["M", "F"]:
        for b, key in enumerate(BAND_KEYS):
            inb = (L.sex == s) & (L.age >= EDGES[b]) & (L.age < EDGES[b + 1])
            R, S = {}, {}
            for a in ANALYTES:
                v = L.loc[inb, a].values
                w = L.loc[inb, "w_fast" if a == "glucose" else "w_mec"].values
                q = wquantile(v, w, P)
                R[a] = q[2]
                if a == "crp":
                    ql = wquantile(np.log(v), w, [0.25, 0.75]); S[a] = (ql[1] - ql[0]) / 1.349
                else:
                    S[a] = (q[3] - q[1]) / 1.349
                N["analytes"][a][s][key] = dict(zip(PN, q))
            N["reference"][s][key], N["imputation_sd"][s][key], N["n"][s][key] = R, S, int(inb.sum())
    cc = L.dropna(subset=ANALYTES + ["w_fast"]).copy()
    xb = INTERCEPT + COEF["age"] * cc.age + sum(COEF[a] * cc[a] for a in ANALYTES if a != "crp") + COEF["ln_crp"] * np.log(cc.crp)
    accel = (AFFINE_A + xb / K) - cc.age
    ok = np.isfinite(accel)
    cc, accel = cc[ok], accel[ok]
    N["n_complete_fasting"] = int(len(cc))
    N["phenoage_accel"] = {"M": {}, "F": {}}
    for s in ["M", "F"]:
        for b, key in enumerate(BAND_KEYS):
            inb = (cc.sex == s) & (cc.age >= EDGES[b]) & (cc.age < EDGES[b + 1])
            N["phenoage_accel"][s][key] = dict(zip(PN, wquantile(accel[inb], cc.loc[inb, "w_fast"], P)))
    return N


# ---------------------------------------------------------------- hunt_fitness_age.m
def hunt_constants():
    H = {"vo2max": {"M": {"intercept": 100.27, "age": -0.296, "waist": -0.369, "rhr": -0.155, "pai": 0.226, "see": 5.70},
                    "F": {"intercept": 74.74, "age": -0.247, "waist": -0.259, "rhr": -0.114, "pai": 0.198, "see": 5.14}},
         "vo2max_source": "Nes 2011, Scand J Med Sci Sports 21:e1-e9",
         "reference": {"age_mid": [25, 35, 45, 55, 65, 75],
                       "M": {"mean": [54.4, 49.1, 47.2, 42.6, 39.2, 35.3], "sd": [8.4, 7.5, 7.7, 7.4, 6.7, 6.5]},
                       "F": {"mean": [43.0, 40.0, 38.4, 34.4, 31.1, 28.3], "sd": [7.7, 6.8, 6.9, 5.7, 5.1, 5.2]}},
         "reference_source": "Loe 2013, PLoS One 8(5):e64319, Table 2 (HUNT3 Fitness, n = 3678)",
         "pai_options": [
             {"key": "none", "label": "Rarely or never", "pai": 0},
             {"key": "light_weekly", "label": "Light, about once a week", "pai": 1 * 1 * 0.75},
             {"key": "moderate_2_3", "label": "Moderate, 2-3 times a week, 30-60 min", "pai": 2.5 * 2 * 0.75},
             {"key": "hard_2_3", "label": "Hard, 2-3 times a week, 30-60 min", "pai": 2.5 * 3 * 0.75},
             {"key": "hard_daily", "label": "Hard, almost every day, over an hour", "pai": 5 * 3 * 1}],
         "pai_source": "Kurtze 2008, Scand J Public Health 36:52-61 (HUNT PA index)",
         "age_range": [20, 90], "fitness_age_lookup": {}}
    ages = np.arange(20, 91, 5)
    for s in ["M", "F"]:
        m = np.interp(ages, H["reference"]["age_mid"], H["reference"][s]["mean"])
        # MATLAB interp1 'linear','extrap' extrapolates; np.interp clamps, so extend by hand
        mid, mean = H["reference"]["age_mid"], H["reference"][s]["mean"]
        lo = mean[0] + (mean[1] - mean[0]) / (mid[1] - mid[0]) * (ages - mid[0])
        hi = mean[-2] + (mean[-1] - mean[-2]) / (mid[-1] - mid[-2]) * (ages - mid[-2])
        m = np.where(ages < mid[0], lo, np.where(ages > mid[-1], hi, m))
        H["fitness_age_lookup"][s] = [[int(a), float(round(v, 1))] for a, v in zip(ages, m)]
    return H


def hunt_fitness_age(age, sex, waist, rhr, pai):
    H = hunt_constants(); c = H["vo2max"][sex]
    vo2 = c["intercept"] + c["age"] * age + c["waist"] * waist + c["rhr"] * rhr + c["pai"] * pai
    lut = np.array(H["fitness_age_lookup"][sex], float)
    v, a = lut[::-1, 1], lut[::-1, 0]
    fa = float(np.interp(vo2, v, a)) if v[0] <= vo2 <= v[-1] else (90.0 if vo2 < v[0] else 20.0)
    slope = abs((lut[-1, 1] - lut[0, 1]) / (lut[-1, 0] - lut[0, 0]))
    return {"vo2max": vo2, "fitness_age": fa, "band_years": c["see"] / slope}


# ---------------------------------------------------------------- risk_years.m / caffeine_curve.m
def risk_years():
    rows = [
        ("social", "social_isolation", 1.29, "Holt-Lunstad 2015, Perspect Psychol Sci 10:227", "lsns_proxy < 12"),
        ("social", "loneliness", 1.26, "Holt-Lunstad 2015, Perspect Psychol Sci 10:227", "lonely == true"),
        ("social", "living_alone", 1.32, "Holt-Lunstad 2015, Perspect Psychol Sci 10:227", "lives_alone == true"),
        ("lifestyle", "short_sleep", 1.12, "Cappuccio 2010, Sleep 33:585", "sleep_h < 6"),
        ("lifestyle", "long_sleep", 1.30, "Cappuccio 2010, Sleep 33:585", "sleep_h > 9"),
        ("lifestyle", "smoking", 2.80, "Jha 2013, NEJM 368:341 (men; women 3.0)", "smoker == true"),
        ("fitness", "low_fitness", 1.70, "Kodama 2009, JAMA 301:2024 (low vs high CRF)", "vo2max < reference_p20"),
        ("fitness", "per_met_fitness", 0.87, "Kodama 2009, JAMA 301:2024 (per 1 MET)", "per 3.5 mL/kg/min of VO2max")]
    return [{"layer": l, "exposure": e, "hr": hr, "years": round(8 * math.log2(hr), 1), "source": s, "condition": c,
             "label": "risk-equivalent years, if sustained, population estimate"} for l, e, hr, s, c in rows]


def caffeine_curve():
    t = [x * 0.5 for x in range(0, 33)]
    return {"half_life_h": 5.0, "modifiers": {"smoker": 0.5, "oral_contraceptive": 2.0}, "bedtime_threshold_mg": 50,
            "threshold_note": "assumption: ~half a cup of coffee remaining; evidence for the 6 h rule is Drake 2013",
            "source": "Fredholm 1999; Benowitz 1989; Abernethy & Todd 1985; Drake 2013",
            "curve": {"t_h": t, "fraction": [round(0.5 ** (x / 5.0), 4) for x in t]},
            "rule": "last_coffee_h_before_bed = half_life_h * modifier * log2(dose_mg / bedtime_threshold_mg)"}


# ---------------------------------------------------------------- vectors.json
VECTORS = [
    ("ref_34M", 34, "M", dict(albumin=44, creatinine=80, glucose=5.4, crp=0.08, lymph_pct=30, mcv=90, rdw=13.1, alp=70, wbc=6.2)),
    ("ref_58F", 58, "F", dict(albumin=41, creatinine=62, glucose=6.1, crp=0.35, lymph_pct=27, mcv=91, rdw=14.2, alp=88, wbc=7.4)),
    ("ref_71M", 71, "M", dict(albumin=39, creatinine=105, glucose=6.8, crp=0.6, lymph_pct=22, mcv=94, rdw=15.0, alp=95, wbc=8.1)),
    ("imputed_crp_45F", 45, "F", dict(albumin=42, creatinine=66, glucose=5.2, lymph_pct=33, mcv=89, rdw=13.0, alp=64, wbc=5.9)),
]


def build_vectors(norms):
    out = []
    for name, age, sex, vals in VECTORS:
        o = phenoage(vals, age, sex, norms)
        out.append({"name": name, "age": age, "sex": sex, "fasting": True, "values": vals,
                    "phenoage": round(o["phenoage"], 4), "band": round(o["band"], 4),
                    "waterfall": {k: round(v, 4) for k, v in o["waterfall"].items()},
                    "imputed": o["imputed"], "markers_used": o["markers_used"],
                    "xb": round(o["xb"], 6), "mortality_10y": round(o["mortality_10y"], 6)})
    return out


# ---------------------------------------------------------------- export_artifacts.m
def relabel(S):
    return {s: {BANDS[i]: S[s][k] for i, k in enumerate(BAND_KEYS)} for s in ["M", "F"]}


def export(norms, out_dir, provisional):
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = {"generated_by": "matlab/tools/crosscheck/crosscheck.py (PROVISIONAL: regenerate with matlab/export/export_artifacts.m)"
             if provisional else "matlab/export/export_artifacts.m",
             "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    mids = [25, 35, 45, 55, 65, 75, 85]
    cohort = {s: {BANDS[i]: round(phenoage(norms["reference"][s][k], mids[i], s, norms)["waterfall"]["cohort_offset"], 3)
                  for i, k in enumerate(BAND_KEYS)} for s in ["M", "F"]}
    P = {"version": 1, "source": "Levine 2018, Aging 10:573, Table 1 + Supplement 1", "units": UNITS,
         "coefficients": COEF, "intercept": INTERCEPT, "gamma": GAMMA, "t_months": T_MONTHS, "k": K, "a": A_CONST,
         "offset": OFFSET,
         "affine": {"A": AFFINE_A, "rule": "phenoage = A + xb / k, where xb = intercept + sum(coef_i * term_i) + coef_age * age; term_crp = ln(max(crp, crp_floor_mgdL))"},
         "crp_floor_mgdL": CRP_FLOOR, "crp_acute_mgdL": CRP_ACUTE,
         "reference_by_age_sex": relabel(norms["reference"]),
         "imputation_sd_by_age_sex": relabel(norms["imputation_sd"]),
         "cohort_offset_by_age_sex": cohort,
         "cohort_offset_rule": "exact: phenoage(reference_by_age_sex[sex][band], age, sex) - age at the user's exact age; the table above is the value at the band midpoint, for display only",
         "waterfall_rule": "years_i = coef_i * (term_i(x_i) - term_i(reference_i)) / k; age + cohort_offset + sum(years_i) == phenoage exactly",
         "band_rule": "1 SD: sqrt(sum_i (coef_i/k * sd_i)^2); measured: sd_i = x_i * sqrt(cv_within^2 + cv_analytical^2) (crp: the cv itself, on the log term); imputed: sd_i = imputation_sd_by_age_sex",
         "cv": {a: {"within": w, "analytical": an} for a, (w, an) in CV.items()},
         "critical_ranges": CRIT, "creatinine_ref_high_default_umolL": CREAT_REF_HIGH_DEFAULT,
         "fasting_rule": 'glucose is imputed (greyed, "8 of 9 markers") unless the report states fasting',
         "labels": {"estimate": "Estimate, not diagnosis", "critical": "See a clinician first", "imputed": "8 of 9 markers"},
         "norms": {"source": norms["source"], "n_adults": norms["n_adults"], "n_complete_fasting": norms["n_complete_fasting"]},
         "meta": stamp}
    Q = {"version": 1, "source": norms["source"], "phenoage_accel": relabel(norms["phenoage_accel"]),
         "analytes": {a: relabel(norms["analytes"][a]) for a in ANALYTES}, "units": UNITS, "meta": stamp}
    H = hunt_constants(); H["version"] = 1
    H["label"] = "Estimate from age, waist, resting pulse and activity; not a fitness test"; H["meta"] = stamp
    Kc = caffeine_curve(); Kc["version"] = 1; Kc["meta"] = stamp
    for name, obj in [("phenoage.json", P), ("nhanes_percentiles.json", Q), ("hunt.json", H),
                      ("risk_years.json", risk_years()), ("caffeine.json", Kc)]:
        (out_dir / name).write_text(json.dumps(obj, indent=2), encoding="utf-8")
        print("wrote", out_dir / name)


if __name__ == "__main__":
    provisional = "--provisional-export" in sys.argv
    N = nhanes_norms()
    (MATLAB / "engine" / "norms_cache.json").write_text(json.dumps(N, indent=2), encoding="utf-8")
    print(f"norms: {N['n_adults']} adults, {N['n_complete_fasting']} complete fasting cases")
    V = build_vectors(N)
    (MATLAB / "tests" / "vectors.json").write_text(json.dumps(V, indent=2), encoding="utf-8")
    for v in V:
        print(f"{v['name']:>18}: phenoage {v['phenoage']:.2f} +/- {v['band']:.2f}  cohort {v['waterfall']['cohort_offset']:+.2f}  imputed {v['imputed']}")
    # self-checks that mirror tests/test_phenoage.m
    o = phenoage(V[0]["values"], 34, "M", N)
    assert abs(o["phenoage"] - o["phenoage_direct"]) < 1e-9, "affine != direct"
    ref = N["reference"]["M"]["b40_49"]; r = phenoage(ref, 45, "M", N)
    assert all(abs(r["waterfall"][a]) < 1e-12 for a in ANALYTES)
    assert phenoage({**V[0]["values"], "crp": 0.02}, 34, "M", N)["phenoage"] == phenoage({**V[0]["values"], "crp": 0.1}, 34, "M", N)["phenoage"]
    assert phenoage({**V[0]["values"], "glucose": 300 / MGDL_PER_MMOL}, 34, "M", N)["flags"]["critical_analytes"] == ["glucose"]
    assert phenoage(V[0]["values"], 34, "M", N, fasting=None)["imputed"] == ["glucose"]
    h = hunt_fitness_age(45, "M", 95, 62, (47.2 - (100.27 - 0.296 * 45 - 0.369 * 95 - 0.155 * 62)) / 0.226)
    assert abs(h["fitness_age"] - 45) < 0.5, h
    print("self-checks passed")
    if provisional:
        export(N, ROOT / "web" / "public" / "engine", provisional=True)
