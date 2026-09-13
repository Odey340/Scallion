import { type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

export function NumberInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}) {
  return <TextField value={value} onChangeText={onChangeText} placeholder={placeholder} keyboardType="numeric" />;
}

export function TextField({
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  keyboardType?: KeyboardTypeOptions;
}) {
  return (
    <TextInput
      style={styles.input}
      keyboardType={keyboardType}
      placeholderTextColor={Colors.textMuted}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
    />
  );
}

export function SegmentButton({
  label,
  active,
  onPress,
  description,
  fullWidth,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  description?: string;
  fullWidth?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={active}
      aria-disabled={disabled}
      accessibilityLabel={description ? `${label}, ${description}` : label}
      disabled={disabled}
      style={[styles.segment, fullWidth && styles.segmentFull, active && styles.segmentActive, disabled && styles.segmentDisabled]}
      onPress={onPress}>
      <ThemedText type={description ? 'smallBold' : 'small'} themeColor={active ? 'accentText' : 'text'}>
        {label}
      </ThemedText>
      {description && (
        <ThemedText type="small" themeColor={active ? 'accentText' : 'textMuted'} style={styles.segmentDescription}>
          {description}
        </ThemedText>
      )}
    </Pressable>
  );
}

export interface Choice<T> {
  value: T;
  label: string;
  description?: string;
}

/** One question, several tappable answers. `stack` puts one answer per line (for long labels). */
export function ChoiceGroup<T>({
  options,
  value,
  onChange,
  layout = 'wrap',
}: {
  options: readonly Choice<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  layout?: 'wrap' | 'stack';
}) {
  return (
    <View accessibilityRole="radiogroup" style={layout === 'stack' ? styles.stack : styles.wrap}>
      {options.map((o) => (
        <SegmentButton
          key={String(o.value)}
          label={o.label}
          description={o.description}
          fullWidth={layout === 'stack'}
          active={value === o.value}
          onPress={() => onChange(o.value)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    color: Colors.text,
    backgroundColor: Colors.surface,
    fontSize: 16,
  },
  segment: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: Colors.surface,
    minHeight: 44,
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  segmentFull: { alignSelf: 'stretch' },
  segmentDisabled: { opacity: 0.5 },
  segmentDescription: { marginTop: Spacing.half },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stack: { gap: Spacing.two },
});
