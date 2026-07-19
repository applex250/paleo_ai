/**
 * 区间编辑纯逻辑自测：岩性与微相同规则；含多段空白填充。
 * 运行：npx tsx welllog/intervalEdits.selftest.ts
 */
import {
  buildCreateOperations,
  buildCreateOperationsForSegments,
  buildDeleteOperation,
  freeSegmentsInRange,
  pendingCreateIdSet,
  resolveCreateInterval,
  resolveCreateIntervals,
  type IntervalOperation,
} from './intervalEdits';
import type { IntervalItem } from './types';

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

const well = { wellTop: 0, wellBottom: 1000 };

console.log('--- 无冲突新增 ---');
{
  const existing: IntervalItem[] = [{ top: 100, bottom: 200, name: 'A' }];
  const r = resolveCreateInterval(300, 400, 'B', { ...well, existing });
  assert(r.ok, '无冲突应成功');
  if (r.ok) {
    assertEq(r.top, 300, 'top');
    assertEq(r.bottom, 400, 'bottom');
    assertEq(r.mergeOf.length, 0, '无融合');
    assertEq(r.adjusted, false, '未贴齐');
  }
  const multi = resolveCreateIntervals(300, 400, 'B', { ...well, existing });
  assert(multi.ok && multi.segments.length === 1, '多段解析无冲突 → 1 段');
  if (multi.ok) {
    assertEq(multi.segments[0].top, 300, 'multi top');
    assertEq(multi.segments[0].bottom, 400, 'multi bottom');
  }
}

console.log('--- 单侧贴齐（顶穿入）---');
{
  const existing: IntervalItem[] = [{ top: 100, bottom: 200, name: 'A' }];
  const r = resolveCreateInterval(150, 250, 'B', { ...well, existing });
  assert(r.ok, '单侧顶穿入应贴齐成功');
  if (r.ok) {
    assertEq(r.top, 200, '顶贴齐到 200');
    assertEq(r.bottom, 250, '底不变');
    assert(r.adjusted, '应标记 adjusted');
  }
  // 多段路径：扣除占用后等价于空白段 [200,250]
  const multi = resolveCreateIntervals(150, 250, 'B', { ...well, existing });
  assert(multi.ok && multi.segments.length === 1, '单侧 → 1 空白段');
  if (multi.ok) {
    assertEq(multi.segments[0].top, 200, 'multi 顶 200');
    assertEq(multi.segments[0].bottom, 250, 'multi 底 250');
  }
}

console.log('--- 单侧贴齐（底穿入）---');
{
  const existing: IntervalItem[] = [{ top: 100, bottom: 200, name: 'A' }];
  const r = resolveCreateInterval(50, 150, 'B', { ...well, existing });
  assert(r.ok, '单侧底穿入应贴齐成功');
  if (r.ok) {
    assertEq(r.top, 50, '顶不变');
    assertEq(r.bottom, 100, '底贴齐到 100');
    assert(r.adjusted, '应标记 adjusted');
  }
  const multi = resolveCreateIntervals(50, 150, 'B', { ...well, existing });
  assert(multi.ok && multi.segments.length === 1, '单侧底 → 1 空白段');
  if (multi.ok) {
    assertEq(multi.segments[0].top, 50, 'multi 顶 50');
    assertEq(multi.segments[0].bottom, 100, 'multi 底 100');
  }
}

console.log('--- 选择包含单占用块 → 两空白段 ---');
{
  const existing: IntervalItem[] = [{ top: 100, bottom: 200, name: 'A' }];
  const multi = resolveCreateIntervals(50, 250, 'B', { ...well, existing });
  assert(multi.ok, '包含单块应成功填空白');
  if (multi.ok) {
    assertEq(multi.segments.length, 2, '两空白段');
    assertEq(multi.segments[0].top, 50, '上段 top');
    assertEq(multi.segments[0].bottom, 100, '上段 bottom');
    assertEq(multi.segments[1].top, 200, '下段 top');
    assertEq(multi.segments[1].bottom, 250, '下段 bottom');
  }
  // 单段路径仍拒绝双侧
  const single = resolveCreateInterval(50, 250, 'B', { ...well, existing });
  assert(!single.ok, '单段 API 双侧仍拒绝');
}

console.log('--- 完全占满（被单块包含）失败 ---');
{
  const existing: IntervalItem[] = [{ top: 100, bottom: 200, name: 'A' }];
  const multi = resolveCreateIntervals(120, 180, 'B', { ...well, existing });
  assert(!multi.ok, '被不同名完全包含应失败');
  const single = resolveCreateInterval(120, 180, 'B', { ...well, existing });
  assert(!single.ok, '单段被包含亦拒绝');
}

console.log('--- 两端占用产中间空白段 ---');
{
  const existing: IntervalItem[] = [
    { top: 100, bottom: 200, name: 'A' },
    { top: 300, bottom: 400, name: 'C' },
  ];
  const multi = resolveCreateIntervals(150, 350, 'B', { ...well, existing });
  assert(multi.ok, '两端重叠应成功');
  if (multi.ok) {
    assertEq(multi.segments.length, 1, '中间一段');
    assertEq(multi.segments[0].top, 200, '中间 top');
    assertEq(multi.segments[0].bottom, 300, '中间 bottom');
  }
}

console.log('--- 多占用块产多段 ---');
{
  const existing: IntervalItem[] = [
    { top: 100, bottom: 150, name: 'A' },
    { top: 200, bottom: 250, name: 'C' },
    { top: 300, bottom: 350, name: 'D' },
  ];
  const multi = resolveCreateIntervals(50, 400, 'B', { ...well, existing });
  assert(multi.ok, '多占用应成功');
  if (multi.ok) {
    assertEq(multi.segments.length, 4, '四段空白');
    assertEq(
      multi.segments.map((s) => [s.top, s.bottom]),
      [
        [50, 100],
        [150, 200],
        [250, 300],
        [350, 400],
      ],
      '空白段几何',
    );
  }
}

console.log('--- 同名融合（重叠）---');
{
  const existing: IntervalItem[] = [
    { top: 100, bottom: 200, name: 'A', source: { type: 'xlsx', sheet: '岩性道', row: 1 } },
  ];
  const r = resolveCreateInterval(180, 250, 'A', { ...well, existing });
  assert(r.ok, '同名重叠应融合');
  if (r.ok) {
    assertEq(r.top, 100, '并集 top');
    assertEq(r.bottom, 250, '并集 bottom');
    assertEq(r.mergeOf.length, 1, '吸收 1 段');
  }
  const multi = resolveCreateIntervals(180, 250, 'A', { ...well, existing });
  assert(multi.ok && multi.segments.length === 1, '同名多段路径 1 段');
  if (multi.ok) {
    assertEq(multi.segments[0].top, 100, 'multi 并集 top');
    assertEq(multi.segments[0].bottom, 250, 'multi 并集 bottom');
    assertEq(multi.segments[0].mergeOf.length, 1, 'multi 吸收 1');
  }
}

console.log('--- 同名融合（相邻 + 传递）---');
{
  const existing: IntervalItem[] = [
    { top: 100, bottom: 200, name: 'A', source: { type: 'xlsx', sheet: '岩性道', row: 1 } },
    { top: 200, bottom: 300, name: 'A', source: { type: 'xlsx', sheet: '岩性道', row: 2 } },
  ];
  const r = resolveCreateInterval(290, 350, 'A', { ...well, existing });
  assert(r.ok, '同名相邻传递融合');
  if (r.ok) {
    assertEq(r.top, 100, '传递并集 top');
    assertEq(r.bottom, 350, '传递并集 bottom');
    assertEq(r.mergeOf.length, 2, '吸收 2 段');
  }
}

console.log('--- 同名融合 + 不同名保留（空白段）---');
{
  // 选择跨不同名 B，同名 A 仅在上空白侧相邻融合
  const existing: IntervalItem[] = [
    { top: 100, bottom: 150, name: 'A', source: { type: 'xlsx', sheet: '岩性道', row: 1 } },
    { top: 200, bottom: 250, name: 'B', source: { type: 'xlsx', sheet: '岩性道', row: 2 } },
  ];
  const multi = resolveCreateIntervals(120, 300, 'A', { ...well, existing });
  assert(multi.ok, '同名融合且不同名占用保留');
  if (multi.ok) {
    assertEq(multi.segments.length, 2, '两空白（B 占用中间）');
    // 上段 [120,200] 与 A 融合 → [100,200]
    assertEq(multi.segments[0].top, 100, '上段融合 top');
    assertEq(multi.segments[0].bottom, 200, '上段融合 bottom');
    assertEq(multi.segments[0].mergeOf.length, 1, '吸收同名 A');
    // 下段 [250,300] 无同名
    assertEq(multi.segments[1].top, 250, '下段 top');
    assertEq(multi.segments[1].bottom, 300, '下段 bottom');
    assertEq(multi.segments[1].mergeOf.length, 0, '下段无融合');
  }
}

console.log('--- 融合后与不同名冲突拒绝（单段 API）---');
{
  // 融合并集完全包含不同名 B → 拒绝
  const existing: IntervalItem[] = [
    { top: 100, bottom: 200, name: 'A' },
    { top: 150, bottom: 180, name: 'B' },
  ];
  const r = resolveCreateInterval(190, 250, 'A', { ...well, existing });
  assert(!r.ok, '融合后包含不同名应拒绝');

  // 融合后仅单侧穿入不同名 → 贴齐成功
  const existing2: IntervalItem[] = [
    { top: 100, bottom: 200, name: 'A' },
    { top: 220, bottom: 300, name: 'B' },
  ];
  const r2 = resolveCreateInterval(180, 250, 'A', { ...well, existing: existing2 });
  assert(r2.ok, '融合后单侧穿入不同名应贴齐');
  if (r2.ok) {
    assertEq(r2.top, 100, '并集 top');
    assertEq(r2.bottom, 220, '底贴齐到 B.top');
  }
}

console.log('--- 相邻不同名允许 ---');
{
  const existing: IntervalItem[] = [{ top: 100, bottom: 200, name: 'A' }];
  const r = resolveCreateInterval(200, 300, 'B', { ...well, existing });
  assert(r.ok, '相邻边界不同名应允许');
  if (r.ok) assertEq(r.adjusted, false, '无需贴齐');
  const multi = resolveCreateIntervals(200, 300, 'B', { ...well, existing });
  assert(multi.ok && multi.segments.length === 1, '相邻多段 1');
}

console.log('--- freeSegmentsInRange 基础 ---');
{
  const gaps = freeSegmentsInRange(0, 100, [
    { top: 10, bottom: 20 },
    { top: 50, bottom: 60 },
  ]);
  assertEq(
    gaps,
    [
      { top: 0, bottom: 10 },
      { top: 20, bottom: 50 },
      { top: 60, bottom: 100 },
    ],
    '三段空白',
  );
  const full = freeSegmentsInRange(10, 20, [{ top: 0, bottom: 30 }]);
  assertEq(full.length, 0, '全占满无空白');
}

console.log('--- buildCreateOperations / 本地 create 撤销 ---');
{
  const existing: IntervalItem[] = [
    {
      top: 100,
      bottom: 200,
      name: 'A',
      source: { type: 'create', operationId: 'local-1' },
    },
    {
      top: 300,
      bottom: 400,
      name: 'A',
      source: { type: 'xlsx', sheet: '岩性道', row: 5 },
    },
  ];
  const r = resolveCreateInterval(150, 350, 'A', { ...well, existing });
  assert(r.ok, '融合本地+xlsx');
  if (r.ok) {
    const local = new Set(['local-1']);
    const ops = buildCreateOperations('lithology', r, 'A', local);
    const deletes = ops.filter((o) => o.action === 'delete');
    const creates = ops.filter((o) => o.action === 'create');
    assertEq(creates.length, 1, '一条 create');
    // local-1 不发 delete
    assert(
      deletes.every((d) => d.target?.originOperationId !== 'local-1'),
      '本地 create 不发 delete',
    );
    assert(
      deletes.some((d) => d.target?.sheet === '岩性道' && d.target?.row === 5),
      'xlsx 行发 delete',
    );
  }
}

console.log('--- buildCreateOperationsForSegments 多段 create ---');
{
  const existing: IntervalItem[] = [{ top: 100, bottom: 200, name: 'A' }];
  const multi = resolveCreateIntervals(50, 250, 'B', { ...well, existing });
  assert(multi.ok, '两空白段解析');
  if (multi.ok) {
    const ops = buildCreateOperationsForSegments('microPhase', multi.segments, 'B', new Set());
    const creates = ops.filter((o) => o.action === 'create');
    const deletes = ops.filter((o) => o.action === 'delete');
    assertEq(creates.length, 2, '两条 create');
    assertEq(deletes.length, 0, '不删除不同名占用块');
    assertEq(
      creates.map((c) => [c.top, c.bottom, c.name]),
      [
        [50, 100, 'B'],
        [200, 250, 'B'],
      ],
      'create 几何与名称',
    );
    assert(
      creates.every((c) => c.kind === 'microPhase' && c.action === 'create'),
      '仅 create/delete 协议字段',
    );
  }
}

console.log('--- buildDeleteOperation ---');
{
  const local = new Set(['pend-1']);
  const localItem: IntervalItem = {
    top: 1,
    bottom: 2,
    name: 'X',
    source: { type: 'create', operationId: 'pend-1' },
  };
  assertEq(buildDeleteOperation('microPhase', localItem, local), null, '未保存 create → null');

  const saved: IntervalItem = {
    top: 1,
    bottom: 2,
    name: 'X',
    source: { type: 'create', operationId: 'saved-9' },
  };
  const op = buildDeleteOperation('microPhase', saved, local);
  assert(!!op && op.action === 'delete', '已保存 create → delete');
  assertEq(op?.target?.originOperationId, 'saved-9', 'originOperationId');

  const xlsxItem: IntervalItem = {
    top: 1,
    bottom: 2,
    name: 'X',
    source: { type: 'xlsx', sheet: '微相', row: 3 },
  };
  const op2 = buildDeleteOperation('microPhase', xlsxItem, local);
  assertEq(op2?.target?.sheet, '微相', 'sheet');
  assertEq(op2?.target?.row, 3, 'row');
}

console.log('--- pendingCreateIdSet ---');
{
  const pending: IntervalOperation[] = [
    { operationId: 'a', action: 'create', kind: 'lithology', top: 1, bottom: 2, name: 'n' },
    { operationId: 'b', action: 'delete', kind: 'lithology', top: 1, bottom: 2, name: 'n' },
  ];
  const s = pendingCreateIdSet(pending);
  assert(s.has('a') && !s.has('b'), '仅 collect create ids');
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
