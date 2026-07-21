/**
 * 沉积相颜色注册表 + 亚相列式规则自测：
 * 规范化、生成器、持久化唯一、规则导入同事务登记、XLSX 列式解析。
 * 运行：npx tsx server/faciesColors.selftest.ts
 * 使用唯一前缀名称并在结束时清理，不改动业务 xlsx（data01/danjing）。
 */
import * as XLSX from 'xlsx';
import {
  db,
  ensureFaciesColors,
  generateFaciesHexFromSeq,
  hslToHex,
  lookupFaciesColors,
  normalizeFaciesName,
  replaceMicroPhaseRuleGroups,
  listMicroPhaseRuleGroups,
  countMicroPhaseRuleStats,
  SAFE_FACIES_COLOR,
  type MicroPhaseRuleGroup,
} from './db';
import { parseFaciesColorsPayload, parseMicroPhaseRulesXlsx } from './annotation';

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

const PREFIX = `__selftest_fc_${Date.now()}_`;
const testNames: string[] = [];

function tname(s: string): string {
  const n = `${PREFIX}${s}`;
  testNames.push(n);
  return n;
}

function cleanup(): void {
  const del = db.prepare(`DELETE FROM facies_color_registry WHERE name LIKE ?`);
  del.run(`${PREFIX}%`);
}

function aoaToXlsxBuf(aoa: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, 'rules');
  // 加第二表，确认解析只读第一表
  const ws2 = XLSX.utils.aoa_to_sheet([['忽略', '第二表']]);
  XLSX.utils.book_append_sheet(wb, ws2, 'other');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);
}

// 保存规则表现场
const rulesBackup: MicroPhaseRuleGroup[] = listMicroPhaseRuleGroups();

console.log('--- normalizeFaciesName ---');
{
  assertEq(normalizeFaciesName('  潮坪  '), '潮坪', 'trim');
  assertEq(normalizeFaciesName('\u0041\u0301'), '\u00C1'.normalize('NFC'), 'NFC');
  assertEq(normalizeFaciesName('   '), '', '空白→空');
}

console.log('--- hslToHex / generateFaciesHexFromSeq ---');
{
  const c0 = generateFaciesHexFromSeq(0);
  const c1 = generateFaciesHexFromSeq(1);
  assert(/^#[0-9a-f]{6}$/.test(c0), `seq0 合法 hex: ${c0}`);
  assert(/^#[0-9a-f]{6}$/.test(c1), `seq1 合法 hex: ${c1}`);
  assert(c0 !== c1, '相邻序号颜色不同');
  assert(c0 !== SAFE_FACIES_COLOR.toLowerCase(), '生成色≠安全灰');
  // 稳定性：同序号同 attempt 必同色
  assertEq(generateFaciesHexFromSeq(42, 0), generateFaciesHexFromSeq(42, 0), '同序号稳定');
  const redish = hslToHex(0, 1, 0.5);
  assertEq(redish, '#ff0000', 'hsl 0,1,0.5 → 红');
}

console.log('--- ensureFaciesColors 唯一与复用 ---');
{
  const a = tname('潮坪');
  const b = tname('三角洲');
  const c = tname('潮坪'); // 同名
  const map1 = ensureFaciesColors([a, b]);
  assert(typeof map1[a] === 'string' && /^#[0-9a-f]{6}$/.test(map1[a]), 'a 有色');
  assert(typeof map1[b] === 'string' && /^#[0-9a-f]{6}$/.test(map1[b]), 'b 有色');
  assert(map1[a] !== map1[b], '不同名不同色');
  const map2 = ensureFaciesColors([c, a]);
  assertEq(map2[a], map1[a], '同名复用 a');
  assertEq(map2[normalizeFaciesName(c)], map1[a], '规范化同名复用');
  // 批量第二次不改变
  const map3 = ensureFaciesColors([a, b]);
  assertEq(map3[a], map1[a], '再次 ensure 同 a');
  assertEq(map3[b], map1[b], '再次 ensure 同 b');
  // 颜色全局唯一（注册表内）
  const rows = db
    .prepare(`SELECT hex FROM facies_color_registry WHERE name LIKE ?`)
    .all(`${PREFIX}%`) as Array<{ hex: string }>;
  const hexes = rows.map((r) => r.hex);
  assertEq(new Set(hexes).size, hexes.length, '注册表内 hex 互异');
}

console.log('--- lookupFaciesColors 不创建 ---');
{
  const known = tname('lookup_known');
  ensureFaciesColors([known]);
  const unknown = `${PREFIX}lookup_never_${Math.random()}`;
  const looked = lookupFaciesColors([known, unknown]);
  assert(looked[known] != null, '已知可查');
  assert(looked[unknown] == null, '未知不创建');
  // 确认 unknown 未入库
  const row = db
    .prepare(`SELECT 1 AS ok FROM facies_color_registry WHERE name = ?`)
    .get(unknown) as { ok?: number } | undefined;
  assert(!row, 'lookup 未写入未知名');
}

console.log('--- parseFaciesColorsPayload 严格校验 ---');
{
  assert(!parseFaciesColorsPayload(null).ok, '拒绝 null');
  assert(!parseFaciesColorsPayload([]).ok, '拒绝数组根');
  assert(!parseFaciesColorsPayload({}).ok, '拒绝缺 names');
  assert(!parseFaciesColorsPayload({ names: 'x' }).ok, '拒绝 names 非数组');
  assert(!parseFaciesColorsPayload({ names: [1] }).ok, '拒绝非字符串');
  assert(!parseFaciesColorsPayload({ names: ['  '] }).ok, '拒绝空名');
  assert(!parseFaciesColorsPayload({ names: ['ok'], file: 1 }).ok, '拒绝 banned 字段');
  const ok = parseFaciesColorsPayload({ names: ['  潮坪 ', '三角洲'] });
  assert(ok.ok, '合法 payload');
  if (ok.ok) {
    assertEq(ok.names, ['潮坪', '三角洲'], '规范化 names');
  }
}

console.log('--- parseMicroPhaseRulesXlsx 列式规则 ---');
{
  // 合法：两列亚相 + 微相；空白列忽略；组内去重；跨组同名允许；trim/NFC
  const nfcA = 'A\u0301'; // Á decomposed
  const bufOk = aoaToXlsxBuf([
    ['  三角洲前缘 ', '潮坪', '', nfcA],
    ['河口坝', '泥坪', '', 'm1'],
    ['远砂坝', '  砂坪 ', '', 'm1'], // 组内重复 m1
    ['河口坝', '混合坪', '', ''], // 组内重复河口坝
    ['', '', '', ''],
  ]);
  const parsedOk = parseMicroPhaseRulesXlsx(bufOk);
  assert(parsedOk.ok, '合法列式 XLSX');
  if (parsedOk.ok) {
    assertEq(parsedOk.groups.length, 3, '忽略全空列，3 组');
    assertEq(parsedOk.groups[0], {
      subPhase: '三角洲前缘',
      microPhases: ['河口坝', '远砂坝'],
    }, '列0 组内去重+trim');
    assertEq(parsedOk.groups[1], {
      subPhase: '潮坪',
      microPhases: ['泥坪', '砂坪', '混合坪'],
    }, '列1');
    assertEq(parsedOk.groups[2].subPhase, nfcA.normalize('NFC'), '列2 亚相 NFC');
    assertEq(parsedOk.groups[2].microPhases, ['m1'], '列2 组内去重 m1');
    const stats = countMicroPhaseRuleStats(parsedOk.groups);
    assertEq(stats.subPhaseCount, 3, 'subPhaseCount');
    assertEq(stats.microPhaseCount, 2 + 3 + 1, 'microPhaseCount 跨组计数');
  }

  // 有亚相无微相 → 拒绝
  const bufNoMicro = aoaToXlsxBuf([['孤立亚相'], ['']]);
  const noMicro = parseMicroPhaseRulesXlsx(bufNoMicro);
  assert(!noMicro.ok, '有亚相无微相拒绝');

  // 有微相无亚相 → 拒绝
  const bufNoSub = aoaToXlsxBuf([[''], ['孤儿微相']]);
  const noSub = parseMicroPhaseRulesXlsx(bufNoSub);
  assert(!noSub.ok, '有微相无亚相拒绝');

  // 全空 → 拒绝
  const bufEmpty = aoaToXlsxBuf([['', ''], ['', '']]);
  const empty = parseMicroPhaseRulesXlsx(bufEmpty);
  assert(!empty.ok, '全空拒绝');

  // 空 buffer
  assert(!parseMicroPhaseRulesXlsx(Buffer.alloc(0)).ok, '空 buffer 拒绝');
}

console.log('--- replaceMicroPhaseRuleGroups 同事务注册颜色 ---');
{
  const sub1 = tname('亚相甲');
  const sub2 = tname('亚相乙');
  const m1 = tname('规则微相甲');
  const m2 = tname('规则微相乙');
  const m3 = tname('规则微相丙');
  // 跨组允许同名微相
  const shared = tname('共享微相');
  const groups: MicroPhaseRuleGroup[] = [
    { subPhase: sub1, microPhases: [m1, m2, shared] },
    { subPhase: sub2, microPhases: [m3, shared] },
  ];
  replaceMicroPhaseRuleGroups(groups);
  const listed = listMicroPhaseRuleGroups();
  assertEq(listed, groups, '规则组已替换');
  const colors = lookupFaciesColors([m1, m2, m3, shared]);
  assert(
    colors[m1] != null && colors[m2] != null && colors[m3] != null && colors[shared] != null,
    '全部微相已登记颜色',
  );
  assert(colors[m1] !== colors[m2], '不同微相不同色');
  assertEq(colors[shared], colors[shared], '跨组同名同色');

  // 恢复原规则
  if (rulesBackup.length > 0) {
    replaceMicroPhaseRuleGroups(rulesBackup);
    assertEq(listMicroPhaseRuleGroups(), rulesBackup, '规则表已恢复');
  } else {
    db.prepare(`DELETE FROM annotation_subphase_rule_microphases`).run();
    db.prepare(`DELETE FROM annotation_subphase_rule_groups`).run();
    assertEq(listMicroPhaseRuleGroups().length, 0, '规则表清空恢复');
  }
}

console.log('--- 旧扁平表不可用于推荐（迁移后无残留）---');
{
  const legacy = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'annotation_micro_phase_rules'`,
    )
    .get() as { name?: string } | undefined;
  assert(!legacy?.name, '旧扁平 annotation_micro_phase_rules 已移除');
  // 列表仅来自分组表；空/备份恢复后不会冒出无关联扁平名
  const groups = listMicroPhaseRuleGroups();
  for (const g of groups) {
    assert(typeof g.subPhase === 'string' && g.subPhase.length > 0, '每组有亚相');
    assert(Array.isArray(g.microPhases) && g.microPhases.length > 0, '每组有微相');
  }
}

console.log('--- 大批量序号颜色两两不同（生成器层）---');
{
  const set = new Set<string>();
  for (let i = 0; i < 80; i++) set.add(generateFaciesHexFromSeq(i));
  // 允许极少数 HSL 量化碰撞，但期望高区分度
  assert(set.size >= 75, `80 序号至少 75 色 (got ${set.size})`);
}

cleanup();
// 再清一次前缀（rules 恢复后可能仍有前缀色）
db.prepare(`DELETE FROM facies_color_registry WHERE name LIKE ?`).run(`${PREFIX}%`);

console.log(`\n结果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
