import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import type { wellbeingTier } from '@/engine/wellbeing';

const SIZE = 168;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreRing({ score, tier }: { score: number; tier: ReturnType<typeof wellbeingTier> }) {
  const color = tier === 'good' ? Colors.connection : tier === 'fair' ? Colors.accent : Colors.critical;
  const offset = CIRCUMFERENCE * (1 - score / 100);

  return (
    <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke={Colors.border} strokeWidth={STROKE} fill="none" />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={color}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${SIZE / 2}, ${SIZE / 2}`}
        />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <ThemedText type="numeric" style={{ fontSize: 40, lineHeight: 46 }}>
          {score}%
        </ThemedText>
        <ThemedText type="small" themeColor="textMuted">
          wellbeing
        </ThemedText>
      </View>
    </View>
  );
}
