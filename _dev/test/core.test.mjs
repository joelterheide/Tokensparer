import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estimateTokens } from '../../src/estimate.js';
import {
  cleanWhitespace,
  combineDocuments,
  compactMarkdownTables,
  dedupeLines,
  dropMarkdownLinks,
  removeInvisible,
  simplifyTypography,
  stripBase64,
  stripComments,
  stripTrackingParams,
} from '../../src/text.js';
import {
  jsonVariants,
  jsonlVariants,
  minifyXml,
  notebookToText,
  optimizeCsv,
  parseCsv,
  parsePageRange,
  pdfPagesToText,
  reflowLines,
  sheetsToText,
  slidesToText,
  subtitlesToText,
  toCsv,
} from '../../src/formats.js';
import { countImageTokens, resizedSize, targetSize } from '../../src/image.js';

test('Bild-Tokens entsprechen der Tabelle in der Anthropic-Doku', () => {
  assert.equal(countImageTokens(200, 200), 64);
  assert.equal(countImageTokens(1000, 1000), 1296);
  assert.equal(countImageTokens(1092, 1092), 1521);
  // Standard-Stufe
  assert.deepEqual(resizedSize(1920, 1080, 1568, 1568), [1456, 819]);
  // Die Doku-Tabelle nennt 1269×952; ihre Referenzimplementierung liefert 1270×952 (gleiche Tokens).
  assert.deepEqual(resizedSize(2000, 1500, 1568, 1568), [1270, 952]);
  assert.equal(countImageTokens(1270, 952), 1564);
  assert.deepEqual(resizedSize(3840, 2160, 1568, 1568), [1456, 819]);
  assert.deepEqual(resizedSize(1075, 1520, 1568, 1568), [924, 1307]);
  // Hochauflösende Stufe
  assert.deepEqual(targetSize(1920, 1080, 'high'), [1920, 1080]);
  assert.equal(countImageTokens(1920, 1080), 2691);
  assert.deepEqual(targetSize(3840, 2160, 'high'), [2576, 1449]);
  assert.equal(countImageTokens(2576, 1449), 4784);
});

test('Token-Budget begrenzt die Bildgröße', () => {
  const [w, h] = targetSize(1920, 1080, 'high', 600);
  assert.ok(countImageTokens(w, h) <= 600);
  assert.ok(Math.abs(w / h - 1920 / 1080) < 0.02);
});

test('Schätzung: mehr Text = mehr Tokens, neuer Tokenizer > alter', () => {
  const short = estimateTokens('Hallo Welt');
  const long = estimateTokens('Hallo Welt, das ist ein deutlich längerer Satz mit mehr Wörtern.');
  assert.ok(short > 0 && long > short);
  const text = 'The quick brown fox jumps over the lazy dog. '.repeat(20);
  assert.ok(estimateTokens(text, 'new') > estimateTokens(text, 'old'));
  assert.equal(estimateTokens(''), 0);
  // Englischer Fließtext: ca. 2,5–4 Zeichen pro Token
  const ratio = text.length / estimateTokens(text, 'new');
  assert.ok(ratio > 2.3 && ratio < 4.2, `Verhältnis ${ratio}`);
});

test('Leerraum und unsichtbare Zeichen', () => {
  assert.equal(cleanWhitespace('a  \n\n\n\nb\t\n'), 'a\n\nb');
  assert.equal(cleanWhitespace('a    b', { collapseInner: true }), 'a b');
  assert.equal(cleanWhitespace('    eingerückt', { collapseInner: true }), '    eingerückt');
  assert.equal(removeInvisible('a​b­c d﻿'), 'abc d');
  assert.equal(removeInvisible('👨‍👩'), '👨‍👩');
});

test('Typografie', () => {
  assert.equal(simplifyTypography('„Hallo“ – sagte er…'), '"Hallo" - sagte er...');
  assert.equal(simplifyTypography('Einﬁnden'), 'Einfinden');
  assert.equal(simplifyTypography('  • Punkt'), '  - Punkt');
});

test('Base64 wird ersetzt', () => {
  const blob = 'iVBORw0KGgo' + 'AAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ'.repeat(5);
  const { text, count } = stripBase64(`Bild: <img src="data:image/png;base64,${blob}"> Ende`);
  assert.equal(count, 1);
  assert.match(text, /^Bild: <img src="\[eingebettete Datei entfernt: image\/png, \d+ KB\]"> Ende$/);
  const run = stripBase64(`x ${'Ab3'.repeat(100)} y`);
  assert.equal(run.count, 1);
  assert.match(run.text, /^x \[Base64-Daten entfernt, \d+ KB\] y$/);
  // normale Wörter bleiben
  assert.equal(stripBase64('a'.repeat(300)).count, 0);
});

test('Tracking-Parameter', () => {
  assert.equal(
    stripTrackingParams('Siehe https://example.com/a?utm_source=x&id=5&fbclid=abc#top.'),
    'Siehe https://example.com/a?id=5#top.',
  );
  assert.equal(stripTrackingParams('https://x.de/?utm_medium=m'), 'https://x.de/');
  assert.equal(stripTrackingParams('https://x.de/?q=1'), 'https://x.de/?q=1');
});

test('Markdown-Links und Tabellen', () => {
  assert.equal(dropMarkdownLinks('Mehr [hier](https://a.b/c) und ![Logo](x.png)'), 'Mehr hier und [Bild: Logo]');
  assert.equal(
    compactMarkdownTables('| Name   | Alter |\n|:-------|------:|\n| Max    |    30 |'),
    '|Name|Alter|\n|:-|-:|\n|Max|30|',
  );
  assert.equal(compactMarkdownTables('| a \\| b | c |'), '|a \\| b|c|');
});

test('Wiederholte Zeilen', () => {
  assert.equal(dedupeLines('a\nx\nx\nx\nb').text, 'a\nx [×3]\nb');
  assert.equal(dedupeLines('kurz\nkurz').text, 'kurz\nkurz');
  const logs = '12:00:01 Verbindung fehlgeschlagen (id 4)\n12:00:02 Verbindung fehlgeschlagen (id 5)\n12:00:03 Verbindung fehlgeschlagen (id 6)';
  assert.equal(dedupeLines(logs).text, logs);
  assert.equal(
    dedupeLines(logs, { similar: true }).text,
    '12:00:01 Verbindung fehlgeschlagen (id 4) [+2 ähnliche Zeilen]',
  );
});

test('Kommentare entfernen, Strings bleiben', () => {
  const js = [
    '// Kopfkommentar',
    'const url = "http://x.de"; // Ende',
    '/* Block',
    '   über Zeilen */',
    "const s = '/* kein Kommentar */';",
    'f(); /* inline */ g();',
  ].join('\n');
  assert.equal(
    stripComments(js, 'c').text,
    'const url = "http://x.de";\nconst s = \'/* kein Kommentar */\';\nf(); g();',
  );
  const py = '#!/usr/bin/env python\n# Kommentar\nx = "#nicht"  # weg\n"""Docstring # bleibt"""\n';
  assert.equal(stripComments(py, 'python').text, '#!/usr/bin/env python\nx = "#nicht"\n"""Docstring # bleibt"""\n');
  const yaml = 'farbe: "#fff"\nid: abc#123 # Kommentar\n# ganz\nx: 1';
  assert.equal(stripComments(yaml, 'hash').text, 'farbe: "#fff"\nid: abc#123\nx: 1');
  assert.equal(stripComments('a { color: red; } /* x */\n', 'css').text, 'a { color: red; } \n');
  assert.equal(stripComments('<p>a</p>\n<!-- weg -->\n<p>b</p>', 'html').text, '<p>a</p>\n<p>b</p>');
});

test('Dokumente zusammenfügen', () => {
  assert.equal(combineDocuments([{ name: 'a.txt', text: 'A' }]), 'A');
  assert.equal(
    combineDocuments([{ name: 'a.txt', text: 'A' }, { name: 'b"c.md', text: 'B' }]),
    '<document name="a.txt">\nA\n</document>\n<document name="b&quot;c.md">\nB\n</document>',
  );
  assert.equal(combineDocuments([{ name: 'a', text: 'A' }, { name: 'b', text: 'B' }], 'md'), '## a\nA\n\n## b\nB');
});

test('CSV', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\n1,2,3'), [['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
  assert.equal(toCsv([['a', 'b,c', 'x"y']]), 'a,"b,c","x""y"');
  const { text } = optimizeCsv('Name; Wert ;;\n Max ; 3,5 ;;\n;;;\nEva;4;;\n');
  assert.equal(text, 'Name;Wert\nMax;3,5\nEva;4');
});

test('JSON', () => {
  const pretty = JSON.stringify(
    [
      { id: 1, name: 'Max', tags: ['a'] },
      { id: 2, name: 'Eva', tags: [] },
    ],
    null,
    2,
  );
  const v = jsonVariants(pretty);
  assert.equal(v[0].text, '[{"id":1,"name":"Max","tags":["a"]},{"id":2,"name":"Eva","tags":[]}]');
  assert.equal(v[1].text, 'id,name,tags\n1,Max,"[""a""]"\n2,Eva,[]');
  const nested = jsonVariants('{"total":2,"items":[{"a":1},{"a":2}]}');
  assert.equal(nested[1].text, '{"total":2}\nitems (CSV):\na\n1\n2');
  assert.equal(jsonVariants('{kaputt'), null);
  assert.equal(jsonlVariants('{"a":1}\n{"a":2}\n')[1].text, 'a\n1\n2');
});

test('XML', () => {
  assert.equal(minifyXml('<a>\n  <!-- x -->\n  <b>1</b>\n</a>'), '<a><b>1</b></a>');
});

test('Untertitel', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nHallo\n\n2\n00:00:02,000 --> 00:00:03,500\nHallo\nWelt\n';
  assert.equal(subtitlesToText(srt), 'Hallo Welt');
  const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\n<v Max>Guten Tag\n\n00:03.000 --> 00:04.000\nWie geht es?';
  assert.equal(subtitlesToText(vtt, { keepTimes: true }), '[00:01] Guten Tag\n[00:03] Wie geht es?');
});

test('Notebook', () => {
  const nb = {
    metadata: { kernelspec: { language: 'python' } },
    cells: [
      { cell_type: 'markdown', source: ['# Titel'] },
      {
        cell_type: 'code',
        source: ['print(1)'],
        outputs: [
          { output_type: 'stream', text: ['1\n'] },
          { output_type: 'display_data', data: { 'image/png': 'AAAA' } },
        ],
      },
    ],
  };
  const r = notebookToText(JSON.stringify(nb));
  assert.equal(r.text, '# Titel\n\n```python\nprint(1)\n```\n\nAusgabe:\n1');
  assert.equal(r.droppedOutputs, 1);
  assert.equal(notebookToText(JSON.stringify(nb), { outputs: false }).text, '# Titel\n\n```python\nprint(1)\n```');
});

test('Tabellenblätter und Folien', () => {
  const r = sheetsToText([
    { name: 'Daten', rows: [['A', '', 'B'], ['', '', ''], ['1', '', '2']] },
    { name: 'Leer', rows: [['', '']] },
  ]);
  assert.equal(r.text, 'A,B\n1,2');
  assert.equal(
    sheetsToText([
      { name: 'S1', rows: [['x']] },
      { name: 'S2', rows: [['y']] },
    ]).text,
    '## S1\nx\n\n## S2\ny',
  );
  assert.equal(
    slidesToText([{ paragraphs: ['Titel', 'Punkt'], notes: ['Sprechen'] }]),
    '## Folie 1\nTitel\nPunkt\nNotizen: Sprechen',
  );
});

test('PDF: Absätze, Silbentrennung, Kopf-/Fußzeilen', () => {
  assert.equal(
    reflowLines(['Dies ist eine lange Zeile mit Infor-', 'mationen und noch mehr Text am Ende', 'der Zeile.']),
    'Dies ist eine lange Zeile mit Informationen und noch mehr Text am Ende der Zeile.',
  );
  assert.equal(reflowLines(['Liste:', '- eins', '- zwei']), 'Liste:\n- eins\n- zwei');

  const page = (n) => ({
    lines: [
      { text: 'Firmenbericht 2026', y: 800, size: 9 },
      { text: `Kapitel ${'ABC'[n - 1]}`, y: 760, size: 16 },
      { text: 'Erster Absatz beginnt hier und läuft über', y: 730, size: 11 },
      { text: 'zwei Zeilen.', y: 716, size: 11 },
      { text: `Zweiter Absatz auf Seite ${'ABC'[n - 1]}.`, y: 690, size: 11 },
      { text: `Seite ${n} von 3`, y: 40, size: 9 },
    ],
  });
  const { text, removedLines } = pdfPagesToText([page(1), page(2), page(3)]);
  assert.equal(removedLines, 6);
  assert.equal(
    text.split('\n\n').slice(0, 3).join('\n\n'),
    'Kapitel A\n\nErster Absatz beginnt hier und läuft über zwei Zeilen.\n\nZweiter Absatz auf Seite A.',
  );
  assert.ok(!text.includes('Firmenbericht'));
  // Gleich aufgebaute Kapitelüberschriften (größere Schrift) sind keine Kopfzeilen
  const chapters = [1, 2, 3].map((n) => ({
    height: 842,
    lines: [
      { text: 'Musterfirma GmbH', y: 820, size: 9 },
      { text: `Kapitel ${n}`, y: 780, size: 16 },
      { text: 'Gleicher Text am Ende jeder Seite.', y: 400, size: 11 },
      { text: `${n}`, y: 30, size: 9 },
    ],
  }));
  const ch = pdfPagesToText(chapters);
  assert.equal(ch.removedLines, 6);
  assert.match(ch.text, /^Kapitel 1\n\nGleicher Text am Ende jeder Seite\.\n\nKapitel 2/);

  const marked = pdfPagesToText([page(1)], { pageMarkers: true, pageNumbers: [7] });
  assert.ok(marked.text.startsWith('[S. 7]\n'));
});

test('Seitenbereiche', () => {
  assert.deepEqual(parsePageRange('', 3), [1, 2, 3]);
  assert.deepEqual(parsePageRange('1-2, 5, 9-', 10), [1, 2, 5, 9, 10]);
  assert.deepEqual(parsePageRange('2-99', 4), [2, 3, 4]);
  assert.equal(parsePageRange('abc', 4), null);
});
