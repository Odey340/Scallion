import { StyleSheet, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';

export function Wordmark() {
  return (
    <View style={styles.row}>
      <View style={styles.dot} />
      <ThemedText style={styles.text}>Scallion</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
  },
  text: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.text,
    letterSpacing: 0.2,
  },
});
