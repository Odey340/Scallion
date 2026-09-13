import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, G, RadialGradient, Stop } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import type { ContactStrength, StrengthTier } from '@/lib/social';

const SIZE = 320;
const CENTER = SIZE / 2;

const RING_RADIUS: Record<StrengthTier, number> = { close: 60, active: 102, weak: 140 };
const DOT_RADIUS: Record<StrengthTier, number> = { close: 9, active: 6, weak: 4 };
const DOT_COLOR: Record<StrengthTier, string> = { close: Colors.connection, active: Colors.accent, weak: Colors.textMuted };

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

/** Stable pseudo-random angle per contact hash, so dots don't jitter on re-render. */
function angleFor(contact: string): number {
  let h = 0;
  for (let i = 0; i < contact.length; i++) h = (h * 31 + contact.charCodeAt(i)) >>> 0;
  return ((h % 3600) / 3600) * 2 * Math.PI;
}

type Point = ContactStrength & { x: number; y: number };

/**
 * "Your circle" at a glance: you at the center, everyone else placed on a ring by tie strength
 * (close/active/weak — see social/src/strength.ts). Computed entirely from events already on
 * the device; no per-contact detail leaves it beyond the anonymized hashes already in Event[].
 *
 * Interactive: tap a dot to select that contact (surfaced by the caller, e.g. next to advice);
 * tap empty space to clear the selection. Visual language: the constellation assembles in
 * (staggered scale/fade), close ties pulse a slow sonar ping, and the whole field drifts in a
 * very slow orbit — reads as alive, not static.
 */
export function CircleDotMap({
  contacts,
  selected = null,
  onSelect,
}: {
  contacts: ContactStrength[];
  selected?: string | null;
  onSelect?: (contact: string | null) => void;
}) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: 120000, easing: Easing.linear }), -1, false);
  }, [rotation]);

  // A plain `transform` string (rotate carries its own pivot) instead of the `rotation`+`origin`
  // props — react-native-svg's web shim turns `origin` into a literal `transform-origin` DOM
  // attribute, which React flags as an invalid property.
  const groupProps = useAnimatedProps(() => ({
    transform: `rotate(${rotation.value} ${CENTER} ${CENTER})`,
  }));

  const points: Point[] = useMemo(
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
        <Defs>
          <RadialGradient id="circleGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={Colors.accent} stopOpacity={0.14} />
            <Stop offset="100%" stopColor={Colors.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* Catches taps on empty space to clear the selection; dots draw on top and win the hit test. */}
        <Circle cx={CENTER} cy={CENTER} r={SIZE / 2} fill={Colors.background} fillOpacity={0.001} onPress={() => onSelect?.(null)} />

        <Circle cx={CENTER} cy={CENTER} r={RING_RADIUS.weak + 18} fill="url(#circleGlow)" />
        <Circle cx={CENTER} cy={CENTER} r={RING_RADIUS.close} stroke={Colors.border} strokeWidth={1} fill="none" />
        <Circle cx={CENTER} cy={CENTER} r={RING_RADIUS.active} stroke={Colors.border} strokeWidth={1} fill="none" />
        <Circle cx={CENTER} cy={CENTER} r={RING_RADIUS.weak} stroke={Colors.border} strokeWidth={1} fill="none" />

        <AnimatedG animatedProps={groupProps}>
          {points.map((p, i) => (
            <Dot key={p.contact} point={p} index={i} isSelected={p.contact === selected} onSelect={onSelect} />
          ))}
        </AnimatedG>

        <Circle cx={CENTER} cy={CENTER} r={6} fill={Colors.surface} stroke={Colors.text} strokeWidth={2} />
      </Svg>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Legend color={Colors.connection} label="Close" />
        <Legend color={Colors.accent} label="Active" />
        <Legend color={Colors.textMuted} label="Weak" />
      </View>
    </View>
  );
}

function Dot({
  point,
  index,
  isSelected,
  onSelect,
}: {
  point: Point;
  index: number;
  isSelected: boolean;
  onSelect?: (contact: string | null) => void;
}) {
  const baseR = DOT_RADIUS[point.tier];
  const progress = useSharedValue(0);
  const pulse = useSharedValue(0);
  const focus = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(index * 26, withSpring(1, { damping: 9, stiffness: 130 }));
    if (point.tier === 'close') {
      pulse.value = withDelay(
        500 + index * 26,
        withRepeat(withSequence(withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 0 })), -1, false),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, point.tier]);

  useEffect(() => {
    focus.value = withSpring(isSelected ? 1 : 0, { damping: 12, stiffness: 180 });
  }, [isSelected, focus]);

  const dotProps = useAnimatedProps(() => ({
    r: baseR * progress.value * (1 + focus.value * 0.35),
    opacity: progress.value,
  }));

  const glowProps = useAnimatedProps(() => ({
    r: baseR * (1 + pulse.value * 1.8),
    opacity: (1 - pulse.value) * 0.4 * progress.value,
  }));

  const ringProps = useAnimatedProps(() => ({
    r: (baseR + 7) * (0.7 + focus.value * 0.3),
    opacity: focus.value,
  }));

  const hitProps = useAnimatedProps(() => ({
    r: Math.max(baseR + 10, 16) * progress.value,
  }));

  return (
    <>
      {point.tier === 'close' && <AnimatedCircle cx={point.x} cy={point.y} fill={DOT_COLOR.close} animatedProps={glowProps} />}
      <AnimatedCircle cx={point.x} cy={point.y} stroke={Colors.text} strokeWidth={1.5} fill="none" animatedProps={ringProps} />
      <AnimatedCircle cx={point.x} cy={point.y} fill={DOT_COLOR[point.tier]} animatedProps={dotProps} />
      <AnimatedCircle
        cx={point.x}
        cy={point.y}
        fill={DOT_COLOR[point.tier]}
        fillOpacity={0.001}
        animatedProps={hitProps}
        onPress={() => onSelect?.(point.contact)}
      />
    </>
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
