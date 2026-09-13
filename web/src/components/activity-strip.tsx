import { View } from 'react-native';

import { Colors } from '@/constants/theme';
import type { Day } from '@/lib/api';

const LEVEL_OPACITY = [1, 0.35, 0.65, 1];

/** A day-by-day strip of who-you-talked-to-that-day (GET /circle/summary's `heatmap`), darker for
 * more people that day. `level` 0 renders as a neutral dot — quiet, not "bad" (weekends happen). */
export function ActivityStrip({ days }: { days: Day[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
      {days.map((d) => (
        <View
          key={d.date}
          style={{
            width: 8,
            height: 8,
            borderRadius: 2,
            backgroundColor: d.level === 0 ? Colors.border : Colors.connection,
            opacity: LEVEL_OPACITY[d.level],
          }}
        />
      ))}
    </View>
  );
}
