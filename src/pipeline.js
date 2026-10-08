// Dateityp erkennen, Inhalt auslesen und optimieren.

import { estimateTokens } from './estimate.js';
import {
  jsonVariants,
  jsonlVariants,
  minifyXml,
  notebookToText,
  optimizeCsv,
  parsePageRange,
  pdfPageRawText,
  pdfPagesToText,
  sheetsToText,
  slidesToText,
  subtitlesToText,
} from './formats.js';
import { htmlToMarkdown } from './html.js';
import { countImageTokens, findContentBox, loadImage, renderImage, targetSize } from './image.js';
import {
  cleanWhitespace,
  compactMarkdownTables,
  dedupeLines,
  dropMarkdownLinks,
  normalizeNewlines,
  removeInvisible,
  simplifyTypography,
  stripBase64,
  stripComments,
  stripTrackingParams,
} from './text.js';

const fmt = new Intl.NumberFormat('de-DE');

/** "1 leere Zeile" / "3 leere Zeilen" */
const count = (n, one, many) => `${fmt.format(n)} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Dateitypen

const EXTENSIONS = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
  xlsx: 'xlsx', xlsm: 'xlsx',
  html: 'html', htm: 'html', xhtml: 'html', mhtml: 'html',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  json: 'json', geojson: 'json', webmanifest: 'json',
  jsonl: 'jsonl', ndjson: 'jsonl',
  ipynb: 'notebook',
  csv: 'csv', tsv: 'csv',
  xml: 'xml', svg: 'xml', rss: 'xml', atom: 'xml', plist: 'xml', xsd: 'xml', kml: 'xml', gpx: 'xml', drawio: 'xml',
  srt: 'subtitles', vtt: 'subtitles',
  txt: 'text', text: 'text', log: 'text', rtf: 'unsupported', eml: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', avif: 'image', heic: 'image', heif: 'image',
  doc: 'unsupported', xls: 'unsupported', ppt: 'unsupported', odt: 'unsupported', ods: 'unsupported', odp: 'unsupported',
  zip: 'unsupported', exe: 'unsupported', mp3: 'unsupported', mp4: 'unsupported', mov: 'unsupported',
};

const CODE_EXTENSIONS = {
  c: 'c', h: 'c', cpp: 'c', cc: 'c', cxx: 'c', hpp: 'c', cs: 'c', java: 'c', js: 'c', mjs: 'c', cjs: 'c', jsx: 'c',
  ts: 'c', tsx: 'c', mts: 'c', go: 'c', rs: 'c', swift: 'c', kt: 'c', kts: 'c', scala: 'c', dart: 'c', php: 'c',
  groovy: 'c', gradle: 'c', m: 'c', zig: 'c', sol: 'c', proto: 'c',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  py: 'python', pyw: 'python', pyi: 'python',
  rb: 'hash', sh: 'hash', bash: 'hash', zsh: 'hash', fish: 'hash', ps1: 'hash', pl: 'hash', r: 'hash',
  yaml: 'hash', yml: 'hash', toml: 'hash', ini: 'hash', cfg: 'hash', conf: 'hash', properties: 'hash', env: 'hash',
  dockerfile: 'hash', makefile: 'hash', cmake: 'hash', tf: 'hash', nix: 'hash', jl: 'hash', ex: 'hash', exs: 'hash',
  sql: 'sql', lua: 'lua', hs: 'sql',
  vue: '', svelte: '', astro: '', bat: '', cmd: '', tex: '', bib: '', graphql: 'hash', gql: 'hash',
};

const KIND_LABELS = {
  pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', xlsx: 'Excel', html: 'Webseite', markdown: 'Markdown',
  json: 'JSON', jsonl: 'JSON Lines', notebook: 'Jupyter-Notebook', csv: 'CSV', xml: 'XML', subtitles: 'Untertitel',
  text: 'Text', code: 'Code', image: 'Bild', unsupported: 'Nicht unterstützt',
};

export function kindLabel(kind) {
  return KIND_LABELS[kind] ?? kind;
}

export function detectKind(name, mimeType = '') {
  const lower = name.toLowerCase();
  const base = lower.split('/').pop();
  const ext = base.includes('.') ? base.split('.').pop() : base;
  if (EXTENSIONS[ext]) return { kind: EXTENSIONS[ext] };
  if (ext in CODE_EXTENSIONS) return { kind: 'code', lang: CODE_EXTENSIONS[ext] };
  if (mimeType.startsWith('image/')) return { kind: 'image' };
  if (mimeType === 'application/pdf') return { kind: 'pdf' };
  return { kind: 'text', guessed: true };
}

/** Eingefügten Text einem Typ zuordnen. */
export function detectPastedKind(text) {
  const t = text.trim();
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t);
      return { kind: 'json' };
    } catch {
      // kein JSON
    }
  }
  if (/^<(!doctype html|html|head|body|div|p|table|article|section)\b/i.test(t)) return { kind: 'html' };
  if (/^<\?xml|^<[a-z][\w:-]*[\s>]/i.test(t) && /<\/[a-z][\w:-]*>\s*$/i.test(t)) return { kind: 'xml' };
  if (/^(WEBVTT|\d+\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3} -->)/.test(t)) return { kind: 'subtitles' };
  return { kind: 'text' };
}

/** Text dekodieren: UTF-8, bei Fehlern Windows-1252 (z. B. CSV aus Excel). */
export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function looksBinary(text) {
  const sample = text.slice(0, 4000);
  // eslint-disable-next-line no-control-regex
  const controls = (sample.match(/[\x00-\x08\x0E-\x1F]/g) || []).length;
  return controls > sample.length * 0.02;
}

// ---------------------------------------------------------------------------
// Auslesen

let mammothPromise;

function loadMammoth() {
  mammothPromise ??= new Promise((resolve, reject) => {
    if (window.mammoth) return resolve(window.mammoth);
    const s = document.createElement('script');
    s.src = new URL('../vendor/mammoth.browser.min.js', import.meta.url).href;
    s.onload = () => resolve(window.mammoth);
    s.onerror = () => reject(new Error('Word-Modul konnte nicht geladen werden'));
    document.head.append(s);
  });
  return mammothPromise;
}

/**
 * Inhalt einer Datei auslesen. Ergebnis wird am Eintrag zwischengespeichert,
 * damit Einstellungsänderungen ohne erneutes Einlesen wirken.
 */
export async function extract(item, onProgress) {
  const { kind } = item;
  if (kind === 'unsupported') {
    throw new Error('Dieses Format wird nicht unterstützt. Bitte als PDF, DOCX, XLSX, PPTX, CSV oder Text speichern.');
  }
  if (kind === 'image') {
    return { img: await loadImage(item.file) };
  }
  const buffer = await item.file.arrayBuffer();
  if (kind === 'pdf') {
    const { readPdf } = await import('./pdf.js');
    return readPdf(buffer, onProgress);
  }
  if (kind === 'docx') {
    const mammoth = await loadMammoth();
    const noImages = mammoth.images.imgElement((image) => Promise.resolve({ src: '', alt: image.altText || '' }));
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buffer }, { convertImage: noImages });
    return { html };
  }
  if (kind === 'xlsx' || kind === 'pptx') {
    const office = await import('./office.js');
    return kind === 'xlsx' ? { sheets: office.readXlsx(buffer) } : { slides: office.readPptx(buffer) };
  }
  const text = decodeText(buffer);
  if (item.guessed && looksBinary(text)) {
    throw new Error('Unbekanntes Binärformat – nur Text-, Office-, PDF- und Bilddateien werden unterstützt.');
  }
  return { text };
}

// ---------------------------------------------------------------------------
// Optimieren

function polish(s, opts, notes, { prose = false, markdown = true, dedupe = true, tracking = true } = {}) {
  let out = normalizeNewlines(s);
  if (opts.invisible) out = removeInvisible(out);
  if (opts.base64) {
    const r = stripBase64(out);
    out = r.text;
    if (r.count) notes.push(`${count(r.count, 'eingebettete Datei', 'eingebettete Dateien')} entfernt`);
  }
  if (markdown) {
    if (opts.typography) out = simplifyTypography(out);
    if (opts.dropLinks) out = dropMarkdownLinks(out);
    if (opts.compactTables) out = compactMarkdownTables(out);
  }
  if (tracking && opts.trackingParams) out = stripTrackingParams(out);
  if (dedupe && (opts.dedupeLines || opts.dedupeSimilar)) {
    const r = dedupeLines(out, { similar: opts.dedupeSimilar });
    out = r.text;
    if (r.removed) notes.push(`${count(r.removed, 'wiederholte Zeile', 'wiederholte Zeilen')} zusammengefasst`);
  }
  if (opts.whitespace) out = cleanWhitespace(out, { collapseInner: prose });
  return out;
}

function cheapest(variants, tokenizer) {
  return variants
    .map((v) => ({ ...v, tokens: estimateTokens(v.text, tokenizer) }))
    .reduce((a, b) => (b.tokens < a.tokens ? b : a));
}

// Annahme für Seitenbilder: Seite wird mit 1,5-facher Punktgröße gerastert.
const PDF_RASTER_SCALE = 1.5;

function pdfPageImageTokens(page, tier) {
  const [w, h] = targetSize(Math.round(page.width * PDF_RASTER_SCALE), Math.round(page.height * PDF_RASTER_SCALE), tier);
  return countImageTokens(w, h);
}

/** Text-Ergebnis für alle Nicht-Bild-Typen. */
function optimizeText(item, opts, model) {
  const tk = model.tokenizer;
  const src = item.source;
  const notes = [];
  let before;
  let beforeText = null; // Rohfassung für die exakte Zählung (PDF: Originaldatei)
  let text;

  switch (item.kind) {
    case 'pdf': {
      const pages = parsePageRange(item.pageRange, src.numPages) ?? parsePageRange('', src.numPages);
      before = src.pages.reduce(
        (sum, p) => sum + estimateTokens(pdfPageRawText(p), tk) + pdfPageImageTokens(p, model.imageTier),
        0,
      );
      const r = pdfPagesToText(
        pages.map((n) => src.pages[n - 1]),
        { removeHeaders: opts.pdfHeaders, reflow: opts.pdfReflow, pageMarkers: opts.pageMarkers, pageNumbers: pages },
      );
      text = polish(r.text, opts, notes, { prose: true });
      const avgImage = Math.round(src.pages.reduce((s, p) => s + pdfPageImageTokens(p, model.imageTier), 0) / src.numPages);
      notes.unshift(
        pages.length === src.numPages
          ? `${src.numPages} Seiten`
          : `${pages.length} von ${src.numPages} Seiten`,
        `Text extrahiert – die Seitenbilder (je ca. ${fmt.format(avgImage)} Tokens) entfallen`,
      );
      if (r.removedLines) notes.push(`${count(r.removedLines, 'Kopf-/Fußzeile', 'Kopf-/Fußzeilen')} entfernt`);
      if (!text.trim()) {
        notes.push('⚠ Kein Text gefunden – vermutlich ein Scan. Dann lieber Seiten als Bilder senden.');
      }
      break;
    }
    case 'docx': {
      // Vergleichsbasis: dieselbe Umwandlung ohne Optimierungen
      beforeText = htmlToMarkdown(src.html, { mainOnly: false }).text;
      const r = htmlToMarkdown(src.html, { mainOnly: false, dropLinks: opts.dropLinks });
      text = polish(r.text, opts, notes, { prose: true });
      if (r.images) notes.push(`${count(r.images, 'Bild', 'Bilder')} entfernt`);
      break;
    }
    case 'pptx': {
      beforeText = slidesToText(src.slides);
      text = polish(beforeText, opts, notes, { prose: true });
      notes.unshift(count(src.slides.length, 'Folie', 'Folien'));
      break;
    }
    case 'xlsx': {
      beforeText = sheetsToText(src.sheets, { tidy: false }).text;
      const r = sheetsToText(src.sheets);
      text = polish(r.text, opts, notes, { markdown: false, dedupe: false, tracking: false });
      notes.unshift(`${count(r.sheets, 'Tabellenblatt', 'Tabellenblätter')} als CSV`);
      if (r.removedRows) notes.push(`${count(r.removedRows, 'leere Zeile', 'leere Zeilen')} entfernt`);
      break;
    }
    case 'html': {
      beforeText = src.text;
      const r = htmlToMarkdown(src.text, { mainOnly: opts.mainOnly, dropLinks: opts.dropLinks });
      text = polish(r.text, opts, notes, { prose: true });
      notes.unshift('HTML in Markdown umgewandelt');
      if (r.removedBlocks) notes.push(`${count(r.removedBlocks, 'Navigations-/Randbereich', 'Navigations-/Randbereiche')} entfernt`);
      break;
    }
    case 'json':
    case 'jsonl': {
      beforeText = src.text;
      const variants =
        opts.minify && (item.kind === 'json' ? jsonVariants(src.text, { toTable: opts.jsonToTable }) : jsonlVariants(src.text, { toTable: opts.jsonToTable }));
      if (variants) {
        const best = cheapest(variants, tk);
        text = polish(best.text, opts, notes, { markdown: false, dedupe: false, tracking: false });
        notes.push(best.note);
      } else {
        if (opts.minify) notes.push('⚠ Kein gültiges JSON – nur Leerraum bereinigt');
        text = polish(src.text, opts, notes, { markdown: false, dedupe: false, tracking: false });
      }
      break;
    }
    case 'notebook': {
      beforeText = src.text;
      const r = notebookToText(src.text, { outputs: !opts.dropNotebookOutputs });
      if (r) {
        text = polish(r.text, { ...opts, typography: false }, notes, { dedupe: false });
        notes.push('Notebook als Markdown + Code');
        if (r.droppedOutputs) notes.push(`${count(r.droppedOutputs, 'Bildausgabe', 'Bildausgaben')} entfernt`);
      } else {
        text = polish(src.text, opts, notes, { markdown: false, dedupe: false });
      }
      break;
    }
    case 'csv': {
      beforeText = src.text;
      let s = src.text;
      if (opts.minify) {
        const r = optimizeCsv(normalizeNewlines(s));
        s = r.text;
        if (r.removedRows) notes.push(`${count(r.removedRows, 'leere Zeile', 'leere Zeilen')} entfernt`);
      }
      text = polish(s, opts, notes, { markdown: false, dedupe: false, tracking: false });
      break;
    }
    case 'xml': {
      beforeText = src.text;
      const s = opts.minify ? minifyXml(normalizeNewlines(src.text), { stripComments: opts.stripComments }) : src.text;
      text = polish(s, opts, notes, { markdown: false, dedupe: false, tracking: false });
      if (opts.minify) notes.push('XML minifiziert');
      break;
    }
    case 'subtitles': {
      beforeText = src.text;
      text = polish(subtitlesToText(normalizeNewlines(src.text), { keepTimes: !opts.dropSubtitleTimes }), opts, notes, {
        prose: true,
      });
      notes.push(opts.dropSubtitleTimes ? 'Nur gesprochener Text (ohne Zeitstempel)' : 'Untertitel mit Startzeiten');
      break;
    }
    case 'code': {
      beforeText = src.text;
      let s = normalizeNewlines(src.text);
      if (opts.stripComments && item.lang) {
        const r = stripComments(s, item.lang);
        s = r.text;
        if (r.removed) notes.push(`${count(r.removed, 'Kommentar', 'Kommentare')} entfernt`);
      }
      text = polish(s, opts, notes, { markdown: false, dedupe: false, tracking: false });
      break;
    }
    case 'markdown':
    case 'text':
    default: {
      beforeText = src.text;
      text = polish(src.text, opts, notes, {});
      break;
    }
  }
  if (beforeText !== null) before = estimateTokens(beforeText, tk);
  return { text, before, beforeText, after: estimateTokens(text, tk), notes };
}

function imageMime(file, format) {
  if (format !== 'auto') return format;
  return ['image/png', 'image/gif', 'image/bmp'].includes(file.type) ? 'image/png' : 'image/jpeg';
}

/** Bild-Ergebnis: Größe berechnen und (falls nötig) neu rendern. */
async function optimizeImage(item, opts, model) {
  const { img } = item.source;
  const full = { x: 0, y: 0, w: img.width, h: img.height };
  const [bw, bh] = targetSize(img.width, img.height, model.imageTier);
  const before = countImageTokens(bw, bh);

  if (opts.trimBorders && !item.source.box) item.source.box = findContentBox(img.source, img.width, img.height);
  const crop = opts.trimBorders ? item.source.box : full;
  const budget = opts.imageBudget > 0 ? opts.imageBudget : Infinity;
  const [w, h] = targetSize(crop.w, crop.h, model.imageTier, budget);
  const mime = imageMime(item.file, opts.imageFormat);

  const key = `${crop.x},${crop.y},${crop.w},${crop.h}|${w}x${h}|${mime}`;
  if (item.imageKey !== key) {
    item.blob = await renderImage(img.source, crop, w, h, mime, 0.9);
    item.imageKey = key;
  }
  const notes = [`${img.width}×${img.height} → ${w}×${h} px`];
  if (crop !== full) notes.push('Einfarbige Ränder abgeschnitten');
  if (w === img.width && h === img.height) notes.push('Größe passt bereits');
  return { image: { blob: item.blob, width: w, height: h, mime }, before, after: countImageTokens(w, h), notes };
}

export function optimize(item, opts, model) {
  return item.kind === 'image' ? optimizeImage(item, opts, model) : Promise.resolve(optimizeText(item, opts, model));
}

