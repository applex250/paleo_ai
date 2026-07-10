// 深度尺：自适应步长的深度刻度 + 横向网格线。移植 depth_track.py。
import React from 'react';
import { THEME } from '../../config';
import { depthToY, gridTicks } from '../../geo';
import type { TrackProps } from './types';

const DepthTrack: React.FC<TrackProps> = React.memo(
  ({ cfg, width, depthTop, depthBottom, headerBandY, headerH, contentY, contentH }) => {
    const ticks = gridTicks(depthTop, depthBottom, contentH);
    return (
      <g>
        {/* 单道表头 */}
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
          {cfg.label2 ? cfg.label2 : ''}
        </text>
        {/* 网格 + 刻度 */}
        {ticks.map((d) => {
          const y = depthToY(d, depthTop, depthBottom, contentY, contentH);
          return (
            <g key={d}>
              <line x1={0} y1={y} x2={width} y2={y} stroke={THEME.grid} strokeWidth={1} />
              <text
                x={width / 2}
                y={y}
                fontSize={11}
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={THEME.text}
                fontFamily={THEME.fontFamily}
              >
                {Math.round(d)}
              </text>
            </g>
          );
        })}
        {/* 右边框 */}
        <line x1={width} y1={contentY} x2={width} y2={contentY + contentH} stroke={THEME.border} strokeWidth={1} />
      </g>
    );
  },
);
DepthTrack.displayName = 'DepthTrack';
export default DepthTrack;
