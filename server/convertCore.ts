import * as XLSX from 'xlsx';
import { parseDatasetXml } from './util';

// XML（<dataset> 结构）→ xlsx 字节。
// 同一份核心逻辑：worker 线程调用 + 降级时主线程调用。
export function convertCore(buf: Uint8Array): Uint8Array {
  const parsed = parseDatasetXml(Buffer.from(buf).toString('utf8'));
  const rows = (parsed.length
    ? parsed
    : [{ 来源: 'imported', 备注: '原XML未识别到<dataset>结构' }]) as unknown as Record<string, unknown>[];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'data');
  // SheetJS 0.18.5 的 type:'array' 返回 ArrayBuffer；包成 Uint8Array（.buffer 可跨 worker transfer）
  const ab = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(ab);
}
