import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { contactStrengths, parseGmailHeaders, parseWhatsApp, UnsupportedChatError, type ContactStrength, type Event } from 'social';

import { CircleDotMap } from '@/components/circle-dot-map';
import { Field, TextField } from '@/components/form-controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { api, ApiError, type CircleSummary } from '@/lib/api';
import { fetchRecentMessages, requestGmailAccessToken } from '@/lib/gmail-ingest';
import { clearDeviceSalt, getOrCreateDeviceSalt } from '@/lib/salt';

const OWNER_KEY = 'scallion.owner_name';
const GMAIL_EMAIL_KEY = 'scallion.gmail_email';
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
const IS_WEB = Platform.OS === 'web';

interface SourceResult {
  source: 'whatsapp' | 'gmail';
  label: string;
  status: 'ok' | 'error';
  message: string;
  eventCount: number;
}

/**
 * Turn your messages into your circle: connect Gmail (OAuth, metadata only) and/or upload
 * WhatsApp exports, both parsed to anonymized Events right here in the browser (social/), then
 * POSTed to the API for the metrics the client doesn't see (GET /circle/summary). The dot map
 * itself is computed locally from the same Events, so it still renders if the API is down.
 */
export default function CircleScreen() {
  const [ownerName, setOwnerName] = useState('');
  const [gmailEmail, setGmailEmail] = useState('');
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailStatus, setGmailStatus] = useState<string | null>(null);

  const [whatsappEvents, setWhatsappEvents] = useState<Event[]>([]);
  const [gmailEvents, setGmailEvents] = useState<Event[]>([]);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CircleSummary | null>(null);

  useEffect(() => {
    if (!IS_WEB) return;
    setOwnerName(localStorage.getItem(OWNER_KEY) ?? '');
    setGmailEmail(localStorage.getItem(GMAIL_EMAIL_KEY) ?? '');
  }, []);

  const allEvents = useMemo(() => [...whatsappEvents, ...gmailEvents], [whatsappEvents, gmailEvents]);
  const strengths: ContactStrength[] = useMemo(() => contactStrengths(allEvents, new Date()), [allEvents]);
  const mostOverdue = useMemo(
    () => [...strengths].filter((s) => s.tier !== 'weak').sort((a, b) => b.daysSinceLast - a.daysSinceLast)[0] ?? null,
    [strengths],
  );

  const sync = useCallback(async (events: Event[]) => {
    if (events.length === 0) return;
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

  async function handleClear() {
    setWhatsappEvents([]);
    setGmailEvents([]);
    setResults([]);
    setSummary(null);
    setSyncError(null);
    setGmailStatus(null);
    setWhatsappError(null);
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="subtitle">Your circle</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            Connect Gmail and upload WhatsApp exports — message text never leaves this device, only a one-way hash of who
            and when.
          </ThemedText>

          <View style={styles.card}>
            <ThemedText type="smallBold">Gmail — read-only metadata</ThemedText>
            <Field label="Your Gmail address">
              <TextField value={gmailEmail} onChangeText={setGmailEmail} placeholder="you@gmail.com" keyboardType="email-address" />
            </Field>
            <Pressable style={styles.button} onPress={() => void handleGmailConnect()} disabled={gmailBusy}>
              {gmailBusy ? <ActivityIndicator color={Colors.accentText} /> : <ThemedText type="smallBold" themeColor="accentText">Connect Gmail</ThemedText>}
            </Pressable>
            {gmailStatus && (
              <ThemedText type="small" themeColor="textMuted">
                {gmailStatus}
              </ThemedText>
            )}
          </View>

          <View style={styles.card}>
            <ThemedText type="smallBold">WhatsApp — export upload</ThemedText>
            <Field label="Your name, exactly as it appears in your own messages">
              <TextField value={ownerName} onChangeText={setOwnerName} placeholder="e.g. your WhatsApp display name" />
            </Field>
            <Pressable style={styles.button} onPress={() => void handleWhatsAppUpload()}>
              <ThemedText type="smallBold" themeColor="accentText">
                Upload .txt export(s)
              </ThemedText>
            </Pressable>
            <ThemedText type="small" themeColor="textMuted">
              Export chat -&gt; Without media, one file per person.
            </ThemedText>
            {whatsappError && (
              <ThemedText type="small" themeColor="silence">
                {whatsappError}
              </ThemedText>
            )}
          </View>

          <View style={styles.card}>
            <ThemedText type="smallBold">More sources</ThemedText>
            <View style={styles.wrap}>
              <Chip label="SMS (Android)" />
              <Chip label="iMessage (Mac)" />
            </View>
            <ThemedText type="small" themeColor="textMuted">
              Same pipeline, not wired up yet.
            </ThemedText>
          </View>

          {results.length > 0 && (
            <View style={styles.card}>
              <ThemedText type="smallBold">Sources</ThemedText>
              {results.map((r, i) => (
                <ThemedText key={`${r.source}-${r.label}-${i}`} type="small" themeColor={r.status === 'ok' ? 'textSecondary' : 'silence'}>
                  {r.source === 'gmail' ? 'Gmail' : 'WhatsApp'} — {r.label}:{' '}
                  {r.status === 'ok' ? `${r.eventCount} events` : r.message}
                </ThemedText>
              ))}
            </View>
          )}

          {allEvents.length > 0 && (
            <View style={styles.card}>
              <ThemedText type="smallBold">Your circle{syncing ? ' — syncing…' : ''}</ThemedText>
              <CircleDotMap contacts={strengths} />

              {summary ? (
                <>
                  <View style={styles.metricsRow}>
                    <Metric label="Active ties" value={summary.metrics.activeTies} />
                    <Metric label="Close ties" value={summary.metrics.closeTies} />
                    <Metric label="LSNS proxy" value={summary.lsns.score} />
                  </View>
                  {summary.lsns.atRisk && (
                    <ThemedText type="small" themeColor="silence">
                      {summary.lsns.label}. Score below 12 — sustained isolation risk.
                      {summary.risk ? ` Risk-equivalent years, if sustained, population estimate: ${summary.risk.years}.` : ''}
                    </ThemedText>
                  )}
                  {summary.nudges.length > 0 && (
                    <View style={{ gap: Spacing.two }}>
                      <ThemedText type="smallBold" themeColor="textSecondary">
                        Reach out to revive
                      </ThemedText>
                      {summary.nudges.map((n) => (
                        <ThemedText key={n.contact} type="small" themeColor="textSecondary">
                          Contact {n.contact.slice(0, 8)} — {n.text}
                        </ThemedText>
                      ))}
                    </View>
                  )}
                </>
              ) : (
                <>
                  {syncError && (
                    <ThemedText type="small" themeColor="silence">
                      {syncError}
                    </ThemedText>
                  )}
                  {mostOverdue && (
                    <ThemedText type="small" themeColor="textSecondary">
                      Reach out to revive: contact {mostOverdue.contact.slice(0, 8)} — {mostOverdue.daysSinceLast} days since
                      you last exchanged messages. (Computed locally — connect to the server for the full picture.)
                    </ThemedText>
                  )}
                </>
              )}
            </View>
          )}

          <Pressable style={styles.link} onPress={() => void handleClear()}>
            <ThemedText type="small" themeColor="textMuted">
              Clear everything (session + saved names + salt)
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <ThemedText type="numeric" style={{ fontSize: 28, lineHeight: 32 }}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textMuted">
        {label}
      </ThemedText>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <ThemedText type="small" themeColor="textMuted">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  scroll: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.three,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  metricsRow: { flexDirection: 'row', gap: Spacing.four, justifyContent: 'center' },
  metric: { alignItems: 'center' },
  link: { alignItems: 'center', paddingVertical: Spacing.two },
});
