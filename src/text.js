// Allgemeine Textoptimierungen (ohne DOM, auch in Node testbar).

export function normalizeNewlines(s) {
  return s.replace(/\r\n?/g, '\n');
}

// Nullbreite Zeichen, Wortverbinder, BOM, weiches Trennzeichen.
// U+200D (Joiner) bleibt erhalten, weil er Emoji-Sequenzen zusammenhält.
const INVISIBLE_RE = /[​‌⁠﻿­᠎]/g;
const ODD_SPACES_RE = /[  -   　]/g;

export function removeInvisible(s) {
  return s.replace(INVISIBLE_RE, '').replace(ODD_SPACES_RE, ' ');
}

const TYPOGRAPHY_MAP = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  '–': '-', '—': '-', '‒': '-', '―': '-', '−': '-',
  '…': '...',
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st',
};
const TYPOGRAPHY_RE = new RegExp(`[${Object.keys(TYPOGRAPHY_MAP).join('')}]`, 'g');
const BULLET_RE = /^([ \t]*)[•●▪■◦‣∙·○►▶➢➤][ \t]*/gm;

/** Typografische Sonderzeichen (aus Word/PDF) durch einfache ASCII-Zeichen ersetzen. */
export function simplifyTypography(s) {
  return s.replace(TYPOGRAPHY_RE, (c) => TYPOGRAPHY_MAP[c]).replace(BULLET_RE, '$1- ');
}

/** Leerraum aufräumen: Leerzeichen am Zeilenende, mehrfache Leerzeilen, Rand. */
export function cleanWhitespace(s, { collapseInner = false } = {}) {
  let out = s.replace(/[ \t]+$/gm, '');
  if (collapseInner) out = out.replace(/(\S)[ \t]{2,}/g, '$1 ');
  return out.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

function formatKb(chars) {
  const kb = (chars * 3) / 4 / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
}

/** Eingebettete Base64-Daten (data:-URIs, lange Base64-Blöcke) durch kurze Platzhalter ersetzen. */
export function stripBase64(s) {
  let count = 0;
  let out = s.replace(
    /data:([\w.+-]+\/[\w.+-]+)?((?:;[\w-]+=[\w.-]+)*);base64,[A-Za-z0-9+/=\\]{60,}/g,
    (m, mime) => {
      count++;
      return `[eingebettete Datei entfernt${mime ? `: ${mime}` : ''}, ${formatKb(m.length)}]`;
    },
  );
  // Zeilenweise umbrochenes Base64 (z. B. in E-Mails oder PEM-Blöcken)
  out = out.replace(/(?:^[A-Za-z0-9+/]{60,}={0,2}\n){3,}(?:^[A-Za-z0-9+/]*={0,2}$)?/gm, (m) => {
    count++;
    return `[Base64-Daten entfernt, ${formatKb(m.length)}]\n`;
  });
  // Lange einzeilige Base64-Läufe
  out = out.replace(/(^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{200,}={0,2})(?![A-Za-z0-9+/=])/g, (m, before, run) => {
    if (!/[0-9]/.test(run) || !/[a-z]/.test(run) || !/[A-Z]/.test(run)) return m;
    count++;
    return `${before}[Base64-Daten entfernt, ${formatKb(run.length)}]`;
  });
  return { text: out, count };
}

const TRACKING_PARAM_RE =
  /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|_gl|mkt_tok|ref_src|trk|spm|si)$/i;

/** Tracking-Parameter (utm_*, fbclid, …) aus URLs entfernen. */
export function stripTrackingParams(s) {
  return s.replace(/\bhttps?:\/\/[^\s<>"'`()[\]{}|\\^]+/g, (url) => {
    const trail = url.match(/[.,;:!?]+$/)?.[0] ?? '';
    const core = trail ? url.slice(0, -trail.length) : url;
    const q = core.indexOf('?');
    if (q === -1) return url;
    const hashPos = core.indexOf('#', q);
    const query = core.slice(q + 1, hashPos === -1 ? undefined : hashPos);
    const hash = hashPos === -1 ? '' : core.slice(hashPos);
    const params = query.split('&');
    const kept = params.filter((p) => p && !TRACKING_PARAM_RE.test(decodeKey(p.split('=')[0])));
    if (kept.length === params.length) return url;
    return core.slice(0, q) + (kept.length ? `?${kept.join('&')}` : '') + hash + trail;
  });
}

function decodeKey(key) {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/** Markdown-Links auf ihren Text reduzieren, Bilder auf ihren Alternativtext. */
export function dropMarkdownLinks(s) {
  return s
    .replace(/!\[([^\]]*)\]\((?:[^()\s]|\([^)]*\))+(?:\s+"[^"]*")?\)/g, (m, alt) => (alt.trim() ? `[Bild: ${alt.trim()}]` : ''))
    .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^)]*\))+(?:\s+"[^"]*")?\)/g, '$1');
}

function splitTableRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  // An "|" trennen, aber nicht an maskiertem "\|"
  const cells = [''];
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && inner[i + 1] === '|') {
      cells[cells.length - 1] += '\\|';
      i++;
    } else if (inner[i] === '|') {
      cells.push('');
    } else {
      cells[cells.length - 1] += inner[i];
    }
  }
  return cells;
}

/** Markdown-Tabellen ohne Füll-Leerzeichen und mit kurzer Trennzeile schreiben. */
export function compactMarkdownTables(s) {
  return s.replace(/^[ \t]*\|.*\|[ \t]*$/gm, (line) => {
    const cells = splitTableRow(line);
    if (cells.length && cells.every((c) => /^\s*:?-+:?\s*$/.test(c))) {
      return `|${cells
        .map((c) => {
          const t = c.trim();
          return `${t.startsWith(':') ? ':' : ''}-${t.length > 1 && t.endsWith(':') ? ':' : ''}`;
        })
        .join('|')}|`;
    }
    return `|${cells.map((c) => c.trim()).join('|')}|`;
  });
}

/**
 * Aufeinanderfolgende gleiche Zeilen zusammenfassen ("Zeile [×5]").
 * similar=true behandelt Zeilen als gleich, die sich nur in Zahlen/IDs unterscheiden (Logs).
 */
export function dedupeLines(s, { similar = false } = {}) {
  const lines = s.split('\n');
  const key = similar
    ? (l) => l.trim().replace(/\b[0-9a-f]{8,}\b/gi, '#').replace(/\d+/g, '#')
    : (l) => l.trim();
  const out = [];
  let removed = 0;
  for (let i = 0; i < lines.length; ) {
    const k = key(lines[i]);
    let j = i + 1;
    if (k !== '') while (j < lines.length && key(lines[j]) === k) j++;
    const n = j - i;
    const exact = lines.slice(i, j).every((l) => l.trim() === lines[i].trim());
    if (n >= 3 || (n === 2 && lines[i].trim().length >= 12)) {
      out.push(exact ? `${lines[i]} [×${n}]` : `${lines[i]} [+${n - 1} ähnliche Zeilen]`);
      removed += n - 1;
    } else {
      out.push(...lines.slice(i, j));
    }
    i = j;
  }
  return { text: out.join('\n'), removed };
}

// ---------------------------------------------------------------------------
// Code-Kommentare

export const COMMENT_STYLES = {
  c: { line: ['//'], block: [['/*', '*/']], strings: ['"', "'", '`'] },
  css: { line: [], block: [['/*', '*/']], strings: ['"', "'"] },
  hash: { line: ['#'], block: [], strings: ['"', "'"], hashNeedsSpace: true },
  python: { line: ['#'], block: [], strings: ['"""', "'''", '"', "'"] },
  sql: { line: ['--'], block: [['/*', '*/']], strings: ["'", '"'] },
  lua: { line: ['--'], block: [['--[[', ']]']], strings: ['"', "'"] },
  html: { line: [], block: [['<!--', '-->']], strings: [] },
};

/**
 * Kommentare entfernen, ohne Zeichenketten anzutasten. Ganze Kommentarzeilen
 * verschwinden samt Zeilenumbruch.
 */
export function stripComments(src, styleName) {
  const style = COMMENT_STYLES[styleName];
  if (!style) return { text: src, removed: 0 };
  let out = '';
  let removed = 0;
  let i = 0;
  const n = src.length;

  // Shebang behalten
  if (src.startsWith('#!')) {
    const end = src.indexOf('\n');
    out = end === -1 ? src : src.slice(0, end + 1);
    i = out.length;
  }

  const lineStartIsBlank = () => /(^|\n)[ \t]*$/.test(out.slice(-200));
  const dropBlankLineStart = () => {
    out = out.replace(/[ \t]*$/, '');
  };

  outer: while (i < n) {
    for (const q of style.strings) {
      if (!src.startsWith(q, i)) continue;
      let j = i + q.length;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src.startsWith(q, j)) {
          j += q.length;
          break;
        }
        if (q.length === 1 && q !== '`' && src[j] === '\n') break;
        j++;
      }
      out += src.slice(i, j);
      i = j;
      continue outer;
    }
    for (const [open, close] of style.block) {
      if (!src.startsWith(open, i)) continue;
      const end = src.indexOf(close, i + open.length);
      let stop = end === -1 ? n : end + close.length;
      removed++;
      if (lineStartIsBlank() && /^[ \t]*(\n|$)/.test(src.slice(stop, stop + 200))) {
        dropBlankLineStart();
        while (stop < n && (src[stop] === ' ' || src[stop] === '\t')) stop++;
        if (src[stop] === '\n') stop++;
      } else if (/\n/.test(src.slice(i, stop))) {
        out += '\n';
      } else if (/[ \t]$/.test(out)) {
        while (stop < n && (src[stop] === ' ' || src[stop] === '\t')) stop++;
      } else {
        out += ' ';
      }
      i = stop;
      continue outer;
    }
    for (const marker of style.line) {
      if (!src.startsWith(marker, i)) continue;
      if (style.hashNeedsSpace && i > 0 && !/\s/.test(src[i - 1])) continue;
      const end = src.indexOf('\n', i);
      removed++;
      if (lineStartIsBlank()) {
        dropBlankLineStart();
        i = end === -1 ? n : end + 1;
      } else {
        out = out.replace(/[ \t]+$/, '');
        i = end === -1 ? n : end;
      }
      continue outer;
    }
    out += src[i];
    i++;
  }
  return { text: out, removed };
}

// ---------------------------------------------------------------------------

/** Mehrere Dokumente zu einem Text zusammenfügen. */
export function combineDocuments(docs, format = 'xml') {
  const parts = docs.filter((d) => d.text);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].text;
  if (format === 'md') return parts.map((d) => `## ${d.name}\n${d.text}`).join('\n\n');
  if (format === 'plain') return parts.map((d) => d.text).join('\n\n---\n\n');
  const esc = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return parts.map((d) => `<document name="${esc(d.name)}">\n${d.text}\n</document>`).join('\n');
}
