// Worker：读取当前 <id>.xlsx，按 JSON 增量 create/delete 岩性/微相区间，记录 operationId 幂等，原子写回。
// 路径由主线程从 id 派生后传入；本线程不拼接 DATA_DIR。删除为真正行级增量，绝不要求整表 Base64。
import { parentPort, threadId } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const OPS_SHEET = '__interval_ops';
const KINDS = new Set(['lithology', 'microPhase']);
const DEPTH_EPS = 1e-9;

export type IntervalOpAction = 'create' | 'delete';

export type IntervalDeleteTarget = {
  sheet?: string;
  row?: number;
  originOperationId?: string;
};

export type IntervalOpIn = {
  operationId: string;
  action?: IntervalOpAction;
  kind: 'lithology' | 'microPhase';
  top: number;
  bottom: number;
  name: string;
  target?: IntervalDeleteTarget;
};

export type OpResult = {
  operationId: string;
  status: 'applied' | 'duplicate' | 'error';
  error?: string;
};

export type IntervalSaveWorkerIn = {
  filePath: string;
  wellName: string;
  operations: IntervalOpIn[];
};

export type IntervalSaveWorkerOut =
  | { ok: true; results: OpResult[] }
  | { ok: false; error: string };

type Matrix = unknown[][];

const headerOf = (m: Matrix): string[] => (m[0] ?? []).map((h) => String(h ?? '').trim());

function sheetToMatrix(ws: XLSX.WorkSheet | undefined): Matrix {
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as Matrix;
}

function matrixToSheet(matrix: Matrix): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(matrix.length ? matrix : [['']]);
}

/** 从现有 sheet 解析井号；失败则回退 wellName。 */
function resolveWellNo(wb: XLSX.WorkBook, fallback: string): string {
  const prefer = ['测井曲线', '岩性道', '岩性剖面', '文本道', '微相', '离散曲线'];
  const names = [
    ...prefer.filter((n) => wb.SheetNames.includes(n)),
    ...wb.SheetNames.filter((n) => !prefer.includes(n) && n !== OPS_SHEET),
  ];
  for (const sn of names) {
    const m = sheetToMatrix(wb.Sheets[sn]);
    if (m.length < 2) continue;
    const h = headerOf(m);
    const wIdx = h.indexOf('井号');
    if (wIdx < 0) continue;
    for (let r = 1; r < m.length; r++) {
      const v = m[r]?.[wIdx];
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  for (const sn of names) {
    const m = sheetToMatrix(wb.Sheets[sn]);
    if (m.length < 2) continue;
    const v = m[1]?.[0];
    if (v != null && String(v).trim() && String(v).trim() !== '井号') return String(v).trim();
  }
  return (fallback || '').trim() || 'UNKNOWN';
}

function findSheetName(wb: XLSX.WorkBook, exact: string[], includes: string[]): string | null {
  for (const n of exact) {
    if (wb.SheetNames.includes(n)) return n;
  }
  for (const sn of wb.SheetNames) {
    if (sn === OPS_SHEET) continue;
    if (includes.some((k) => sn.includes(k))) return sn;
  }
  return null;
}

function ensureSheet(wb: XLSX.WorkBook, name: string, defaultHeader: string[]): Matrix {
  if (!wb.SheetNames.includes(name)) {
    XLSX.utils.book_append_sheet(wb, matrixToSheet([defaultHeader]), name);
  }
  const m = sheetToMatrix(wb.Sheets[name]);
  if (m.length === 0) {
    m.push([...defaultHeader]);
  } else if (m[0].every((c) => c === '' || c == null)) {
    m[0] = [...defaultHeader];
  }
  return m;
}

function setSheet(wb: XLSX.WorkBook, name: string, matrix: Matrix): void {
  wb.Sheets[name] = matrixToSheet(matrix);
  if (!wb.SheetNames.includes(name)) wb.SheetNames.push(name);
}

/** 按现有表头对齐写一行；缺失列填空；已知语义列写入。返回写入行号（matrix 下标）。 */
function appendAlignedRow(
  matrix: Matrix,
  values: Record<string, unknown>,
  fallbackHeader: string[],
): number {
  if (matrix.length === 0) matrix.push([...fallbackHeader]);
  let header = headerOf(matrix);
  if (header.length === 0 || header.every((h) => !h)) {
    header = [...fallbackHeader];
    matrix[0] = [...fallbackHeader];
  }
  for (const key of Object.keys(values)) {
    if (!header.includes(key) && fallbackHeader.includes(key)) {
      header.push(key);
      matrix[0] = header;
      for (let r = 1; r < matrix.length; r++) {
        const row = matrix[r] ?? [];
        while (row.length < header.length) row.push('');
        matrix[r] = row;
      }
    }
  }
  const row: unknown[] = header.map((h) => (h in values ? values[h] : ''));
  matrix.push(row);
  return matrix.length - 1;
}

function hideOpsSheet(wb: XLSX.WorkBook): void {
  if (!wb.Workbook) wb.Workbook = {};
  const meta = wb.SheetNames.map((name) => {
    const prev = (wb.Workbook!.Sheets ?? []).find((s) => s.name === name);
    return {
      name,
      Hidden: name === OPS_SHEET ? 1 : (prev?.Hidden ?? 0),
    };
  });
  wb.Workbook.Sheets = meta;
}

function loadAppliedIds(wb: XLSX.WorkBook): Set<string> {
  const ids = new Set<string>();
  if (!wb.SheetNames.includes(OPS_SHEET)) return ids;
  const m = sheetToMatrix(wb.Sheets[OPS_SHEET]);
  if (m.length < 2) return ids;
  const h = headerOf(m);
  let idIdx = h.indexOf('operationId');
  if (idIdx < 0) idIdx = 0;
  for (let r = 1; r < m.length; r++) {
    const id = m[r]?.[idIdx];
    if (id != null && String(id).trim()) ids.add(String(id).trim());
  }
  return ids;
}

const OPS_HEADER = [
  'operationId',
  'action',
  'kind',
  'top',
  'bottom',
  'name',
  'appliedAt',
  'originSheet',
  'originRow',
  'writeSheet',
  'writeRow',
  'originOperationId',
];

type OpsRecord = {
  operationId: string;
  action: string;
  kind: string;
  top: number;
  bottom: number;
  name: string;
  appliedAt: string;
  originSheet: string;
  originRow: string;
  writeSheet: string;
  writeRow: string;
  originOperationId: string;
};

function parseOpsSheet(wb: XLSX.WorkBook): OpsRecord[] {
  if (!wb.SheetNames.includes(OPS_SHEET)) return [];
  const m = sheetToMatrix(wb.Sheets[OPS_SHEET]);
  if (m.length < 2) return [];
  const h = headerOf(m);
  const idx = (name: string, fallback = -1) => {
    const i = h.indexOf(name);
    return i >= 0 ? i : fallback;
  };
  const idI = idx('operationId', 0);
  const actI = idx('action');
  const kindI = idx('kind', 1);
  const topI = idx('top', 2);
  const botI = idx('bottom', 3);
  const nameI = idx('name', 4);
  const atI = idx('appliedAt', 5);
  const oSheetI = idx('originSheet');
  const oRowI = idx('originRow');
  const wSheetI = idx('writeSheet');
  const wRowI = idx('writeRow');
  const oOpI = idx('originOperationId');
  const out: OpsRecord[] = [];
  for (let r = 1; r < m.length; r++) {
    const row = m[r] ?? [];
    const id = row[idI] != null ? String(row[idI]).trim() : '';
    if (!id) continue;
    const top = Number(row[topI]);
    const bottom = Number(row[botI]);
    out.push({
      operationId: id,
      action: actI >= 0 && row[actI] != null && String(row[actI]).trim() ? String(row[actI]).trim() : 'create',
      kind: kindI >= 0 && row[kindI] != null ? String(row[kindI]).trim() : '',
      top: Number.isFinite(top) ? top : NaN,
      bottom: Number.isFinite(bottom) ? bottom : NaN,
      name: nameI >= 0 && row[nameI] != null ? String(row[nameI]).trim() : '',
      appliedAt: atI >= 0 && row[atI] != null ? String(row[atI]) : '',
      originSheet: oSheetI >= 0 && row[oSheetI] != null ? String(row[oSheetI]).trim() : '',
      originRow: oRowI >= 0 && row[oRowI] != null ? String(row[oRowI]).trim() : '',
      writeSheet: wSheetI >= 0 && row[wSheetI] != null ? String(row[wSheetI]).trim() : '',
      writeRow: wRowI >= 0 && row[wRowI] != null ? String(row[wRowI]).trim() : '',
      originOperationId: oOpI >= 0 && row[oOpI] != null ? String(row[oOpI]).trim() : '',
    });
  }
  return out;
}

function recordOp(
  wb: XLSX.WorkBook,
  fields: {
    operationId: string;
    action: IntervalOpAction;
    kind: string;
    top: number;
    bottom: number;
    name: string;
    originSheet?: string;
    originRow?: number;
    writeSheet?: string;
    writeRow?: number;
    originOperationId?: string;
  },
): void {
  const m = ensureSheet(wb, OPS_SHEET, OPS_HEADER);
  const h = headerOf(m);
  if (!h.includes('operationId') || !h.includes('action')) {
    // 迁移旧表头：保留数据行，扩展列
    const old = m.slice(1);
    m.length = 0;
    m.push([...OPS_HEADER]);
    for (const row of old) {
      const padded = [...row];
      while (padded.length < OPS_HEADER.length) padded.push('');
      m.push(padded);
    }
  }
  m.push([
    fields.operationId,
    fields.action,
    fields.kind,
    fields.top,
    fields.bottom,
    fields.name,
    new Date().toISOString(),
    fields.originSheet ?? '',
    fields.originRow != null ? fields.originRow : '',
    fields.writeSheet ?? '',
    fields.writeRow != null ? fields.writeRow : '',
    fields.originOperationId ?? '',
  ]);
  setSheet(wb, OPS_SHEET, m);
  hideOpsSheet(wb);
}

function numEq(a: number, b: number): boolean {
  return Math.abs(a - b) <= DEPTH_EPS;
}

function parseNumCell(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

type SheetLoc = { sheet: string; matrix: Matrix; header: string[]; topIdx: number; botIdx: number; nameIdx: number };

function resolveLithologySheet(wb: XLSX.WorkBook): { sn: string; isLegacyProfile: boolean; defaultHeader: string[] } {
  const sn =
    findSheetName(wb, ['岩性道'], ['岩性道']) ??
    findSheetName(wb, ['岩性剖面'], ['岩性剖面']) ??
    '岩性道';
  const isLegacyProfile = sn === '岩性剖面' || sn.includes('岩性剖面');
  const defaultHeader = isLegacyProfile
    ? ['井号', '顶深', '底深', '岩性']
    : ['井号', '道名', '顶深', '顶TVD', '顶TVDSS', '底深', '底TVD', '底TVDSS', '岩性'];
  return { sn, isLegacyProfile, defaultHeader };
}

function resolveMicroPhaseSheet(wb: XLSX.WorkBook): {
  sn: string;
  isLegacy: boolean;
  defaultHeader: string[];
  nameKey: string;
} {
  const legacy = findSheetName(wb, ['微相'], []);
  const textSn = findSheetName(wb, ['文本道'], ['文本']);
  if (legacy && !textSn) {
    const m = ensureSheet(wb, legacy, ['井号', '顶深', '底深', '名称']);
    const h = headerOf(m);
    const nameKey = h.includes('文本')
      ? '文本'
      : h.includes('名称')
        ? '名称'
        : h.includes('层名')
          ? '层名'
          : h.includes('层号')
            ? '层号'
            : '名称';
    return {
      sn: legacy,
      isLegacy: true,
      defaultHeader: ['井号', '顶深', '底深', nameKey],
      nameKey,
    };
  }
  return {
    sn: textSn ?? '文本道',
    isLegacy: false,
    defaultHeader: [
      '井号',
      '道名',
      '层号',
      '顶深',
      '顶TVD',
      '顶TVDSS',
      '底深',
      '底TVD',
      '底TVDSS',
      '文本',
    ],
    nameKey: '文本',
  };
}

function openKindSheet(wb: XLSX.WorkBook, kind: 'lithology' | 'microPhase'): SheetLoc | null {
  if (kind === 'lithology') {
    const { sn, defaultHeader } = resolveLithologySheet(wb);
    const m = ensureSheet(wb, sn, defaultHeader);
    const h = headerOf(m);
    const topIdx = h.indexOf('顶深');
    const botIdx = h.indexOf('底深');
    const nameIdx = h.indexOf('岩性');
    if (topIdx < 0 || botIdx < 0 || nameIdx < 0) return null;
    return { sheet: sn, matrix: m, header: h, topIdx, botIdx, nameIdx };
  }
  const { sn, defaultHeader, nameKey } = resolveMicroPhaseSheet(wb);
  const m = ensureSheet(wb, sn, defaultHeader);
  const h = headerOf(m);
  const topIdx = h.indexOf('顶深');
  const botIdx = h.indexOf('底深');
  let nameIdx = h.indexOf(nameKey);
  if (nameIdx < 0) {
    for (const k of ['文本', '名称', '层名', '层号']) {
      nameIdx = h.indexOf(k);
      if (nameIdx >= 0) break;
    }
  }
  if (topIdx < 0 || botIdx < 0 || nameIdx < 0) return null;
  // 文本道可能混有其它道名行；删除时额外校验道名=微相
  return { sheet: sn, matrix: m, header: h, topIdx, botIdx, nameIdx };
}

function rowMatches(
  loc: SheetLoc,
  rowIdx: number,
  top: number,
  bottom: number,
  name: string,
  kind: 'lithology' | 'microPhase',
): boolean {
  const row = loc.matrix[rowIdx];
  if (!row) return false;
  const t = parseNumCell(row[loc.topIdx]);
  const b = parseNumCell(row[loc.botIdx]);
  const n = row[loc.nameIdx] != null ? String(row[loc.nameIdx]).trim() : '';
  if (t == null || b == null) return false;
  if (!numEq(t, top) || !numEq(b, bottom) || n !== name.trim()) return false;
  if (kind === 'microPhase') {
    const trackIdx = loc.header.indexOf('道名');
    if (trackIdx >= 0) {
      const tn = row[trackIdx] != null ? String(row[trackIdx]).trim() : '';
      // 文本道中仅接受微相行；空道名在专用微相 sheet 允许
      if (tn && tn !== '微相' && !tn.includes('微相')) return false;
    }
  }
  if (kind === 'lithology') {
    const trackIdx = loc.header.indexOf('道名');
    if (trackIdx >= 0) {
      const tn = row[trackIdx] != null ? String(row[trackIdx]).trim() : '';
      if (tn && tn !== '岩性' && !tn.includes('岩性')) return false;
    }
  }
  return true;
}

function deleteRowAt(loc: SheetLoc, rowIdx: number): void {
  if (rowIdx < 1 || rowIdx >= loc.matrix.length) {
    throw new Error(`删除行号无效: ${rowIdx}`);
  }
  loc.matrix.splice(rowIdx, 1);
}

function findMatchingRows(
  loc: SheetLoc,
  top: number,
  bottom: number,
  name: string,
  kind: 'lithology' | 'microPhase',
): number[] {
  const hits: number[] = [];
  for (let r = 1; r < loc.matrix.length; r++) {
    if (rowMatches(loc, r, top, bottom, name, kind)) hits.push(r);
  }
  return hits;
}

function appendLithology(
  wb: XLSX.WorkBook,
  wellNo: string,
  op: IntervalOpIn,
): { sheet: string; row: number } {
  const { sn, isLegacyProfile, defaultHeader } = resolveLithologySheet(wb);
  const m = ensureSheet(wb, sn, defaultHeader);
  let row: number;
  if (isLegacyProfile) {
    row = appendAlignedRow(
      m,
      { 井号: wellNo, 顶深: op.top, 底深: op.bottom, 岩性: op.name },
      defaultHeader,
    );
  } else {
    row = appendAlignedRow(
      m,
      {
        井号: wellNo,
        道名: '岩性',
        顶深: op.top,
        顶TVD: op.top,
        顶TVDSS: '',
        底深: op.bottom,
        底TVD: op.bottom,
        底TVDSS: '',
        岩性: op.name,
      },
      defaultHeader,
    );
  }
  setSheet(wb, sn, m);
  return { sheet: sn, row };
}

function appendMicroPhase(
  wb: XLSX.WorkBook,
  wellNo: string,
  op: IntervalOpIn,
): { sheet: string; row: number } {
  const { sn, isLegacy, defaultHeader, nameKey } = resolveMicroPhaseSheet(wb);
  const m = ensureSheet(wb, sn, defaultHeader);
  let row: number;
  if (isLegacy) {
    row = appendAlignedRow(
      m,
      { 井号: wellNo, 顶深: op.top, 底深: op.bottom, [nameKey]: op.name },
      defaultHeader,
    );
  } else {
    row = appendAlignedRow(
      m,
      {
        井号: wellNo,
        道名: '微相',
        层号: '',
        顶深: op.top,
        顶TVD: op.top,
        顶TVDSS: '',
        底深: op.bottom,
        底TVD: op.bottom,
        底TVDSS: '',
        文本: op.name,
      },
      defaultHeader,
    );
  }
  setSheet(wb, sn, m);
  return { sheet: sn, row };
}

function applyCreate(wb: XLSX.WorkBook, wellNo: string, op: IntervalOpIn): void {
  const name = (op.name || '').trim();
  const normalized: IntervalOpIn = {
    operationId: op.operationId,
    action: 'create',
    kind: op.kind,
    top: op.top,
    bottom: op.bottom,
    name,
  };
  const written =
    op.kind === 'lithology'
      ? appendLithology(wb, wellNo, normalized)
      : appendMicroPhase(wb, wellNo, normalized);
  recordOp(wb, {
    operationId: op.operationId,
    action: 'create',
    kind: op.kind,
    top: op.top,
    bottom: op.bottom,
    name,
    writeSheet: written.sheet,
    writeRow: written.row,
  });
}

function applyDelete(wb: XLSX.WorkBook, op: IntervalOpIn): void {
  const name = (op.name || '').trim();
  const kind = op.kind;
  const loc = openKindSheet(wb, kind);
  if (!loc) throw new Error('找不到对应数据表');

  let rowIdx = -1;
  let originSheet = '';
  let originRow: number | undefined;
  let originOperationId = '';

  const target = op.target;

  if (target?.originOperationId) {
    originOperationId = target.originOperationId.trim();
    const records = parseOpsSheet(wb);
    const createRec = [...records]
      .reverse()
      .find((r) => r.operationId === originOperationId && r.action === 'create');
    if (!createRec) {
      throw new Error(`找不到 originOperationId 对应的 create 记录: ${originOperationId}`);
    }
    // 校验类型与数值
    if (createRec.kind && createRec.kind !== kind) {
      throw new Error('originOperationId 的 kind 与请求不一致');
    }
    if (
      Number.isFinite(createRec.top) &&
      Number.isFinite(createRec.bottom) &&
      (!numEq(createRec.top, op.top) || !numEq(createRec.bottom, op.bottom) || createRec.name !== name)
    ) {
      throw new Error('originOperationId 记录的顶底深/名称与请求不一致');
    }
    const wSheet = createRec.writeSheet;
    const wRow = Number(createRec.writeRow);
    if (wSheet && Number.isFinite(wRow) && wRow >= 1) {
      if (wSheet !== loc.sheet) {
        // 写在不同 sheet：打开该 sheet
        if (!wb.SheetNames.includes(wSheet)) throw new Error(`写入表不存在: ${wSheet}`);
        const m = sheetToMatrix(wb.Sheets[wSheet]);
        const h = headerOf(m);
        const topIdx = h.indexOf('顶深');
        const botIdx = h.indexOf('底深');
        const nameIdx =
          h.indexOf('岩性') >= 0
            ? h.indexOf('岩性')
            : h.indexOf('文本') >= 0
              ? h.indexOf('文本')
              : h.indexOf('名称');
        if (topIdx < 0 || botIdx < 0 || nameIdx < 0) throw new Error('写入表缺关键列');
        const alt: SheetLoc = { sheet: wSheet, matrix: m, header: h, topIdx, botIdx, nameIdx };
        if (rowMatches(alt, wRow, op.top, op.bottom, name, kind)) {
          deleteRowAt(alt, wRow);
          setSheet(wb, wSheet, alt.matrix);
          originSheet = wSheet;
          originRow = wRow;
          recordOp(wb, {
            operationId: op.operationId,
            action: 'delete',
            kind,
            top: op.top,
            bottom: op.bottom,
            name,
            originSheet,
            originRow,
            originOperationId,
          });
          return;
        }
      } else if (rowMatches(loc, wRow, op.top, op.bottom, name, kind)) {
        rowIdx = wRow;
        originSheet = loc.sheet;
        originRow = wRow;
      }
    }
    // 行号漂移：按 top/bottom/name 精确搜；多条时取第一条（同名同深重复时优先用 writeRow 已处理）
    if (rowIdx < 0) {
      const hits = findMatchingRows(loc, op.top, op.bottom, name, kind);
      if (hits.length === 0) throw new Error('未找到 originOperationId 对应的数据行');
      rowIdx = hits[0];
      originSheet = loc.sheet;
      originRow = rowIdx;
    }
  } else if (target?.sheet != null && target.sheet !== '' && target.row != null && Number.isFinite(Number(target.row))) {
    originSheet = String(target.sheet).trim();
    originRow = Number(target.row);
    if (!wb.SheetNames.includes(originSheet)) {
      throw new Error(`目标 sheet 不存在: ${originSheet}`);
    }
    if (originSheet !== loc.sheet) {
      const m = sheetToMatrix(wb.Sheets[originSheet]);
      const h = headerOf(m);
      const topIdx = h.indexOf('顶深');
      const botIdx = h.indexOf('底深');
      const nameIdx =
        h.indexOf('岩性') >= 0
          ? h.indexOf('岩性')
          : h.indexOf('文本') >= 0
            ? h.indexOf('文本')
            : h.indexOf('名称');
      if (topIdx < 0 || botIdx < 0 || nameIdx < 0) throw new Error('目标 sheet 缺关键列');
      const alt: SheetLoc = { sheet: originSheet, matrix: m, header: h, topIdx, botIdx, nameIdx };
      if (!rowMatches(alt, originRow, op.top, op.bottom, name, kind)) {
        throw new Error(
          `删除校验失败：sheet=${originSheet} row=${originRow} 与 kind/顶底深/名称不匹配`,
        );
      }
      deleteRowAt(alt, originRow);
      setSheet(wb, originSheet, alt.matrix);
      recordOp(wb, {
        operationId: op.operationId,
        action: 'delete',
        kind,
        top: op.top,
        bottom: op.bottom,
        name,
        originSheet,
        originRow,
      });
      return;
    }
    if (!rowMatches(loc, originRow, op.top, op.bottom, name, kind)) {
      throw new Error(
        `删除校验失败：sheet=${originSheet} row=${originRow} 与 kind/顶底深/名称不匹配`,
      );
    }
    rowIdx = originRow;
  } else {
    // 无 target：按 top/bottom/name 精确匹配（仅一条时允许；多条拒绝以免误删）
    const hits = findMatchingRows(loc, op.top, op.bottom, name, kind);
    if (hits.length === 0) throw new Error('未找到匹配的数据行');
    if (hits.length > 1) {
      throw new Error(`存在 ${hits.length} 条同名同深度行，删除必须指定 target.sheet/row 或 originOperationId`);
    }
    rowIdx = hits[0];
    originSheet = loc.sheet;
    originRow = rowIdx;
  }

  deleteRowAt(loc, rowIdx);
  setSheet(wb, loc.sheet, loc.matrix);
  recordOp(wb, {
    operationId: op.operationId,
    action: 'delete',
    kind,
    top: op.top,
    bottom: op.bottom,
    name,
    originSheet,
    originRow,
    originOperationId: originOperationId || undefined,
  });
}

function atomicReplace(targetPath: string, data: Buffer): void {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, targetPath);
  } catch {
    const bak = path.join(dir, `.${base}.${process.pid}.bak`);
    try {
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
      if (fs.existsSync(targetPath)) fs.renameSync(targetPath, bak);
      fs.renameSync(tmp, targetPath);
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
    } catch (e) {
      try {
        if (fs.existsSync(bak) && !fs.existsSync(targetPath)) fs.renameSync(bak, targetPath);
      } catch {
        /* ignore restore error */
      }
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw e;
    }
  }
}

/** 同批次 xlsx 行删除按 sheet/行倒序，避免行号前移。create 保持原序且在 delete 之后。 */
function orderOperations(operations: IntervalOpIn[]): IntervalOpIn[] {
  const deletes: IntervalOpIn[] = [];
  const creates: IntervalOpIn[] = [];
  for (const op of operations) {
    const action = op.action === 'delete' ? 'delete' : 'create';
    if (action === 'delete') deletes.push(op);
    else creates.push(op);
  }
  deletes.sort((a, b) => {
    const as = a.target?.sheet ?? '';
    const bs = b.target?.sheet ?? '';
    if (as !== bs) return as < bs ? 1 : as > bs ? -1 : 0; // sheet 名字典序倒序亦可，主要靠 row
    const ar = a.target?.row;
    const br = b.target?.row;
    if (ar != null && br != null && Number.isFinite(ar) && Number.isFinite(br)) {
      return br - ar; // 行号倒序
    }
    // 有 row 的优先按 row 排在前面（更大 row 先删）
    if (ar != null && br == null) return -1;
    if (ar == null && br != null) return 1;
    return 0;
  });
  // 二次：同一 sheet 内仅有 row 的再保证倒序
  deletes.sort((a, b) => {
    const as = (a.target?.sheet ?? '').trim();
    const bs = (b.target?.sheet ?? '').trim();
    if (as !== bs) return as.localeCompare(bs);
    const ar = Number(a.target?.row);
    const br = Number(b.target?.row);
    if (Number.isFinite(ar) && Number.isFinite(br)) return br - ar;
    return 0;
  });
  return [...deletes, ...creates];
}

export function applyOps(input: IntervalSaveWorkerIn): IntervalSaveWorkerOut {
  const { filePath, wellName, operations } = input;
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, error: 'invalid filePath' };
  }
  const base = path.basename(filePath);
  if (!/^\d+\.xlsx$/.test(base) || filePath.includes('..')) {
    return { ok: false, error: 'illegal file path' };
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return { ok: false, error: 'xlsx 文件不存在' };
  }

  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const wellNo = resolveWellNo(wb, wellName);
  const applied = loadAppliedIds(wb);
  const results: OpResult[] = [];
  let dirty = false;

  // 结果顺序与输入 operations 对齐；执行顺序为 delete(倒序)+create
  const resultById = new Map<string, OpResult>();
  const ordered = orderOperations(operations);

  // 先标记 duplicate / 基础校验，再执行
  for (const op of ordered) {
    const id = (op.operationId || '').trim();
    if (!id) {
      resultById.set(op.operationId || `empty-${resultById.size}`, {
        operationId: op.operationId || '',
        status: 'error',
        error: '缺少 operationId',
      });
      continue;
    }
    if (applied.has(id)) {
      resultById.set(id, { operationId: id, status: 'duplicate' });
      continue;
    }
    if (!KINDS.has(op.kind)) {
      resultById.set(id, { operationId: id, status: 'error', error: '非法 kind' });
      continue;
    }
    const action: IntervalOpAction = op.action === 'delete' ? 'delete' : 'create';
    if (!(Number.isFinite(op.top) && Number.isFinite(op.bottom)) || op.top >= op.bottom) {
      resultById.set(id, { operationId: id, status: 'error', error: '顶深必须小于底深' });
      continue;
    }
    const name = (op.name || '').trim();
    if (!name) {
      resultById.set(id, { operationId: id, status: 'error', error: '名称不能为空' });
      continue;
    }
    try {
      if (action === 'create') {
        applyCreate(wb, wellNo, { ...op, operationId: id, action: 'create', name });
      } else {
        applyDelete(wb, { ...op, operationId: id, action: 'delete', name });
      }
      applied.add(id);
      dirty = true;
      resultById.set(id, { operationId: id, status: 'applied' });
    } catch (e) {
      resultById.set(id, {
        operationId: id,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 按输入顺序输出 results
  for (const op of operations) {
    const id = (op.operationId || '').trim();
    const r = resultById.get(id) ?? resultById.get(op.operationId || '');
    if (r) results.push(r);
    else results.push({ operationId: op.operationId || '', status: 'error', error: '内部未处理' });
  }

  if (dirty) {
    hideOpsSheet(wb);
    const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    atomicReplace(filePath, Buffer.from(out));
  }

  return { ok: true, results };
}

console.log('[intervalSave.worker] started tid', threadId);

parentPort?.on('message', (msg: IntervalSaveWorkerIn) => {
  try {
    const out = applyOps(msg);
    parentPort?.postMessage(out);
  } catch (e) {
    parentPort?.postMessage({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    } satisfies IntervalSaveWorkerOut);
  }
});
