/**
 * 沉积相颜色注册表自测：规范化、生成器、持久化唯一、规则导入同事务登记。
 * 运行：npx tsx server/faciesColors.selftest.ts
 * 使用唯一前缀名称并在结束时清理，不改动业务 xlsx（data01/danjing）。
 */
import {
  db,
  ensureFaciesColors,
  generateFaciesHexFromSeq,
  hslToHex,
  lookupFaciesColors,
  normalizeFaciesName,
  replaceMicroPhaseRules,
  listMicroPhaseRules,
  SAFE_FACIES_COLOR,
} from './db';
import { parseFaciesColorsPayload } from './annotation';

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
  // 若规则表被自测替换，尽量不留下前缀规则（仅当列表全是自测名时恢复空——生产库可能有真实规则，
  // 故规则替换测试使用独立前缀并在测后仅删前缀色，规则表若被污染则用 restore 处理）
}

// 保存规则表现场
const rulesBackup = listMicroPhaseRules();

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

console.log('--- replaceMicroPhaseRules 同事务注册颜色 ---');
{
  const r1 = tname('规则微相甲');
  const r2 = tname('规则微相乙');
  replaceMicroPhaseRules([r1, r2]);
  const listed = listMicroPhaseRules();
  assertEq(listed, [r1, r2], '规则列表已替换');
  const colors = lookupFaciesColors([r1, r2]);
  assert(colors[r1] != null && colors[r2] != null, '规则名已登记颜色');
  assert(colors[r1] !== colors[r2], '规则两名不同色');
  // 恢复原规则（若原为空则写回需至少一项——replace 要求非空）
  if (rulesBackup.length > 0) {
    replaceMicroPhaseRules(rulesBackup);
    assertEq(listMicroPhaseRules(), rulesBackup, '规则表已恢复');
  } else {
    // 原库无规则：再替换为单占位并清理？保持自测规则会污染；改为删规则表行
    db.prepare(`DELETE FROM annotation_micro_phase_rules`).run();
    assertEq(listMicroPhaseRules().length, 0, '规则表清空恢复');
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
