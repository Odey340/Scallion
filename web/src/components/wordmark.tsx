import { View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';

const SIZES = {
  small: { dot: 8, gap: 6, fontSize: 18 },
  large: { dot: 14, gap: 10, fontSize: 34 },
} as const;

export function Wordmark({ size = 'small' }: { size?: keyof typeof SIZES }) {
  const s = SIZES[size];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: s.gap }}>
      <View style={{ width: s.dot, height: s.dot, borderRadius: s.dot / 2, backgroundColor: Colors.accent }} />
      <ThemedText style={{ fontFamily: Fonts.display, fontSize: s.fontSize, color: Colors.text, letterSpacing: 0.2 }}>
        Scallion
      </ThemedText>
    </View>
  );
}
