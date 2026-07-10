// 岩性道（dataKey='lithology'）：区间用 SVG 纹样平铺填充，无匹配回退色。移植 lithology_track.py。
// 纹样 id 由 matchMapping(岩性, LITHOLOGY_MAPPING.patterns) 解析；纹样 <defs> 由 Canvas 注册。
import React from 'react';
import { DEFAULT_LITHOLOGY_COLOR, FACIES_COLORS, LITHOLOGY_MAPPING, THEME } from '../../config';
import { depthToY, gridTicks, matchDict } from '../../geo';
import type { LithologyInterval } from '../../types';
import type { TrackProps } from './types';

function resolveFill(lithology: string): { fill: string; isPattern: boolean } {
  const patternId = matchDict(lithology, LITHOLOGY_MAPPING.patterns);
  if (patternId) return { fill: `url(#${patternId})`, isPattern: true };
  const color =
    matchDict(lithology, LITHOLOGY_MAPPING.colors) ??
    matchDict(lithology, FACIES_COLORS) ??
    DEFAULT_LITHOLOGY_COLOR;
  return { fill: color, isPattern: false };
}

const LithologyTrack: React.FC<TrackProps> = React.memo(({ cfg, data, width, depthTop, depthBottom, headerBandY, headerH, contentY, contentH }) => {
  const items = data.lithology;
  const ticks = gridTicks(depthTop, depthBottom, contentH);

  return (
    <g>
      {/* 表头 */}
      <rect x={0} y={headerBandY} width={width} height={headerH} fill={THEME.headerBg} stroke={THEME.border} />
      <text
        x={width / 2}
        y={headerBandY + headerH / 2}
        fontSize={13}
        fontWeight={700}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={THEME.text}
        fontFamily={THEME.fontFamily}
      >
        {cfg.label}
      </text>

      {/* 网格 */}
      {ticks.map((dp) => {
        const y = depthToY(dp, depthTop, depthBottom, contentY, contentH);
        return <line key={dp} x1={0} y1={y} x2={width} y2={y} stroke={THEME.grid} strokeWidth={1} />;
      })}

      {/* 岩性区间 */}
      {items.map((it: LithologyInterval, i) => {
        let yTop = depthToY(it.top, depthTop, depthBottom, contentY, contentH);
        let yBot = depthToY(it.bottom, depthTop, depthBottom, contentY, contentH);
        if (yBot < contentY || yTop > contentY + contentH) return null;
        yTop = Math.max(yTop, contentY);
        yBot = Math.min(yBot, contentY + contentH);
        const h = yBot - yTop;
        const { fill } = resolveFill(it.lithology);
        const showText = h > 16;
        return (
          <g key={`lith-${i}`}>
            <rect x={0} y={yTop} width={width} height={h} fill={fill} stroke={THEME.border} strokeWidth={0.5} />
            {showText && (
              <text
                x={width / 2}
                y={(yTop + yBot) / 2}
                fontSize={10}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={THEME.text}
                fontFamily={THEME.fontFamily}
              >
                {it.lithology}
              </text>
            )}
          </g>
        );
      })}

      {/* 边框 */}
      <rect x={0} y={contentY} width={width} height={contentH} fill="none" stroke={THEME.border} strokeWidth={1} />
    </g>
  );
});
LithologyTrack.displayName = 'LithologyTrack';
export default LithologyTrack;
