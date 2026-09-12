from app.extract.spans import find_span

TEXT = "CBC\nWBC 6.2 10*3/uL 3.4-10.8\nRDW 13.1 % 11.6-15.4\nGlucose 97 mg/dL 70-99\n"


def test_exact():
    s = find_span(TEXT, "RDW 13.1 % 11.6-15.4")
    assert s and TEXT[s[0]:s[1]] == "RDW 13.1 % 11.6-15.4"


def test_whitespace_insensitive():
    s = find_span(TEXT, "RDW   13.1   %   11.6-15.4")
    assert s and TEXT[s[0]:s[1]] == "RDW 13.1 % 11.6-15.4"


def test_name_then_value_fallback():
    s = find_span(TEXT, "Glucose 97 mg/dL (70-99) H")
    assert s and TEXT[s[0]:s[1]].startswith("Glucose 97")


def test_missing_is_none():
    assert find_span(TEXT, "Sodium 140 mmol/L") is None
    assert find_span("", "RDW 13.1") is None


def test_trailing_zeros_and_cell_per_line():
    text = "C-Reactive Protein, Cardiac\n0.80\nmg/L\n0.00-3.00\n"
    s = find_span(text, "C-Reactive Protein, Cardiac 0.8 mg/L 0.0-3.0")
    assert s and text[s[0]:s[1]] == "C-Reactive Protein, Cardiac\n0.80\nmg/L\n0.00-3.00"
