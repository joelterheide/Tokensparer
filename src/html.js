// HTML → kompaktes Markdown (im Browser, nutzt DOMParser).
// Wird für Webseiten und – über mammoth – für Word-Dokumente verwendet.

const DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED',
  'HEAD', 'BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'VIDEO', 'AUDIO', 'MAP', 'DIALOG',
]);
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'FIGURE',
  'FIGCAPTION', 'ADDRESS', 'DL', 'FORM', 'FIELDSET', 'DETAILS', 'SUMMARY', 'CENTER', 'BODY', 'HTML',
]);
const BOILERPLATE_SELECTOR = [
  'nav', 'footer', 'aside', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="complementary"]', '[aria-hidden="true"]', '[hidden]',
].join(',');

// Platzhalter, damit Listeneinrückung und Codeblöcke das Trimmen der Zeilen überstehen.
const INDENT = '\u0001';
const PRE_MARK = '\u0002';

class Converter {
  constructor({ dropLinks }) {
    this.dropLinks = dropLinks;
    this.images = 0;
    this.preBlocks = [];
  }

  children(node, ctx) {
    let out = '';
    for (const child of node.childNodes) out += this.node(child, ctx);
    return out;
  }

  inline(node, ctx) {
    return this.children(node, ctx).replace(/\s*\n\s*/g, ' ').trim();
  }

  node(node, ctx) {
    if (node.nodeType === 3) {
      return ctx.pre ? node.nodeValue : node.nodeValue.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toUpperCase();
    if (DROP_TAGS.has(tag)) return '';

    switch (tag) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        const text = this.inline(node, ctx);
        return text ? `\n\n${'#'.repeat(Number(tag[1]))} ${text}\n\n` : '';
      }
      case 'BR':
        return '\n';
      case 'HR':
        return '\n\n';
      case 'UL': case 'OL':
        return this.list(node, ctx);
      case 'LI':
        return `\n- ${this.children(node, ctx).trim()}\n`;
      case 'TABLE':
        return this.table(node, ctx);
      case 'PRE': {
        const code = node.textContent.replace(/^\n+|\n+$/g, '');
        if (!code.trim()) return '';
        this.preBlocks.push(code);
        return `\n\n\`\`\`\n${PRE_MARK}${this.preBlocks.length - 1}${PRE_MARK}\n\`\`\`\n\n`;
      }
      case 'CODE': case 'KBD': case 'SAMP': {
        const code = node.textContent;
        return code.trim() ? `\`${code}\`` : code;
      }
      case 'A':
        return this.link(node, ctx);
      case 'IMG': {
        this.images++;
        const alt = (node.getAttribute('alt') || '').trim();
        return alt ? `[Bild: ${alt}]` : '';
      }
      case 'BLOCKQUOTE': {
        const inner = this.children(node, ctx).trim().replace(/\n{3,}/g, '\n\n');
        return inner ? `\n\n${inner.replace(/^/gm, '> ')}\n\n` : '';
      }
      case 'DT':
        return `\n${this.inline(node, ctx)}:`;
      case 'DD':
        return ` ${this.inline(node, ctx)}\n`;
      case 'TD': case 'TH':
        return ` ${this.children(node, ctx)} `;
      case 'TR':
        return `\n${this.children(node, ctx)}\n`;
      default:
        if (BLOCK_TAGS.has(tag)) return `\n\n${this.children(node, ctx)}\n\n`;
        // Hervorhebungen (b, i, strong, em, span, …) entfallen bewusst – sie kosten Tokens.
        return this.children(node, ctx);
    }
  }

  list(node, ctx) {
    const ordered = node.tagName.toUpperCase() === 'OL';
    let n = Number(node.getAttribute('start')) || 1;
    const depth = ctx.depth ?? 0;
    const pad = INDENT.repeat(depth * 2);
    let out = '';
    for (const li of node.children) {
      if (li.tagName.toUpperCase() !== 'LI') {
        out += this.node(li, ctx);
        continue;
      }
      const marker = ordered ? `${n++}. ` : '- ';
      const body = this.children(li, { ...ctx, depth: depth + 1 })
        .replace(/\n{2,}/g, '\n')
        .trim();
      if (!body) continue;
      out += `\n${pad}${marker}${body}`;
    }
    return depth === 0 ? `\n\n${out.trim()}\n\n` : `\n${out.replace(/^\n/, '')}`;
  }

  link(node, ctx) {
    const text = this.inline(node, ctx);
    const href = (node.getAttribute('href') || '').trim();
    if (this.dropLinks || !text || !/^(https?:|mailto:)/i.test(href)) return text;
    if (text === href || `mailto:${text}` === href) return href;
    return `[${text}](${href})`;
  }

  table(node, ctx) {
    const rows = [...node.rows].map((tr) => {
      const cells = [];
      for (const cell of tr.cells) {
        cells.push(this.inline(cell, ctx).replace(/\|/g, '\\|'));
        const span = Math.min(Number(cell.getAttribute('colspan')) || 1, 20);
        for (let i = 1; i < span; i++) cells.push('');
      }
      return cells;
    });
    const filled = rows.filter((r) => r.some((c) => c !== ''));
    if (!filled.length) return '';
    const width = Math.max(...filled.map((r) => r.length));
    // Layout-Tabellen (eine Spalte oder eine Zeile) als normalen Text ausgeben
    if (width === 1 || filled.length === 1) {
      return `\n\n${filled.map((r) => r.filter(Boolean).join(' ')).join('\n')}\n\n`;
    }
    const line = (r) => `|${Array.from({ length: width }, (_, i) => r[i] ?? '').join('|')}|`;
    const out = [line(filled[0]), `|${Array(width).fill('-').join('|')}|`, ...filled.slice(1).map(line)];
    return `\n\n${out.join('\n')}\n\n`;
  }
}

function finish(md, preBlocks) {
  return md
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(new RegExp(INDENT, 'g'), ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(new RegExp(`${PRE_MARK}(\\d+)${PRE_MARK}`, 'g'), (m, i) => preBlocks[Number(i)]);
}

/**
 * HTML in Markdown umwandeln.
 * mainOnly: Navigation/Fußzeilen entfernen und – falls vorhanden – nur <main>/<article> nehmen.
 */
export function htmlToMarkdown(html, { mainOnly = true, dropLinks = false } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.title?.trim() ?? '';
  let root = doc.body ?? doc.documentElement;
  let removedBlocks = 0;
  if (mainOnly) {
    for (const el of doc.querySelectorAll(BOILERPLATE_SELECTOR)) {
      el.remove();
      removedBlocks++;
    }
    const articles = doc.querySelectorAll('article');
    const main = doc.querySelector('main, [role="main"]') ?? (articles.length === 1 ? articles[0] : null);
    if (main) root = main;
  }
  const conv = new Converter({ dropLinks });
  let md = finish(conv.node(root, { depth: 0 }), conv.preBlocks);
  if (title && !/^# /.test(md) && !md.slice(0, 300).includes(title)) md = `# ${title}\n\n${md}`;
  return { text: md, images: conv.images, removedBlocks };
}
