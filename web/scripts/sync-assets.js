/* Copies runtime assets into public/ (run on postinstall and before build:web).
 * - pdf.js (pdfjs-dist) main + worker: loaded at runtime by src/lib/pdf.ts from /pdfjs/, outside Metro.
 * - api/redaction_rules.json (contracts.md section 7) when the api/ tree is present (monorepo checkout);
 *   the committed copy in public/ is used otherwise (Vercel CLI deploys upload web/ only).
 * - fixtures/lab_report_synthetic.pdf and the API's cached extraction for that exact file
 *   (api/fixtures/cache/<sha256>.json), so "Try the sample report" works with no API and no token.
 *   Both are synthetic and PHI-free (fixtures/README.md); the copies are committed for the same reason.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pub = path.join(root, 'public');

const pdfjsOut = path.join(pub, 'pdfjs');
fs.mkdirSync(pdfjsOut, { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  const src = path.join(root, 'node_modules', 'pdfjs-dist', 'build', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(pdfjsOut, f));
  else console.warn(`sync-assets: missing ${src}`);
}

const rules = path.join(root, '..', 'api', 'redaction_rules.json');
if (fs.existsSync(rules)) fs.copyFileSync(rules, path.join(pub, 'redaction_rules.json'));

const sample = path.join(root, '..', 'fixtures', 'lab_report_synthetic.pdf');
const samplesOut = path.join(pub, 'samples');
if (fs.existsSync(sample)) {
  fs.mkdirSync(samplesOut, { recursive: true });
  fs.copyFileSync(sample, path.join(samplesOut, 'lab_report_synthetic.pdf'));
  const cacheDir = path.join(root, '..', 'api', 'fixtures', 'cache');
  if (fs.existsSync(cacheDir)) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(sample)).digest('hex');
    const cached = path.join(cacheDir, `${sha}.json`);
    if (fs.existsSync(cached)) fs.copyFileSync(cached, path.join(samplesOut, 'lab_report_synthetic.extract.json'));
    else console.warn(`sync-assets: no cached extraction for the sample (${sha.slice(0, 12)})`);
  }
}

console.log('sync-assets: pdfjs, redaction_rules.json and samples in public/');
