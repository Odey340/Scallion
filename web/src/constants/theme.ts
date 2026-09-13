/**
 * Scallion design tokens — single source of truth for color, type, and spacing.
 * Light, clinical palette: see docs/log/C.md session 2 for the pivot from the original dark-gold spec.
 * Session 29: glassmorphism dashboard pass (ui-ux-pro-max skill) — surfaces became translucent
 * glass over a fixed page gradient (see GradientColors/PageGradientAngle, painted once in the root
 * layout); the brand accent/connection/silence hues are unchanged, only how surfaces render them.
 */

import { Platform } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

export const Colors = {
  background: 'transparent', // the fixed page gradient shows through every screen
  surface: 'rgba(255,255,255,0.66)', // glass cards
  surfaceRaised: 'rgba(255,255,255,0.88)', // chips, elevated rows — reads distinctly over a glass card
  border: 'rgba(15,23,42,0.10)',
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

/**
 * The fixed background behind every screen (painted once in the root layout, not per-screen):
 * a soft diagonal wash from a pale tint of the accent blue to a pale tint of the connection green,
 * the same two hues already in Colors, not a new palette. Cards (Colors.surface) float as
 * translucent glass over it — this is what gives them depth instead of sitting on a flat fill.
 */
export const GradientColors = ['#D8E9FA', '#E9E3F7', '#DBF2E6'] as const;
export const GradientStart = { x: 0, y: 0 } as const;
export const GradientEnd = { x: 1, y: 1 } as const;

/** Frosted-glass blur for card surfaces. Web only — RN Web forwards it as real CSS; native ignores it. */
export const GlassBlur: ViewStyle = Platform.select({
  web: { backdropFilter: 'blur(20px) saturate(160%)' } as ViewStyle,
  default: {},
})!;

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

/** Soft, ambient elevation for glass cards — a wide, low-opacity shadow instead of a hard drop shadow. */
export const CardShadow: ViewStyle = {
  shadowColor: '#0F172A',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.08,
  shadowRadius: 24,
  elevation: 3,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.6)',
};

/** Apply to every rendered number per CLAUDE.md: "tabular numerals for every number." */
export const NumericStyle: { fontVariant: TextStyle['fontVariant']; fontFamily: string } = {
  fontVariant: ['tabular-nums'],
  fontFamily: Fonts.display,
};

/**
 * Content max-width. Phones are always well under this, so this only affects laptop/desktop
 * viewports. 1080 read as too wide/stretched (human feedback); a classic centered reading/form
 * column reads better than maximizing fill.
 */
export const MaxContentWidth = 720;

/** Charts read as a stretched line, not a chart, once their box gets much wider than this. */
export const MaxChartWidth = 560;
