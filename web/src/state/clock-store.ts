import { useEffect, useState } from 'react';

/**
 * The most recent clock C computed on this device, so Home can show it without a login
 * (the QR judge does /start then taps Home). Persisted to localStorage on web when available;
 * a module singleton otherwise. When a token exists the same result is also POSTed to /clock
 * (contracts.md section 3) so the coach can speak about it — that is best-effort and lives in
 * the screen, not here.
 */
export interface LocalClock {
  clock: 'phenoage' | 'fitness';
  years: number;
  chronologicalAge: number;
  band: number;
  /** ISO timestamp of the computation. */
  computedAt: string;
  /** phenoage only: analytes imputed ("8 of 9 markers"). */
  imputed?: string[];
}

const KEY = 'scallion.clock.v1';
let current: Partial<Record<LocalClock['clock'], LocalClock>> = load();
const listeners = new Set<() => void>();

function load(): Partial<Record<LocalClock['clock'], LocalClock>> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<LocalClock['clock'], LocalClock>>) : {};
  } catch {
    return {};
  }
}

function persist() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // private mode or blocked storage: the module singleton still works for this page load
  }
}

export function setLocalClock(clock: LocalClock) {
  current = { ...current, [clock.clock]: clock };
  persist();
  listeners.forEach((listener) => listener());
}

export function getLocalClocks() {
  return current;
}

export function useLocalClocks() {
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
