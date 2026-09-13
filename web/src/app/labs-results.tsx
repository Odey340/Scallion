import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedNumber, AnimatedPressable, FadeInUp } from '@/components/animated';
import { Distribution, type Percentiles } from '@/components/distribution';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ANALYTE_LABELS, Waterfall } from '@/components/waterfall';
import { CardShadow, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { ANALYTES, type AnalyteKey, type PhenoAgeData } from '@/engine/phenoage';
import { useLabs } from '@/state/labs-store';

interface NhanesPercentiles {
  source?: string;
  phenoage_accel: Record<'M' | 'F', Record<string, Percentiles>>;
  analytes: Record<AnalyteKey, Record<'M' | 'F', Record<string, Percentiles>>>;
  units: Record<AnalyteKey, string>;
}

/**
 * Labs result: the waterfall that reconciles on screen, the band, "8 of 9 markers" and
 * "complete your clock" states, and a tap-through NHANES distribution per analyte.
 * docs/lanes/C.md Block 3. Every number is phenoage.ts over A's phenoage.json, or a row of
 * nhanes_percentiles.json, or the API's `complete` block (reference prices, labelled).
 */
export default function LabsResultsScreen() {
  const router = useRouter();
  const labs = useLabs();
  const [data, setData] = useState<PhenoAgeData | null>(null);
  const [nhanes, setNhanes] = useState<NhanesPercentiles | null>(null);
  const [selected, setSelected] = useState<AnalyteKey | null>(null);

  useEffect(() => {
    fetch('/engine/phenoage.json').then((r) => r.json()).then(setData).catch(() => undefined);
    fetch('/engine/nhanes_percentiles.json').then((r) => r.json()).then(setNhanes).catch(() => undefined);
  }, []);

  const result = labs.result;
  if (!result || labs.age === null || !labs.sex) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <FadeInUp delay={0} style={styles.scroll}>
            <ThemedText type="subtitle">No result yet</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              Upload or type a blood panel first.
            </ThemedText>
            <AnimatedPressable style={styles.submit} onPress={() => router.replace('/(tabs)/labs')}>
              <ThemedText type="smallBold" themeColor="accentText">
                Go to Labs
              </ThemedText>
            </AnimatedPressable>
          </FadeInUp>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const age = labs.age;
  const sex = labs.sex;
  const labels = data?.labels ?? {};
  const critical = result.flags.critical;
  const markers = result.markersUsed;
  const complete = labs.extract?.complete ?? null;
  const accel = result.phenoage !== null ? result.phenoage - age : null;
  const accelPct = nhanes?.phenoage_accel[sex]?.[result.ageBand];
  const selPct = selected && nhanes ? nhanes.analytes[selected]?.[sex]?.[result.ageBand] : undefined;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scroll}>
          <FadeInUp delay={0}>
          {critical ? (
            <ThemedView type="surface" style={[styles.card, CardShadow]}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Biological age
              </ThemedText>
              <ThemedText type="subtitle" themeColor="critical">
                {labels.critical ?? 'See a clinician first'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {result.flags.criticalAnalytes.map((a) => ANALYTE_LABELS[a]).join(', ')} is outside the range this clock can be
                read in. The age number is hidden until a clinician has seen the report.
              </ThemedText>
            </ThemedView>
          ) : (
            <ThemedView type="surface" style={[styles.card, CardShadow]}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Biological age (PhenoAge, Levine 2018)
              </ThemedText>
              <View style={styles.clockRow}>
                <AnimatedNumber value={Math.round(result.phenoage!)} type="numeric" style={styles.bigNumber} duration={900} />
                <View style={styles.clockMeta}>
                  <ThemedText type="small" themeColor="textSecondary">
                    +/- {result.band.toFixed(1)} years (1 SD)
                  </ThemedText>
                  {accel !== null && (
                    <ThemedText type="small" themeColor={accel < 0 ? 'connection' : accel > 0 ? 'silence' : 'textSecondary'}>
                      {Math.abs(accel).toFixed(1)} years {accel < 0 ? 'younger' : 'older'} than your calendar age of {age}
                    </ThemedText>
                  )}
                </View>
              </View>
              {markers < 9 && (
                <ThemedText type="small" themeColor="textSecondary">
                  {markers} of 9 markers. Imputed from age-sex norms: {result.imputed.map((a) => ANALYTE_LABELS[a]).join(', ')}
                  {result.flags.nonFasting ? ' (glucose: not a confirmed fasting draw)' : ''}. The band is wider for it.
                </ThemedText>
              )}
              {accelPct && accel !== null && (
                <ThemedText type="small" themeColor="textMuted">
                  Among adults of your age band and sex (NHANES), the median PhenoAge runs {accelPct.p50.toFixed(1)} years{' '}
                  {accelPct.p50 < 0 ? 'below' : 'above'} calendar age; the middle half sits between {accelPct.p25?.toFixed(1)} and{' '}
                  {accelPct.p75?.toFixed(1)}.
                </ThemedText>
              )}
              <ThemedText type="small" themeColor="textMuted">
                {labels.estimate ?? 'Estimate, not diagnosis'}. Fasting: {labs.fasting === true ? 'yes' : labs.fasting === false ? 'no' : 'not sure'}.
              </ThemedText>
            </ThemedView>
          )}
          </FadeInUp>

          <FadeInUp delay={70}>
          <ThemedView type="surface" style={[styles.card, CardShadow]}>
            <ThemedText type="smallBold">Where the years come from</ThemedText>
            <Waterfall
              age={age}
              waterfall={result.waterfall}
              phenoage={result.phenoage ?? age + result.waterfall.cohort_offset + ANALYTES.reduce((s, a) => s + result.waterfall[a], 0)}
              imputed={result.imputed}
              selected={selected}
              onSelect={setSelected}
            />
            <ThemedText type="small" themeColor="textMuted">
              Cohort offset: what the age-sex reference person scores at your exact age, minus your age.
            </ThemedText>
          </ThemedView>
          </FadeInUp>

          {selected && (
            <FadeInUp delay={0}>
            <ThemedView type="surface" style={[styles.card, CardShadow]}>
              {selPct && nhanes ? (
                <Distribution
                  label={ANALYTE_LABELS[selected]}
                  unit={nhanes.units[selected]}
                  pct={selPct}
                  value={result.inputs[selected]}
                  imputed={result.imputed.includes(selected)}
                  source={nhanes.source}
                />
              ) : (
                <ThemedText type="small" themeColor="textMuted">
                  No NHANES distribution for {ANALYTE_LABELS[selected]} in this band.
                </ThemedText>
              )}
              <ThemedText type="small" themeColor="textSecondary">
                {result.waterfall[selected] >= 0 ? 'Adds' : 'Removes'} {Math.abs(result.waterfall[selected]).toFixed(1)} years
                relative to the reference value of {data?.reference_by_age_sex[sex]?.[result.ageBand]?.[selected]}{' '}
                {nhanes?.units[selected]}.
              </ThemedText>
            </ThemedView>
            </FadeInUp>
          )}

          {markers < 9 && (
            <FadeInUp delay={0}>
            <ThemedView type="surfaceRaised" style={styles.card}>
              <ThemedText type="smallBold">Complete your clock</ThemedText>
              {complete && complete.order.length > 0 ? (
                <>
                  {complete.order.map((o) => (
                    <ThemedText key={o.name} type="small" themeColor="textSecondary">
                      {o.panel}: {o.name} (covers {o.covers.join(', ')}){o.fasting ? ', fasting' : ''}. Reference price ${o.dtc_usd[0]}-$
                      {o.dtc_usd[1]}.
                    </ThemedText>
                  ))}
                  <ThemedText type="small" themeColor="textMuted">
                    {complete.where.join(' · ')}. {complete.label}.
                  </ThemedText>
                </>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  Add {result.imputed.map((a) => ANALYTE_LABELS[a]).join(', ')} from your next draw to read all nine markers.
                </ThemedText>
              )}
              {complete?.retest_date && (
                <ThemedText type="small" themeColor="textMuted">
                  Re-test around {complete.retest_date}. {complete.retest_rule}.
                </ThemedText>
              )}
              {complete?.fasting_action && (
                <ThemedText type="small" themeColor="textMuted">
                  {complete.fasting_action}
                </ThemedText>
              )}
            </ThemedView>
            </FadeInUp>
          )}

          <FadeInUp delay={140}>
          <AnimatedPressable style={styles.submit} onPress={() => router.replace('/(tabs)/labs')}>
            <ThemedText type="smallBold" themeColor="accentText">
              Back to the report
            </ThemedText>
          </AnimatedPressable>
          <AnimatedPressable style={styles.linkButton} onPress={() => router.replace('/(tabs)')}>
            <ThemedText type="smallBold" themeColor="accent">
              See it on Home
            </ThemedText>
          </AnimatedPressable>
          </FadeInUp>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  scrollOuter: { flex: 1, width: '100%' },
  scroll: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.four,
  },
  card: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  clockRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.three },
  bigNumber: { fontSize: 64, lineHeight: 68 },
  clockMeta: { paddingBottom: Spacing.two, gap: Spacing.half, flex: 1 },
  submit: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  linkButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
