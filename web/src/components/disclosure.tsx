import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';

/**
 * Progressive disclosure: a tappable title, collapsed by default, that reveals technical detail
 * on demand — the surface stays simple while the depth underneath stays reachable (CLAUDE.md's
 * "estimate, not diagnosis" style already keeps prose short; this is where the "why" lives).
 */
export function Disclosure({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityLabel={title}
        onPress={() => setOpen((o) => !o)}
        style={styles.header}>
        <ThemedText type="smallBold" themeColor="accent">
          {title}
        </ThemedText>
        <ThemedText type="smallBold" themeColor="accent">
          {open ? '−' : '+'}
        </ThemedText>
      </Pressable>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

/** A short citation line, e.g. under a chart or number — "Source · Levine et al. 2018". */
export function SourceNote({ label = 'Source', children }: { label?: string; children: string }) {
  return (
    <ThemedText type="small" themeColor="textMuted">
      {label} · {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.two,
  },
  body: { gap: Spacing.two, paddingBottom: Spacing.one },
});
