import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  contactStrengths,
  hashContact,
  parseGmailHeaders,
  parseWhatsApp,
  UnsupportedChatError,
  type ContactStrength,
  type Event,
  type GmailMetadataMessage,
  type StrengthTier,
} from '@/lib/social';

import { ActivityStrip } from '@/components/activity-strip';
import { AnimatedNumber, AnimatedPressable, FadeInUp } from '@/components/animated';
import { CircleDotMap } from '@/components/circle-dot-map';
import { Disclosure } from '@/components/disclosure';
import { Field, TextField } from '@/components/form-controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Colors, Radius, Spacing } from '@/constants/theme';
import { api, ApiError, hasToken, type CircleSummary } from '@/lib/api';
import { fetchRecentMessages, requestGmailAccessToken } from '@/lib/gmail-ingest';
import { clearDeviceSalt, getOrCreateDeviceSalt } from '@/lib/salt';

const OWNER_KEY = 'scallion.owner_name';
const GMAIL_EMAIL_KEY = 'scallion.gmail_email';
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
const IS_WEB = Platform.OS === 'web';
const SPLIT_MAX_WIDTH = 1080;
const SPLIT_BREAKPOINT = 900;

const TIER_LABEL: Record<StrengthTier, string> = { close: 'Close', active: 'Active', weak: 'Weak' };
const TIER_COLOR: Record<StrengthTier, string> = { close: Colors.connection, active: Colors.accent, weak: Colors.textMuted };

interface SourceResult {
  source: 'whatsapp' | 'gmail';
  label: string;
  status: 'ok' | 'error';
  message: string;
  eventCount: number;
}

interface AdviceItem {
  contact: string;
  text: string;
}

/**
 * Turn your messages into your circle: connect Gmail (OAuth, metadata only) and/or upload
 * WhatsApp exports, both parsed to anonymized Events right here in the browser (social/), then
 * POSTed to the API for the metrics the client doesn't see (GET /circle/summary). The dot map
 * itself is computed locally from the same Events, so it still renders if the API is down.
 *
 * Layout: connection sources on the left, a live interactive circle map + relationship advice
 * on the right (stacked below on narrow screens). Tapping a dot or an advice row selects that
 * contact and cross-highlights the other side of the panel.
 */
export default function CircleScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= SPLIT_BREAKPOINT;

  const [ownerName, setOwnerName] = useState(() => (IS_WEB ? (localStorage.getItem(OWNER_KEY) ?? '') : ''));
  const [gmailEmail, setGmailEmail] = useState(() => (IS_WEB ? (localStorage.getItem(GMAIL_EMAIL_KEY) ?? '') : ''));
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailStatus, setGmailStatus] = useState<string | null>(null);

  const [whatsappEvents, setWhatsappEvents] = useState<Event[]>([]);
  const [gmailEvents, setGmailEvents] = useState<Event[]>([]);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  // Demo-only: a contact-hash -> first-name map, built solely from the synthetic fixture so the
  // sample circle reads as people. Real Gmail/WhatsApp connections never populate this — only the
  // hash ever reaches this component's state for a real account, by design.
  const [demoNames, setDemoNames] = useState<Record<string, string>>({});

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CircleSummary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const allEvents = useMemo(() => [...whatsappEvents, ...gmailEvents], [whatsappEvents, gmailEvents]);
  const strengths: ContactStrength[] = useMemo(() => contactStrengths(allEvents, new Date()), [allEvents]);

  // Who to reach out to: the server's nudges (real thresholds) once synced, else the same
  // "quietest active/close tie" signal computed locally so the panel is never empty.
  const advice: AdviceItem[] = useMemo(() => {
    // The server's history can outlive what's loaded locally this session — a contact hashed
    // under a device salt from before a "Clear everything," or from data connected earlier and
    // never re-uploaded this load, has no way to resolve a name and no meaningful "usual gap" in
    // the context of what's on screen. Only show a server nudge for a contact this session's own
    // events actually recognize (strengths, above, is computed from the same allEvents).
    const known = new Set(strengths.map((s) => s.contact));
    const serverNudges = summary?.nudges.filter((n) => known.has(n.contact)) ?? [];
    if (serverNudges.length > 0) {
      return serverNudges.map((n) => ({ contact: n.contact, text: n.text }));
    }
    return [...strengths]
      .filter((s) => s.tier !== 'weak')
      .sort((a, b) => b.daysSinceLast - a.daysSinceLast)
      .slice(0, 3)
      .map((s) => {
        const tier = TIER_LABEL[s.tier].toLowerCase();
        const article = /^[aeiou]/i.test(tier) ? 'an' : 'a';
        return {
          contact: s.contact,
          text: `${s.daysSinceLast} day${s.daysSinceLast === 1 ? '' : 's'} since your last exchange — ${article} ${tier} tie going quiet.`,
        };
      });
  }, [summary, strengths]);

  const selectedInfo = useMemo(() => strengths.find((s) => s.contact === selected) ?? null, [strengths, selected]);
  const selectedAdvice = useMemo(() => advice.find((a) => a.contact === selected) ?? null, [advice, selected]);

  const displayContact = useCallback((contact: string) => demoNames[contact] ?? `Contact ${contact.slice(0, 8)}`, [demoNames]);

  const sync = useCallback(async (events: Event[]) => {
    if (events.length === 0) return;
    // Posting events and reading a summary both need a real account (or the shared demo token) —
    // without one, every attempt would 401. That's expected, not a failure, so it's not an error:
    // the local numbers ("computed on this device" below) are the whole story for a signed-out
    // visitor, same as Labs' sample report works without a sign-in.
    if (!hasToken()) {
      setSummary(null);
      setSyncError(null);
      return;
    }
    setSyncing(true);
    setSyncError(null);
    try {
      await api.postEvents(events);
      const s = await api.circle();
      setSummary(s.available ? s : null);
      if (!s.available) setSyncError('Circle summary unavailable yet — showing local numbers only.');
    } catch (err) {
      setSummary(null);
      setSyncError(
        err instanceof ApiError
          ? `Server error (${err.status}) — showing local numbers only.`
          : 'Could not reach the server — showing local numbers only.',
      );
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (allEvents.length > 0) void sync(allEvents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatsappEvents, gmailEvents]);

  async function handleGmailConnect() {
    if (!IS_WEB) return;
    const email = gmailEmail.trim();
    if (!email) {
      setGmailStatus('Enter your Gmail address first.');
      return;
    }
    if (!GOOGLE_CLIENT_ID) {
      setGmailStatus('No Google OAuth client configured — set EXPO_PUBLIC_GOOGLE_CLIENT_ID in web/.env.local.');
      return;
    }

    setGmailBusy(true);
    setGmailStatus('Opening Google sign-in…');
    try {
      const token = await requestGmailAccessToken(GOOGLE_CLIENT_ID);
      setGmailStatus('Fetching message metadata…');
      const messages = await fetchRecentMessages(token);
      const salt = getOrCreateDeviceSalt();
      const events = parseGmailHeaders(messages, email, salt);

      setGmailEvents(events);
      setResults((prev) => [
        ...prev.filter((r) => r.source !== 'gmail'),
        { source: 'gmail', label: email, status: 'ok', message: '', eventCount: events.length },
      ]);
      setGmailStatus(`Connected — ${events.length} anonymized events kept.`);
      localStorage.setItem(GMAIL_EMAIL_KEY, email);
    } catch (err) {
      setGmailStatus(err instanceof Error ? err.message : 'Gmail connect failed.');
    } finally {
      setGmailBusy(false);
    }
  }

  async function handleWhatsAppUpload() {
    const name = ownerName.trim();
    if (!name) {
      setWhatsappError('Enter your name first — it has to match how you appear as a sender in the export.');
      return;
    }
    if (IS_WEB) localStorage.setItem(OWNER_KEY, name);
    setWhatsappError(null);

    const picked = await DocumentPicker.getDocumentAsync({ type: 'text/plain', multiple: true, copyToCacheDirectory: true });
    if (picked.canceled) return;

    const salt = getOrCreateDeviceSalt();
    const nextEvents: Event[] = [];
    const nextResults: SourceResult[] = [];

    for (const asset of picked.assets) {
      try {
        const text = await (await fetch(asset.uri)).text();
        const events = parseWhatsApp(text, name, salt);
        nextEvents.push(...events);
        nextResults.push({ source: 'whatsapp', label: asset.name, status: 'ok', message: '', eventCount: events.length });
      } catch (err) {
        const message =
          err instanceof UnsupportedChatError ? err.message : err instanceof Error ? err.message : 'Could not parse this file.';
        nextResults.push({ source: 'whatsapp', label: asset.name, status: 'error', message, eventCount: 0 });
      }
    }

    setWhatsappEvents((prev) => [...prev, ...nextEvents]);
    setResults((prev) => [...prev, ...nextResults]);
  }

  /** Synthetic circle (fixtures/whatsapp_sample.txt + gmail_metadata_sample.json, served from
   * public/samples/ by sync-assets.js) so the map and advice can be demoed with no real account. */
  async function handleTrySample() {
    setSampleBusy(true);
    setSampleError(null);
    try {
      const salt = getOrCreateDeviceSalt();
      const [waText, gmailMessages] = await Promise.all([
        fetch('/samples/whatsapp_sample.txt').then((res) => {
          if (!res.ok) throw new Error('Sample WhatsApp export not available.');
          return res.text();
        }),
        fetch('/samples/gmail_metadata_sample.json').then((res) => {
          if (!res.ok) throw new Error('Sample Gmail metadata not available.');
          return res.json() as Promise<GmailMetadataMessage[]>;
        }),
      ]);

      // The fixture bundles one block per contact (real WhatsApp exports are one chat per file) —
      // split on the "=== BLOCK: Name (platform) ===" markers before parsing, same as
      // social/src/parsers/whatsapp.test.ts's loadFixtureBlocks.
      const blocks = waText.split(/\n(?==== BLOCK: )/).filter((p) => p.trim().length > 0);
      const waEvents: Event[] = [];
      const waResults: SourceResult[] = [];
      const names: Record<string, string> = {};
      for (const block of blocks) {
        const header = block.match(/^=== BLOCK: (.+) \((ios|android)\) ===\n?/);
        if (!header) continue;
        const [full, name] = header;
        const events = parseWhatsApp(block.slice(full.length), 'You', salt);
        waEvents.push(...events);
        waResults.push({ source: 'whatsapp', label: `${name} (sample)`, status: 'ok', message: '', eventCount: events.length });
        names[hashContact(name, salt)] = name;
      }

      const gmEvents = parseGmailHeaders(gmailMessages, 'you@example.com', salt);

      // Same fixture identities on the Gmail side (maria@example.com, etc.) — the local part,
      // capitalized, makes as good a display name as the WhatsApp block header.
      const gmailAddresses = new Set<string>();
      for (const msg of gmailMessages) {
        for (const header of msg.payload?.headers ?? []) {
          if (header.name.toLowerCase() === 'from' || header.name.toLowerCase() === 'to') {
            gmailAddresses.add(header.value.trim().toLowerCase());
          }
        }
      }
      for (const address of gmailAddresses) {
        if (address === 'you@example.com') continue;
        const localPart = address.split('@')[0] ?? address;
        names[hashContact(address, salt)] = localPart.charAt(0).toUpperCase() + localPart.slice(1);
      }

      setOwnerName('You');
      setGmailEmail('you@example.com');
      setWhatsappEvents(waEvents);
      setGmailEvents(gmEvents);
      setDemoNames(names);
      setResults([...waResults, { source: 'gmail', label: 'you@example.com (sample)', status: 'ok', message: '', eventCount: gmEvents.length }]);
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : 'Could not load the sample circle.');
    } finally {
      setSampleBusy(false);
    }
  }

  async function handleClear() {
    setConfirmingClear(false);
    setWhatsappEvents([]);
    setGmailEvents([]);
    setResults([]);
    setSummary(null);
    setSyncError(null);
    setGmailStatus(null);
    setWhatsappError(null);
    setSampleError(null);
    setSelected(null);
    setDemoNames({});
    if (IS_WEB) {
      localStorage.removeItem(OWNER_KEY);
      localStorage.removeItem(GMAIL_EMAIL_KEY);
    }
    clearDeviceSalt();
    setOwnerName('');
    setGmailEmail('');
    try {
      await api.deleteAllEvents();
    } catch {
      // best-effort — the device-side state is already cleared either way
    }
  }

  // On a phone (stacked, not side-by-side), a returning user with a circle already connected
  // would otherwise scroll past four setup cards before reaching it. Once there's data, the
  // circle leads and the connection controls follow; on a wide screen both are visible at once
  // side by side, so the setup column stays put on the left there.
  const circleFirst = !isWide && allEvents.length > 0;

  const sourcesColumn = (
    <View style={[styles.column, isWide && styles.leftColumnWide]}>
      <FadeInUp delay={35}>
        <View style={[styles.card, CardShadow, styles.sampleCard]}>
          <SectionHeader icon="sparkles-outline" label="No account handy?" />
          <ThemedText type="small" themeColor="textSecondary">
            Load a sample circle to see the map, the metrics and the reach-out advice before connecting your own
            inbox or chats.
          </ThemedText>
          <AnimatedPressable style={styles.sampleButton} onPress={() => void handleTrySample()} disabled={sampleBusy}>
            {sampleBusy ? (
              <ActivityIndicator color={Colors.accent} />
            ) : (
              <View style={styles.buttonContent}>
                <Ionicons name="sparkles-outline" size={16} color={Colors.accent} />
                <ThemedText type="smallBold" themeColor="accent">
                  Load sample circle
                </ThemedText>
              </View>
            )}
          </AnimatedPressable>
          {sampleError && (
            <ThemedText type="small" themeColor="silence">
              {sampleError}
            </ThemedText>
          )}
        </View>
      </FadeInUp>

      <FadeInUp delay={70}>
        <View style={[styles.card, CardShadow]}>
          <SectionHeader icon="mail" label="Gmail — read-only metadata" />
          <Field label="Your Gmail address">
            <TextField value={gmailEmail} onChangeText={setGmailEmail} placeholder="you@gmail.com" keyboardType="email-address" />
          </Field>
          <AnimatedPressable style={styles.button} onPress={() => void handleGmailConnect()} disabled={gmailBusy}>
            {gmailBusy ? (
              <ActivityIndicator color={Colors.accentText} />
            ) : (
              <View style={styles.buttonContent}>
                <Ionicons name="mail-outline" size={16} color={Colors.accentText} />
                <ThemedText type="smallBold" themeColor="accentText">
                  Connect Gmail
                </ThemedText>
              </View>
            )}
          </AnimatedPressable>
          {gmailStatus && (
            <ThemedText type="small" themeColor="textMuted">
              {gmailStatus}
            </ThemedText>
          )}
        </View>
      </FadeInUp>

      <FadeInUp delay={140}>
        <View style={[styles.card, CardShadow]}>
          <SectionHeader icon="logo-whatsapp" label="WhatsApp — export upload" />
          <Field label="Your name, exactly as it appears in your own messages">
            <TextField value={ownerName} onChangeText={setOwnerName} placeholder="e.g. your WhatsApp display name" />
          </Field>
          <AnimatedPressable style={styles.button} onPress={() => void handleWhatsAppUpload()}>
            <View style={styles.buttonContent}>
              <Ionicons name="cloud-upload-outline" size={16} color={Colors.accentText} />
              <ThemedText type="smallBold" themeColor="accentText">
                Upload .txt export(s)
              </ThemedText>
            </View>
          </AnimatedPressable>
          <ThemedText type="small" themeColor="textMuted">
            Export chat -&gt; Without media, one file per person.
          </ThemedText>
          {whatsappError && (
            <ThemedText type="small" themeColor="silence">
              {whatsappError}
            </ThemedText>
          )}
        </View>
      </FadeInUp>

      {results.length > 0 && (
        <FadeInUp delay={0}>
          <View style={[styles.card, CardShadow]}>
            <SectionHeader icon="list-outline" label="Sources" />
            {results.map((r, i) => (
              <ThemedText key={`${r.source}-${r.label}-${i}`} type="small" themeColor={r.status === 'ok' ? 'textSecondary' : 'silence'}>
                {r.source === 'gmail' ? 'Gmail' : 'WhatsApp'} — {r.label}: {r.status === 'ok' ? `${r.eventCount} events` : r.message}
              </ThemedText>
            ))}
          </View>
        </FadeInUp>
      )}

      {allEvents.length > 0 &&
        (confirmingClear ? (
          <View style={[styles.card, styles.confirmCard]}>
            <ThemedText type="small">Delete everything Scallion knows about your circle?</ThemedText>
            <ThemedText type="small" themeColor="textMuted">
              Removes the stored connection events from the server and this device. This can&apos;t be undone.
            </ThemedText>
            <View style={styles.wrap}>
              <AnimatedPressable style={styles.secondaryButtonSmall} onPress={() => setConfirmingClear(false)}>
                <ThemedText type="smallBold" themeColor="accent">
                  Cancel
                </ThemedText>
              </AnimatedPressable>
              <AnimatedPressable style={styles.dangerButton} onPress={() => void handleClear()}>
                <ThemedText type="smallBold" themeColor="accentText">
                  Delete everything
                </ThemedText>
              </AnimatedPressable>
            </View>
          </View>
        ) : (
          <AnimatedPressable style={styles.link} onPress={() => setConfirmingClear(true)}>
            <ThemedText type="small" themeColor="textMuted">
              Clear everything (session + saved names + salt)
            </ThemedText>
          </AnimatedPressable>
        ))}
    </View>
  );

  const circleColumn = (
    <View style={[styles.column, isWide && styles.rightColumnWide]}>
      <FadeInUp delay={allEvents.length > 0 ? 0 : 280}>
        <View style={[styles.card, CardShadow, styles.circleCard]}>
          <View style={styles.circleHeaderRow}>
            <SectionHeader icon="planet-outline" label="Your circle" />
            {syncing && <ActivityIndicator size="small" color={Colors.accent} />}
          </View>

          {allEvents.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="radio-outline" size={26} color={Colors.textMuted} />
              <ThemedText type="small" themeColor="textMuted" style={styles.emptyStateText}>
                Connect Gmail or upload a WhatsApp export to see your circle and get relationship advice here.
              </ThemedText>
            </View>
          ) : (
            <>
              {summary && (
                <View style={styles.metricsRow}>
                  <Metric label="Active" value={summary.metrics.activeTies} />
                  <Metric label="Close" value={summary.metrics.closeTies} />
                  <Metric label="Overdue" value={summary.nudges.length} color={summary.nudges.length > 0 ? 'silence' : 'connection'} />
                </View>
              )}

              <CircleDotMap contacts={strengths} selected={selected} onSelect={setSelected} />
              <ThemedText type="small" themeColor="textMuted" style={styles.mapCaption}>
                You&apos;re at the center. Closer means more frequent recent contact.
              </ThemedText>

              {summary && (
                <Disclosure title="How Scallion sees your circle">
                  <ThemedText type="small" themeColor="textSecondary">
                    Active: at least one real back-and-forth day (a message from you and one from them, within a
                    week of each other) in the last 30 days. Close: four or more such days in that window.
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Overdue: it&apos;s been longer than your own typical gap with that person (plus some slack for
                    normal variation) — not a fixed number of days for everyone.
                  </ThemedText>
                </Disclosure>
              )}

              {syncError && (
                <ThemedText type="small" themeColor="silence">
                  {syncError}
                </ThemedText>
              )}

              {selected && selectedInfo && (
                <FadeInUp duration={260} distance={6}>
                  <View style={styles.detailCard}>
                    <View style={styles.detailHeaderRow}>
                      <View style={[styles.tierDot, { backgroundColor: TIER_COLOR[selectedInfo.tier] }]} />
                      <ThemedText type="smallBold" style={{ flex: 1 }}>
                        {displayContact(selected)}
                      </ThemedText>
                      <AnimatedPressable onPress={() => setSelected(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                        <Ionicons name="close" size={16} color={Colors.textMuted} />
                      </AnimatedPressable>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {TIER_LABEL[selectedInfo.tier]} tie · {selectedInfo.eventCount} messages in 30 days · last contact{' '}
                      {selectedInfo.daysSinceLast} day{selectedInfo.daysSinceLast === 1 ? '' : 's'} ago
                    </ThemedText>
                    {selectedAdvice && (
                      <ThemedText type="small" themeColor="accent">
                        {selectedAdvice.text}
                      </ThemedText>
                    )}
                  </View>
                </FadeInUp>
              )}

              {advice.length > 0 && (
                <View style={{ gap: Spacing.two }}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    Reach out to revive
                  </ThemedText>
                  {advice.map((a) => {
                    const isSelected = selected === a.contact;
                    return (
                      <AnimatedPressable
                        key={a.contact}
                        onPress={() => setSelected(isSelected ? null : a.contact)}
                        style={[styles.adviceRow, isSelected && styles.adviceRowSelected]}>
                        <Ionicons name="alert-circle-outline" size={14} color={isSelected ? Colors.accent : Colors.textMuted} />
                        <ThemedText type="small" themeColor={isSelected ? 'accent' : 'textSecondary'} style={{ flex: 1 }}>
                          {displayContact(a.contact)} — {a.text}
                        </ThemedText>
                      </AnimatedPressable>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </View>
      </FadeInUp>

      {allEvents.length > 0 && (
        <FadeInUp delay={60}>
          <View style={[styles.card, CardShadow]}>
            <SectionHeader icon="pulse-outline" label="Social score" />
            {summary ? (
              <>
                <View style={styles.scoreRow}>
                  <AnimatedNumber
                    value={summary.lsns.score}
                    type="numeric"
                    style={styles.scoreNumber}
                    themeColor={summary.lsns.atRisk ? 'silence' : 'connection'}
                  />
                  <View style={{ flex: 1 }}>
                    <ThemedText type="small" themeColor="textMuted">
                      out of 30 · LSNS-6 proxy, 4 of 6 items from your messaging
                    </ThemedText>
                    <ThemedText type="small" themeColor={summary.lsns.atRisk ? 'silence' : 'textSecondary'}>
                      {summary.lsns.label}
                      {summary.lsns.atRisk && summary.risk
                        ? ` — risk-equivalent years, if sustained, population estimate: ${summary.risk.years}.`
                        : ''}
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.trendRow}>
                  <TrendStat label="Active ties" current={summary.metrics.activeTies} previous={summary.previous.activeTies} />
                  <TrendStat label="Close ties" current={summary.metrics.closeTies} previous={summary.previous.closeTies} />
                </View>

                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.patternHeading}>
                  Connection pattern
                </ThemedText>
                <View style={styles.patternGrid}>
                  <PatternStat label="You start" value={`${Math.round(summary.metrics.initiationShare * 100)}%`} />
                  <PatternStat
                    label="Your reply time"
                    value={summary.metrics.replyLatencyH.mine !== null ? `${summary.metrics.replyLatencyH.mine} h` : 'not enough data'}
                  />
                  <PatternStat
                    label="Their reply time"
                    value={summary.metrics.replyLatencyH.theirs !== null ? `${summary.metrics.replyLatencyH.theirs} h` : 'not enough data'}
                  />
                  {summary.metrics.churn > 0 && <PatternStat label="Gone quiet" value={`${Math.round(summary.metrics.churn * 100)}%`} />}
                </View>

                {summary.heatmap.length > 0 && (
                  <View style={{ gap: Spacing.one }}>
                    <ThemedText type="small" themeColor="textMuted">
                      Last 30 days
                    </ThemedText>
                    <ActivityStrip days={summary.heatmap.slice(-30)} />
                  </View>
                )}
              </>
            ) : (
              <View style={styles.scoreRow}>
                <ThemedText type="numeric" style={styles.scoreNumber}>
                  {strengths.filter((s) => s.tier !== 'weak').length}/{strengths.length}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                  ties active or close in the last 30 days, computed on this device. Connect to sync for your full
                  LSNS-6 social score, connection pattern, and month-over-month trend.
                </ThemedText>
              </View>
            )}
          </View>
        </FadeInUp>
      )}
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scrollContent}>
          <View style={[styles.scroll, isWide && styles.scrollWide]}>
            <FadeInUp delay={0}>
              <View style={styles.hero}>
                <View style={styles.heroBadge}>
                  <Ionicons name="people" size={22} color={Colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="subtitle">Your circle</ThemedText>
                  <ThemedText type="default" themeColor="textSecondary">
                    Connect Gmail and upload WhatsApp exports — message text never leaves this device, only a one-way hash
                    of who and when.
                  </ThemedText>
                </View>
              </View>
            </FadeInUp>

            <View style={[styles.splitRow, isWide && styles.splitRowWide]}>
              {circleFirst ? (
                <>
                  {circleColumn}
                  {sourcesColumn}
                </>
              ) : (
                <>
                  {sourcesColumn}
                  {circleColumn}
                </>
              )}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function SectionHeader({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={16} color={Colors.accent} />
      <ThemedText type="smallBold">{label}</ThemedText>
    </View>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color?: 'silence' | 'connection' }) {
  return (
    <View style={styles.metric}>
      <AnimatedNumber value={value} type="numeric" themeColor={color} style={{ fontSize: 28, lineHeight: 32 }} />
      <ThemedText type="small" themeColor="textMuted">
        {label}
      </ThemedText>
    </View>
  );
}

/** One line of the "Connection pattern" breakdown — a stat with no history to compare against, unlike TrendStat. */
function PatternStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.patternStat}>
      <ThemedText type="smallBold" style={styles.tabular}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textMuted">
        {label}
      </ThemedText>
    </View>
  );
}

function TrendStat({ label, current, previous }: { label: string; current: number; previous: number }) {
  const delta = current - previous;
  const color = delta > 0 ? 'connection' : delta < 0 ? 'silence' : 'textMuted';
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
  return (
    <View style={styles.trendStat}>
      <AnimatedNumber value={current} type="numeric" style={{ fontSize: 22, lineHeight: 26 }} />
      <ThemedText type="small" themeColor="textMuted">
        {label}
      </ThemedText>
      <ThemedText type="small" themeColor={color}>
        {arrow} {Math.abs(delta)} vs last month
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  scrollOuter: { flex: 1, width: '100%' },
  scrollContent: { alignItems: 'center' },
  scroll: {
    width: '100%',
    maxWidth: 720,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.four,
  },
  scrollWide: { maxWidth: SPLIT_MAX_WIDTH },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroBadge: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitRow: { width: '100%', gap: Spacing.three },
  splitRowWide: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.four },
  column: { width: '100%', gap: Spacing.three },
  leftColumnWide: { flex: 5, maxWidth: 420 },
  rightColumnWide: { flex: 6 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  circleHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  circleCard: { minHeight: 320 },
  sampleCard: { borderStyle: 'dashed', borderColor: Colors.accent },
  sampleButton: {
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  emptyState: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  emptyStateText: { textAlign: 'center', maxWidth: 260 },
  detailCard: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.medium,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  detailHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tierDot: { width: 8, height: 8, borderRadius: 4 },
  adviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.small,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  adviceRowSelected: { backgroundColor: Colors.surfaceRaised },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  metricsRow: { flexDirection: 'row', gap: Spacing.four, justifyContent: 'center' },
  metric: { alignItems: 'center' },
  mapCaption: { textAlign: 'center' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  scoreNumber: { fontSize: 44, lineHeight: 48 },
  trendRow: { flexDirection: 'row', gap: Spacing.five, justifyContent: 'center' },
  trendStat: { alignItems: 'center', gap: Spacing.half },
  patternHeading: { marginTop: Spacing.one },
  patternGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four, rowGap: Spacing.two },
  patternStat: { gap: Spacing.half, minWidth: 96 },
  tabular: { fontVariant: ['tabular-nums'] },
  link: { alignItems: 'center', paddingVertical: Spacing.two },
  confirmCard: {
    borderWidth: 1,
    borderColor: Colors.silence,
    gap: Spacing.two,
  },
  secondaryButtonSmall: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
  },
  dangerButton: {
    backgroundColor: Colors.silence,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
  },
});
