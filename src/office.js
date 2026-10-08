// Excel- (.xlsx) und PowerPoint-Dateien (.pptx) auslesen.
// Beide sind ZIP-Archive mit XML-Dateien; entpackt wird mit fflate.

import { strFromU8, unzipSync } from '../vendor/fflate.js';

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function parseXml(files, path) {
  const data = files[path];
  if (!data) return null;
  return new DOMParser().parseFromString(strFromU8(data), 'application/xml');
}

const els = (node, name) => [...node.getElementsByTagNameNS('*', name)];

/** Relativen Pfad aus einer .rels-Datei auflösen. */
function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function readRels(files, relsPath, basePath) {
  const doc = parseXml(files, relsPath);
  const map = new Map();
  if (!doc) return map;
  for (const r of els(doc, 'Relationship')) {
    map.set(r.getAttribute('Id'), {
      target: resolvePath(basePath, r.getAttribute('Target')),
      type: r.getAttribute('Type') || '',
    });
  }
  return map;
}

const relId = (el) => el.getAttributeNS(REL_NS, 'id') || el.getAttribute('r:id');

// ---------------------------------------------------------------------------
// Excel

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormat(code) {
  const cleaned = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dmyhs]/i.test(cleaned) && !/^general$/i.test(cleaned);
}

function readDateStyles(files) {
  const doc = parseXml(files, 'xl/styles.xml');
  if (!doc) return [];
  const custom = new Map();
  for (const f of els(doc, 'numFmt')) custom.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') || '');
  const cellXfs = els(doc, 'cellXfs')[0];
  if (!cellXfs) return [];
  return els(cellXfs, 'xf').map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') || 0);
    return BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)));
  });
}

function serialToDate(serial, date1904) {
  const ms = Math.round((serial - (date1904 ? -1462 : 0) - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const iso = d.toISOString();
  const time = iso.slice(11, 19);
  if (serial >= 1 && time === '00:00:00') return iso.slice(0, 10);
  if (serial < 1) return time.replace(/:00$/, '');
  return `${iso.slice(0, 10)} ${time.replace(/:00$/, '')}`;
}

function formatNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  // Gleitkomma-Rauschen (0.30000000000000004) entfernen
  return String(Number(n.toPrecision(12)));
}

function cellColumn(ref) {
  const letters = (ref.match(/^[A-Z]+/) || ['A'])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(node) {
  // Text eines <si>/<is>-Elements ohne phonetische Hilfstexte (<rPh>)
  return els(node, 't')
    .filter((t) => t.parentNode?.localName !== 'rPh')
    .map((t) => t.textContent)
    .join('');
}

/** Liefert [{ name, rows: string[][] }] */
export function readXlsx(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const workbook = parseXml(files, 'xl/workbook.xml');
  if (!workbook) throw new Error('Keine gültige Excel-Datei (.xlsx)');
  const date1904 = els(workbook, 'workbookPr')[0]?.getAttribute('date1904') === '1';
  const rels = readRels(files, 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml');
  const sstDoc = parseXml(files, 'xl/sharedStrings.xml');
  const shared = sstDoc ? els(sstDoc, 'si').map(textOf) : [];
  const dateStyles = readDateStyles(files);

  return els(workbook, 'sheet').map((sheet) => {
    const name = sheet.getAttribute('name') || 'Tabelle';
    const path = rels.get(relId(sheet))?.target;
    const doc = path && parseXml(files, path);
    const rows = [];
    if (doc) {
      for (const row of els(doc, 'row')) {
        const r = Number(row.getAttribute('r') || rows.length + 1) - 1;
        const cells = (rows[r] = rows[r] || []);
        let col = 0;
        for (const c of els(row, 'c')) {
          const ref = c.getAttribute('r');
          if (ref) col = cellColumn(ref);
          const type = c.getAttribute('t');
          const v = els(c, 'v')[0]?.textContent ?? '';
          let value;
          if (type === 's') value = shared[Number(v)] ?? '';
          else if (type === 'inlineStr') value = textOf(c);
          else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
          else if (type === 'str' || type === 'e') value = v;
          else if (v === '') value = '';
          else if (dateStyles[Number(c.getAttribute('s') || 0)]) value = serialToDate(Number(v), date1904);
          else value = formatNumber(v);
          cells[col] = value;
          col++;
        }
      }
    }
    return { name, rows: Array.from(rows, (r) => Array.from(r ?? [], (v) => v ?? '')) };
  });
}

// ---------------------------------------------------------------------------
// PowerPoint

function paragraphsOf(doc) {
  return els(doc, 'p')
    .map((p) =>
      [...p.getElementsByTagNameNS('*', '*')]
        .filter((n) => (n.localName === 't' && n.parentNode?.localName !== 'fld') || n.localName === 'br')
        .map((n) => (n.localName === 'br' ? ' ' : n.textContent))
        .join('')
        .trim(),
    )
    .filter(Boolean);
}

/** Liefert [{ paragraphs: string[], notes: string[] }] in Präsentationsreihenfolge. */
export function readPptx(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const pres = parseXml(files, 'ppt/presentation.xml');
  if (!pres) throw new Error('Keine gültige PowerPoint-Datei (.pptx)');
  const rels = readRels(files, 'ppt/_rels/presentation.xml.rels', 'ppt/presentation.xml');
  const slidePaths = els(pres, 'sldId')
    .map((s) => rels.get(relId(s))?.target)
    .filter((p) => p && files[p]);

  return slidePaths.map((path) => {
    const doc = parseXml(files, path);
    const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    const slideRels = readRels(files, relsPath, path);
    const notesRel = [...slideRels.values()].find((r) => r.type.endsWith('/notesSlide'));
    const notesDoc = notesRel && parseXml(files, notesRel.target);
    return {
      paragraphs: paragraphsOf(doc),
      notes: notesDoc ? paragraphsOf(notesDoc).filter((p) => !/^\d+$/.test(p)) : [],
    };
  });
}
