// 通用区间道：地层（系/统/组）、层序、沉积相子列等。移植 interval_track.py。
// 矩形填色（colorMapping 子串匹配 → default → pastel 轮转），窄道竖排文字。
import React from 'react';
import { PASTEL_PALETTE, THEME } from '../../config';
import { depthToY, gridTicks, matchDict } from '../../geo';
import { resolveTrackItems } from '../../transform';
import type { IntervalTrackConfig } from '../../types';
import type { TrackProps } from './types';

function intervalColor(cfg: IntervalTrackConfig, name: string, index: number): string {
  const cm = cfg.colorMapping;
  if (cm) {
    const m = matchDict(name, cm.colors);
    if (m) return m;
    if (cm.colors.default) return cm.colors.default;
  }
  return PASTEL_PALETTE[index % PASTEL_PALETTE.length];
}

const IntervalTrack: React.FC<TrackProps> = React.memo(({ cfg, data, width, depthTop, depthBottom, headerBandY, headerH, contentY, contentH }) => {
  if (cfg.type !== 'interval') return null;
  const items = (resolveTrackItems(cfg, data) ?? []) as { top: number; bottom: number; name: string }[];
  const ticks = gridTicks(depthTop, depthBottom, contentH);
  const rotate = !!cfg.rotateText && width < 50;

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

      {/* 区间 */}
      {items.map((it, i) => {
        let yTop = depthToY(it.top, depthTop, depthBottom, contentY, contentH);
        let yBot = depthToY(it.bottom, depthTop, depthBottom, contentY, contentH);
        if (yBot < contentY || yTop > contentY + contentH) return null;
        yTop = Math.max(yTop, contentY);
        yBot = Math.min(yBot, contentY + contentH);
        const h = yBot - yTop;
        const color = intervalColor(cfg, it.name, i);
        const showText = h > 14;
        const midY = (yTop + yBot) / 2;
        return (
          <g key={`${it.name}-${i}`}>
            <rect x={0} y={yTop} width={width} height={h} fill={color} stroke={THEME.border} strokeWidth={0.5} />
            {showText &&
              (rotate ? (
                <text
                  x={midY}
                  y={width / 2}
                  fontSize={11}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={THEME.text}
                  fontFamily={THEME.fontFamily}
                  transform={`rotate(-90 ${midY} ${width / 2})`}
                >
                  {it.name}
                </text>
              ) : (
                <text
                  x={width / 2}
                  y={midY}
                  fontSize={10}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={THEME.text}
                  fontFamily={THEME.fontFamily}
                >
                  {it.name}
                </text>
              ))}
          </g>
        );
      })}

      {/* 边框 */}
      <rect x={0} y={contentY} width={width} height={contentH} fill="none" stroke={THEME.border} strokeWidth={1} />
    </g>
  );
});
IntervalTrack.displayName = 'IntervalTrack';
export default IntervalTrack;
