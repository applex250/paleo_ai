/**
 * 微相名称候选：按名称输入切换。
 * - 名称为空：区间中心深度命中唯一亚相后，精确/去后缀包含式模糊匹配规则组微相（无关键词回退）。
 * - 名称非空：忽略深度与亚相，对全部导入规则微相做 trim/NFC 包含过滤（英文大小写不敏感）。
 * 纯函数，无 DOM / 网络依赖；供新建/既有区间编辑弹窗与自测复用。
 */

/** 亚相规则组：一列亚相 → 有序微相列表（与 API 形态一致）。 */
export interface MicroPhaseRuleGroup {
  subPhase: string;
  microPhases: string[];
}

/** 深度区间（亚相等）；name 为亚相名称。 */
export interface DepthNamedInterval {
  top: number;
  bottom: number;
  name: string;
}

/** trim + Unicode NFC，与服务端规则名规范化一致。 */
export function normalizeName(raw: string): string {
  return String(raw ?? '')
    .trim()
    .normalize('NFC');
}

/** 英文大小写不敏感比较用：NFC + 小写（中文不受影响）。 */
function foldForContains(raw: string): string {
  return normalizeName(raw).toLowerCase();
}

/**
 * 区间中心深度：(min+max)/2。
 * 非有限数字返回 null；顶底可颠倒（先取 min/max）。
 */
export function intervalMidpoint(top: number, bottom: number): number | null {
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  const lo = Math.min(top, bottom);
  const hi = Math.max(top, bottom);
  return (lo + hi) / 2;
}

/**
 * 深度落在区间内（含边界）：depth ∈ [min(top,bottom), max(top,bottom)]。
 * 忽略无效数字或空名称的区间。
 */
export function intervalsContainingDepth(
  depth: number,
  intervals: readonly DepthNamedInterval[],
): DepthNamedInterval[] {
  if (!Number.isFinite(depth) || !Array.isArray(intervals)) return [];
  const hits: DepthNamedInterval[] = [];
  for (const it of intervals) {
    if (!it || !Number.isFinite(it.top) || !Number.isFinite(it.bottom)) continue;
    const name = normalizeName(it.name);
    if (!name) continue;
    const lo = Math.min(it.top, it.bottom);
    const hi = Math.max(it.top, it.bottom);
    if (depth >= lo && depth <= hi) hits.push(it);
  }
  return hits;
}

/** 供亚相名称比较使用：去掉空白/常见标点及末尾层级后缀。 */
function compactSubPhaseName(raw: string): string {
  return normalizeName(raw)
    .replace(/[\s\-—–_()（）\[\]【】、,，。./\\]/g, '')
    .replace(/(?:沉积)?(?:微)?亚相$/u, '')
    .replace(/(?:沉积)?相$/u, '');
}

function uniqueGroup(groups: MicroPhaseRuleGroup[]): MicroPhaseRuleGroup | null {
  return groups.length === 1 ? groups[0] : null;
}

/**
 * 为当前井的亚相名定位唯一规则组。
 * 优先级：规范化精确匹配 → 去层级后缀/空白/标点后的包含式模糊匹配。
 * 任一层出现并列候选或不命中均不猜测，返回 null（不再关键词回退）。
 */
export function findRuleGroupForSubPhase(
  subPhaseName: string,
  ruleGroups: readonly MicroPhaseRuleGroup[],
): MicroPhaseRuleGroup | null {
  const exact = normalizeName(subPhaseName);
  const groups = (Array.isArray(ruleGroups) ? ruleGroups : []).filter(
    (g): g is MicroPhaseRuleGroup => Boolean(g && normalizeName(g.subPhase)),
  );
  if (!exact || groups.length === 0) return null;

  const exactMatch = uniqueGroup(groups.filter((g) => normalizeName(g.subPhase) === exact));
  if (exactMatch) return exactMatch;

  const compact = compactSubPhaseName(subPhaseName);
  if (!compact) return null;
  return uniqueGroup(
    groups.filter((g) => {
      const candidate = compactSubPhaseName(g.subPhase);
      return candidate.length > 0 && (candidate.includes(compact) || compact.includes(candidate));
    }),
  );
}

/** 根据亚相名找到唯一规则组后返回其微相列表；未匹配或有歧义返回 []。 */
export function microPhasesForSubPhase(
  subPhaseName: string,
  ruleGroups: readonly MicroPhaseRuleGroup[],
): string[] {
  const group = findRuleGroupForSubPhase(subPhaseName, ruleGroups);
  if (!group) return [];
  return dedupeMicroPhasesInOrder(group.microPhases ?? []);
}

/**
 * 按规则组列序、组内行序扁平收集全部导入微相名，normalize 后去重保序。
 * 不读取井内已有微相名。
 */
export function allImportedMicroPhases(
  ruleGroups: readonly MicroPhaseRuleGroup[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of Array.isArray(ruleGroups) ? ruleGroups : []) {
    if (!g) continue;
    for (const raw of g.microPhases ?? []) {
      const m = normalizeName(String(raw ?? ''));
      if (!m || seen.has(m)) continue;
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

/** 组内微相去重保序（normalize 后比较）。 */
function dedupeMicroPhasesInOrder(microPhases: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of microPhases) {
    const m = normalizeName(String(raw ?? ''));
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

/**
 * 名称非空时：对全部导入微相做包含式过滤。
 * - query / 候选均 trim + NFC；英文 toLowerCase 后 contains
 * - 保留规则列/行原始顺序中的首次出现
 */
export function filterMicroPhasesByNameQuery(
  nameQuery: string,
  ruleGroups: readonly MicroPhaseRuleGroup[],
): string[] {
  const q = foldForContains(nameQuery);
  if (!q) return allImportedMicroPhases(ruleGroups);
  return allImportedMicroPhases(ruleGroups).filter((m) => foldForContains(m).includes(q));
}

/**
 * 根据当前顶/底深推荐微相列表（名称输入为空时的路径）。
 * - 中心深度 = midpoint(top, bottom)
 * - 亚相区间含边界匹配；仅当**恰好一个**区间命中时推荐该亚相组的微相
 * - 零命中、多命中、无匹配规则组 → []
 * - 亚相名与规则组名：精确 → 去后缀包含式模糊；歧义或不命中 → []（无关键词回退）
 * - 不合并井内已有微相名；旧扁平规则不参与
 */
export function recommendMicroPhases(
  top: number,
  bottom: number,
  subPhaseIntervals: readonly DepthNamedInterval[],
  ruleGroups: readonly MicroPhaseRuleGroup[],
): string[] {
  const mid = intervalMidpoint(top, bottom);
  if (mid == null) return [];
  const hits = intervalsContainingDepth(mid, subPhaseIntervals);
  if (hits.length !== 1) return [];
  return microPhasesForSubPhase(hits[0].name, ruleGroups);
}

/**
 * 微相名称候选（弹窗主入口）：按名称输入切换。
 * - nameInput 经 trim 后为空：解析顶/底，走亚相定向推荐（非法数字 → []）
 * - nameInput 非空：忽略深度与亚相，从全部导入规则微相按包含过滤
 */
export function recommendMicroPhasesFromInput(
  topStr: string,
  bottomStr: string,
  subPhaseIntervals: readonly DepthNamedInterval[],
  ruleGroups: readonly MicroPhaseRuleGroup[],
  nameInput: string = '',
): string[] {
  const nameTrimmed = normalizeName(nameInput);
  if (nameTrimmed) {
    return filterMicroPhasesByNameQuery(nameTrimmed, ruleGroups);
  }
  const top = Number(topStr);
  const bottom = Number(bottomStr);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return [];
  return recommendMicroPhases(top, bottom, subPhaseIntervals, ruleGroups);
}
