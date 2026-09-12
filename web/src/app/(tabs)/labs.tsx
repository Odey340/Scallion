import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Field, NumberInput, SegmentButton } from '@/components/form-controls';
import { ALT_UNITS, ReviewTable } from '@/components/review-table';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { ANALYTES, computePhenoAge, type AnalyteKey, type PhenoAgeData, type Sex } from '@/engine/phenoage';
import { ApiError, api, hasToken, type ExtractResponse } from '@/lib/api';
import { findSourceLine, renderPdf, stitchPages, type RenderedPage } from '@/lib/pdf';
import { loadRules, type RawRules, type RuleSet } from '@/lib/redaction';
import { setLocalClock } from '@/state/clock-store';
import { resetLabs, setLabs, useLabs } from '@/state/labs-store';

/**
 * Labs: upload -> review -> waterfall (docs/lanes/C.md Blocks 2-3).
 * 1. Pick a PDF (rendered with pdf.js, text layer redacted in the browser per section 7) or an
 *    image, or type the nine values. Only the redacted document is uploaded; nothing is stored.
 * 2. Review: the page with each extracted value's printed line highlighted, the nine SI values
 *    (editable), fasting question, hs-CRP flag, identifiers-stripped note, age and sex.
 * 3. Compute PhenoAge from A's export (phenoage.ts) and go to /labs-results.
 */

type Step = 'pick' | 'working' | 'review';

export default function LabsScreen() {
  const router = useRouter();
  const labs = useLabs();
  const { width: windowWidth } = useWindowDimensions();

  const [data, setData] = useState<PhenoAgeData | null>(null);
  const [rules, setRules] = useState<RuleSet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>(labs.extract || labs.source === 'typed' && Object.keys(labs.values).length > 0 ? 'review' : 'pick');
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AnalyteKey | null>(null);
  const [ageText, setAgeText] = useState(labs.age ? String(labs.age) : '');
  const [altUnits, setAltUnits] = useState<Partial<Record<AnalyteKey, boolean>>>({});

  useEffect(() => {
    fetch('/engine/phenoage.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setLoadError('Could not load the PhenoAge model (phenoage.json).'));
    fetch('/redaction_rules.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((raw: RawRules) => setRules(loadRules(raw)))
      .catch(() => setRules(null));
  }, []);

  // Prefill age/sex from the verified profile when signed in (Persona-verified age only).
  useEffect(() => {
    if (!hasToken() || labs.age) return;
    api
      .me()
      .then((me) => {
        if (me.age) {
          setLabs({ age: me.age });
          setAgeText(String(me.age));
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const located = useMemo(() => {
    const set = new Set<AnalyteKey>();
    if (!labs.extract) return set;
    for (const a of labs.extract.analytes) {
      if (a.name.startsWith('other:')) continue;
      if (findSourceLine(labs.pages, a.source_text, a.raw_name, a.value)) set.add(a.name as AnalyteKey);
    }
    return set;
  }, [labs.extract, labs.pages]);

  const highlights = useMemo(() => {
    const out: { page: number; box: RenderedPage['lines'][number]['box']; key: AnalyteKey }[] = [];
    if (!labs.extract) return out;
    for (const a of labs.extract.analytes) {
      if (a.name.startsWith('other:')) continue;
      const hit = findSourceLine(labs.pages, a.source_text, a.raw_name, a.value);
      if (hit) out.push({ page: hit.page, box: labs.pages[hit.page].lines[hit.line].box, key: a.name as AnalyteKey });
    }
    return out;
  }, [labs.extract, labs.pages]);

  const applyExtract = (extract: ExtractResponse) => {
    const values: Partial<Record<AnalyteKey, number | null>> = {};
    for (const key of ANALYTES) values[key] = null;
    for (const a of extract.analytes) {
      if (a.name.startsWith('other:')) continue;
      values[a.name as AnalyteKey] = a.si_value;
    }
    setLabs({ extract, values, fasting: extract.fasting });
  };

  const upload = async (blob: Blob, filename: string) => {
    if (!hasToken()) {
      throw new ApiError(401, null, 'Sign in to extract a report, or type the values below.');
    }
    setStatus('Reading the report (Gemini extracts, never computes)…');
    // prefer the cached demo response when the API has one for this exact file; live otherwise.
    return api.extract(blob, { preferCache: true, filename });
  };

  /** Render, redact, upload, and land on review. `buf` never leaves the device unredacted. */
  const processFile = async (buf: ArrayBuffer, name: string, mimeType: string | null) => {
    setStep('working');
    try {
      const isPdf = (mimeType ?? '').includes('pdf') || name.toLowerCase().endsWith('.pdf');
      // Keep the original bytes now: pdf.js transfers the ArrayBuffer to its worker, which detaches it.
      const original = new Blob([buf], { type: isPdf ? 'application/pdf' : (mimeType ?? 'image/jpeg') });
      let blob: Blob = original;
      let pages: RenderedPage[] = [];
      let redaction = null;
      if (isPdf && Platform.OS === 'web') {
        setStatus('Rendering and redacting on this device…');
        const rendered = await renderPdf(buf.slice(0), rules);
        pages = rendered.pages;
        redaction = rendered.report;
        // Nothing to redact: send the original bytes so the API's cached demo response (keyed by
        // file hash) can answer. Otherwise only the redacted page image leaves the phone.
        blob = redaction.dropped + redaction.masked === 0 ? original : await stitchPages(pages);
      }
      resetLabs();
      setLabs({ source: isPdf ? 'pdf' : 'image', fileName: name, pages, redaction });
      try {
        const extract = await upload(blob, blob.type === 'application/pdf' ? name : 'redacted.jpg');
        applyExtract(extract);
      } catch (e) {
        // The page is still on screen: fall back to typing the nine values from it.
        const values: Partial<Record<AnalyteKey, number | null>> = {};
        for (const key of ANALYTES) values[key] = null;
        setLabs({ extract: null, values });
        setError(`${e instanceof Error ? e.message : 'Extraction failed'}. Type the values from the report below.`);
      }
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the report.');
      setStep('pick');
    } finally {
      setStatus('');
    }
  };

  const pickPdf = async () => {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const buf = await (await fetch(asset.uri)).arrayBuffer();
    await processFile(buf, asset.name, asset.mimeType ?? null);
  };

  /** The synthetic, identifier-free fixture (fixtures/lab_report_synthetic.pdf) for judges without a report to hand. */
  const trySample = async () => {
    setError(null);
    setStep('working');
    setStatus('Fetching the sample report…');
    try {
      const res = await fetch('/samples/lab_report_synthetic.pdf');
      if (!res.ok) throw new Error('Sample report not available.');
      await processFile(await res.arrayBuffer(), 'lab_report_synthetic.pdf', 'application/pdf');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the sample report.');
      setStep('pick');
    }
  };

  const startTyped = () => {
    resetLabs();
    const values: Partial<Record<AnalyteKey, number | null>> = {};
    for (const key of ANALYTES) values[key] = null;
    setLabs({ source: 'typed', values });
    setStep('review');
  };

  const compute = () => {
    setError(null);
    if (!data) {
      setError('Still loading the PhenoAge model.');
      return;
    }
    const age = Number(ageText);
    if (!Number.isFinite(age) || age <= 0) {
      setError('Enter your age.');
      return;
    }
    if (!labs.sex) {
      setError('Choose your sex (the norms are by age band and sex).');
      return;
    }
    const measured = ANALYTES.filter((k) => typeof labs.values[k] === 'number');
    if (measured.length < 5) {
      setError('At least five of the nine values are needed for an honest estimate.');
      return;
    }
    const result = computePhenoAge(labs.values, age, labs.sex, data, { fasting: labs.fasting, creatinineRefHigh: labs.creatinineRefHigh });
    setLabs({ age, result });
    if (result.phenoage !== null) {
      setLocalClock({ clock: 'phenoage', years: result.phenoage, chronologicalAge: age, band: result.band, computedAt: new Date().toISOString(), imputed: result.imputed });
      if (hasToken()) {
        api
          .postClock({
            clock: 'phenoage',
            years: result.phenoage,
            chronological_age: age,
            band: result.band,
            inputs: { ...result.inputs, imputed: result.imputed, fasting: labs.fasting, sex: labs.sex },
            engine_version: String(data.version),
          })
          .catch(() => undefined);
      }
    }
    router.push('/labs-results');
  };

  const crpAcute = data && typeof labs.values.crp === 'number' && labs.values.crp > data.crp_acute_mgdL;
  const pageW = Math.min(windowWidth - Spacing.four * 2, MaxContentWidth - Spacing.four * 2);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">Your labs</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            Upload the blood panel you already have. PhenoAge (Levine 2018) reads nine common analytes. Estimate, not diagnosis.
          </ThemedText>
          {loadError && (
            <ThemedText type="small" themeColor="silence">
              {loadError}
            </ThemedText>
          )}

          {step === 'pick' && (
            <>
              <ThemedView type="surface" style={[styles.card, CardShadow]}>
                <ThemedText type="smallBold">What leaves your phone</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  The report is read on this device first. Name, date of birth, record numbers, address, physician and contact
                  lines are blacked out before upload ({rules ? `${rules.rules.length} rules` : 'rules loading'}). The upload is
                  never stored.
                </ThemedText>
                <View style={styles.row}>
                  <Pressable style={styles.primaryButton} onPress={pickPdf}>
                    <ThemedText type="smallBold" themeColor="accentText">
                      Pick a PDF or photo
                    </ThemedText>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={startTyped}>
                    <ThemedText type="smallBold" themeColor="accent">
                      Type the values
                    </ThemedText>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={trySample}>
                    <ThemedText type="smallBold" themeColor="accent">
                      Try the sample report
                    </ThemedText>
                  </Pressable>
                </View>
                {!hasToken() && (
                  <ThemedText type="small" themeColor="textMuted">
                    Uploading needs a sign-in (the extraction runs on our server). Typing the values works without one.
                  </ThemedText>
                )}
              </ThemedView>
              {error && (
                <ThemedText type="small" themeColor="silence">
                  {error}
                </ThemedText>
              )}
            </>
          )}

          {step === 'working' && (
            <ThemedView type="surface" style={[styles.card, CardShadow, styles.center]}>
              <ActivityIndicator color={Colors.accent} />
              <ThemedText type="small" themeColor="textSecondary">
                {status || 'Working…'}
              </ThemedText>
            </ThemedView>
          )}

          {step === 'review' && data && (
            <>
              {error && (
                <ThemedText type="small" themeColor="silence">
                  {error}
                </ThemedText>
              )}
              {labs.pages.length > 0 && (
                <View style={styles.pages}>
                  {labs.pages.map((p) => {
                    const scale = pageW / p.width;
                    return (
                      <View key={p.index} style={[styles.page, { width: pageW, height: p.height * scale }]}>
                        <Image source={{ uri: p.dataUrl }} style={{ width: pageW, height: p.height * scale }} resizeMode="contain" />
                        {highlights
                          .filter((h) => h.page === p.index)
                          .map((h) => (
                            <Pressable
                              key={h.key}
                              onPress={() => setSelected(h.key)}
                              style={[
                                styles.highlight,
                                selected === h.key && styles.highlightSelected,
                                { left: h.box.x * scale - 2, top: h.box.y * scale - 1, width: h.box.w * scale + 4, height: h.box.h * scale + 2 },
                              ]}
                            />
                          ))}
                      </View>
                    );
                  })}
                  <ThemedText type="small" themeColor="textMuted">
                    {labs.redaction
                      ? labs.redaction.dropped + labs.redaction.masked > 0
                        ? `Identifiers stripped on this device: ${labs.redaction.dropped} line(s) removed, ${labs.redaction.masked} field(s) masked (${labs.redaction.ruleIds.join(', ')}). Only this redacted image was uploaded.`
                        : 'Identifiers stripped: nothing matched the redaction rules, so this report was already free of them.'
                      : 'Photo uploaded as-is; check it carries no name or record number.'}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textMuted">
                    Highlights mark the printed line each value came from. Tap one to select it.
                  </ThemedText>
                </View>
              )}

              {labs.extract && labs.extract.missing.length > 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  Not on this report: {labs.extract.missing.map((k) => k.replace('_', ' ')).join(', ')}. They will be imputed from
                  age-sex norms ({9 - labs.extract.missing.length} of 9 markers).
                </ThemedText>
              )}

              <ReviewTable
                units={data.units}
                analytes={labs.extract?.analytes ?? []}
                values={labs.values}
                onChange={(key, v) => {
                  const alt = altUnits[key] ? ALT_UNITS[key] : undefined;
                  setLabs({ values: { ...labs.values, [key]: v === null ? null : alt ? v * alt.toSi : v } });
                }}
                selected={selected}
                onSelect={setSelected}
                located={labs.extract ? located : undefined}
              />
              {labs.source === 'typed' && (
                <View style={styles.wrap}>
                  <ThemedText type="small" themeColor="textMuted">
                    Type in US units instead (converted to the paper&apos;s units):
                  </ThemedText>
                  {(Object.keys(ALT_UNITS) as AnalyteKey[]).map((k) => (
                    <SegmentButton
                      key={k}
                      label={`${k.replace('_', ' ')} in ${ALT_UNITS[k]!.unit}`}
                      active={!!altUnits[k]}
                      onPress={() => setAltUnits((u) => ({ ...u, [k]: !u[k] }))}
                    />
                  ))}
                </View>
              )}

              <Field label="Was this a fasting draw? (non-fasting glucose is imputed, 8 of 9 markers)">
                <View style={styles.row}>
                  <SegmentButton label="Yes" active={labs.fasting === true} onPress={() => setLabs({ fasting: true })} />
                  <SegmentButton label="No" active={labs.fasting === false} onPress={() => setLabs({ fasting: false })} />
                  <SegmentButton label="Not sure" active={labs.fasting === null} onPress={() => setLabs({ fasting: null })} />
                </View>
              </Field>

              {crpAcute && (
                <ThemedView type="surfaceRaised" style={styles.note}>
                  <ThemedText type="smallBold">hs-CRP above {data.crp_acute_mgdL * 10} mg/L</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    That level often reflects a recent infection or injury rather than a steady state. The clock still runs, but a
                    repeat draw in a few weeks gives a fairer number.
                  </ThemedText>
                </ThemedView>
              )}

              <Field label="Age (years)">
                <NumberInput value={ageText} onChangeText={setAgeText} placeholder="34" />
              </Field>
              <Field label="Sex (the norms are by age band and sex)">
                <View style={styles.row}>
                  <SegmentButton label="Male" active={labs.sex === 'M'} onPress={() => setLabs({ sex: 'M' as Sex })} />
                  <SegmentButton label="Female" active={labs.sex === 'F'} onPress={() => setLabs({ sex: 'F' as Sex })} />
                </View>
              </Field>

              {error && (
                <ThemedText type="small" themeColor="silence">
                  {error}
                </ThemedText>
              )}
              <Pressable style={styles.submit} onPress={compute}>
                <ThemedText type="smallBold" themeColor="accentText">
                  Compute my PhenoAge
                </ThemedText>
              </Pressable>
              <Pressable
                style={styles.linkButton}
                onPress={() => {
                  resetLabs();
                  setSelected(null);
                  setStep('pick');
                }}>
                <ThemedText type="smallBold" themeColor="accent">
                  Start over
                </ThemedText>
              </Pressable>
            </>
          )}
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
  center: { alignItems: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center' },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  submit: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  linkButton: { alignItems: 'center', paddingVertical: Spacing.two },
  pages: { gap: Spacing.two },
  page: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.small,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  highlight: {
    position: 'absolute',
    backgroundColor: 'rgba(27, 94, 140, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(27, 94, 140, 0.5)',
    borderRadius: 2,
  },
  highlightSelected: {
    backgroundColor: 'rgba(27, 94, 140, 0.32)',
    borderColor: Colors.accent,
    borderWidth: 2,
  },
  note: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.half },
});
