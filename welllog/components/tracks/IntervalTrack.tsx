// 通用区间道：地层（系/统/组）、层序、沉积相子列等。移植 interval_track.py。
// 非沉积相：colorMapping 子串匹配 → default → pastel 轮转。
// 沉积相（dataKey=facies）：仅 WellLogData.faciesColors 完整名称精确取色；无映射→稳定安全灰。
// 微相道在区间编辑模式下支持同一块右键双击编辑。
import React from 'react';
import { PASTEL_PALETTE, THEME, resolveFaciesIntervalColor } from '../../config';
import { depthToY, gridTicks, matchDict } from '../../geo';
import { resolveTrackItems } from '../../transform';
import type { IntervalItem, IntervalTrackConfig, WellLogData } from '../../types';
import type { TrackProps } from './types';

function intervalColor(
  cfg: IntervalTrackConfig,
  name: string,
  index: number,
  data: WellLogData,
): string {
  // 沉积相三轨道：全局注册表精确匹配，禁止 pastel/下标兜底
  if (cfg.dataKey === 'facies') {
    return resolveFaciesIntervalColor(name, data.faciesColors);
  }
  const cm = cfg.colorMapping;
  if (cm) {
    const m = matchDict(name, cm.colors);
    if (m) return m;
    if (cm.colors.default) return cm.colors.default;
  }
  return PASTEL_PALETTE[index % PASTEL_PALETTE.length];
}

const IntervalTrack: React.FC<TrackProps> = React.memo(
  ({
    cfg,
    data,
    width,
    depthTop,
    depthBottom,
    headerBandY,
    headerH,
    contentY,
    contentH,
    onIntervalBlockRightDoubleClick,
  }) => {
    if (cfg.type !== 'interval') return null;
    const items = (resolveTrackItems(cfg, data) ?? []) as IntervalItem[];
    const ticks = gridTicks(depthTop, depthBottom, contentH);
    const rotate = !!cfg.rotateText && width < 50;
    const isMicroPhase = cfg.dataKey === 'facies' && cfg.faciesLevel === 'microPhase';
    const enableBlockEdit = isMicroPhase && !!onIntervalBlockRightDoubleClick;
    const rightClickRef = React.useRef<{ key: string; at: number } | null>(null);

    const onBlockRightPointerUp = (
      e: React.PointerEvent<SVGRectElement>,
      key: string,
      payload: { top: number; bottom: number; name: string; source?: IntervalItem['source'] },
    ) => {
      if (!enableBlockEdit || e.button !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      const prior = rightClickRef.current;
      if (prior?.key === key && now - prior.at <= 500) {
        rightClickRef.current = null;
        onIntervalBlockRightDoubleClick!({ kind: 'microPhase', ...payload });
        return;
      }
      rightClickRef.current = { key, at: now };
    };

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
          const color = intervalColor(cfg, it.name, i, data);
          const showText = h > 14;
          const midY = (yTop + yBot) / 2;
          const keyBase =
            it.source?.type === 'xlsx'
              ? `${it.source.sheet}-${it.source.row}`
              : it.source?.type === 'create'
                ? it.source.operationId
                : String(i);
          return (
            <g key={`${it.name}-${keyBase}`}>
              <rect
                x={0}
                y={yTop}
                width={width}
                height={h}
                fill={color}
                stroke={THEME.border}
                strokeWidth={0.5}
                style={enableBlockEdit ? { cursor: 'context-menu' } : undefined}
                onPointerDown={
                  enableBlockEdit
                    ? (e) => {
                        if (e.button === 2) {
                          e.preventDefault();
                          e.stopPropagation();
                        }
                      }
                    : undefined
                }
                onPointerUp={
                  enableBlockEdit
                    ? (e) => onBlockRightPointerUp(e, keyBase, it)
                    : undefined
                }
              />
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
                    style={enableBlockEdit ? { pointerEvents: 'none' } : undefined}
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
                    style={enableBlockEdit ? { pointerEvents: 'none' } : undefined}
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
  },
);
IntervalTrack.displayName = 'IntervalTrack';
export default IntervalTrack;
