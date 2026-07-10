// 测井曲线道：支持同道多曲线叠加（主曲线 + 副曲线），**共享主曲线横轴量程**。
// 列头 SVG 行式：主曲线(色块+名+量程) + 副曲线(色块+名，逐行，超出 +N) + 右上角 ➕（打开副曲线下拉）。
// ⚡ 共享量程 R = curveRange ?? primary.displayRange，全道所有 CurvePath 用同一个 R。
// ⚡ CurvePath 用 React.memo + range 入依赖；增删副曲线只挂/卸该道那条 path。
// ⚡ curves 按 curveNames 顺序映射（主曲线恒在首位），不用 data.curves 原序。
import React, { useId, useMemo } from 'react';
import { LOG_CURVES, THEME } from '../../config';
import { buildCurveSegments, depthToY, gridTicks, segmentsToPath, valueToX } from '../../geo';
import type { CurveData } from '../../types';
import type { TrackProps } from './types';

const DASH: Record<string, string | undefined> = { dashed: '6 4', dotted: '2 3' };

const CurveTrack: React.FC<TrackProps> = React.memo(({ cfg, data, width, depthTop, depthBottom, headerBandY, headerH, contentY, contentH, curveRange, onOpenCurveMenu }) => {
  if (cfg.type !== 'curves') return null;
  // 按 curveNames 顺序解析（主曲线首位，副曲线随后）
  const curves: CurveData[] = cfg.curveNames
    .map((n) => data.curves.find((c) => c.name === n))
    .filter((c): c is CurveData => !!c);
  if (curves.length === 0) return null;

  const primary = curves[0];
  const secondaries = curves.slice(1);
  const R: [number, number] = curveRange ?? primary.displayRange; // 全道共享量程
  const ticks = gridTicks(depthTop, depthBottom, contentH);
  const clipId = 'wlclip' + useId().replace(/:/g, '');

  const openMenu = (e: React.PointerEvent): void => {
    // 用 pointerdown 打开并阻止冒泡：内容 svg 的拖拽 onPointerDown 会 setPointerCapture，
    // 使 pointerup 落到 svg、click 不再派发到 ➕ —— 故不能依赖 onClick。
    e.stopPropagation();
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    onOpenCurveMenu?.(primary.name, rect);
  };

  // 副曲线行：从 headerBandY+40 起每 16px，超出 headerBandY+headerH-6 则 +N
  const maxSecY = headerBandY + headerH - 6;
  const secRows: { c?: CurveData; plus?: number; y: number }[] = [];
  let sy = headerBandY + 40;
  for (let i = 0; i < secondaries.length; i++) {
    if (sy > maxSecY) {
      secRows.push({ plus: secondaries.length - i, y: sy });
      break;
    }
    secRows.push({ c: secondaries[i], y: sy });
    sy += 16;
  }

  return (
    <g>
      {/* 列头 */}
      <rect x={0} y={headerBandY} width={width} height={headerH} fill={THEME.headerBg} stroke={THEME.border} />
      {/* 主曲线：线型示意(颜色+实/虚/点) + 名(粗) + 量程(右) */}
      <line x1={4} y1={headerBandY + 14} x2={20} y2={headerBandY + 14} stroke={primary.color} strokeWidth={1.8} strokeDasharray={DASH[primary.lineStyle]} strokeLinecap="round" />
      <text x={24} y={headerBandY + 18} fontSize={13} fontWeight={700} fill={THEME.text} fontFamily={THEME.fontFamily}>
        {primary.name}
      </text>
      <text x={width - 22} y={headerBandY + 18} fontSize={10} textAnchor="end" fill={THEME.muted} fontFamily={THEME.fontFamily}>
        [{R[0]}, {R[1]}]
      </text>
      {/* 副曲线：线型示意 + 名，逐行 */}
      {secRows.map((row, i) =>
        row.c ? (
          <g key={`sec-${i}`}>
            <line x1={4} y1={row.y - 4} x2={20} y2={row.y - 4} stroke={row.c.color} strokeWidth={1.8} strokeDasharray={DASH[row.c.lineStyle]} strokeLinecap="round" />
            <text x={24} y={row.y} fontSize={11} fill={THEME.text} fontFamily={THEME.fontFamily}>
              {row.c.name}
            </text>
          </g>
        ) : (
          <text key={`sec-${i}`} x={24} y={row.y} fontSize={10} fill={THEME.muted} fontFamily={THEME.fontFamily}>
            +{row.plus}
          </text>
        ),
      )}
      {/* ➕ 副曲线下拉按钮（pointerdown 打开，避免被画布拖拽的 pointer capture 吞掉点击） */}
      <g onPointerDown={openMenu} style={{ cursor: 'pointer' }}>
        <rect x={width - 18} y={headerBandY + 3} width={15} height={15} rx={2} fill="#fff" stroke={THEME.border} />
        <text x={width - 10.5} y={headerBandY + 15} fontSize={13} textAnchor="middle" fill={THEME.text} fontFamily={THEME.fontFamily}>
          ＋
        </text>
      </g>

      {/* 内容区裁剪：超出深度区间的线段不越过列头/底边 */}
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={contentY} width={width} height={contentH} />
        </clipPath>
      </defs>

      {/* 网格 + 曲线（全部用共享量程 R），裁剪到内容区 */}
      <g clipPath={`url(#${clipId})`}>
        {ticks.map((d) => {
          const y = depthToY(d, depthTop, depthBottom, contentY, contentH);
          return <line key={d} x1={0} y1={y} x2={width} y2={y} stroke={THEME.grid} strokeWidth={1} />;
        })}
        {curves.map((c) => (
          <CurvePath key={c.name} curve={c} range={R} width={width} depthTop={depthTop} depthBottom={depthBottom} contentY={contentY} contentH={contentH} />
        ))}
      </g>

      {/* 量程标注（左上 lo / 左下 hi，共享 R） */}
      <text x={2} y={contentY + 11} fontSize={10} fill={THEME.muted} fontFamily={THEME.fontFamily}>
        {R[0]}
      </text>
      <text x={2} y={contentY + contentH - 4} fontSize={10} fill={THEME.muted} fontFamily={THEME.fontFamily}>
        {R[1]}
      </text>

      {/* 边框 */}
      <rect x={0} y={contentY} width={width} height={contentH} fill="none" stroke={THEME.border} strokeWidth={1} />
    </g>
  );
});
CurveTrack.displayName = 'CurveTrack';

interface CurvePathProps {
  curve: CurveData;
  range: [number, number];
  width: number;
  depthTop: number;
  depthBottom: number;
  contentY: number;
  contentH: number;
}

const CurvePath: React.FC<CurvePathProps> = React.memo(({ curve, range, width, depthTop, depthBottom, contentY, contentH }) => {
  const log = LOG_CURVES.has(curve.name);
  const d = useMemo(() => {
    const segs = buildCurveSegments(curve, Math.max(1, Math.round(contentH)));
    const toX = (v: number) => valueToX(v, range, 0, width, log);
    const toY = (dep: number) => depthToY(dep, depthTop, depthBottom, contentY, contentH);
    return segmentsToPath(segs, toX, toY);
  }, [curve, range, width, log, depthTop, depthBottom, contentY, contentH]);
  return (
    <path
      d={d}
      stroke={curve.color}
      strokeWidth={THEME.strokeWidth}
      strokeDasharray={DASH[curve.lineStyle]}
      fill="none"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
});
CurvePath.displayName = 'CurvePath';

export default CurveTrack;
