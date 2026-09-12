/**
 * Mirrors api/tests/test_redaction.py: the rules Lane D ships must behave the same in the browser.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadRules, redactLine, redactText, type RawRules } from './redaction';

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, '../../public/redaction_rules.json'), 'utf8')) as RawRules;
const RS = loadRules(raw);

// Three invented header lines a real report might print (no real person).
const INVENTED_HEADERS = [
  'Patient: DOE, JANE Q    DOB: 03/14/1975    Sex: F    MRN: 004417823',
  'Address: 4500 Old Spanish Trl Apt 12, Houston, TX 77021    Phone: (713) 555-0142',
  'Ordering Physician: Dr. A. Smith, MD    NPI 1234567890    Fax: 713-555-0199',
];

// Lines that must never be dropped: analyte rows and the fields the clock or re-test date needs.
const MUST_KEEP = [
  'Protein, Total 7.0 g/dL 6.0-8.5',
  'Albumin 4.4 g/dL 3.8-4.9',
  'Vitamin D, 25-Hydroxy 32 ng/mL 30-100',
  'Creatinine 0.91 mg/dL 0.76-1.27',
  'Collected: 2026-08-14 07:52    Reported: 2026-08-14 15:10    Specimen: Serum / Whole blood',
  'Fasting: Yes',
  'Sex: F    Age: 51',
  'COMPREHENSIVE METABOLIC PANEL (CMP)',
  'Reference ranges apply to adults. Results are for the specimen as received.',
];

describe('redaction_rules.json', () => {
  it('is the same file Lane D ships (shape and JS-safe regexes)', () => {
    expect(raw.version).toBe(1);
    const ids = raw.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of raw.rules) {
      expect(['drop_line', 'mask']).toContain(r.action);
      expect(() => new RegExp(r.pattern, 'i')).not.toThrow();
    }
    for (const cat of ['name', 'dob', 'mrn', 'address', 'physician']) {
      expect(raw.rules.some((r) => r.category === cat)).toBe(true);
    }
  });
});

describe('redactLine', () => {
  for (const line of INVENTED_HEADERS) {
    it(`drops: ${line.slice(0, 30)}...`, () => {
      const r = redactLine(line, RS);
      expect(r.text).toBeNull();
      expect(r.droppedBy).toBeTruthy();
    });
  }

  it('the invented headers hit the name, address and physician categories', () => {
    const cats = Object.fromEntries(RS.rules.map((r) => [r.id, r.category]));
    const hit = new Set(INVENTED_HEADERS.map((l) => cats[redactLine(l, RS).droppedBy!]));
    expect(hit).toEqual(new Set(['name', 'address', 'physician']));
  });

  for (const line of MUST_KEEP) {
    it(`keeps: ${line.slice(0, 30)}...`, () => {
      const r = redactLine(line, RS);
      expect(r.text).toBe(line);
      expect(r.masks).toEqual([]);
    });
  }

  it('masks only the matched substring on a line that survives', () => {
    const r = redactLine('Questions? Email lab@example.org or call 713-555-0100', RS);
    expect(r.text).not.toBeNull();
    expect(r.text).not.toContain('lab@example.org');
    expect(r.text).toContain('[REDACTED]');
    expect(r.masks.some((m) => m.ruleId === 'email')).toBe(true);
  });

  it('a line already carrying the mask token is left alone (fixture header, byte-identical upload)', () => {
    const r = redactLine('Patient: [REDACTED]    DOB: [REDACTED]    MRN: [REDACTED]', RS);
    expect(r.text).toBe('Patient: [REDACTED]    DOB: [REDACTED]    MRN: [REDACTED]');
    expect(r.droppedBy).toBeNull();
  });

  it('a result row is never dropped even when a drop rule matches inside it', () => {
    const r = redactLine('Dr. Albumin 4.4 g/dL 3.8-4.9', RS);
    expect(r.text).not.toBeNull();
  });
});

describe('redactText', () => {
  it('reports dropped and masked lines and keeps the rest byte-identical', () => {
    const text = [INVENTED_HEADERS[0], ...MUST_KEEP, 'Fax: 713-555-0199'].join('\n');
    const r = redactText(text, RS);
    expect(r.dropped.map((d) => d.line)).toEqual([0]);
    expect(r.masked.length).toBeGreaterThan(0);
    expect(r.text.split('\n').slice(0, MUST_KEEP.length)).toEqual(MUST_KEEP);
  });
});
