import { useEffect, useState } from 'react';

import type { MealComputation } from '@/engine/meal';

export interface GeminiEstimate {
  carbs_g: number;
  food_description: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface TonightResult {
  meal: MealComputation;
  mealType: string;
  onMeds: boolean;
  carbsSource: 'photo' | 'manual';
  gemini: GeminiEstimate | null;
  coffee: { hoursBefore: number; byClockTime: string | null } | null;
}

let current: TonightResult | null = null;
const listeners = new Set<() => void>();

export function setTonightResult(result: TonightResult) {
  current = result;
  listeners.forEach((listener) => listener());
}

export function clearTonightResult() {
  current = null;
  listeners.forEach((listener) => listener());
}

/** Module-level singleton, not persisted — a fresh page load (e.g. a shared link) has no result. */
export function useTonightResult(): TonightResult | null {
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
