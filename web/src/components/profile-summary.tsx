import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';

export interface SummaryItem {
  label: string;
  value: string;
}

/**
 * One compact row for facts Scallion already knows, shown instead of asking the same question
 * again on another screen: "From your profile · Age 34 · Male · Waist 86 cm" with a single Edit
 * link that swaps the full form back in. Start, Camera, Labs and Scan all use it, so a returning
 * user sees the same shape everywhere (state/profile-store.ts is the source of the values).
 */
export function ProfileSummary({
  items,
  onEdit,
  note = 'From your profile',
  editLabel = 'Edit',
}: {
  items: SummaryItem[];
  onEdit: () => void;
  note?: string;
  editLabel?: string;
}) {
  return (
    <ThemedView type="surfaceRaised" style={styles.box}>
      <View style={styles.head}>
        <ThemedText type="small" themeColor="textMuted" style={styles.note}>
          {note}
        </ThemedText>
        <Pressable accessibilityRole="button" accessibilityLabel={`${editLabel} these answers`} onPress={onEdit} hitSlop={8}>
          <ThemedText type="smallBold" themeColor="accent">
            {editLabel}
          </ThemedText>
        </Pressable>
      </View>
      <View style={styles.items}>
        {items.map((item) => (
          <View key={item.label} style={styles.item}>
            <ThemedText type="small" themeColor="textSecondary">
              {item.label}
            </ThemedText>
            <ThemedText type="smallBold" style={styles.value}>
              {item.value}
            </ThemedText>
          </View>
        ))}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  note: { flexShrink: 1 },
  items: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.four, rowGap: Spacing.two },
  item: { gap: Spacing.half, minWidth: 96 },
  value: { fontVariant: ['tabular-nums'] },
});
