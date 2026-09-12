import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Wordmark } from '@/components/wordmark';
import { CardShadow, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { api, hasToken, type ClockOut, type CoachContext, type Lever, type Nudge } from '@/lib/api';
import { useLocalClocks, type LocalClock } from '@/state/clock-store';

/**
 * Home: the clock (PhenoAge if labs, else fitness age) with its band; the levers ledger from
 * risk_years.json; today's one nudge; the distancing / active state. docs/lanes/C.md Block 2.
 *
 * Numbers: the clock is what C computed from A's exports (phenoage.ts / fitness-age.ts), either
 * stored by the API (`/coach/context`, `POST /clock`) or kept on this device (clock-store). Lever
 * years are rows of risk_years.json, served by the API when the user's answers decide them, or
 * read from /engine/risk_years.json as an unassessed ledger when there is no session. Nudge and
 * state come from the circle summary (B's thresholds; D's stand-in until social/ lands).
 */

type ClockRow = ClockOut & { delta_years: number | null; show: boolean };

interface ClockView {
  kind: 'phenoage' | 'fitness';
  years: number;
  band: number | null;
  chronologicalAge: number | null;
  imputed: string[];
  show: boolean;
}

const RISK_LABEL = 'Risk-equivalent years, if sustained, population estimate';

/** What an unassessed lever is waiting on (risk_years.json condition variables), and where to get it. */
const NEEDS: Record<string, { text: string; href: '/onboarding' | '/start' | '/circle' }> = {
  lonely: { text: 'the loneliness question', href: '/onboarding' },
  lives_alone: { text: 'whether you live alone', href: '/onboarding' },
  sleep_h: { text: 'your usual hours of sleep', href: '/onboarding' },
  smoker: { text: 'the smoking question', href: '/onboarding' },
  vo2max: { text: 'a fitness age (ten seconds)', href: '/start' },
  lsns_proxy: { text: 'a connected inbox or chat export', href: '/circle' },
};

function humanize(exposure: string): string {
  const s = exposure.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isClockRow(v: unknown): v is ClockRow {
  return typeof v === 'object' && v !== null && 'years' in v && 'show' in v;
}

function fromApi(row: ClockRow, kind: ClockView['kind']): ClockView {
  const imputed = (row.inputs?.imputed as string[] | undefined) ?? [];
  return {
    kind,
    years: row.years,
    band: row.band ?? null,
    chronologicalAge: row.chronological_age ?? null,
    imputed,
    show: row.show,
  };
}

function fromLocal(c: LocalClock): ClockView {
  return { kind: c.clock, years: c.years, band: c.band, chronologicalAge: c.chronologicalAge, imputed: c.imputed ?? [], show: true };
}

export default function HomeScreen() {
  const local = useLocalClocks();
  const [context, setContext] = useState<CoachContext | null>(null);
  const [ledger, setLedger] = useState<Lever[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    if (hasToken()) {
      try {
        setContext(await api.coachContext());
        setOffline(false);
        setLoading(false);
        return;
      } catch {
        setOffline(true);
      }
    }
    try {
      const res = await fetch('/engine/risk_years.json');
      if (res.ok) setLedger((await res.json()) as Lever[]);
    } catch {
      // the ledger card explains itself when empty
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // PhenoAge if labs exist, else fitness age. API rows first, then what this device computed.
  const apiPheno = isClockRow(context?.clock.phenoage) ? fromApi(context!.clock.phenoage as ClockRow, 'phenoage') : null;
  const apiFitness = isClockRow(context?.clock.fitness) ? fromApi(context!.clock.fitness as ClockRow, 'fitness') : null;
  const clock: ClockView | null =
    apiPheno ?? (local.phenoage ? fromLocal(local.phenoage) : null) ?? apiFitness ?? (local.fitness ? fromLocal(local.fitness) : null);
  const critical = context?.flags.critical ?? false;
  const labels = (context?.clock.labels as { estimate?: string; critical?: string; imputed?: string } | undefined) ?? {};

  const circle = context?.circle;
  const circleAvailable = circle?.available === true;
  const alerts = circleAvailable ? circle.alerts : [];
  const nudge: Nudge | null = context?.today.nudge ?? null;
  const caffeine = context?.today.caffeine ?? null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scrollOuter}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={Colors.accent} />}>
          <View style={styles.hero}>
            <Wordmark size="large" />
            <ThemedText type="default" themeColor="textSecondary" style={styles.tagline}>
              Know your biological age. Know your circle. Then move both.
            </ThemedText>
          </View>

          <View style={styles.divider} />

          <View style={styles.headerRow}>
            <ThemedText type="subtitle">Today</ThemedText>
            {circleAvailable && (
              <StatePill state={alerts.includes('distancing') ? 'distancing' : alerts.includes('active') ? 'active' : 'steady'} />
            )}
          </View>

          {offline && (
            <ThemedText type="small" themeColor="silence">
              Could not reach the API. Showing what this device computed.
            </ThemedText>
          )}

          <ClockCard clock={clock} critical={critical} labels={labels} />

          <NudgeCard nudge={nudge} circleAvailable={circleAvailable} hasSession={context !== null} />

          {caffeine?.last_coffee_by && (
            <ThemedView type="surfaceRaised" style={styles.line}>
              <ThemedText type="small">
                Last coffee by <ThemedText type="smallBold">{caffeine.last_coffee_by}</ThemedText>
                {caffeine.bedtime ? ` for a ${caffeine.bedtime} bedtime` : ''}.
              </ThemedText>
              <ThemedText type="small" themeColor="textMuted">
                {caffeine.dose_assumption ? `${caffeine.dose_assumption}. ` : ''}Source: {caffeine.source}.
              </ThemedText>
            </ThemedView>
          )}

          <LeversLedger active={context?.levers ?? null} unknown={context?.levers_unknown ?? null} ledger={ledger} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function StatePill({ state }: { state: 'distancing' | 'active' | 'steady' }) {
  const color = state === 'distancing' ? Colors.silence : state === 'active' ? Colors.connection : Colors.textMuted;
  const text = state === 'distancing' ? 'Distancing' : state === 'active' ? 'Active' : 'Steady';
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <View style={[styles.pillDot, { backgroundColor: color }]} />
      <ThemedText type="smallBold" style={{ color }}>
        {text}
      </ThemedText>
    </View>
  );
}

function ClockCard({
  clock,
  critical,
  labels,
}: {
  clock: ClockView | null;
  critical: boolean;
  labels: { estimate?: string; critical?: string; imputed?: string };
}) {
  const estimate = labels.estimate ?? 'Estimate, not diagnosis';

  if (critical || (clock && !clock.show)) {
    return (
      <ThemedView type="surface" style={[styles.card, CardShadow]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Biological age
        </ThemedText>
        <ThemedText type="subtitle" themeColor="critical">
          {labels.critical ?? 'See a clinician first'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          One of your lab values is outside the range this clock can be read in. The age number is hidden until a clinician
          has seen the report.
        </ThemedText>
        <Link href="/labs" asChild>
          <Pressable style={styles.secondaryButton}>
            <ThemedText type="smallBold" themeColor="accent">
              Review the report
            </ThemedText>
          </Pressable>
        </Link>
      </ThemedView>
    );
  }

  if (!clock) {
    return (
      <ThemedView type="surface" style={[styles.card, CardShadow]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Your clock
        </ThemedText>
        <ThemedText type="default">No clock yet. Ten seconds for a fitness age, or upload a blood panel for PhenoAge.</ThemedText>
        <View style={styles.row}>
          <Link href="/start" asChild>
            <Pressable style={styles.primaryButton}>
              <ThemedText type="smallBold" themeColor="accentText">
                Fitness age in ten seconds
              </ThemedText>
            </Pressable>
          </Link>
          <Link href="/labs" asChild>
            <Pressable style={styles.secondaryButton}>
              <ThemedText type="smallBold" themeColor="accent">
                Upload labs
              </ThemedText>
            </Pressable>
          </Link>
        </View>
        <ThemedText type="small" themeColor="textMuted">
          {estimate}.
        </ThemedText>
      </ThemedView>
    );
  }

  const isPheno = clock.kind === 'phenoage';
  const years = Math.round(clock.years);
  const delta = clock.chronologicalAge !== null ? years - Math.round(clock.chronologicalAge) : null;
  const deltaText =
    delta === null
      ? null
      : delta === 0
        ? 'the same as your calendar age'
        : `${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'year' : 'years'} ${delta < 0 ? 'younger' : 'older'} than your calendar age`;
  const markers = 9 - clock.imputed.length;

  return (
    <ThemedView type="surface" style={[styles.card, CardShadow]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {isPheno ? 'Biological age (PhenoAge, Levine 2018)' : 'Fitness age (HUNT)'}
      </ThemedText>
      <View style={styles.clockRow}>
        <ThemedText type="numeric" style={styles.bigNumber}>
          {years}
        </ThemedText>
        <View style={styles.clockMeta}>
          {clock.band !== null && (
            <ThemedText type="small" themeColor="textSecondary">
              +/- {Math.round(clock.band)} years
            </ThemedText>
          )}
          {deltaText && (
            <ThemedText type="small" themeColor={delta !== null && delta < 0 ? 'connection' : delta ? 'silence' : 'textSecondary'}>
              {deltaText}
            </ThemedText>
          )}
        </View>
      </View>
      {isPheno && clock.imputed.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          {labels.imputed ?? `${markers} of 9 markers`} ({clock.imputed.map(humanize).join(', ')} imputed).{' '}
          <Link href="/labs">
            <ThemedText type="smallBold" themeColor="accent">
              Complete your clock
            </ThemedText>
          </Link>
        </ThemedText>
      )}
      {!isPheno && (
        <ThemedText type="small" themeColor="textSecondary">
          Upload a blood panel to switch this to PhenoAge, which reads nine analytes.{' '}
          <Link href="/labs">
            <ThemedText type="smallBold" themeColor="accent">
              Upload labs
            </ThemedText>
          </Link>
        </ThemedText>
      )}
      <ThemedText type="small" themeColor="textMuted">
        {estimate}.
      </ThemedText>
    </ThemedView>
  );
}

function NudgeCard({ nudge, circleAvailable, hasSession }: { nudge: Nudge | null; circleAvailable: boolean; hasSession: boolean }) {
  return (
    <ThemedView type="surface" style={[styles.card, CardShadow]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        Today&apos;s nudge
      </ThemedText>
      {nudge ? (
        <>
          <ThemedText type="default">{nudge.text}</ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            Overdue by your own rhythm: usually every {nudge.medianGapDays} days, now {nudge.daysSince} days. Contact names never
            leave your phone; this one is a hash.
          </ThemedText>
          <Link href="/circle" asChild>
            <Pressable style={styles.primaryButton}>
              <ThemedText type="smallBold" themeColor="accentText">
                Open your circle
              </ThemedText>
            </Pressable>
          </Link>
        </>
      ) : circleAvailable ? (
        <ThemedText type="default" themeColor="textSecondary">
          Nothing overdue today. Every tie is inside its usual rhythm.
        </ThemedText>
      ) : (
        <>
          <ThemedText type="default" themeColor="textSecondary">
            {hasSession
              ? 'Connect an inbox or a chat export to see who is drifting.'
              : 'Sign in and connect an inbox or a chat export to see who is drifting.'}
          </ThemedText>
          <Link href={hasSession ? '/circle' : '/onboarding'} asChild>
            <Pressable style={styles.secondaryButton}>
              <ThemedText type="smallBold" themeColor="accent">
                {hasSession ? 'Open your circle' : 'Get started'}
              </ThemedText>
            </Pressable>
          </Link>
        </>
      )}
    </ThemedView>
  );
}

function LeversLedger({
  active,
  unknown,
  ledger,
}: {
  active: Lever[] | null;
  unknown: { exposure: string; needs: string }[] | null;
  ledger: Lever[] | null;
}) {
  const assessed = active !== null;
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        Levers
      </ThemedText>
      <ThemedText type="small" themeColor="textMuted">
        {RISK_LABEL}. Years = 8 x log2(hazard ratio), the Gompertz mortality doubling time.
      </ThemedText>

      {assessed && active.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          No lever is costing you years right now.
        </ThemedText>
      )}

      <View style={styles.chips}>
        {assessed &&
          active.map((row) => (
            <ThemedView key={row.exposure} type="surface" style={[styles.chip, styles.chipActive]}>
              <View style={styles.chipHead}>
                <ThemedText type="smallBold">{humanize(row.exposure)}</ThemedText>
                <ThemedText type="smallBold" themeColor="silence" style={styles.tabular}>
                  {row.years > 0 ? '+' : ''}
                  {row.years} y
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textMuted">
                {row.source}. HR {row.hr}. If sustained.
              </ThemedText>
            </ThemedView>
          ))}

        {assessed &&
          (unknown ?? []).map((row) => (
            <ThemedView key={row.exposure} type="surfaceRaised" style={styles.chip}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {humanize(row.exposure)}
              </ThemedText>
              <ThemedText type="small" themeColor="textMuted">
                Needs {NEEDS[row.needs]?.text ?? humanize(row.needs).toLowerCase()}.{' '}
                <Link href={NEEDS[row.needs]?.href ?? '/onboarding'}>
                  <ThemedText type="smallBold" themeColor="accent">
                    {NEEDS[row.needs]?.href === '/onboarding' || !NEEDS[row.needs] ? 'Answer' : 'Add it'}
                  </ThemedText>
                </Link>
              </ThemedText>
            </ThemedView>
          ))}

        {!assessed &&
          (ledger ?? []).map((row) => (
            <ThemedView key={row.exposure} type="surfaceRaised" style={styles.chip}>
              <View style={styles.chipHead}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {humanize(row.exposure)}
                </ThemedText>
                <ThemedText type="smallBold" themeColor="textMuted" style={styles.tabular}>
                  {row.years > 0 ? '+' : ''}
                  {row.years} y
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textMuted">
                {row.source}. Applies when {row.condition}. Not assessed yet.
              </ThemedText>
            </ThemedView>
          ))}
      </View>

      {!assessed && (
        <ThemedText type="small" themeColor="textSecondary">
          Sign in and answer the onboarding questions to see which of these apply to you.{' '}
          <Link href="/onboarding">
            <ThemedText type="smallBold" themeColor="accent">
              Get started
            </ThemedText>
          </Link>
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  scrollOuter: { flex: 1, width: '100%', alignItems: 'center' },
  scroll: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.four,
  },
  hero: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.three },
  tagline: { textAlign: 'center', maxWidth: 340 },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    width: '100%',
    marginVertical: Spacing.two,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  card: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  clockRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.three },
  bigNumber: { fontSize: 64, lineHeight: 68 },
  clockMeta: { paddingBottom: Spacing.two, gap: Spacing.half },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  line: {
    borderRadius: Radius.medium,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  section: { gap: Spacing.two },
  chips: { gap: Spacing.two },
  chip: {
    borderRadius: Radius.medium,
    padding: Spacing.three,
    gap: Spacing.half,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: { borderColor: Colors.silence },
  chipHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  tabular: { fontVariant: ['tabular-nums'] },
});
