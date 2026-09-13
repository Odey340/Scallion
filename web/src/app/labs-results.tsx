import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedPressable, FadeInUp } from '@/components/animated';
import { LabsResultsPanel, type NhanesPercentiles } from '@/components/labs-results-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { type AnalyteKey, type PhenoAgeData } from '@/engine/phenoage';
import { useLabs } from '@/state/labs-store';

/**
 * Standalone results route, kept for direct navigation/back-compat. The Labs tab itself now
 * shows this inline (src/components/labs-results-panel.tsx) in a split view instead of routing
 * here — see docs/lanes/C.md Block 3.
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
  if (!result || labs.age === null || !labs.sex || !data) {
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scroll}>
          <LabsResultsPanel
            age={labs.age}
            sex={labs.sex}
            fasting={labs.fasting}
            result={result}
            data={data}
            nhanes={nhanes}
            complete={labs.extract?.complete ?? null}
            selected={selected}
            onSelect={setSelected}
          />

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
  submit: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  linkButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
