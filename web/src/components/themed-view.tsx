import { View, type ViewProps } from 'react-native';

import { PageGradient } from '@/components/page-gradient';
import { GlassBlur, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  type?: ThemeColor;
};

/** `surface`/`surfaceRaised` are translucent glass over the page gradient — frost them (web only). */
const GLASS_TYPES = new Set<ThemeColor>(['surface', 'surfaceRaised']);

/**
 * `type="background"` (the default) is every screen's own outermost container. Colors.background
 * is transparent by design (see theme.ts Session 29), so each of these paints its own opaque
 * gradient here rather than relying on one shared layer behind the navigator — React Navigation
 * keeps the previous screen/tab mounted underneath during and after transitions, so a shared
 * transparent layer let it show through in the gaps between cards. Painting the gradient inside
 * every screen's own container makes each one opaque on its own, regardless of what's stacked
 * beneath it.
 */
export function ThemedView({ style, type, children, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();
  const isPage = !type || type === 'background';
  const glass = type && GLASS_TYPES.has(type) ? GlassBlur : undefined;

  return (
    <View style={[{ backgroundColor: theme[type ?? 'background'] }, glass, style]} {...otherProps}>
      {isPage && <PageGradient />}
      {children}
    </View>
  );
}
