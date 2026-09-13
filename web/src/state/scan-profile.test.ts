import { describe, expect, it } from 'vitest';

import { diffScanProfile, pickChanged } from './scan-profile';

describe('diffScanProfile', () => {
  it('reports nothing when the meal uses exactly the saved profile', () => {
    const d = diffScanProfile({ weightLb: 172, fastingGlucoseMgdl: 92, on_glucose_meds: false }, { weightLb: 172, fastingGlucoseMgdl: 92, on_glucose_meds: false });
    expect(d.changed).toEqual([]);
    expect(d.overwrites).toEqual([]);
  });

  it('defaults to saving first-time entries', () => {
    const d = diffScanProfile({ weightLb: 172, fastingGlucoseMgdl: 92, on_glucose_meds: false }, {});
    expect(d.changed).toEqual(['weightLb', 'fastingGlucoseMgdl', 'on_glucose_meds']);
    expect(d.overwrites).toEqual([]);
    expect(d.defaultSave).toBe(true);
  });

  it('defaults to "just this meal" when a saved value would be replaced', () => {
    const d = diffScanProfile({ weightLb: 180, fastingGlucoseMgdl: 92 }, { weightLb: 172, fastingGlucoseMgdl: 92 });
    expect(d.changed).toEqual(['weightLb']);
    expect(d.overwrites).toEqual(['weightLb']);
    expect(d.defaultSave).toBe(false);
  });

  it('treats a medication change from No to Yes as an overwrite', () => {
    const d = diffScanProfile({ on_glucose_meds: true }, { on_glucose_meds: false });
    expect(d.overwrites).toEqual(['on_glucose_meds']);
    expect(d.defaultSave).toBe(false);
  });

  it('mixes new and overwritten fields but still defaults to not saving', () => {
    const d = diffScanProfile({ weightLb: 180, bedtime: '23:00' }, { weightLb: 172 });
    expect(d.changed).toEqual(['weightLb', 'bedtime']);
    expect(d.overwrites).toEqual(['weightLb']);
    expect(d.defaultSave).toBe(false);
  });

  it('treats answering the medication question after "prefer not to say" as an overwrite', () => {
    const d = diffScanProfile({ on_glucose_meds: false }, { glucoseMedsDeclined: true });
    expect(d.overwrites).toEqual(['on_glucose_meds']);
    expect(d.defaultSave).toBe(false);
  });

  it('ignores fields the meal left blank', () => {
    const d = diffScanProfile({ weightLb: 172 }, { weightLb: 172, coffee_mg_per_cup: 95 });
    expect(d.changed).toEqual([]);
  });
});

describe('pickChanged', () => {
  it('returns only the changed fields, so saving never touches the rest of the profile', () => {
    expect(pickChanged({ weightLb: 180, fastingGlucoseMgdl: 92, bedtime: '23:00' }, ['weightLb'])).toEqual({ weightLb: 180 });
  });
});
