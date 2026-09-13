import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { ThemedText, type ThemedTextProps } from '@/components/themed-text';

/**
 * Fades and slides content up on mount. Stagger a list by passing an increasing `delay` (ms) —
 * used everywhere a screen's cards should feel like they arrive together, not just appear.
 */
export function FadeInUp({
  children,
  delay = 0,
  duration = 420,
  distance = 14,
  style,
}: {
  children: ReactNode;
  delay?: number;
  duration?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
  }, [delay, duration, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * distance }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

/** A Pressable that scales down slightly on press — the tactile feedback a flat button lacks. */
export function AnimatedPressable({
  children,
  style,
  scaleTo = 0.96,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressableBase
      style={[style, animatedStyle]}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, { damping: 16, stiffness: 320 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 12, stiffness: 220 });
        onPressOut?.(e);
      }}
      {...rest}>
      {children}
    </AnimatedPressableBase>
  );
}

/** Counts a number up (or down) to its new value instead of snapping — small, but reads as "live". */
export function AnimatedNumber({
  value,
  duration = 600,
  ...rest
}: { value: number; duration?: number } & Omit<ThemedTextProps, 'children'>) {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    const end = value;
    if (start === end) return;
    const startedAt = Date.now();
    let raf: ReturnType<typeof requestAnimationFrame>;

    const tick = () => {
      const t = Math.min(1, (Date.now() - startedAt) / duration);
      const eased = 1 - (1 - t) * (1 - t);
      setDisplay(Math.round(start + (end - start) * eased));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        from.current = end;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <ThemedText {...rest}>{display}</ThemedText>;
}
