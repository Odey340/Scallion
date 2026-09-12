import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import type { ContactStrength, StrengthTier } from '@/lib/social';

const SIZE = 280;
const CENTER = SIZE / 2;

const RING_RADIUS: Record<StrengthTier, number> = { close: 55, active: 95, weak: 130 };
const DOT_RADIUS: Record<StrengthTier, number> = { close: 9, active: 6, weak: 4 };
const DOT_COLOR: Record<StrengthTier, string> = { close: Colors.connection, active: Colors.accent, weak: Colors.textMuted };

/** Stable pseudo-random angle per contact hash, so dots don't jitter on re-render. */
function angleFor(contact: string): number {
  let h = 0;
  for (let i = 0; i < contact.length; i++) h = (h * 31 + contact.charCodeAt(i)) >>> 0;
  return ((h % 3600) / 3600) * 2 * Math.PI;
}

/**
 * "Your circle" at a glance: you at the center, everyone else placed on a ring by tie strength
 * (close/active/weak — see social/src/strength.ts). Computed entirely from events already on
 * the device; no per-contact detail leaves it beyond the anonymized hashes already in Event[].
 */
export function CircleDotMap({ contacts }: { contacts: ContactStrength[] }) {
  const points = useMemo(
    () =>
      contacts.map((c) => {
        const r = RING_RADIUS[c.tier];
        const angle = angleFor(c.contact);
        return { ...c, x: CENTER + r * Math.cos(angle), y: CENTER + r * Math.sin(angle) };
      }),
    [contacts],
  );

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={CENTER} cy={CENTER} r={RING_RADIUS.close} stroke={Colors.border} strokeWidth={1} fill="none" />
        <Circle cx={CENTER} cy={CENTER} r={RING_RADIUS.active} stroke={Colors.border} strokeWidth={1} fill="none" />
        <Circle cx={CENTER} cy={CENTER} r={RING_RADIUS.weak} stroke={Colors.border} strokeWidth={1} fill="none" />
        <Circle cx={CENTER} cy={CENTER} r={5} fill={Colors.text} />
        {points.map((p) => (
          <Circle key={p.contact} cx={p.x} cy={p.y} r={DOT_RADIUS[p.tier]} fill={DOT_COLOR[p.tier]} opacity={0.9} />
        ))}
      </Svg>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Legend color={Colors.connection} label="Close" />
        <Legend color={Colors.accent} label="Active" />
        <Legend color={Colors.textMuted} label="Weak" />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <ThemedText type="small" themeColor="textMuted">
        {label}
      </ThemedText>
    </View>
  );
}
