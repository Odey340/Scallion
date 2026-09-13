import { Link, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedNumber, AnimatedPressable, FadeInUp } from '@/components/animated';
import { ThemedText } from '@/components/themed-text';
import { ANALYTE_LABELS } from '@/components/waterfall';
import { Wordmark } from '@/components/wordmark';
import { cupLabel, formatClock } from '@/constants/profile-options';
import { Colors, Fonts, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { lastCoffeeHoursBeforeBed, subtractHours, type CaffeineData } from '@/engine/caffeine';
import { ANALYTES, type PhenoAgeData, type Sex } from '@/engine/phenoage';
import { parseStoredInputs, rebuildDrivers, type Drivers } from '@/engine/phenoage-drivers';
import { api, hasToken, type ClockOut, type CoachContext, type Nudge } from '@/lib/api';
import { formatBand, formatDay, formatSigned, formatYears } from '@/lib/format';
import { useLocalClocks, type LocalClock } from '@/state/clock-store';
import { missingFields, PROFILE_FEATURES, useProfile, type UserProfile } from '@/state/profile-store';

/**
 * Home, in the order a person asks: how am I doing (the clock), why (what moved it), what can I do
 * today (one action), then tonight's coffee line and the state of their data. docs/lanes/C.md Block 2.
 *
 * Numbers: the clock is what C computed from A's exports (phenoage.ts / fitness-age.ts), stored by
 * the API (`/coach/context`) or on this device (clock-store). "What moved it" is the same PhenoAge
 * waterfall Labs shows, rebuilt from the stored inputs by the same function and checked against the
 * stored age (engine/phenoage-drivers.ts). The coffee line runs caffeine.json's rule on the profile.
 * The nudge and circle state come from the circle summary.
 *
 * Visual language on this screen only (docs/log/C.md — visual redesign pass): a warm-paper ground,
 * an ink headline color, and thin rules in place of the boxed/shadowed cards used elsewhere in the
 * app — a small, deliberate departure scoped to Home, reusing the app's own blue/green/red semantics
 * so navigating to another tab still reads as the same product.
 */

const WIDE = 960;

// Home-only palette. Deliberately not added to constants/theme.ts: the redesign brief scoped this
// pass to Home, and every other screen keeps its existing look. The accent blue and the
// connection/silence green & red are the app's own (Colors.accent/.connection/.silence) — kept
// as-is everywhere below, so Home still feels like the same product once you tap to another tab.
const Paper = {
  ground: '#FBFAF7',
  ink: '#141C2C',
  hairline: '#E4E0D6',
  muted: '#6B6558',
} as const;

type ClockRow = ClockOut & { delta_years: number | null; show: boolean };

interface ClockView {
  kind: 'phenoage' | 'fitness';
  years: number;
  band: number | null;
  chronologicalAge: number | null;
  imputed: string[];
  show: boolean;
  inputs: unknown;
  sex: Sex | null;
  computedAt: string | null;
}

function isClockRow(v: unknown): v is ClockRow {
  return typeof v === 'object' && v !== null && 'years' in v && 'show' in v;
}

function fromApi(row: ClockRow, kind: ClockView['kind']): ClockView {
  const inputs = row.inputs ?? null;
  const sex = inputs && (inputs.sex === 'M' || inputs.sex === 'F') ? inputs.sex : null;
  return {
    kind,
    years: row.years,
    band: row.band ?? null,
    chronologicalAge: row.chronological_age ?? null,
    imputed: (inputs?.imputed as string[] | undefined) ?? [],
    show: row.show,
    inputs,
    sex,
    computedAt: row.computed_at ?? null,
  };
}

function fromLocal(c: LocalClock): ClockView {
  return {
    kind: c.clock,
    years: c.years,
    band: c.band,
    chronologicalAge: c.chronologicalAge,
    imputed: c.imputed ?? [],
    show: true,
    inputs: c.inputs ?? null,
    sex: c.sex ?? null,
    computedAt: c.computedAt,
  };
}

export default function HomeScreen() {
  const local = useLocalClocks();
  const profile = useProfile();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;

  const [context, setContext] = useState<CoachContext | null>(null);
  const [loading, setLoading] = useState(hasToken());
  const [offline, setOffline] = useState(false);
  const [pheno, setPheno] = useState<PhenoAgeData | null>(null);
  const [caffeine, setCaffeine] = useState<CaffeineData | null>(null);

  const load = useCallback(async () => {
    if (!hasToken()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setContext(await api.coachContext());
      setOffline(false);
    } catch {
      setOffline(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    fetch('/engine/caffeine.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setCaffeine)
      .catch(() => undefined);
  }, [load]);

  // PhenoAge if labs exist, else fitness age. API rows first, then what this device computed.
  const apiPheno = isClockRow(context?.clock.phenoage) ? fromApi(context!.clock.phenoage as ClockRow, 'phenoage') : null;
  const apiFitness = isClockRow(context?.clock.fitness) ? fromApi(context!.clock.fitness as ClockRow, 'fitness') : null;
  const clock: ClockView | null =
    apiPheno ?? (local.phenoage ? fromLocal(local.phenoage) : null) ?? apiFitness ?? (local.fitness ? fromLocal(local.fitness) : null);
  const critical = context?.flags.critical ?? false;
  const labels = (context?.clock.labels as { estimate?: string; critical?: string; imputed?: string } | undefined) ?? {};

  useEffect(() => {
    if (clock?.kind !== 'phenoage' || pheno) return;
    fetch('/engine/phenoage.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setPheno)
      .catch(() => undefined);
  }, [clock?.kind, pheno]);

  const drivers: Drivers | null = useMemo(() => {
    if (!clock || clock.kind !== 'phenoage' || !pheno || clock.chronologicalAge === null) return null;
    const sex = clock.sex ?? profile.sex ?? null;
    const stored = parseStoredInputs(clock.inputs, clock.imputed);
    if (!sex || !stored) return null;
    return rebuildDrivers(stored, clock.chronologicalAge, sex, clock.years, pheno);
  }, [clock, pheno, profile.sex]);

  const circle = context?.circle;
  const circleAvailable = circle?.available === true;
  const alerts = circleAvailable ? circle.alerts : [];
  const nudge: Nudge | null = context?.today.nudge ?? null;

  const coffee = useMemo(() => coffeeLine(profile, caffeine, context), [profile, caffeine, context]);
  const firstVisit = !clock && !critical && !loading;

  const main = (
    <View style={styles.column}>
      {firstVisit ? (
        <FadeInUp delay={0}>
          <Welcome />
        </FadeInUp>
      ) : (
        <>
          <FadeInUp delay={0} style={styles.todayRow}>
            <ThemedText type="small" style={styles.sectionLabel}>
              Today
            </ThemedText>
            {circleAvailable && <StatePill state={alerts.includes('distancing') ? 'distancing' : alerts.includes('active') ? 'active' : 'steady'} />}
          </FadeInUp>
          {offline && (
            <ThemedText type="small" themeColor="textSecondary">
              Scallion&apos;s server couldn&apos;t be reached. Showing results saved on this device.
            </ThemedText>
          )}
          <FadeInUp delay={60}>
            <ClockHero clock={clock} critical={critical} labels={labels} loading={loading} source={pheno?.source} />
          </FadeInUp>
          {clock && !critical && clock.show && clock.kind === 'phenoage' && drivers && clock.chronologicalAge !== null && (
            <FadeInUp delay={120}>
              <DriversSection drivers={drivers} age={clock.chronologicalAge} sex={clock.sex ?? profile.sex ?? null} years={clock.years} />
            </FadeInUp>
          )}
        </>
      )}
    </View>
  );

  const side = (
    <View style={styles.column}>
      <FadeInUp delay={160}>
        <Section title="Today's move">
          <TodaysMove nudge={nudge} circleAvailable={circleAvailable} />
        </Section>
      </FadeInUp>
      <FadeInUp delay={200}>
        <Section title="Tonight">
          <Tonight coffee={coffee} />
        </Section>
      </FadeInUp>
      <FadeInUp delay={240}>
        <Section title="Your data">
          <YourData clock={clock} context={context} circleAvailable={circleAvailable} profile={profile} />
        </Section>
      </FadeInUp>
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scrollOuter}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={Colors.accent} />}>
          <View style={[styles.page, wide && styles.pageWide]}>
            {wide ? (
              <View style={styles.columns}>
                <View style={styles.mainCol}>{main}</View>
                <View style={styles.sideCol}>{side}</View>
              </View>
            ) : (
              <>
                {main}
                {side}
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const PILLARS: { key: string; label: string; image: number }[] = [
  { key: 'labs', label: 'Biological age', image: require('@/assets/images/scallion/labs-blood-sample.jpg') },
  { key: 'fitness', label: 'Fitness', image: require('@/assets/images/scallion/fitness-activity-watch.jpg') },
  { key: 'circle', label: 'Circle', image: require('@/assets/images/scallion/circle-friends.jpg') },
];

function Welcome() {
  return (
    <View style={styles.welcome}>
      <Wordmark size="large" linkToHome={false} />
      <ThemedText type="default" style={styles.welcomeTagline}>
        Know your biological age. Know your circle. Then move both.
      </ThemedText>

      <View style={styles.triptych}>
        {PILLARS.map((p) => (
          <View key={p.key} style={styles.triptychItem}>
            <View style={styles.triptychFrame}>
              <Image source={p.image} style={styles.triptychPhoto} resizeMode="cover" accessibilityLabel={p.label} />
            </View>
            <ThemedText type="small" style={styles.triptychLabel}>
              {p.label}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.welcomeActions}>
        <LinkButton href="/start" primary>
          Fitness age in ten seconds
        </LinkButton>
        <LinkButton href="/labs">Upload labs or try a sample</LinkButton>
      </View>
      <ThemedText type="small" style={styles.welcomeFootnote}>
        Estimate, not diagnosis. Nothing is required up front — Scallion only asks for what a feature needs.
      </ThemedText>
    </View>
  );
}

function StatePill({ state }: { state: 'distancing' | 'active' | 'steady' }) {
  const color = state === 'distancing' ? Colors.silence : state === 'active' ? Colors.connection : Paper.muted;
  const text = state === 'distancing' ? 'Circle: distancing' : state === 'active' ? 'Circle: active' : 'Circle: steady';
  return (
    <View style={styles.pill}>
      <View style={[styles.pillDot, { backgroundColor: color }]} />
      <ThemedText type="small" style={{ color }}>
        {text}
      </ThemedText>
    </View>
  );
}

function ClockHero({
  clock,
  critical,
  labels,
  loading,
  source,
}: {
  clock: ClockView | null;
  critical: boolean;
  labels: { estimate?: string; critical?: string; imputed?: string };
  loading: boolean;
  source?: string;
}) {
  const estimate = labels.estimate ?? 'Estimate, not diagnosis';

  if (critical || (clock && !clock.show)) {
    return (
      <View style={styles.hero}>
        <ThemedText type="small" style={styles.sectionLabel}>
          Biological age
        </ThemedText>
        <ThemedText type="subtitle" themeColor="critical">
          {labels.critical ?? 'See a clinician first'}
        </ThemedText>
        <ThemedText type="small" style={styles.mutedText}>
          One of your lab values is outside the range this clock can be read in. The age number is hidden until a clinician has
          seen the report.
        </ThemedText>
        <LinkButton href="/labs">Review the report</LinkButton>
      </View>
    );
  }

  if (!clock) {
    return (
      <View style={styles.hero}>
        <ThemedText type="small" style={styles.sectionLabel}>
          Your clock
        </ThemedText>
        {loading ? (
          <ThemedText type="default" style={styles.mutedText}>
            Loading your results…
          </ThemedText>
        ) : (
          <>
            <ThemedText type="default" style={styles.heroBody}>
              A fitness age from your age, waist, resting pulse and activity takes about ten seconds. A blood panel gives
              PhenoAge instead.
            </ThemedText>
            <View style={styles.row}>
              <LinkButton href="/start" primary>
                Fitness age in ten seconds
              </LinkButton>
              <LinkButton href="/labs">Upload labs</LinkButton>
            </View>
          </>
        )}
      </View>
    );
  }

  const isPheno = clock.kind === 'phenoage';
  const chrono = clock.chronologicalAge;
  const diff = chrono !== null ? clock.years - chrono : null;
  const markers = ANALYTES.length - clock.imputed.length;

  let interpretation: string | null = null;
  if (diff !== null && chrono !== null) {
    if (clock.band !== null && Math.abs(diff) <= clock.band) {
      interpretation = `Within the ${formatBand(clock.band)} uncertainty of your calendar age`;
    } else {
      const n = Math.round(Math.abs(diff));
      interpretation = `${n} ${n === 1 ? 'year' : 'years'} ${diff < 0 ? 'younger' : 'older'} than your calendar age`;
    }
  }

  return (
    <View style={styles.hero}>
      <ThemedText type="small" style={styles.sectionLabel}>
        {isPheno ? 'Biological age — PhenoAge' : 'Fitness age'}
      </ThemedText>
      <View style={styles.bigRow}>
        <AnimatedNumber value={Math.round(clock.years)} type="numeric" style={styles.bigNumber} duration={900} />
        <ThemedText type="default" style={styles.bigUnit}>
          years
        </ThemedText>
      </View>
      <ThemedText type="small" style={[styles.mutedText, styles.tabular]}>
        {[clock.band !== null ? formatBand(clock.band) : null, chrono !== null ? `calendar age ${Math.round(chrono)}` : null]
          .filter(Boolean)
          .join(' · ')}
      </ThemedText>
      {interpretation && (
        <ThemedText type="smallBold" style={styles.interpretation}>
          {interpretation}
        </ThemedText>
      )}

      {isPheno && clock.imputed.length > 0 && (
        <ThemedText type="small" style={styles.mutedText}>
          {labels.imputed && clock.imputed.length === 1 ? labels.imputed : `${markers} of ${ANALYTES.length} markers`} —{' '}
          {clock.imputed.map((k) => ANALYTE_LABELS[k as keyof typeof ANALYTE_LABELS] ?? k).join(', ')} filled from the reference for your age
          and sex, which widens the range.{' '}
          <Link href="/labs">
            <ThemedText type="smallBold" themeColor="accent">
              Complete your clock
            </ThemedText>
          </Link>
        </ThemedText>
      )}
      {!isPheno && (
        <ThemedText type="small" style={styles.mutedText}>
          From the HUNT fitness model. A blood panel switches this to PhenoAge, which reads nine markers.{' '}
          <Link href="/labs">
            <ThemedText type="smallBold" themeColor="accent">
              Upload labs
            </ThemedText>
          </Link>
        </ThemedText>
      )}

      <ThemedText type="small" style={styles.footnote}>
        {estimate}.{isPheno ? ` ${source ?? 'Levine et al. 2018'}.` : ''}
        {clock.computedAt ? ` Computed ${formatDay(clock.computedAt)}.` : ''}
      </ThemedText>
    </View>
  );
}

function DriversSection({ drivers, age, sex, years }: { drivers: Drivers; age: number; sex: Sex | null; years: number }) {
  const top = drivers.analytes.filter((d) => Math.abs(d.years) >= 0.05).slice(0, 4);
  const max = Math.max(...top.map((d) => Math.abs(d.years)), 0.1);
  const markerSum = drivers.total - age - drivers.cohortOffset;
  const who = `${Math.round(age)}-year-old ${sex === 'F' ? 'woman' : sex === 'M' ? 'man' : 'person'}`;

  return (
    <Section title="What is moving it">
      <ThemedText type="small" style={styles.mutedText}>
        Years each marker adds or takes away compared with the NHANES reference for a {who}.
      </ThemedText>
      {top.length === 0 ? (
        <ThemedText type="small" style={styles.mutedText}>
          Every marker is within 0.05 years of the reference.
        </ThemedText>
      ) : (
        <View style={styles.drivers}>
          {top.map((d) => {
            const adds = d.years > 0;
            return (
              <View key={d.key} style={styles.driverRow} accessibilityLabel={`${ANALYTE_LABELS[d.key]} ${adds ? 'adds' : 'takes away'} ${Math.abs(d.years).toFixed(1)} years${d.imputed ? ', imputed' : ''}`}>
                <ThemedText type="small" style={styles.driverName}>
                  {ANALYTE_LABELS[d.key]}
                  {d.imputed ? <ThemedText type="small" style={styles.mutedText}> (imputed)</ThemedText> : null}
                </ThemedText>
                <View style={styles.driverBarTrack}>
                  <View
                    style={[
                      styles.driverBar,
                      { width: `${(Math.abs(d.years) / max) * 100}%`, backgroundColor: adds ? Colors.silence : Colors.connection },
                    ]}
                  />
                </View>
                <ThemedText type="smallBold" style={styles.driverValue}>
                  {formatSigned(d.years)} yr
                </ThemedText>
              </View>
            );
          })}
        </View>
      )}
      <ThemedText type="small" style={[styles.footnote, styles.tabular]}>
        Calendar age {age.toFixed(1)} {formatSigned(drivers.cohortOffset)} reference offset {formatSigned(markerSum)} from all nine
        markers = {formatYears(years)}.
      </ThemedText>
      <LinkButton href="/labs">See all nine markers in Labs</LinkButton>
    </Section>
  );
}

function TodaysMove({ nudge, circleAvailable }: { nudge: Nudge | null; circleAvailable: boolean }) {
  if (nudge) {
    return (
      <>
        <ThemedText type="default" style={styles.sideBody}>{nudge.text}</ThemedText>
        <ThemedText type="small" style={[styles.mutedText, styles.tabular]}>
          You usually talk every {nudge.medianGapDays} days; it has been {nudge.daysSince}.
        </ThemedText>
        <ThemedText type="small" style={styles.footnote}>
          Names never leave your phone; the server only knows a hashed contact.
        </ThemedText>
        <LinkButton href="/circle" primary>
          Open your circle
        </LinkButton>
      </>
    );
  }
  if (circleAvailable) {
    return (
      <ThemedText type="default" style={styles.sideBody}>
        Nothing overdue today. Everyone you talk to regularly is inside their usual rhythm.
      </ThemedText>
    );
  }
  return (
    <>
      <ThemedText type="default" style={styles.sideBody}>
        Connect an inbox or a chat export and Scallion will flag a friendship before it goes quiet. Only message metadata is used.
      </ThemedText>
      <LinkButton href="/circle">Open Circle</LinkButton>
    </>
  );
}

interface CoffeeLine {
  byClock: string | null;
  hoursBefore: number;
  detail: string;
  basis: string;
  source: string | null;
}

/** The profile's usual cup and bedtime through caffeine.json's rule; the server's line only as a fallback. */
function coffeeLine(p: UserProfile, c: CaffeineData | null, context: CoachContext | null): CoffeeLine | null {
  if (c && p.coffee_mg_per_cup !== undefined && p.bedtime) {
    const smoker = p.smoker ?? false;
    const oc = p.oral_contraceptive ?? false;
    const hoursBefore = lastCoffeeHoursBeforeBed(p.coffee_mg_per_cup, { smoker, oralContraceptive: oc }, c);
    const halfLife = c.half_life_h * (smoker ? c.modifiers.smoker : 1) * (oc ? c.modifiers.oral_contraceptive : 1);
    return {
      byClock: hoursBefore > 0 ? formatClock(subtractHours(p.bedtime, hoursBefore)) : null,
      hoursBefore,
      detail: `${cupLabel(p.coffee_mg_per_cup)} · bed ${formatClock(p.bedtime)}`,
      basis: `Leaves under ${c.bedtime_threshold_mg} mg by bedtime, using a ${Number(halfLife.toFixed(1))} h caffeine half-life${
        smoker || oc ? ` (adjusted for ${[smoker ? 'smoking' : null, oc ? 'oral contraceptive' : null].filter(Boolean).join(' and ')})` : ''
      }.`,
      source: (c as CaffeineData & { source?: string }).source ?? null,
    };
  }
  const server = context?.today.caffeine;
  if (server?.last_coffee_by) {
    return {
      byClock: formatClock(server.last_coffee_by),
      hoursBefore: server.hours_before_bed,
      detail: [server.dose_assumption, server.bedtime ? `bed ${formatClock(server.bedtime)}` : null].filter(Boolean).join(' · '),
      basis: '',
      source: server.source,
    };
  }
  return null;
}

function Tonight({ coffee }: { coffee: CoffeeLine | null }) {
  if (!coffee) {
    return (
      <>
        <ThemedText type="small" style={styles.mutedText}>
          Add your usual cup and bedtime to see the latest time for a last coffee.
        </ThemedText>
        <LinkButton href="/onboarding">Add to your profile</LinkButton>
      </>
    );
  }
  return (
    <>
      {coffee.byClock ? (
        <ThemedText type="default" style={styles.sideBody}>
          Last coffee by <ThemedText type="numeric" style={styles.coffeeTime}>{coffee.byClock}</ThemedText>
        </ThemedText>
      ) : (
        <ThemedText type="default" style={styles.sideBody}>Your usual cup is already under the bedtime threshold — no cutoff needed.</ThemedText>
      )}
      {coffee.detail !== '' && (
        <ThemedText type="small" style={styles.mutedText}>
          {coffee.detail}
        </ThemedText>
      )}
      <ThemedText type="small" style={styles.footnote}>
        {coffee.basis}
        {coffee.source ? ` ${coffee.source}.` : ''}
      </ThemedText>
    </>
  );
}

function YourData({
  clock,
  context,
  circleAvailable,
  profile,
}: {
  clock: ClockView | null;
  context: CoachContext | null;
  circleAvailable: boolean;
  profile: UserProfile;
}) {
  const ready = PROFILE_FEATURES.filter((f) => missingFields(f.fields, profile).length === 0).length;
  const vitals = context?.today.vitals ?? null;
  const circle = context?.circle;
  const rows: { label: string; value: string; href: Href }[] = [
    {
      label: 'Labs',
      value:
        clock?.kind === 'phenoage'
          ? `${ANALYTES.length - clock.imputed.length} of ${ANALYTES.length} markers${clock.computedAt ? ` · ${formatDay(clock.computedAt)}` : ''}`
          : 'No blood panel yet',
      href: '/labs',
    },
    {
      label: 'Circle',
      value: circleAvailable && circle && 'metrics' in circle ? `${circle.metrics.activeTies} active connections` : 'Not connected',
      href: '/circle',
    },
    {
      label: 'Camera',
      value: vitals ? `${Math.round(vitals.pulse_bpm)} bpm resting · ${formatDay(vitals.captured_at)}` : 'No reading yet',
      href: '/camera',
    },
    { label: 'Profile', value: `${ready} of ${PROFILE_FEATURES.length} features ready`, href: '/onboarding' },
  ];
  return (
    <View>
      {rows.map((r) => (
        <Link key={r.label} href={r.href} asChild>
          <AnimatedPressable style={styles.dataRow} accessibilityRole="link" accessibilityLabel={`${r.label}: ${r.value}`}>
            <ThemedText type="small" style={styles.dataLabel}>{r.label}</ThemedText>
            <View style={styles.dataValue}>
              <ThemedText type="small" style={[styles.mutedText, styles.tabular]}>
                {r.value}
              </ThemedText>
              <ThemedText type="small" themeColor="accent">
                ›
              </ThemedText>
            </View>
          </AnimatedPressable>
        </Link>
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="small" style={styles.sectionLabel}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function LinkButton({ href, primary, children }: { href: Href; primary?: boolean; children: ReactNode }) {
  return (
    <Link href={href} asChild>
      <AnimatedPressable style={primary ? styles.primaryButton : styles.secondaryButton}>
        <ThemedText type="smallBold" themeColor={primary ? 'accentText' : 'accent'}>
          {children}
        </ThemedText>
      </AnimatedPressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Paper.ground },
  safeArea: { flex: 1, alignItems: 'center' },
  scrollOuter: { flex: 1, width: '100%' },
  scrollContent: { alignItems: 'center' },
  page: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.six,
    gap: Spacing.six,
  },
  pageWide: { maxWidth: 1080 },
  columns: { flexDirection: 'row', gap: Spacing.six, alignItems: 'flex-start' },
  mainCol: { flex: 3, minWidth: 0 },
  sideCol: { flex: 2, minWidth: 0 },
  column: { gap: Spacing.six },

  // Typography — a quiet, sentence-case section label instead of tracked-out caps; used for every
  // section heading on this screen (Today, What is moving it, Today's move, Tonight, Your data).
  sectionLabel: {
    fontFamily: Fonts.displayMedium,
    fontSize: 15,
    color: Paper.muted,
  },
  mutedText: { color: Paper.muted },
  footnote: { color: Paper.muted },
  tabular: { fontVariant: ['tabular-nums'] },

  todayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  // Welcome (first visit only) — the one place on this screen with photography; see manifest.json
  // in assets/images/scallion for where the three photos come from.
  welcome: { gap: Spacing.four, paddingTop: Spacing.two },
  welcomeTagline: { color: Paper.muted, maxWidth: 420, fontSize: 17, lineHeight: 25 },
  triptych: { flexDirection: 'row', gap: Spacing.three },
  triptychItem: { flex: 1, gap: Spacing.two },
  triptychFrame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radius.small,
    backgroundColor: Colors.surfaceRaised,
    overflow: 'hidden',
  },
  triptychPhoto: {
    width: '100%',
    height: '100%',
  },
  triptychLabel: { color: Paper.muted, textAlign: 'center' },
  welcomeActions: { gap: Spacing.two, alignItems: 'flex-start', marginTop: Spacing.two },
  welcomeFootnote: { color: Paper.muted, maxWidth: 480 },

  // The clock hero — no card, no shadow; the number is the only bold gesture on the page.
  hero: { gap: Spacing.two },
  heroBody: { color: Paper.ink, maxWidth: 440 },
  bigRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  bigNumber: { fontSize: 128, lineHeight: 128, color: Paper.ink, letterSpacing: -2 },
  bigUnit: { paddingBottom: Spacing.four, color: Paper.muted },
  interpretation: { color: Paper.ink },

  section: {
    gap: Spacing.two,
    paddingTop: Spacing.four,
    borderTopWidth: 1,
    borderTopColor: Paper.hairline,
  },
  sideBody: { color: Paper.ink },

  drivers: { gap: Spacing.three, marginVertical: Spacing.two },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  driverName: { width: 128, color: Paper.ink },
  driverBarTrack: { flex: 1, height: 3, backgroundColor: Paper.hairline, borderRadius: 1.5, overflow: 'hidden' },
  driverBar: { height: 3, borderRadius: 1.5 },
  driverValue: { width: 64, textAlign: 'right', fontVariant: ['tabular-nums'], color: Paper.ink },

  coffeeTime: { fontSize: 20, lineHeight: 24, color: Paper.ink },

  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: Paper.hairline,
  },
  dataLabel: { color: Paper.ink },
  dataValue: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },

  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
});
