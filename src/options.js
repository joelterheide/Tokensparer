// Einstellungen und Voreinstellungen ("Presets").

const LOSSLESS = {
  whitespace: true,
  invisible: true,
  typography: true,
  base64: false,
  trackingParams: false,
  dropLinks: false,
  dedupeLines: false,
  dedupeSimilar: false,
  pdfHeaders: false,
  pdfReflow: true,
  pageMarkers: false,
  mainOnly: false,
  compactTables: true,
  stripComments: false,
  minify: true,
  jsonToTable: false,
  dropNotebookOutputs: false,
  dropSubtitleTimes: false,
  trimBorders: false,
  imageBudget: 0,
};

const BALANCED = {
  ...LOSSLESS,
  base64: true,
  trackingParams: true,
  dedupeLines: true,
  pdfHeaders: true,
  mainOnly: true,
  jsonToTable: true,
  dropSubtitleTimes: true,
  trimBorders: true,
  imageBudget: 1600,
};

const MAXIMUM = {
  ...BALANCED,
  dropLinks: true,
  dedupeSimilar: true,
  stripComments: true,
  dropNotebookOutputs: true,
  imageBudget: 600,
};

export const PRESETS = {
  lossless: { label: 'Verlustfrei', hint: 'Nur Formatierung – der Inhalt bleibt vollständig erhalten.', options: LOSSLESS },
  balanced: { label: 'Ausgewogen', hint: 'Entfernt Ballast wie Kopfzeilen, Tracking-Links und eingebettete Daten.', options: BALANCED },
  max: { label: 'Maximal', hint: 'Spart am meisten: auch Links, Kommentare und Notebook-Ausgaben fallen weg.', options: MAXIMUM },
};

export const DEFAULT_SETTINGS = {
  ...BALANCED,
  imageFormat: 'auto',
  outputFormat: 'xml',
};

export const OPTION_GROUPS = [
  {
    title: 'Allgemein',
    items: [
      { key: 'whitespace', label: 'Leerraum aufräumen', hint: 'Leerzeichen am Zeilenende und mehrfache Leerzeilen' },
      { key: 'invisible', label: 'Unsichtbare Zeichen entfernen', hint: 'Nullbreite Zeichen, weiche Trennstriche, geschützte Leerzeichen' },
      { key: 'typography', label: 'Typografie vereinfachen', hint: '„“ – … ﬁ werden zu " - ... fi' },
      { key: 'base64', label: 'Eingebettete Daten entfernen', hint: 'Base64-Bilder und -Dateien im Text durch kurze Platzhalter ersetzen' },
      { key: 'trackingParams', label: 'Tracking-Parameter aus Links entfernen', hint: 'utm_source, fbclid, gclid …' },
      { key: 'dropLinks', label: 'Link-Adressen weglassen', hint: 'Nur der Linktext bleibt stehen' },
      { key: 'dedupeLines', label: 'Wiederholte Zeilen zusammenfassen', hint: 'Gleiche Zeilen hintereinander werden zu „Zeile [×5]“' },
      { key: 'dedupeSimilar', label: 'Ähnliche Log-Zeilen zusammenfassen', hint: 'Zeilen, die sich nur in Zahlen/Zeitstempeln unterscheiden' },
    ],
  },
  {
    title: 'Dokumente (PDF, Word, PowerPoint, Web)',
    items: [
      { key: 'pdfHeaders', label: 'Kopf-/Fußzeilen und Seitenzahlen entfernen' },
      { key: 'pdfReflow', label: 'Zeilenumbrüche und Silbentrennung reparieren' },
      { key: 'pageMarkers', label: 'Seitenmarker einfügen', hint: '[S. 3] – hilfreich, wenn Claude Seiten zitieren soll' },
      { key: 'mainOnly', label: 'Webseiten: nur Hauptinhalt', hint: 'Navigation, Seitenleisten und Fußbereich weglassen' },
      { key: 'compactTables', label: 'Tabellen verdichten', hint: 'Markdown-Tabellen ohne Füll-Leerzeichen' },
      { key: 'dropSubtitleTimes', label: 'Untertitel: Zeitstempel entfernen' },
    ],
  },
  {
    title: 'Code und Daten',
    items: [
      { key: 'stripComments', label: 'Code-Kommentare entfernen' },
      { key: 'minify', label: 'JSON, XML und CSV verdichten', hint: 'Einrückung und leere Zeilen/Spalten entfernen' },
      { key: 'jsonToTable', label: 'JSON-Listen als Tabelle (CSV)', hint: 'Nur wenn das weniger Tokens braucht' },
      { key: 'dropNotebookOutputs', label: 'Jupyter: Zellenausgaben weglassen' },
    ],
  },
  {
    title: 'Bilder',
    items: [{ key: 'trimBorders', label: 'Einfarbige Ränder abschneiden' }],
  },
];

export const IMAGE_BUDGETS = [
  { value: 0, label: 'Keine Verkleinerung (Modell-Maximum)' },
  { value: 2500, label: 'max. 2.500 Tokens – sehr detailreich' },
  { value: 1600, label: 'max. 1.600 Tokens – Text gut lesbar' },
  { value: 1000, label: 'max. 1.000 Tokens – ausgewogen' },
  { value: 600, label: 'max. 600 Tokens – sparsam' },
  { value: 300, label: 'max. 300 Tokens – grobe Vorschau' },
];

/** Welches Preset passt zu den aktuellen Einstellungen? null = benutzerdefiniert. */
export function matchingPreset(settings) {
  for (const [id, preset] of Object.entries(PRESETS)) {
    if (Object.entries(preset.options).every(([k, v]) => settings[k] === v)) return id;
  }
  return null;
}
