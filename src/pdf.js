// Text aus PDFs mit pdf.js auslesen (Zeilen mit Position und Schriftgröße).

let pdfjsPromise;

// Safari kann ReadableStreams nicht mit for await durchlaufen; pdf.js braucht das
// für getTextContent ("undefined is not a function (near '...t of e...')").
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype.values = async function* values({ preventCancel = false } = {}) {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      if (!preventCancel) reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };
  ReadableStream.prototype[Symbol.asyncIterator] = ReadableStream.prototype.values;
}

function loadPdfJs() {
  pdfjsPromise ??= import('../vendor/pdf.min.js').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.js', import.meta.url).href;
    return pdfjs;
  });
  return pdfjsPromise;
}

/** Textstücke einer Seite zu Zeilen zusammensetzen. */
function itemsToLines(items) {
  const lines = [];
  let cur = null;
  let lastEnd = null;
  let breakNext = false;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const [a, b, , , x, y] = it.transform;
    const size = Math.hypot(a, b) || it.height || 10;
    if (!it.str && !it.hasEOL) continue;
    const newLine = !cur || breakNext || Math.abs(y - cur.y) > size * 0.5;
    if (newLine && it.str) {
      cur = { text: '', y, size, x };
      lines.push(cur);
      lastEnd = null;
    }
    if (cur && it.str) {
      const gap = lastEnd === null ? 0 : x - lastEnd;
      if (cur.text && gap > size * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
      cur.text += it.str;
      cur.size = Math.max(cur.size, size);
      lastEnd = x + (it.width || 0);
    }
    breakNext = Boolean(it.hasEOL);
  }
  for (const l of lines) l.text = l.text.replace(/\s+/g, ' ').trim();
  return lines.filter((l) => l.text);
}

/**
 * PDF lesen. Liefert { pages: [{ lines, width, height }], numPages }.
 * onProgress(seite, gesamt) meldet den Fortschritt.
 */
export async function readPdf(buffer, onProgress) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    task.destroy();
    if (err?.name === 'PasswordException') throw new Error('Die PDF ist passwortgeschützt. Bitte ohne Passwort speichern.');
    throw new Error(`PDF konnte nicht gelesen werden (${err?.message ?? err}).`);
  }
  try {
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({ lines: itemsToLines(content.items), width: viewport.width, height: viewport.height });
      page.cleanup();
      onProgress?.(p, doc.numPages);
    }
    return { pages, numPages: doc.numPages };
  } finally {
    task.destroy();
  }
}
