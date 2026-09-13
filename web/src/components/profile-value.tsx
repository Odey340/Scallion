import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';

/**
 * A value Scallion already knows, shown instead of an empty input: label, value, where it came
 * from, and an Edit link that swaps in the editor (children). When nothing is saved yet the
 * editor shows directly, so a first-time user just types once.
 */
export function ProfileValue({
  label,
  value,
  note,
  editing,
  onEdit,
  onRevert,
  revertLabel,
  children,
}: {
  label: string;
  /** Formatted saved/current value, or null when nothing is known yet. */
  value: string | null;
  note?: string;
  editing: boolean;
  onEdit: () => void;
  /** Offered while editing a value that has a saved counterpart. */
  onRevert?: () => void;
  revertLabel?: string;
  children: ReactNode;
}) {
  const showEditor = editing || value === null;
  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
          {label}
        </ThemedText>
        {!showEditor && (
          <View style={styles.valueWrap}>
            <ThemedText type="smallBold" style={styles.value}>
              {value}
            </ThemedText>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} onPress={onEdit} hitSlop={8}>
              <ThemedText type="small" themeColor="accent">
                Edit
              </ThemedText>
            </Pressable>
          </View>
        )}
      </View>
      {!showEditor && note && (
        <ThemedText type="small" themeColor="textMuted">
          {note}
        </ThemedText>
      )}
      {showEditor && (
        <View style={styles.editor}>
          {children}
          {editing && onRevert && (
            <Pressable accessibilityRole="button" onPress={onRevert} hitSlop={8}>
              <ThemedText type="small" themeColor="accent">
                {revertLabel ?? 'Use saved value'}
              </ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.one,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  label: { flexShrink: 1 },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  value: { fontVariant: ['tabular-nums'] },
  editor: { gap: Spacing.two },
});
