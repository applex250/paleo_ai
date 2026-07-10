// 文本道（岩性描述等长文本列）。本数据无此 sheet → 通常被 hasTrackData 过滤掉。
import React from 'react';
import { THEME } from '../../config';
import { depthToY, gridTicks } from '../../geo';
import { resolveTrackItems } from '../../transform';
import type { TrackProps } from './types';

const TextTrack: React.FC<TrackProps> = React.memo(({ cfg, data, width, depthTop, depthBottom, headerBandY, headerH, contentY, contentH }) => {
  const items = (resolveTrackItems(cfg, data) ?? []) as { top: number; bottom: number; name: string }[];
  const ticks = gridTicks(depthTop, depthBottom, contentH);

  return (
    <g>
      <rect x={0} y={headerBandY} width={width} height={headerH} fill={THEME.headerBg} stroke={THEME.border} />
      <text x={4} y={headerBandY + headerH / 2} fontSize={13} fontWeight={700} dominantBaseline="middle" fill={THEME.text} fontFamily={THEME.fontFamily}>
        {cfg.label}
      </text>
      {ticks.map((dp) => {
        const y = depthToY(dp, depthTop, depthBottom, contentY, contentH);
        return <line key={dp} x1={0} y1={y} x2={width} y2={y} stroke={THEME.grid} strokeWidth={1} />;
      })}
      {items.map((it, i) => {
        let yTop = depthToY(it.top, depthTop, depthBottom, contentY, contentH);
        let yBot = depthToY(it.bottom, depthTop, depthBottom, contentY, contentH);
        if (yBot < contentY || yTop > contentY + contentH) return null;
        yTop = Math.max(yTop, contentY);
        yBot = Math.min(yBot, contentY + contentH);
        return (
          <g key={`txt-${i}`}>
            <rect x={0} y={yTop} width={width} height={yBot - yTop} fill={THEME.subHeaderBg} stroke={THEME.border} strokeWidth={0.5} />
            {yBot - yTop > 14 && (
              <text x={3} y={(yTop + yBot) / 2} fontSize={10} dominantBaseline="middle" fill={THEME.text} fontFamily={THEME.fontFamily}>
                {it.name}
              </text>
            )}
          </g>
        );
      })}
      <rect x={0} y={contentY} width={width} height={contentH} fill="none" stroke={THEME.border} strokeWidth={1} />
    </g>
  );
});
TextTrack.displayName = 'TextTrack';
export default TextTrack;
