import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts, Spacing } from '@/constants/theme';

/** NHANES percentile strip (p5..p95) with the user's marker, from nhanes_percentiles.json. */
export interface Percentiles {
  p5: number;
  p25?: number;
  p50: number;
  p75?: number;
  p95: number;
}

interface Props {
  label: string;
  unit: string;
  pct: Percentiles;
  value: number;
  imputed?: boolean;
  source?: string;
}

export function Distribution({ label, unit, pct, value, imputed, source }: Props) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const H = 56;
  const lo = Math.min(pct.p5, value);
  const hi = Math.max(pct.p95, value);
  const pad = (hi - lo) * 0.12 || 1;
  const xMin = lo - pad;
  const xMax = hi + pad;
  const xOf = (v: number) => ((v - xMin) / (xMax - xMin)) * width;
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

  return (
    <View onLayout={onLayout} style={styles.wrap}>
      <ThemedText type="smallBold">
        {label} <ThemedText type="small" themeColor="textMuted">{unit}</ThemedText>
      </ThemedText>
      {width > 0 && (
        <Svg width={width} height={H}>
          <Rect x={xOf(pct.p5)} y={22} width={xOf(pct.p95) - xOf(pct.p5)} height={12} fill={Colors.surfaceRaised} rx={6} />
          {pct.p25 !== undefined && pct.p75 !== undefined && (
            <Rect x={xOf(pct.p25)} y={22} width={xOf(pct.p75) - xOf(pct.p25)} height={12} fill={Colors.border} rx={6} />
          )}
          <Line x1={xOf(pct.p50)} y1={20} x2={xOf(pct.p50)} y2={36} stroke={Colors.textSecondary} strokeWidth={2} />
          <Polygon points={`${xOf(value)},20 ${xOf(value) - 6},10 ${xOf(value) + 6},10`} fill={imputed ? Colors.textMuted : Colors.accent} />
          <SvgText x={xOf(pct.p5)} y={50} fontSize={10} fontFamily={Fonts.body} fill={Colors.textMuted} textAnchor="start">
            {`p5 ${fmt(pct.p5)}`}
          </SvgText>
          <SvgText x={xOf(pct.p50)} y={50} fontSize={10} fontFamily={Fonts.body} fill={Colors.textMuted} textAnchor="middle">
            {`median ${fmt(pct.p50)}`}
          </SvgText>
          <SvgText x={xOf(pct.p95)} y={50} fontSize={10} fontFamily={Fonts.body} fill={Colors.textMuted} textAnchor="end">
            {`p95 ${fmt(pct.p95)}`}
          </SvgText>
          <SvgText x={xOf(value)} y={8} fontSize={11} fontFamily={Fonts.display} fill={imputed ? Colors.textMuted : Colors.accent} textAnchor="middle">
            {imputed ? `${fmt(value)} (imputed)` : fmt(value)}
          </SvgText>
        </Svg>
      )}
      {source && (
        <ThemedText type="small" themeColor="textMuted">
          Your value against adults of your age band and sex. {source}.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: Spacing.one },
});
