/**
 * 微相名称候选纯函数自测：空名亚相模糊、全局搜索、排序去重、英文大小写、深度变化。
 * 运行：npx tsx welllog/microPhaseRecommendations.selftest.ts
 */
import {
  intervalMidpoint,
  intervalsContainingDepth,
  findRuleGroupForSubPhase,
  microPhasesForSubPhase,
  allImportedMicroPhases,
  filterMicroPhasesByNameQuery,
  recommendMicroPhases,
  recommendMicroPhasesFromInput,
  type DepthNamedInterval,
  type MicroPhaseRuleGroup,
} from './microPhaseRecommendations';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  OK  ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL ${msg}`);
  }
}

function assertEq(a: unknown, b: unknown, msg: string): void {
  const ok = Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
  assert(ok, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

const groups: MicroPhaseRuleGroup[] = [
  { subPhase: '三角洲前缘', microPhases: ['河口坝', '远砂坝', '水下分流河道'] },
  { subPhase: '潮坪', microPhases: ['泥坪', '砂坪', '混合坪'] },
];

const subPhases: DepthNamedInterval[] = [
  { top: 100, bottom: 200, name: '三角洲前缘' },
  { top: 200, bottom: 300, name: '潮坪' },
  { top: 400, bottom: 500, name: '三角洲前缘' },
];

console.log('--- intervalMidpoint ---');
{
  assertEq(intervalMidpoint(100, 200), 150, '正常中点');
  assertEq(intervalMidpoint(200, 100), 150, '顶底颠倒仍取中点');
  assertEq(intervalMidpoint(10, 10), 10, '零厚度中点=自身');
  assertEq(intervalMidpoint(NaN, 1), null, 'NaN → null');
  assertEq(intervalMidpoint(1, Infinity), null, 'Infinity → null');
}

console.log('--- intervalsContainingDepth 含边界 ---');
{
  const hitsMid = intervalsContainingDepth(150, subPhases);
  assertEq(hitsMid.length, 1, '内部命中 1');
  assertEq(hitsMid[0]?.name, '三角洲前缘', '内部命中名');

  const hitsTop = intervalsContainingDepth(100, subPhases);
  assertEq(hitsTop.length, 1, '顶界 inclusive');
  assertEq(hitsTop[0]?.name, '三角洲前缘', '顶界名');

  const hitsBot = intervalsContainingDepth(200, subPhases);
  // 100-200 与 200-300 在 200 处均 inclusive → 重叠
  assertEq(hitsBot.length, 2, '相邻共享底/顶边界 → 2 命中');

  const hitsNone = intervalsContainingDepth(350, subPhases);
  assertEq(hitsNone.length, 0, '间隙未命中');
}

console.log('--- recommendMicroPhases: 唯一命中 ---');
{
  const rec = recommendMicroPhases(120, 180, subPhases, groups);
  assertEq(rec, ['河口坝', '远砂坝', '水下分流河道'], '中点 150 → 三角洲前缘微相');

  const rec2 = recommendMicroPhases(220, 280, subPhases, groups);
  assertEq(rec2, ['泥坪', '砂坪', '混合坪'], '中点 250 → 潮坪微相');
}

console.log('--- recommendMicroPhases: 边界唯一命中 ---');
{
  // 100 仅落在 [100,200]
  const rec = recommendMicroPhases(100, 100, subPhases, groups);
  assertEq(rec, ['河口坝', '远砂坝', '水下分流河道'], '零厚度中点在顶界');

  // [100, 200] 中点 150，唯一
  const recEdge = recommendMicroPhases(100, 200, subPhases, groups);
  assertEq(recEdge, ['河口坝', '远砂坝', '水下分流河道'], '整段中点仍唯一');
}

console.log('--- recommendMicroPhases: 零命中 ---');
{
  assertEq(recommendMicroPhases(340, 360, subPhases, groups), [], '间隙 → 无推荐');
  assertEq(recommendMicroPhases(10, 20, subPhases, groups), [], '井段外 → 无推荐');
  assertEq(recommendMicroPhases(150, 160, [], groups), [], '无亚相区间 → 无推荐');
  assertEq(recommendMicroPhases(150, 160, subPhases, []), [], '无规则组 → 有亚相但无微相列表');
}

console.log('--- recommendMicroPhases: 多命中（重叠）→ 无推荐 ---');
{
  const overlap: DepthNamedInterval[] = [
    { top: 100, bottom: 200, name: '三角洲前缘' },
    { top: 150, bottom: 250, name: '潮坪' },
  ];
  assertEq(recommendMicroPhases(160, 180, overlap, groups), [], '重叠 → 空');
  // 相邻 inclusive 边界共享点
  assertEq(recommendMicroPhases(200, 200, subPhases, groups), [], '共享边界点多命中 → 空');
}

console.log('--- recommendMicroPhases: 亚相无对应规则组 ---');
{
  const unknown: DepthNamedInterval[] = [{ top: 0, bottom: 50, name: '未知亚相' }];
  assertEq(recommendMicroPhases(10, 20, unknown, groups), [], '有命中但规则无该亚相 → 空');
}

console.log('--- 深度输入变化（FromInput 空名）---');
{
  assertEq(
    recommendMicroPhasesFromInput('120', '180', subPhases, groups, ''),
    ['河口坝', '远砂坝', '水下分流河道'],
    '输入 120-180 → 三角洲前缘',
  );
  assertEq(
    recommendMicroPhasesFromInput('220', '280', subPhases, groups),
    ['泥坪', '砂坪', '混合坪'],
    '改为 220-280 → 潮坪',
  );
  assertEq(
    recommendMicroPhasesFromInput('340', '360', subPhases, groups, '   '),
    [],
    '改为间隙 → 清空',
  );
  assertEq(
    recommendMicroPhasesFromInput('abc', '180', subPhases, groups, ''),
    [],
    '非法顶深 → 空',
  );
  assertEq(
    recommendMicroPhasesFromInput('180', '120', subPhases, groups, ''),
    ['河口坝', '远砂坝', '水下分流河道'],
    '输入颠倒仍按中点',
  );
}

console.log('--- microPhasesForSubPhase 规范化 ---');
{
  assertEq(
    microPhasesForSubPhase('  潮坪  ', groups),
    ['泥坪', '砂坪', '混合坪'],
    'trim 匹配',
  );
  assertEq(microPhasesForSubPhase('不存在', groups), [], '未知亚相');
}

console.log('--- 空名：亚相模糊成功 / 零匹配 / 歧义（无关键词回退）---');
{
  const fuzzyGroups: MicroPhaseRuleGroup[] = [
    { subPhase: '下三角洲平原亚相', microPhases: ['分流河道微相', '天然堤微相'] },
    { subPhase: '三角洲平原下部亚相', microPhases: ['决口扇微相'] },
  ];
  assertEq(
    microPhasesForSubPhase('下三角洲平原', fuzzyGroups),
    ['分流河道微相', '天然堤微相'],
    '空路径：去“亚相”后缀后的包含式模糊匹配成功',
  );
  assertEq(
    microPhasesForSubPhase('下三角洲平原', [fuzzyGroups[1]]),
    [],
    '模糊零匹配 → 空（不再关键词回退）',
  );
  // 两个规则组 compact 后都可被「三角洲平原」双向包含 → 歧义
  const ambiguousFuzzy: MicroPhaseRuleGroup[] = [
    { subPhase: '三角洲平原下部亚相', microPhases: ['决口扇微相'] },
    { subPhase: '三角洲平原上部亚相', microPhases: ['分流间洼地微相'] },
  ];
  assertEq(
    findRuleGroupForSubPhase('三角洲平原', ambiguousFuzzy),
    null,
    '模糊歧义 → null',
  );
  assertEq(microPhasesForSubPhase('三角洲平原', ambiguousFuzzy), [], '模糊歧义 → 空微相');

  // 端到端：空名 + 唯一亚相区间 + 模糊成功
  const fuzzySub: DepthNamedInterval[] = [{ top: 0, bottom: 100, name: '下三角洲平原' }];
  assertEq(
    recommendMicroPhasesFromInput('10', '20', fuzzySub, fuzzyGroups, ''),
    ['分流河道微相', '天然堤微相'],
    '空名 + 唯一亚相 + 模糊 → 该组微相',
  );
  assertEq(
    recommendMicroPhasesFromInput('10', '20', fuzzySub, [fuzzyGroups[1]], ''),
    [],
    '空名 + 模糊零匹配 → 空',
  );
}

console.log('--- 非空名：全局搜索，与亚相/深度无关 ---');
{
  // 中点落在潮坪，但输入「河」应从全部规则微相过滤，不限于潮坪组
  assertEq(
    recommendMicroPhasesFromInput('220', '280', subPhases, groups, '河'),
    ['河口坝', '水下分流河道'],
    '单字符「河」全局包含过滤（含前缘组，非当前亚相）',
  );
  assertEq(
    recommendMicroPhasesFromInput('340', '360', subPhases, groups, '坝'),
    ['河口坝', '远砂坝'],
    '间隙深度仍可按名称全局搜索',
  );
  assertEq(
    recommendMicroPhasesFromInput('abc', 'xyz', subPhases, groups, '砂'),
    ['远砂坝', '砂坪'],
    '非法深度 + 非空名 → 仍全局搜索',
  );
  // 无匹配
  assertEq(
    recommendMicroPhasesFromInput('120', '180', subPhases, groups, '不存在的微相zzz'),
    [],
    '全局无匹配 → 空',
  );
}

console.log('--- 排序/去重：规则列行序扁平 ---');
{
  const ordered: MicroPhaseRuleGroup[] = [
    { subPhase: 'A', microPhases: ['河口坝', '远砂坝', '河口坝'] },
    { subPhase: 'B', microPhases: ['远砂坝', '泥坪', '  河口坝  '] },
  ];
  assertEq(
    allImportedMicroPhases(ordered),
    ['河口坝', '远砂坝', '泥坪'],
    '列序+行序扁平，normalize 去重保首次',
  );
  assertEq(
    filterMicroPhasesByNameQuery('坝', ordered),
    ['河口坝', '远砂坝'],
    '过滤保持首次出现顺序',
  );
}

console.log('--- 英文大小写不敏感 + NFC/trim ---');
{
  const eng: MicroPhaseRuleGroup[] = [
    { subPhase: 'Shoreface', microPhases: ['Upper Shoreface', 'lower shoreface', 'Tidal Channel'] },
  ];
  assertEq(
    recommendMicroPhasesFromInput('0', '1', [], eng, 'shore'),
    ['Upper Shoreface', 'lower shoreface'],
    '小写 query 匹配大小写混合候选',
  );
  assertEq(
    recommendMicroPhasesFromInput('0', '1', [], eng, 'CHANNEL'),
    ['Tidal Channel'],
    '大写 query 匹配',
  );
  assertEq(
    recommendMicroPhasesFromInput('0', '1', [], eng, '  tidal  '),
    ['Tidal Channel'],
    'query trim 后匹配',
  );
  // NFC：合成/分解形式
  const nfcQuery = 'e\u0301'; // e + combining acute
  const nfcName = '\u00e9'; // precomposed é
  const nfcGroups: MicroPhaseRuleGroup[] = [
    { subPhase: 'X', microPhases: [`caf${nfcName}`] },
  ];
  assertEq(
    recommendMicroPhasesFromInput('0', '1', [], nfcGroups, `caf${nfcQuery}`),
    [`caf${nfcName}`],
    'NFC 规范化后包含匹配',
  );
}

console.log('--- 深度字段变化：仅空名路径受影响 ---');
{
  assertEq(
    recommendMicroPhasesFromInput('120', '180', subPhases, groups, ''),
    ['河口坝', '远砂坝', '水下分流河道'],
    '空名 120-180 → 前缘',
  );
  assertEq(
    recommendMicroPhasesFromInput('220', '280', subPhases, groups, ''),
    ['泥坪', '砂坪', '混合坪'],
    '空名改深度 → 潮坪',
  );
  // 非空名时改深度不改变候选
  const withNameA = recommendMicroPhasesFromInput('120', '180', subPhases, groups, '坝');
  const withNameB = recommendMicroPhasesFromInput('220', '280', subPhases, groups, '坝');
  assertEq(withNameA, withNameB, '非空名时改深度候选不变');
  assertEq(withNameA, ['河口坝', '远砂坝'], '非空名候选内容');
}

console.log('');
if (failed > 0) {
  console.error(`FAILED: ${failed} / ${passed + failed}`);
  process.exit(1);
}
console.log(`All ${passed} checks passed.`);
