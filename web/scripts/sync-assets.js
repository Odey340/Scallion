/* Copies runtime assets into public/ (run on postinstall and before build:web).
 * - pdf.js (pdfjs-dist) main + worker: loaded at runtime by src/lib/pdf.ts from /pdfjs/, outside Metro.
 * - api/redaction_rules.json (contracts.md section 7) when the api/ tree is present (monorepo checkout);
 *   the committed copy in public/ is used otherwise (Vercel CLI deploys upload web/ only).
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public', 'pdfjs');
fs.mkdirSync(out, { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  const src = path.join(root, 'node_modules', 'pdfjs-dist', 'build', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, f));
  else console.warn(`sync-assets: missing ${src}`);
}
const rules = path.join(root, '..', 'api', 'redaction_rules.json');
if (fs.existsSync(rules)) fs.copyFileSync(rules, path.join(root, 'public', 'redaction_rules.json'));
const sample = path.join(root, '..', 'fixtures', 'lab_report_synthetic.pdf');
if (fs.existsSync(sample)) {
  fs.mkdirSync(path.join(root, 'public', 'samples'), { recursive: true });
  fs.copyFileSync(sample, path.join(root, 'public', 'samples', 'lab_report_synthetic.pdf'));
}
console.log('sync-assets: pdfjs + redaction_rules.json in public/');
