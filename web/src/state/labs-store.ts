import { useEffect, useState } from 'react';

import type { AnalyteKey, PhenoAgeResult, Sex } from '@/engine/phenoage';
import type { ExtractResponse } from '@/lib/api';
import type { RedactionReport, RenderedPage } from '@/lib/pdf';

/**
 * Labs flow state shared between the tab screen (upload -> review) and /labs-results.
 * Module singleton, not persisted: page images can be several MB and hold a redacted report.
 */
export interface LabsState {
  source: 'pdf' | 'image' | 'typed';
  fileName: string | null;
  pages: RenderedPage[];
  redaction: RedactionReport | null;
  extract: ExtractResponse | null;
  /** Editable SI values by canonical key (from si_value, or typed). null = missing. */
  values: Partial<Record<AnalyteKey, number | null>>;
  fasting: boolean | null;
  age: number | null;
  sex: Sex | null;
  creatinineRefHigh: number | null;
  result: PhenoAgeResult | null;
}

export const EMPTY_LABS: LabsState = {
  source: 'typed',
  fileName: null,
  pages: [],
  redaction: null,
  extract: null,
  values: {},
  fasting: null,
  age: null,
  sex: null,
  creatinineRefHigh: null,
  result: null,
};

let current: LabsState = EMPTY_LABS;
const listeners = new Set<() => void>();

export function setLabs(patch: Partial<LabsState>) {
  current = { ...current, ...patch };
  listeners.forEach((l) => l());
}

export function resetLabs() {
  current = EMPTY_LABS;
  listeners.forEach((l) => l());
}

export function getLabs() {
  return current;
}

export function useLabs(): LabsState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return current;
}
