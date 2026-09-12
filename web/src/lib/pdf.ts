/**
 * Web-only PDF handling for the Labs screen: render pages, read the text layer, group items into
 * lines, black out what the redaction rules say, and stitch the redacted pages into one image
 * for upload. pdf.js is loaded at runtime from /pdfjs/ (copied by scripts/sync-assets.js), not
 * bundled by Metro, so the native bundles never see it.
 */
import { redactLine, type RuleSet } from '@/lib/redaction';

export interface TextItem {
  str: string;
  /** Box in page-canvas pixels (origin top-left). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextLine {
  text: string;
  items: TextItem[];
  /** Union box of the items, canvas pixels. */
  box: { x: number; y: number; w: number; h: number };
}

export interface RenderedPage {
  index: number;
  width: number;
  height: number;
  /** JPEG data URL of the page as rendered (redacted boxes painted when applyRedaction ran). */
  dataUrl: string;
  lines: TextLine[];
  /** Line indexes removed by drop_line rules, and boxes painted black. */
  redactedBoxes: { x: number; y: number; w: number; h: number }[];
}

export interface RedactionReport {
  dropped: number;
  masked: number;
  /** Rule ids that fired, for the "identifiers stripped" note. */
  ruleIds: string[];
}

type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfDocument> };
};
interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}
interface PdfPage {
  getViewport: (o: { scale: number }) => { width: number; height: number; transform: number[] };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
  getTextContent: () => Promise<{ items: { str?: string; transform?: number[]; width?: number; height?: number }[] }>;
}

let pdfjsPromise: Promise<PdfJs> | null = null;

/** Dynamic import by URL, hidden from Metro so it does not try to bundle the file. */
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    const importer = new Function('u', 'return import(u)') as (u: string) => Promise<PdfJs>;
    pdfjsPromise = importer('/pdfjs/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfjsPromise;
}

const RENDER_SCALE = 1.5;

/** Group text items into lines by their baseline (items within half a line-height of each other). */
function groupLines(items: TextItem[]): TextLine[] {
  const sorted = [...items].filter((i) => i.str.trim().length > 0).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextLine[] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    const tol = Math.max(item.h, 6) * 0.6;
    if (last && Math.abs(last.items[0].y - item.y) <= tol) {
      last.items.push(item);
    } else {
      lines.push({ text: '', items: [item], box: { x: 0, y: 0, w: 0, h: 0 } });
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items
      .map((i) => i.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const x0 = Math.min(...line.items.map((i) => i.x));
    const y0 = Math.min(...line.items.map((i) => i.y));
    const x1 = Math.max(...line.items.map((i) => i.x + i.w));
    const y1 = Math.max(...line.items.map((i) => i.y + i.h));
    line.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return lines;
}

/**
 * Render every page and read its text layer. When `rules` is given, drop_line hits are painted
 * black on the canvas (every item box on the line) and mask hits paint the whole item that
 * contains the match; the page image returned is therefore already redacted.
 */
export async function renderPdf(data: ArrayBuffer, rules: RuleSet | null): Promise<{ pages: RenderedPage[]; report: RedactionReport }> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: RenderedPage[] = [];
  const report: RedactionReport = { dropped: 0, masked: 0, ruleIds: [] };

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items) {
      if (!it.str || !it.transform) continue;
      // transform = [a, b, c, d, e, f] in PDF user space; map through the viewport transform.
      const [a, b, , d, e, f] = it.transform;
      const [va, vb, vc, vd, ve, vf] = viewport.transform;
      const x = va * e + vc * f + ve;
      const yBase = vb * e + vd * f + vf;
      const fontH = Math.hypot(b, d) * Math.hypot(va, vb) || (it.height ?? 10) * RENDER_SCALE;
      const w = (it.width ?? 0) * Math.hypot(va, vb) || Math.hypot(a, b) * (it.str.length * 0.5) * RENDER_SCALE;
      items.push({ str: it.str, x, y: yBase - fontH, w, h: fontH * 1.15 });
    }
    const lines = groupLines(items);
    const redactedBoxes: RenderedPage['redactedBoxes'] = [];

    if (rules) {
      const kept: TextLine[] = [];
      for (const line of lines) {
        const r = redactLine(line.text, rules);
        if (r.text === null) {
          report.dropped += 1;
          report.ruleIds.push(r.droppedBy!);
          for (const it of line.items) redactedBoxes.push({ x: it.x, y: it.y, w: it.w, h: it.h });
          continue;
        }
        if (r.masks.length > 0) {
          report.masked += r.masks.length;
          for (const m of r.masks) {
            report.ruleIds.push(m.ruleId);
            // Paint every item whose text takes part in the match (item boundaries are the finest unit we have).
            for (const it of line.items) {
              if (m.matched.includes(it.str.trim()) || it.str.includes(m.matched)) {
                redactedBoxes.push({ x: it.x, y: it.y, w: it.w, h: it.h });
              }
            }
          }
          line.text = r.text;
        }
        kept.push(line);
      }
      ctx.fillStyle = '#000';
      for (const b of redactedBoxes) ctx.fillRect(b.x - 2, b.y - 1, b.w + 4, b.h + 2);
      pages.push({ index: n - 1, width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL('image/jpeg', 0.85), lines: kept, redactedBoxes });
    } else {
      pages.push({ index: n - 1, width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL('image/jpeg', 0.85), lines, redactedBoxes });
    }
  }
  report.ruleIds = [...new Set(report.ruleIds)];
  return { pages, report };
}

/** One tall JPEG of every redacted page, for `/extract` when the original cannot be sent as-is. */
export async function stitchPages(pages: RenderedPage[]): Promise<Blob> {
  const width = Math.max(...pages.map((p) => p.width));
  const height = pages.reduce((s, p) => s + p.height, 0);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const p of pages) {
    const img = await loadImage(p.dataUrl);
    ctx.drawImage(img, 0, y);
    y += p.height;
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.85));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Find the page line that printed an extracted analyte, by the API's verbatim `source_text`
 * (contracts.md section 3: highlight by quote when the text layers differ). Falls back to a
 * line that carries both the printed name and the printed value.
 */
export function findSourceLine(
  pages: RenderedPage[],
  sourceText: string,
  rawName: string,
  value: number,
): { page: number; line: number } | null {
  const target = norm(sourceText);
  for (const p of pages) {
    for (let i = 0; i < p.lines.length; i++) {
      const t = norm(p.lines[i].text);
      if (target && (t === target || t.includes(target) || target.includes(t) && t.length > 8)) return { page: p.index, line: i };
    }
  }
  const name = norm(rawName);
  const val = String(value);
  for (const p of pages) {
    for (let i = 0; i < p.lines.length; i++) {
      const t = norm(p.lines[i].text);
      if (name && t.includes(name) && t.includes(val)) return { page: p.index, line: i };
    }
  }
  return null;
}
