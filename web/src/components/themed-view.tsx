import { View, type ViewProps } from 'react-native';

import { GlassBlur, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  type?: ThemeColor;
};

/** `surface`/`surfaceRaised` are translucent glass over the page gradient — frost them (web only). */
const GLASS_TYPES = new Set<ThemeColor>(['surface', 'surfaceRaised']);

export function ThemedView({ style, type, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();
  const glass = type && GLASS_TYPES.has(type) ? GlassBlur : undefined;

  return <View style={[{ backgroundColor: theme[type ?? 'background'] }, glass, style]} {...otherProps} />;
}
