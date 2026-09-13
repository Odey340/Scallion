import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

/**
 * "Scallion was updated since this page loaded. Reload."
 *
 * The web export is redeployed many times an hour during the event, and a tab that stayed open
 * across a deploy keeps running the previous entry bundle: old copy, old flows (Sun H33: a camera
 * page from before the /vitals/arm contract sat on a phone and could never reach the laptop
 * worker), and split chunks that no longer exist on Vercel. This compares the entry bundle this
 * page runs with the one the server publishes now, every 30 s and whenever the tab comes back to
 * the foreground, and offers one tap to reload. It never reloads on its own: a capture or a coach
 * conversation in progress must not be interrupted.
 */

const CHECK_MS = 30_000;
const ENTRY_RE = /\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/;

// The entry bundle this page is running, or null outside the web export (native, dev server).
function runningEntry(): string | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  for (const script of Array.from(document.scripts)) {
    const m = ENTRY_RE.exec(script.src);
    if (m) return m[0];
  }
  return null;
}

// The entry bundle the server serves for a fresh load right now.
async function publishedEntry(): Promise<string | null> {
  const res = await fetch(`/?fresh=${Date.now()}`, { cache: 'no-store', headers: { accept: 'text/html' } });
  if (!res.ok) return null;
  const m = ENTRY_RE.exec(await res.text());
  return m ? m[0] : null;
}

export function UpdateBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const running = runningEntry();
    if (!running) return;
    let cancelled = false;
    const check = async () => {
      try {
        const published = await publishedEntry();
        if (!cancelled && published && published !== running) setStale(true);
      } catch {
        // offline or the server is mid-deploy: try again on the next tick
      }
    };
    const id = setInterval(check, CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!stale) return null;
  return (
    <View style={styles.bar} accessibilityRole="alert">
      <ThemedText type="small" style={styles.text}>
        Scallion was updated since this page loaded.
      </ThemedText>
      <Pressable style={styles.button} onPress={() => window.location.reload()} accessibilityRole="button">
        <ThemedText type="smallBold" themeColor="accentText">
          Reload
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: Colors.surfaceRaised,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  text: { color: Colors.text },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    minHeight: 32,
    justifyContent: 'center',
  },
});
