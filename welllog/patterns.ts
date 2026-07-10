// 岩性/相 SVG 纹样：用 import.meta.glob 一次性以 ?raw 取全部纹样字符串，
// 模块加载时转 data URL（SVG 作"独立文档"由 <image> 渲染，规避命名空间/跨域问题）。
// key = 文件名去后缀、下划线转连字符（与 geoviz chart_engine._build_patterns_json 一致）。
//
// ⚡ 用 <image href=dataURL> 而非 dangerouslySetInnerHTML 注入原 SVG：
//    原文件各含 <?xml?>/自带 xmlns 等，innerHTML 注入易渲染空白；<image> 天然稳健。
// ⚡ 每个纹样 tile 尺寸不同（砂岩 20×20、泥岩 16×8、页岩 16×6…），
//    需随 dataURL 一并暴露 width/height，<pattern> 要按此设宽高，否则纹样被拉伸变形。

export interface PatternAsset {
  url: string; // data:image/svg+xml;utf8,...
  w: number;
  h: number;
}

const rawModules = import.meta.glob('./patterns/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function parseSize(raw: string): { w: number; h: number } {
  const m = raw.match(/<svg[^>]*\bwidth=["'](\d+(?:\.\d+)?)["'][^>]*\bheight=["'](\d+(?:\.\d+)?)["']/);
  if (m) return { w: Number(m[1]), h: Number(m[2]) };
  const m2 = raw.match(/<svg[^>]*\bheight=["'](\d+(?:\.\d+)?)["'][^>]*\bwidth=["'](\d+(?:\.\d+)?)["']/);
  if (m2) return { w: Number(m2[2]), h: Number(m2[1]) };
  return { w: 16, h: 16 }; // 兜底
}

function fileToId(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.svg$/i, '').replace(/_/g, '-');
}

export const PATTERNS: Record<string, PatternAsset> = (() => {
  const out: Record<string, PatternAsset> = {};
  for (const [path, raw] of Object.entries(rawModules)) {
    const id = fileToId(path);
    const { w, h } = parseSize(raw);
    out[id] = { url: `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`, w, h };
  }
  return out;
})();

export function getPattern(id: string | undefined): PatternAsset | undefined {
  if (!id) return undefined;
  return PATTERNS[id];
}
