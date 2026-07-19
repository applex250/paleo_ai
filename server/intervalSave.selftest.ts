/**
 * Worker applyOps 自测：临时 XLSX 上 create / 融合式 delete+create / delete / 重复 ID / 隐藏表。
 * 运行：npx tsx server/intervalSave.selftest.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as XLSX from 'xlsx';
import { applyOps, type IntervalOpIn } from './intervalSave.worker';

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

function makeTempXlsx(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interval-save-'));
  // 文件名必须是 <数字>.xlsx（Worker 路径校验）
  const fp = path.join(dir, '999001.xlsx');
  const wb = XLSX.utils.book_new();
  const curves = [
    ['井号', '深度', 'GR'],
    ['TEST-WELL', 0, 10],
    ['TEST-WELL', 100, 20],
  ];
  const lith = [
    ['井号', '道名', '顶深', '顶TVD', '顶TVDSS', '底深', '底TVD', '底TVDSS', '岩性'],
    ['TEST-WELL', '岩性', 100, 100, '', 200, 200, '', '泥岩'],
    ['TEST-WELL', '岩性', 200, 200, '', 300, 300, '', '砂岩'],
    // 同名同深度重复行（精确删除用）
    ['TEST-WELL', '岩性', 400, 400, '', 500, 500, '', '灰岩'],
    ['TEST-WELL', '岩性', 400, 400, '', 500, 500, '', '灰岩'],
  ];
  const text = [
    ['井号', '道名', '层号', '顶深', '顶TVD', '顶TVDSS', '底深', '底TVD', '底TVDSS', '文本'],
    ['TEST-WELL', '微相', '', 50, 50, '', 80, 80, '', '潮坪'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(curves), '测井曲线');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lith), '岩性道');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(text), '文本道');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  fs.writeFileSync(fp, buf);
  return fp;
}

function readWb(fp: string): XLSX.WorkBook {
  return XLSX.read(fs.readFileSync(fp), { type: 'buffer' });
}

function sheetMatrix(wb: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true }) as unknown[][];
}

const fp = makeTempXlsx();
console.log('temp file:', fp);

console.log('--- create 岩性 ---');
{
  const ops: IntervalOpIn[] = [
    {
      operationId: 'op-create-1',
      action: 'create',
      kind: 'lithology',
      top: 300,
      bottom: 350,
      name: '粉砂',
    },
  ];
  const out = applyOps({ filePath: fp, wellName: 'TEST-WELL', operations: ops });
  assert(out.ok, 'create ok');
  if (out.ok) {
    assert(out.results[0]?.status === 'applied', 'create applied');
  }
  const wb = readWb(fp);
  const m = sheetMatrix(wb, '岩性道');
  const last = m[m.length - 1];
  assert(String(last?.[8] ?? last?.[3] ?? '').includes('粉砂') || m.some((r) => r.includes('粉砂')), '粉砂已写入');
  assert(wb.SheetNames.includes('__interval_ops'), '有隐藏 ops 表名');
  const opsM = sheetMatrix(wb, '__interval_ops');
  assert(opsM[0]?.includes('action'), 'ops 含 action 列');
  assert(opsM[0]?.includes('writeSheet'), 'ops 含 writeSheet');
  // Hidden meta
  const meta = wb.Workbook?.Sheets?.find((s) => s.name === '__interval_ops');
  assert(meta?.Hidden === 1, 'ops 表 Hidden=1');
}

console.log('--- 重复 operationId → duplicate ---');
{
  const out = applyOps({
    filePath: fp,
    wellName: 'TEST-WELL',
    operations: [
      {
        operationId: 'op-create-1',
        action: 'create',
        kind: 'lithology',
        top: 600,
        bottom: 700,
        name: '重复',
      },
    ],
  });
  assert(out.ok && out.results[0]?.status === 'duplicate', 'duplicate');
}

console.log('--- 融合式 delete + create ---');
{
  // 删除 row1 泥岩 [100,200]，创建并集 [100,250]
  const ops: IntervalOpIn[] = [
    {
      operationId: 'op-del-merge',
      action: 'delete',
      kind: 'lithology',
      top: 100,
      bottom: 200,
      name: '泥岩',
      target: { sheet: '岩性道', row: 1 },
    },
    {
      operationId: 'op-create-merge',
      action: 'create',
      kind: 'lithology',
      top: 100,
      bottom: 250,
      name: '泥岩',
    },
  ];
  const out = applyOps({ filePath: fp, wellName: 'TEST-WELL', operations: ops });
  assert(out.ok, 'merge batch ok');
  if (out.ok) {
    assert(out.results.every((r) => r.status === 'applied'), 'merge all applied');
  }
  const wb = readWb(fp);
  const m = sheetMatrix(wb, '岩性道');
  // row1 应为原砂岩或后续行；不应再有 [100,200] 泥岩
  const mudExact = m.filter((r, i) => {
    if (i === 0) return false;
    const top = Number(r[2]);
    const bot = Number(r[5]);
    const name = String(r[8] ?? '');
    return top === 100 && bot === 200 && name === '泥岩';
  });
  assert(mudExact.length === 0, '原 [100,200] 泥岩已删');
  const mudUnion = m.some((r, i) => {
    if (i === 0) return false;
    return Number(r[2]) === 100 && Number(r[5]) === 250 && String(r[8]) === '泥岩';
  });
  assert(mudUnion, '并集泥岩 [100,250] 已写');
}

console.log('--- 精确删除同名同深度重复行（指定 row）---');
{
  const wb0 = readWb(fp);
  const m0 = sheetMatrix(wb0, '岩性道');
  const dupRows: number[] = [];
  for (let i = 1; i < m0.length; i++) {
    if (Number(m0[i][2]) === 400 && Number(m0[i][5]) === 500 && String(m0[i][8]) === '灰岩') {
      dupRows.push(i);
    }
  }
  assert(dupRows.length >= 2, `灰岩重复至少 2 行 (got ${dupRows.length})`);
  const delRow = dupRows[dupRows.length - 1]; // 删较大行号
  const out = applyOps({
    filePath: fp,
    wellName: 'TEST-WELL',
    operations: [
      {
        operationId: 'op-del-dup',
        action: 'delete',
        kind: 'lithology',
        top: 400,
        bottom: 500,
        name: '灰岩',
        target: { sheet: '岩性道', row: delRow },
      },
    ],
  });
  assert(out.ok && out.results[0]?.status === 'applied', '精确删一条 applied');
  const m1 = sheetMatrix(readWb(fp), '岩性道');
  const left = m1.filter((r, i) => {
    if (i === 0) return false;
    return Number(r[2]) === 400 && Number(r[5]) === 500 && String(r[8]) === '灰岩';
  });
  assert(left.length === dupRows.length - 1, '仅删一条重复灰岩');
}

console.log('--- 按 originOperationId 删除已保存新增 ---');
{
  // 先 create 微相
  const createId = 'op-micro-create';
  let out = applyOps({
    filePath: fp,
    wellName: 'TEST-WELL',
    operations: [
      {
        operationId: createId,
        action: 'create',
        kind: 'microPhase',
        top: 90,
        bottom: 120,
        name: '三角洲',
      },
    ],
  });
  assert(out.ok && out.results[0]?.status === 'applied', '微相 create');
  out = applyOps({
    filePath: fp,
    wellName: 'TEST-WELL',
    operations: [
      {
        operationId: 'op-micro-del',
        action: 'delete',
        kind: 'microPhase',
        top: 90,
        bottom: 120,
        name: '三角洲',
        target: { originOperationId: createId },
      },
    ],
  });
  assert(out.ok && out.results[0]?.status === 'applied', 'originOperationId delete');
  const m = sheetMatrix(readWb(fp), '文本道');
  const still = m.some(
    (r, i) =>
      i > 0 &&
      Number(r[3]) === 90 &&
      Number(r[6]) === 120 &&
      String(r[9]) === '三角洲',
  );
  assert(!still, '微相新增行已删除');
}

console.log('--- 删除校验失败（数值不匹配）---');
{
  const out = applyOps({
    filePath: fp,
    wellName: 'TEST-WELL',
    operations: [
      {
        operationId: 'op-bad-del',
        action: 'delete',
        kind: 'lithology',
        top: 999,
        bottom: 1000,
        name: '不存在',
        target: { sheet: '岩性道', row: 1 },
      },
    ],
  });
  assert(out.ok && out.results[0]?.status === 'error', '校验失败 → error');
}

// cleanup
try {
  fs.unlinkSync(fp);
  fs.rmdirSync(path.dirname(fp));
} catch {
  /* ignore */
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
