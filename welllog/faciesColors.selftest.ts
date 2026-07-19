/**
 * 前端沉积相取色解析自测：完整名称映射、安全灰兜底、无 pastel 下标依赖。
 * 运行：npx tsx welllog/faciesColors.selftest.ts
 */
import {
  SAFE_FACIES_COLOR,
  collectFaciesNames,
  resolveFaciesIntervalColor,
  PASTEL_PALETTE,
} from './config';

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

console.log('--- resolveFaciesIntervalColor 精确映射 ---');
{
  const map = { 潮坪: '#aabbcc', 三角洲平原: '#112233' };
  assertEq(resolveFaciesIntervalColor('潮坪', map), '#aabbcc', '完整名命中');
  assertEq(resolveFaciesIntervalColor('  潮坪  ', map), '#aabbcc', 'trim 后命中');
  assertEq(resolveFaciesIntervalColor('三角洲平原', map), '#112233', '另一名');
  // 不走子串：部分匹配不得命中
  assertEq(
    resolveFaciesIntervalColor('潮', map),
    SAFE_FACIES_COLOR,
    '子串不匹配→安全灰',
  );
}

console.log('--- 无映射 / 非法 hex → 稳定安全灰（与下标无关）---');
{
  const c0 = resolveFaciesIntervalColor('未知相', undefined);
  const c1 = resolveFaciesIntervalColor('未知相', {});
  const c2 = resolveFaciesIntervalColor('未知相', { 未知相: 'red' });
  const c3 = resolveFaciesIntervalColor('未知相', { 未知相: '#fff' });
  assertEq(c0, SAFE_FACIES_COLOR, 'undefined map');
  assertEq(c1, SAFE_FACIES_COLOR, 'empty map');
  assertEq(c2, SAFE_FACIES_COLOR, '非法 hex 单词');
  assertEq(c3, SAFE_FACIES_COLOR, '非法短 hex');
  assertEq(c0, c1, '稳定同色');
  // 明确不是 pastel 轮换（下标 0/1/2 若用 PASTEL 会不同；安全灰固定）
  assert(!PASTEL_PALETTE.includes(SAFE_FACIES_COLOR), '安全灰不在 pastel 表（或可重合但语义固定）');
  assertEq(
    resolveFaciesIntervalColor('A', null),
    resolveFaciesIntervalColor('B', null),
    '不同未知名同安全灰（非下标色）',
  );
}

console.log('--- HEX 大小写规范化 ---');
{
  assertEq(
    resolveFaciesIntervalColor('X', { X: '#AABBCC' }),
    '#aabbcc',
    '输出小写',
  );
}

console.log('--- collectFaciesNames 三级相 ---');
{
  const data = {
    intervals: {
      facies: {
        microPhase: [
          { name: '潮坪', top: 0, bottom: 1 },
          { name: '  潮坪  ', top: 1, bottom: 2 },
          { name: '砂坝', top: 2, bottom: 3 },
        ],
        subPhase: [{ name: '三角洲前缘', top: 0, bottom: 3 }],
        phase: [
          { name: '三角洲', top: 0, bottom: 3 },
          { name: '砂坝', top: 0, bottom: 1 }, // 与微相同名，去重
        ],
      },
    },
  };
  const names = collectFaciesNames(data);
  assert(names.includes('潮坪'), '含微相 潮坪');
  assert(names.includes('砂坝'), '含 砂坝');
  assert(names.includes('三角洲前缘'), '含亚相');
  assert(names.includes('三角洲'), '含相');
  assertEq(names.filter((n) => n === '潮坪').length, 1, '潮坪去重');
  assertEq(names.filter((n) => n === '砂坝').length, 1, '砂坝跨级去重');
  // 顺序：先 micro 再 sub 再 phase
  assert(names.indexOf('潮坪') < names.indexOf('三角洲前缘'), '微相先于亚相');
  assert(names.indexOf('三角洲前缘') < names.indexOf('三角洲'), '亚相先于相');
}

console.log('--- collectFaciesNames 空数据 ---');
{
  assertEq(collectFaciesNames({}), [], '空对象');
  assertEq(collectFaciesNames({ facies: { phase: [], subPhase: [], microPhase: [] } }), [], '空数组');
}

console.log('--- 同名跨轨道同一映射语义 ---');
{
  const map = { 统一名: '#d4e6f1' };
  // 微相/亚相/相均用同一 resolve，保证同名同色
  const micro = resolveFaciesIntervalColor('统一名', map);
  const sub = resolveFaciesIntervalColor('统一名', map);
  const phase = resolveFaciesIntervalColor('统一名', map);
  assertEq(micro, sub, '微相=亚相');
  assertEq(sub, phase, '亚相=相');
  assertEq(micro, '#d4e6f1', '映射色');
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
