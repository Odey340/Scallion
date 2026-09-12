"""Generate fixtures/lab_report_synthetic.pdf: a CBC + CMP + hs-CRP report with a real text layer.

Every value is invented. No name, DOB, MRN, address or clinician appears, so it is safe to commit.
Run: uv run python tests/make_fixture.py
"""
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parents[2] / "fixtures" / "lab_report_synthetic.pdf"

HEADER = [
    "LABORATORY REPORT (SYNTHETIC SAMPLE, NOT A REAL PATIENT)",
    "Patient: [REDACTED]    DOB: [REDACTED]    MRN: [REDACTED]",
    "Collected: 2026-08-14 07:52    Reported: 2026-08-14 15:10    Specimen: Serum / Whole blood",
    "Fasting: Yes",
]

# (section, rows[(name, value, unit, range, flag)])
SECTIONS = [
    ("COMPLETE BLOOD COUNT (CBC) WITH DIFFERENTIAL", [
        ("WBC", "6.2", "10*3/uL", "3.4-10.8", ""),
        ("RBC", "4.85", "10*6/uL", "4.14-5.80", ""),
        ("Hemoglobin", "14.9", "g/dL", "13.0-17.7", ""),
        ("Hematocrit", "44.1", "%", "37.5-51.0", ""),
        ("MCV", "90", "fL", "79-97", ""),
        ("MCH", "30.7", "pg", "26.6-33.0", ""),
        ("MCHC", "33.8", "g/dL", "31.5-35.7", ""),
        ("RDW", "13.1", "%", "11.6-15.4", ""),
        ("Platelets", "241", "10*3/uL", "150-450", ""),
        ("Neutrophils", "58", "%", "", ""),
        ("Lymphs", "30", "%", "", ""),
        ("Monocytes", "8", "%", "", ""),
        ("Eos", "3", "%", "", ""),
        ("Basos", "1", "%", "", ""),
        ("Neutrophils (Absolute)", "3.6", "10*3/uL", "1.4-7.0", ""),
        ("Lymphs (Absolute)", "1.9", "10*3/uL", "0.7-3.1", ""),
    ]),
    ("COMPREHENSIVE METABOLIC PANEL (CMP)", [
        ("Glucose", "97", "mg/dL", "70-99", ""),
        ("BUN", "15", "mg/dL", "6-24", ""),
        ("Creatinine", "0.91", "mg/dL", "0.76-1.27", ""),
        ("eGFR", "104", "mL/min/1.73", ">59", ""),
        ("BUN/Creatinine Ratio", "16", "", "9-20", ""),
        ("Sodium", "140", "mmol/L", "134-144", ""),
        ("Potassium", "4.3", "mmol/L", "3.5-5.2", ""),
        ("Chloride", "102", "mmol/L", "96-106", ""),
        ("Carbon Dioxide, Total", "25", "mmol/L", "20-29", ""),
        ("Calcium", "9.4", "mg/dL", "8.7-10.2", ""),
        ("Protein, Total", "7.0", "g/dL", "6.0-8.5", ""),
        ("Albumin", "4.4", "g/dL", "3.8-4.9", ""),
        ("Globulin, Total", "2.6", "g/dL", "1.5-4.5", ""),
        ("Bilirubin, Total", "0.6", "mg/dL", "0.0-1.2", ""),
        ("Alkaline Phosphatase", "70", "IU/L", "44-121", ""),
        ("AST (SGOT)", "22", "IU/L", "0-40", ""),
        ("ALT (SGPT)", "24", "IU/L", "0-44", ""),
    ]),
    ("INFLAMMATION", [
        ("C-Reactive Protein, Cardiac", "0.80", "mg/L", "0.00-3.00", ""),
    ]),
]

FOOTER = [
    "Reference ranges apply to adults. Results are for the specimen as received.",
    "This document is a synthetic fixture for software testing.",
]


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=letter)
    w, h = letter
    y = h - 60
    c.setFont("Helvetica-Bold", 12)
    for line in HEADER[:1]:
        c.drawString(50, y, line); y -= 18
    c.setFont("Helvetica", 9)
    for line in HEADER[1:]:
        c.drawString(50, y, line); y -= 13
    y -= 8
    for title, rows in SECTIONS:
        c.setFont("Helvetica-Bold", 10)
        c.drawString(50, y, title); y -= 14
        c.setFont("Helvetica", 9)
        c.drawString(50, y, "Test"); c.drawString(280, y, "Result"); c.drawString(340, y, "Flag")
        c.drawString(380, y, "Units"); c.drawString(460, y, "Reference Interval"); y -= 12
        for name, val, unit, rng, flag in rows:
            c.drawString(50, y, name); c.drawString(280, y, val); c.drawString(340, y, flag)
            c.drawString(380, y, unit); c.drawString(460, y, rng); y -= 12
            if y < 80:
                c.showPage(); c.setFont("Helvetica", 9); y = h - 60
        y -= 8
    c.setFont("Helvetica-Oblique", 8)
    for line in FOOTER:
        c.drawString(50, y, line); y -= 11
    c.save()
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
