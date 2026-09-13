import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { GradientColors, GradientEnd, GradientStart } from '@/constants/theme';

/**
 * The one fixed background behind every screen — mounted once in the root layout, not per-screen.
 * Every screen container is transparent (Colors.background) so this shows through underneath their
 * glass cards; see theme.ts's Session 29 note.
 */
export function PageGradient() {
  return (
    <LinearGradient
      colors={GradientColors}
      start={GradientStart}
      end={GradientEnd}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );
}
