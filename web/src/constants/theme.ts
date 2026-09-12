/**
 * Scallion design tokens — single source of truth for color, type, and spacing.
 * Dark-first, single palette (no light mode): see docs/lanes/C.md Block 1.
 */

import type { TextStyle } from 'react-native';

export const Colors = {
  background: '#0B0D10', // slate ground
  surface: '#161A1F', // cards, sheets
  surfaceRaised: '#1F242B', // chips, elevated rows
  border: '#2A3038',
  text: '#F5F3EE', // off-white
  textSecondary: '#A3ABB5',
  textMuted: '#6C7480',
  accent: '#D9B24C', // the single gold accent
  accentText: '#0B0D10', // text drawn on top of the accent
  connection: '#3FB27F', // green — connection days
  silence: '#E5484D', // red — silence / distancing
  critical: '#E5484D',
} as const;

export type ThemeColor = keyof typeof Colors;

export const Fonts = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  mono: 'Inter_500Medium',
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 8,
  medium: 14,
  large: 24,
  pill: 999,
} as const;

/** Apply to every rendered number per CLAUDE.md: "tabular numerals for every number." */
export const NumericStyle: { fontVariant: TextStyle['fontVariant']; fontFamily: string } = {
  fontVariant: ['tabular-nums'],
  fontFamily: Fonts.display,
};

export const MaxContentWidth = 800;
