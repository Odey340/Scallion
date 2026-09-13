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

/** What /start asked, kept so the Camera screen can turn a measured pulse into a fitness age. */
export interface FitnessInputs {
  age: number;
  sex: 'M' | 'F';
  waistCm: number;
  pai: number;
  paiKey: string;
}

interface Stored {
  clocks: Partial<Record<LocalClock['clock'], LocalClock>>;
  fitnessInputs: FitnessInputs | null;
}

const KEY = 'scallion.clock.v2';
let current: Stored = load();
const listeners = new Set<() => void>();

function load(): Stored {
  try {
    if (typeof localStorage === 'undefined') return { clocks: {}, fitnessInputs: null };
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Stored>) : {};
    return { clocks: parsed.clocks ?? {}, fitnessInputs: parsed.fitnessInputs ?? null };
  } catch {
    return { clocks: {}, fitnessInputs: null };
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
  current = { ...current, clocks: { ...current.clocks, [clock.clock]: clock } };
  persist();
  listeners.forEach((listener) => listener());
}

export function setFitnessInputs(inputs: FitnessInputs) {
  current = { ...current, fitnessInputs: inputs };
  persist();
  listeners.forEach((listener) => listener());
}

export function getLocalClocks() {
  return current.clocks;
}

export function getFitnessInputs() {
  return current.fitnessInputs;
}

function useStore(): Stored {
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

export function useLocalClocks() {
  return useStore().clocks;
}

export function useFitnessInputs() {
  return useStore().fitnessInputs;
}
