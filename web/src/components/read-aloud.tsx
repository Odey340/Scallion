import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';

/**
 * "Read aloud" for a card: one sentence through D's `GET /tts` (ElevenLabs, en/es), played in
 * the browser. The text is composed by the screen from numbers already on it, so nothing new is
 * narrated. Web only (native playback is behind the cut order); the button hides itself elsewhere.
 */
export function ReadAloud({ text, lang = 'en' }: { text: string; lang?: 'en' | 'es' }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);

  useEffect(
    () => () => {
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  if (Platform.OS !== 'web') return null;

  const play = async () => {
    if (state === 'playing') {
      audio.current?.pause();
      setState('idle');
      return;
    }
    setState('loading');
    try {
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = await api.tts(text.slice(0, 300), lang);
      const el = new Audio(url.current);
      audio.current = el;
      el.onended = () => setState('idle');
      el.onerror = () => setState('error');
      await el.play();
      setState('playing');
    } catch {
      setState('error');
    }
  };

  return (
    <Pressable style={styles.button} onPress={play} accessibilityLabel="Read aloud">
      <ThemedText type="smallBold" themeColor="accent">
        {state === 'loading' ? 'Loading…' : state === 'playing' ? 'Stop' : state === 'error' ? 'Voice unavailable' : 'Read aloud'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
});
