import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ANALYTE_LABELS } from '@/components/waterfall';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { ANALYTES, type AnalyteKey } from '@/engine/phenoage';
import type { Analyte } from '@/lib/api';
import { parseNumberText, textForValue } from '@/lib/number-text';

/**
 * The nine PhenoAge analytes as the report printed them, next to the SI value the clock uses.
 * Every SI value stays editable (typed-entry fallback and corrections). Rows the extraction
 * did not find are marked missing (they will be imputed: "8 of 9 markers"). A derived row is
 * labelled "1 of 9 derived"; an unrecognised unit is flagged rather than guessed.
 */

/** Common printed units and their factor to the paper's unit, for the typed-entry unit toggle. */
export const ALT_UNITS: Partial<Record<AnalyteKey, { unit: string; toSi: number }>> = {
  albumin: { unit: 'g/dL', toSi: 10 },
  creatinine: { unit: 'mg/dL', toSi: 88.42 },
  glucose: { unit: 'mg/dL', toSi: 1 / 18.016 },
  crp: { unit: 'mg/L (hs-CRP)', toSi: 0.1 },
  wbc: { unit: 'K/uL', toSi: 1 },
};

interface Props {
  units: Record<AnalyteKey, string>;
  analytes: Analyte[];
  values: Partial<Record<AnalyteKey, number | null>>;
  onChange: (key: AnalyteKey, value: number | null) => void;
  selected?: AnalyteKey | null;
  onSelect?: (key: AnalyteKey) => void;
  /** Keys whose printed row could be located on the page. */
  located?: Set<AnalyteKey>;
}

export function ReviewTable({ units, analytes, values, onChange, selected, onSelect, located }: Props) {
  const byKey = new Map<string, Analyte>();
  for (const a of analytes) if (!a.name.startsWith('other:')) byKey.set(a.name, a);

  return (
    <View style={styles.table}>
      {ANALYTES.map((key) => {
        const a = byKey.get(key);
        const v = values[key];
        const missing = v === null || v === undefined;
        const isSel = selected === key;
        return (
          <Pressable key={key} onPress={() => onSelect?.(key)}>
            <ThemedView type={isSel ? 'surfaceRaised' : 'surface'} style={[styles.row, isSel && styles.rowSelected]}>
              <View style={styles.rowHead}>
                <ThemedText type="smallBold">{ANALYTE_LABELS[key]}</ThemedText>
                {a ? (
                  <ThemedText type="small" themeColor="textMuted">
                    printed: {a.raw_name} {a.value} {a.unit}
                    {a.ref_low !== null && a.ref_high !== null ? ` (${a.ref_low}-${a.ref_high})` : ''}
                  </ThemedText>
                ) : (
                  <ThemedText type="small" themeColor="silence">
                    not found on the report
                  </ThemedText>
                )}
              </View>
              <View style={styles.rowValue}>
                <NumberCell style={[styles.input, missing && styles.inputMissing]} value={v} onChange={(n) => onChange(key, n)} />
                <ThemedText type="small" themeColor="textMuted">
                  {units[key]}
                </ThemedText>
              </View>
              {a?.derived && (
                <ThemedText type="small" themeColor="textSecondary">
                  1 of 9 derived: {a.raw_name}.
                </ThemedText>
              )}
              {a?.note && (
                <ThemedText type="small" themeColor="silence">
                  Unit not recognised ({a.note.replace('unknown_unit:', '')}). Enter the value in {units[key]} yourself.
                </ThemedText>
              )}
              {a && located && !located.has(key) && (
                <ThemedText type="small" themeColor="textMuted">
                  Printed line not located on the page image; quoted: &quot;{a.source_text}&quot;.
                </ThemedText>
              )}
            </ThemedView>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Keeps the user's own text (so "5." survives) and only shows a new number when it changed elsewhere. */
function NumberCell({
  value,
  onChange,
  style,
}: {
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  style: StyleProp<TextStyle>;
}) {
  const [text, setText] = useState(() => textForValue('', value));
  return (
    <TextInput
      style={style}
      keyboardType="decimal-pad"
      placeholder="—"
      placeholderTextColor={Colors.textMuted}
      value={textForValue(text, value)}
      onChangeText={(t) => {
        setText(t);
        onChange(parseNumberText(t));
      }}
    />
  );
}

const styles = StyleSheet.create({
  table: { gap: Spacing.two },
  row: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.medium,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  rowSelected: { borderColor: Colors.accent },
  rowHead: { gap: Spacing.half },
  rowValue: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.small,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    minWidth: 96,
    color: Colors.text,
    backgroundColor: Colors.surface,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  inputMissing: { borderColor: Colors.silence, borderStyle: 'dashed' },
});
