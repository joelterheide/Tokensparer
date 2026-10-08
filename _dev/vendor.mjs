// Kopiert bzw. bündelt die Fremdbibliotheken nach ../vendor.
// Aufruf: npm install && npm run vendor
// Die Website lädt alles von dort statt von einem CDN – keine Anfragen an Dritte.

import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'vendor');
const licenses = join(out, 'licenses');
mkdirSync(licenses, { recursive: true });

const pkgDir = (name) => join(here, 'node_modules', name);
const version = (name) => JSON.parse(readFileSync(join(pkgDir(name), 'package.json'), 'utf8')).version;

function copyLicense(name) {
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE']) {
    const src = join(pkgDir(name), file);
    if (existsSync(src)) {
      copyFileSync(src, join(licenses, `${name.replace('/', '__')}.txt`));
      return;
    }
  }
  throw new Error(`Keine Lizenzdatei für ${name} gefunden`);
}

// pdf.js (Legacy-Build für ältere Safari-Versionen). Endung .js statt .mjs,
// damit jeder Webserver den richtigen MIME-Typ schickt.
copyFileSync(join(pkgDir('pdfjs-dist'), 'legacy/build/pdf.min.mjs'), join(out, 'pdf.min.js'));
copyFileSync(join(pkgDir('pdfjs-dist'), 'legacy/build/pdf.worker.min.mjs'), join(out, 'pdf.worker.min.js'));
copyLicense('pdfjs-dist');

// mammoth (Word → HTML)
copyFileSync(join(pkgDir('mammoth'), 'mammoth.browser.min.js'), join(out, 'mammoth.browser.min.js'));
copyLicense('mammoth');

// fflate (ZIP für .xlsx/.pptx) und Anthropic-SDK als ES-Module bündeln
const bundles = [
  { file: 'fflate.js', contents: "export { unzipSync, strFromU8 } from 'fflate';", pkg: 'fflate' },
  { file: 'anthropic-sdk.js', contents: "export { default } from '@anthropic-ai/sdk';", pkg: '@anthropic-ai/sdk' },
];
for (const b of bundles) {
  await build({
    stdin: { contents: b.contents, resolveDir: here, loader: 'js' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'eof',
    outfile: join(out, b.file),
    logLevel: 'warning',
  });
  copyLicense(b.pkg);
}

const libs = ['pdfjs-dist', 'mammoth', 'fflate', '@anthropic-ai/sdk'];
writeFileSync(
  join(out, 'VERSIONS.md'),
  `# Fremdbibliotheken\n\nErzeugt mit \`_dev/vendor.mjs\`. Lizenzen siehe \`licenses/\`.\n\n${libs
    .map((l) => `- ${l} ${version(l)}`)
    .join('\n')}\n`,
);
console.log(`vendor/ aktualisiert: ${libs.map((l) => `${l}@${version(l)}`).join(', ')}`);
