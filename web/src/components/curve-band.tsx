import Svg, { Line, Polygon, Polyline, Text as SvgText } from 'react-native-svg';

import { Colors, Fonts } from '@/constants/theme';
import type { MealCurveSeries } from '@/engine/meal';

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 200;
const PAD_LEFT = 34;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;

export function CurveBand({
  series,
  tMin,
  basalMgdl,
  walkWindow,
  height = 200,
}: {
  series: MealCurveSeries;
  tMin: number[];
  basalMgdl: number;
  walkWindow?: { startMin: number; endMin: number };
  height?: number;
}) {
  const plotW = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const minT = tMin[0];
  const maxT = tMin[tMin.length - 1];
  const allValues = [...series.p10, ...series.p90, basalMgdl];
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const yPad = (rawMax - rawMin) * 0.1 || 5;
  const minY = Math.floor(rawMin - yPad);
  const maxY = Math.ceil(rawMax + yPad);

  const x = (t: number) => PAD_LEFT + ((t - minT) / (maxT - minT)) * plotW;
  const y = (v: number) => PAD_TOP + plotH - ((v - minY) / (maxY - minY)) * plotH;

  const bandPoints = [
    ...tMin.map((t, i) => `${x(t)},${y(series.p90[i])}`),
    ...[...tMin].reverse().map((t, i) => `${x(t)},${y(series.p10[series.p10.length - 1 - i])}`),
  ].join(' ');

  const linePoints = tMin.map((t, i) => `${x(t)},${y(series.p50[i])}`).join(' ');

  const xTicks = [0, 60, 120, 180, 240].filter((t) => t <= maxT);
  const yTicks = [minY, (minY + maxY) / 2, maxY];

  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
      {walkWindow && (
        <Polygon
          points={`${x(walkWindow.startMin)},${PAD_TOP} ${x(walkWindow.endMin)},${PAD_TOP} ${x(
            walkWindow.endMin
          )},${PAD_TOP + plotH} ${x(walkWindow.startMin)},${PAD_TOP + plotH}`}
          fill={Colors.connection}
          fillOpacity={0.08}
        />
      )}

      {yTicks.map((v) => (
        <Line
          key={v}
          x1={PAD_LEFT}
          x2={VIEW_WIDTH - PAD_RIGHT}
          y1={y(v)}
          y2={y(v)}
          stroke={Colors.border}
          strokeWidth={1}
        />
      ))}

      <Line
        x1={PAD_LEFT}
        x2={VIEW_WIDTH - PAD_RIGHT}
        y1={y(basalMgdl)}
        y2={y(basalMgdl)}
        stroke={Colors.textMuted}
        strokeWidth={1}
        strokeDasharray="4,3"
      />

      <Polygon points={bandPoints} fill={Colors.accent} fillOpacity={0.15} />
      <Polyline points={linePoints} fill="none" stroke={Colors.accent} strokeWidth={2.5} />

      {yTicks.map((v) => (
        <SvgText
          key={v}
          x={PAD_LEFT - 6}
          y={y(v) + 3}
          fontSize={9}
          fontFamily={Fonts.body}
          fill={Colors.textMuted}
          textAnchor="end">
          {Math.round(v)}
        </SvgText>
      ))}

      {xTicks.map((t) => (
        <SvgText
          key={t}
          x={x(t)}
          y={VIEW_HEIGHT - 6}
          fontSize={9}
          fontFamily={Fonts.body}
          fill={Colors.textMuted}
          textAnchor="middle">
          {t}m
        </SvgText>
      ))}
    </Svg>
  );
}
