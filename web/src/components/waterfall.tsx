import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { ANALYTES, type AnalyteKey, type Waterfall as WaterfallData } from '@/engine/phenoage';

/**
 * The PhenoAge waterfall: chronological age -> cohort offset -> nine analyte bars -> PhenoAge.
 * Bars are the exact per-analyte years from phenoage.ts (affine identity), so the chart
 * reconciles on screen: the last bar lands on the PhenoAge value. Tap a bar to select it.
 */

export const ANALYTE_LABELS: Record<AnalyteKey, string> = {
  albumin: 'Albumin',
  creatinine: 'Creatinine',
  glucose: 'Glucose',
  crp: 'CRP',
  lymph_pct: 'Lymphocytes',
  mcv: 'MCV',
  rdw: 'RDW',
  alp: 'Alk. phosphatase',
  wbc: 'WBC',
};

interface Props {
  age: number;
  waterfall: WaterfallData;
  phenoage: number;
  imputed: AnalyteKey[];
  selected?: AnalyteKey | null;
  onSelect?: (a: AnalyteKey | null) => void;
}

const ROW_H = 26;
const LABEL_W = 120;
const VALUE_W = 54;

export function Waterfall({ age, waterfall, phenoage, imputed, selected, onSelect }: Props) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const steps: { key: string; label: string; delta: number; analyte?: AnalyteKey }[] = [
    { key: 'cohort', label: 'Cohort offset', delta: waterfall.cohort_offset },
    ...ANALYTES.map((a) => ({ key: a, label: ANALYTE_LABELS[a], delta: waterfall[a], analyte: a })),
  ];

  // Running totals, then a shared x scale over everything the bars touch.
  let running = age;
  const rows = steps.map((s) => {
    const from = running;
    running += s.delta;
    return { ...s, from, to: running };
  });
  const lo = Math.min(age, phenoage, ...rows.map((r) => Math.min(r.from, r.to)));
  const hi = Math.max(age, phenoage, ...rows.map((r) => Math.max(r.from, r.to)));
  const pad = Math.max(1, (hi - lo) * 0.08);
  const xMin = lo - pad;
  const xMax = hi + pad;
  const chartW = Math.max(0, width - LABEL_W - VALUE_W);
  const xOf = (v: number) => LABEL_W + ((v - xMin) / (xMax - xMin)) * chartW;

  const totalRows = rows.length + 2; // age row + steps + phenoage row
  const height = totalRows * ROW_H + Spacing.two;

  return (
    <View onLayout={onLayout} style={styles.wrap}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {/* Age anchor */}
          <SvgText x={0} y={ROW_H * 0.7} fontFamily={Fonts.bodySemiBold} fontSize={12} fill={Colors.text}>
            Calendar age
          </SvgText>
          <Line x1={xOf(age)} y1={ROW_H * 0.15} x2={xOf(age)} y2={height - ROW_H * 0.3} stroke={Colors.border} strokeWidth={1} strokeDasharray="3 3" />
          <Rect x={xOf(age) - 1.5} y={ROW_H * 0.2} width={3} height={ROW_H * 0.6} fill={Colors.text} />
          <SvgText x={width - VALUE_W + 4} y={ROW_H * 0.7} fontFamily={Fonts.display} fontSize={12} fill={Colors.text}>
            {age.toFixed(0)}
          </SvgText>

          {rows.map((r, i) => {
            const y = (i + 1) * ROW_H;
            const x0 = xOf(Math.min(r.from, r.to));
            const w = Math.max(2, Math.abs(xOf(r.to) - xOf(r.from)));
            const isImputed = r.analyte ? imputed.includes(r.analyte) : false;
            const color = r.key === 'cohort' ? Colors.textMuted : r.delta > 0 ? Colors.silence : Colors.connection;
            const isSel = selected && r.analyte === selected;
            return (
              <G key={r.key} onPress={() => onSelect?.(r.analyte ?? null)}>
                <Rect x={0} y={y} width={width} height={ROW_H} fill={isSel ? Colors.surfaceRaised : 'transparent'} />
                <SvgText x={0} y={y + ROW_H * 0.7} fontFamily={isSel ? Fonts.bodySemiBold : Fonts.body} fontSize={12} fill={isImputed ? Colors.textMuted : Colors.text}>
                  {r.label + (isImputed ? ' (imputed)' : '')}
                </SvgText>
                <Rect x={x0} y={y + ROW_H * 0.2} width={w} height={ROW_H * 0.6} fill={color} opacity={isImputed ? 0.35 : isSel ? 1 : 0.85} rx={2} />
                {isSel && <Rect x={x0 - 2} y={y + ROW_H * 0.1} width={w + 4} height={ROW_H * 0.8} fill="none" stroke={Colors.accent} strokeWidth={1.5} rx={3} />}
                <SvgText x={width - VALUE_W + 4} y={y + ROW_H * 0.7} fontFamily={Fonts.display} fontSize={12} fill={color}>
                  {(r.delta >= 0 ? '+' : '') + r.delta.toFixed(1)}
                </SvgText>
              </G>
            );
          })}

          {/* PhenoAge landing */}
          <SvgText x={0} y={(rows.length + 1) * ROW_H + ROW_H * 0.7} fontFamily={Fonts.bodySemiBold} fontSize={12} fill={Colors.accent}>
            PhenoAge
          </SvgText>
          <Rect x={xOf(phenoage) - 1.5} y={(rows.length + 1) * ROW_H + ROW_H * 0.2} width={3} height={ROW_H * 0.6} fill={Colors.accent} />
          <SvgText x={width - VALUE_W + 4} y={(rows.length + 1) * ROW_H + ROW_H * 0.7} fontFamily={Fonts.display} fontSize={12} fill={Colors.accent}>
            {phenoage.toFixed(1)}
          </SvgText>
        </Svg>
      )}
      <ThemedText type="small" themeColor="textMuted">
        Years per analyte relative to the age-sex reference person. Red adds years, green removes them. Bars sum exactly to
        PhenoAge.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: Spacing.two },
});
