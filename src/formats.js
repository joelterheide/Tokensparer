// Formatspezifische Umwandlungen (ohne DOM, auch in Node testbar).

// ---------------------------------------------------------------------------
// CSV

export function detectDelimiter(text) {
  const sample = text.split('\n', 20).filter((l) => l.trim());
  let best = ',';
  let bestScore = 0;
  for (const d of [',', ';', '\t', '|']) {
    const counts = sample.map((l) => countOutsideQuotes(l, d));
    const min = Math.min(...counts);
    if (min > 0 && min >= bestScore) {
      best = d;
      bestScore = min;
    }
  }
  return best;
}

function countOutsideQuotes(line, d) {
  let n = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === d && !quoted) n++;
  }
  return n;
}

/** CSV nach RFC 4180 einlesen (Anführungszeichen, Zeilenumbrüche in Zellen). */
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function toCsv(rows, delimiter = ',') {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = v == null ? '' : String(v);
          return s.includes(delimiter) || s.includes('"') || s.includes('\n') || s !== s.trim()
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        })
        .join(delimiter),
    )
    .join('\n');
}

/** Leere Zeilen/Spalten entfernen, Zellen trimmen, leere Zellen am Zeilenende weglassen. */
export function tidyRows(rows) {
  const trimmed = rows.map((r) => r.map((v) => (v == null ? '' : String(v).trim())));
  const nonEmptyRows = trimmed.filter((r) => r.some((v) => v !== ''));
  const width = Math.max(0, ...nonEmptyRows.map((r) => r.length));
  const usedCols = [];
  for (let c = 0; c < width; c++) if (nonEmptyRows.some((r) => (r[c] ?? '') !== '')) usedCols.push(c);
  return nonEmptyRows.map((r) => {
    const out = usedCols.map((c) => r[c] ?? '');
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  });
}

export function optimizeCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  const tidy = tidyRows(rows);
  return {
    text: toCsv(tidy, delimiter),
    removedRows: rows.length - tidy.length,
  };
}

// ---------------------------------------------------------------------------
// JSON

function cellValue(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Array gleichartiger Objekte als CSV-Tabelle, sonst null. */
export function arrayToTable(data) {
  if (!Array.isArray(data) || data.length < 2) return null;
  if (!data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return null;
  const keys = [];
  const seen = new Set();
  for (const r of data) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  if (keys.length === 0 || keys.length > 60) return null;
  let filled = 0;
  for (const r of data) for (const k of keys) if (k in r) filled++;
  if (filled / (data.length * keys.length) < 0.6) return null;
  return toCsv([keys, ...data.map((r) => keys.map((k) => cellValue(r[k])))]);
}

/**
 * JSON-Varianten erzeugen: minifiziert und – wenn möglich – mit Objekt-Listen als
 * CSV-Tabellen. Gibt null zurück, wenn der Text kein gültiges JSON ist.
 */
export function jsonVariants(text, { toTable = true } = {}) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const variants = [{ text: JSON.stringify(data), note: 'JSON minifiziert' }];
  if (!toTable) return variants;

  const table = arrayToTable(data);
  if (table) {
    variants.push({ text: table, note: 'JSON-Liste als CSV-Tabelle' });
  } else if (data && typeof data === 'object' && !Array.isArray(data)) {
    const rest = {};
    const sections = [];
    for (const [k, v] of Object.entries(data)) {
      const t = arrayToTable(v);
      if (t) sections.push(`${k} (CSV):\n${t}`);
      else rest[k] = v;
    }
    if (sections.length) {
      const head = Object.keys(rest).length ? `${JSON.stringify(rest)}\n` : '';
      variants.push({ text: head + sections.join('\n'), note: 'Objekt-Listen als CSV-Tabellen' });
    }
  }
  return variants;
}

/** JSON Lines: eine Tabelle, wenn alle Zeilen gleichartige Objekte sind. */
export function jsonlVariants(text, { toTable = true } = {}) {
  const lines = text.split('\n').filter((l) => l.trim());
  let data;
  try {
    data = lines.map((l) => JSON.parse(l));
  } catch {
    return null;
  }
  const variants = [{ text: data.map((d) => JSON.stringify(d)).join('\n'), note: 'JSON Lines minifiziert' }];
  const table = toTable && arrayToTable(data);
  if (table) variants.push({ text: table, note: 'JSON Lines als CSV-Tabelle' });
  return variants;
}

// ---------------------------------------------------------------------------
// XML

export function minifyXml(s, { stripComments = true } = {}) {
  let out = s;
  if (stripComments) out = out.replace(/<!--[\s\S]*?-->/g, '');
  return out.replace(/>\s+</g, '><').trim();
}

// ---------------------------------------------------------------------------
// Untertitel (SRT/VTT)

const CUE_TIME_RE = /^\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}.*$/;

/** Untertitel auf den gesprochenen Text reduzieren. keepTimes behält die Startzeit pro Absatz. */
export function subtitlesToText(text, { keepTimes = false } = {}) {
  const lines = text.split('\n');
  const cues = [];
  let cue = { time: '', parts: [] };
  let last = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^WEBVTT/.test(line) || /^(NOTE|STYLE|REGION)\b/.test(line)) continue;
    if (/^\d+$/.test(line) && CUE_TIME_RE.test(lines[i + 1] ?? '')) continue;
    if (CUE_TIME_RE.test(line)) {
      if (cue.parts.length) cues.push(cue);
      cue = { time: line.split('-->')[0].trim().replace(/[.,]\d+$/, ''), parts: [] };
      continue;
    }
    const clean = line.replace(/<[^>]+>/g, '').trim();
    if (clean && clean !== last) cue.parts.push(clean);
    last = clean;
  }
  if (cue.parts.length) cues.push(cue);
  if (!keepTimes) return cues.flatMap((c) => c.parts).join(' ');
  return cues.map((c) => (c.time ? `[${c.time}] ` : '') + c.parts.join(' ')).join('\n');
}

// ---------------------------------------------------------------------------
// Jupyter-Notebooks

const joinSource = (src) => (Array.isArray(src) ? src.join('') : (src ?? ''));

/** Notebook (.ipynb) als Markdown mit Codeblöcken; Bild-/HTML-Ausgaben entfallen. */
export function notebookToText(text, { outputs = true } = {}) {
  let nb;
  try {
    nb = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(nb.cells)) return null;
  const lang = nb.metadata?.kernelspec?.language || nb.metadata?.language_info?.name || '';
  const parts = [];
  let droppedOutputs = 0;
  for (const cell of nb.cells) {
    const src = joinSource(cell.source).trim();
    if (cell.cell_type === 'markdown' || cell.cell_type === 'raw') {
      if (src) parts.push(src);
    } else if (cell.cell_type === 'code') {
      if (src) parts.push(`\`\`\`${lang}\n${src}\n\`\`\``);
      for (const o of cell.outputs ?? []) {
        let t = '';
        if (o.output_type === 'stream') t = joinSource(o.text);
        else if (o.output_type === 'error') t = `${o.ename}: ${o.evalue}`;
        // Bei Bildausgaben ist text/plain nur ein Platzhalter wie "<Figure size …>"
        else if (o.data?.['text/plain'] && !Object.keys(o.data).some((k) => k.startsWith('image/'))) {
          t = joinSource(o.data['text/plain']);
        }
        if (outputs && t.trim()) parts.push(`Ausgabe:\n${t.trim()}`);
        else droppedOutputs++;
      }
    }
  }
  return { text: parts.join('\n\n'), droppedOutputs };
}

// ---------------------------------------------------------------------------
// Tabellenkalkulation & Präsentation (Daten kommen aus office.js)

/** sheets: [{ name, rows: string[][] }]. tidy=false liefert die ungekürzte Fassung. */
export function sheetsToText(sheets, { tidy = true } = {}) {
  const parts = [];
  let removedRows = 0;
  for (const s of sheets) {
    const rows = tidy ? tidyRows(s.rows) : s.rows;
    removedRows += s.rows.length - rows.length;
    if (!rows.length) continue;
    parts.push({ name: s.name, csv: toCsv(rows) });
  }
  if (parts.length === 1) return { text: parts[0].csv, removedRows, sheets: 1 };
  return {
    text: parts.map((p) => `## ${p.name}\n${p.csv}`).join('\n\n'),
    removedRows,
    sheets: parts.length,
  };
}

/** slides: [{ paragraphs: string[], notes: string[] }] */
export function slidesToText(slides, { notes = true } = {}) {
  return slides
    .map((s, i) => {
      const body = s.paragraphs.filter((p) => p.trim()).join('\n');
      const n = notes ? s.notes.filter((p) => p.trim()).join(' ') : '';
      return [`## Folie ${i + 1}`, body, n && `Notizen: ${n}`].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// PDF-Text (Zeilen kommen aus pdf.js, siehe pdf.js im selben Ordner)

const PAGE_NUMBER_RE = /^(seite|page|s\.|p\.)?\s*[-–—]?\s*\d{1,4}\s*[-–—]?\s*((von|of|\/)\s*\d{1,4})?$/i;
const LIST_START_RE = /^([-–•*▪●◦]|\d{1,3}[.)]|[a-z][.)])\s/;
const SENTENCE_END_RE = /[.!?:;"')\]]$/;

const normalizeBoilerplate = (t) => t.trim().toLowerCase().replace(/\d+/g, '#');

/**
 * Wiederkehrende Kopf-/Fußzeilen erkennen: kurze Zeilen unter den ersten/letzten
 * zwei einer Seite, die (bis auf Ziffern) auf mindestens der Hälfte der Seiten vorkommen.
 */
const EDGE_LINES = 2;
const EDGE_ZONE = 0.15; // oberste/unterste 15 % der Seite

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/**
 * Kandidaten für Kopf-/Fußzeilen: die ersten/letzten zwei Zeilen einer Seite,
 * sofern sie kurz sind, nicht größer als der Fließtext (also keine Überschrift)
 * und – wenn die Seitenhöhe bekannt ist – im Randbereich liegen.
 */
function isEdgeCandidate(page, idx, bodySize) {
  const { lines, height } = page;
  const l = lines[idx];
  if (idx >= EDGE_LINES && idx < lines.length - EDGE_LINES) return false;
  if (l.text.trim().length > 100 || l.size > bodySize * 1.1) return false;
  if (height && l.y !== undefined && l.y < height * (1 - EDGE_ZONE) && l.y > height * EDGE_ZONE) return false;
  return true;
}

function findBoilerplate(pages, bodySize) {
  const counts = new Map();
  for (const page of pages) {
    const keys = new Set();
    page.lines.forEach((l, idx) => {
      if (isEdgeCandidate(page, idx, bodySize)) keys.add(normalizeBoilerplate(l.text));
    });
    for (const k of keys) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.5));
  return new Set([...counts].filter(([, c]) => c >= threshold).map(([k]) => k));
}

/** Häufigster Zeilenabstand (auf 0,5 pt gerundet); bei Gleichstand der kleinste. */
function typicalLineGap(gaps) {
  const counts = new Map();
  for (const g of gaps) {
    const k = Math.round(g * 2) / 2;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount || (c === bestCount && k < best)) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

/** Zeilen einer Seite zu Absätzen gruppieren (anhand des Zeilenabstands). */
function pageToParagraphs(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y;
    if (g > 0 && g < lines[i].size * 3) gaps.push(g);
  }
  const typicalGap = typicalLineGap(gaps) || 14;
  const paragraphs = [];
  let current = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (current.length) {
      const prev = lines[i - 1];
      const gap = prev.y - line.y;
      const sizeChange = Math.abs(prev.size - line.size) > Math.max(prev.size, line.size) * 0.15;
      if (gap > typicalGap * 1.45 || gap < 0 || sizeChange) {
        paragraphs.push(current);
        current = [];
      }
    }
    current.push(line.text);
  }
  if (current.length) paragraphs.push(current);
  return paragraphs;
}

/** Zeilen eines Absatzes zusammenfügen, Silbentrennung am Zeilenende reparieren. */
export function reflowLines(lines) {
  const maxLen = Math.max(...lines.map((l) => l.length));
  let out = lines[0] ?? '';
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const next = lines[i];
    const prevIsShort = prev.length < maxLen * 0.6 && SENTENCE_END_RE.test(prev);
    if (LIST_START_RE.test(next) || prevIsShort) {
      out += `\n${next}`;
    } else if (/\p{L}-$/u.test(out) && /^\p{Ll}/u.test(next)) {
      out = out.slice(0, -1) + next;
    } else if (/-$/.test(out) && /^\p{Lu}/u.test(next)) {
      out += next;
    } else {
      out += ` ${next}`;
    }
  }
  return out;
}

/**
 * pages: [{ lines: [{ text, y, size }] }] (y wächst nach oben, wie in PDF).
 * Liefert Text plus Statistik über entfernte Kopf-/Fußzeilen.
 */
export function pdfPagesToText(pages, { removeHeaders = true, reflow = true, pageMarkers = false, pageNumbers } = {}) {
  const numbered = pages.map((p, i) => ({ ...p, number: pageNumbers?.[i] ?? i + 1 }));
  const bodySize = median(numbered.flatMap((p) => p.lines.map((l) => l.size))) || 11;
  const boilerplate = removeHeaders && numbered.length >= 3 ? findBoilerplate(numbered, bodySize) : new Set();
  let removedLines = 0;
  const pageTexts = [];

  for (const page of numbered) {
    const lines = page.lines.filter((l, idx) => {
      if (!l.text.trim()) return false;
      if (!removeHeaders || !isEdgeCandidate(page, idx, bodySize)) return true;
      if (boilerplate.has(normalizeBoilerplate(l.text)) || PAGE_NUMBER_RE.test(l.text.trim())) {
        removedLines++;
        return false;
      }
      return true;
    });
    const paragraphs = pageToParagraphs(lines).map((p) => (reflow ? reflowLines(p) : p.join('\n')));
    pageTexts.push({ number: page.number, paragraphs });
  }

  // Absätze über Seitenwechsel hinweg zusammenführen
  if (reflow && !pageMarkers) {
    for (let i = 1; i < pageTexts.length; i++) {
      const prev = pageTexts[i - 1].paragraphs;
      const cur = pageTexts[i].paragraphs;
      if (!prev.length || !cur.length) continue;
      const last = prev[prev.length - 1];
      if (!SENTENCE_END_RE.test(last) && /^\p{Ll}/u.test(cur[0])) {
        prev[prev.length - 1] = /\p{L}-$/u.test(last) ? last.slice(0, -1) + cur[0] : `${last} ${cur[0]}`;
        cur.shift();
      }
    }
  }

  const text = pageTexts
    .filter((p) => p.paragraphs.length)
    .map((p) => (pageMarkers ? `[S. ${p.number}]\n` : '') + p.paragraphs.join('\n\n'))
    .join('\n\n');
  return { text, removedLines };
}

/** Rohtext einer PDF-Seite (so, wie ihn eine einfache Extraktion liefern würde). */
export function pdfPageRawText(page) {
  return page.lines.map((l) => l.text).join('\n');
}

/** "1-3, 5, 8-" → Seitenzahlen (1-basiert) innerhalb von 1..total; leer = alle. */
export function parsePageRange(spec, total) {
  const s = (spec ?? '').trim();
  if (!s) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set();
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*[-–]\s*(\d*)$/);
    if (m) {
      const a = m[1] ? Number(m[1]) : 1;
      const b = m[2] ? Number(m[2]) : total;
      for (let p = Math.max(1, a); p <= Math.min(total, b); p++) pages.add(p);
    } else if (/^\d+$/.test(part)) {
      const p = Number(part);
      if (p >= 1 && p <= total) pages.add(p);
    } else {
      return null;
    }
  }
  return [...pages].sort((a, b) => a - b);
}
