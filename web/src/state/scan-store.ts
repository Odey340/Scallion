import { useEffect, useState } from 'react';

import type { MealComputation } from '@/engine/meal';

export interface GeminiEstimate {
  carbs_g: number;
  food_description: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface ScanResult {
  meal: MealComputation;
  mealType: string;
  onMeds: boolean;
  carbsSource: 'photo' | 'manual';
  gemini: GeminiEstimate | null;
  coffee: { hoursBefore: number; byClockTime: string | null } | null;
}

let current: ScanResult | null = null;
const listeners = new Set<() => void>();

export function setScanResult(result: ScanResult) {
  current = result;
  listeners.forEach((listener) => listener());
}

export function clearScanResult() {
  current = null;
  listeners.forEach((listener) => listener());
}

/** Module-level singleton, not persisted — a fresh page load (e.g. a shared link) has no result. */
export function useScanResult(): ScanResult | null {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return current;
}
