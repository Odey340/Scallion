/**
 * Scallion design tokens — single source of truth for color, type, and spacing.
 * Light, clinical palette: see docs/log/C.md session 2 for the pivot from the original dark-gold spec.
 */

import type { TextStyle, ViewStyle } from 'react-native';

export const Colors = {
  background: '#F6F8FA', // clinical off-white
  surface: '#FFFFFF', // cards, sheets
  surfaceRaised: '#EEF2F6', // chips, elevated rows
  border: '#DCE3EA',
  text: '#111827', // near-black, formal
  textSecondary: '#4B5768',
  textMuted: '#7A8699',
  accent: '#1B5E8C', // clinical blue
  accentText: '#FFFFFF', // text drawn on top of the accent
  connection: '#0F7A4B', // green — connection days
  silence: '#B42318', // red — silence / distancing
  critical: '#B42318',
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

/** Subtle elevation for cards on a light ground — reads as a formal, structured surface rather than flat. */
export const CardShadow: ViewStyle = {
  shadowColor: '#0F172A',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,
};

/** Apply to every rendered number per CLAUDE.md: "tabular numerals for every number." */
export const NumericStyle: { fontVariant: TextStyle['fontVariant']; fontFamily: string } = {
  fontVariant: ['tabular-nums'],
  fontFamily: Fonts.display,
};

/**
 * Content max-width. Phones are always well under this, so raising it only affects laptop/desktop
 * viewports; kept well short of full-bleed so text stays readable on ultra-wide screens.
 */
export const MaxContentWidth = 1080;
