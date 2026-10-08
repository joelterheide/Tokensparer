# Token-Sparer – Entwicklung

Der Token-Sparer (`/token-sparer/`) ist eine statische Seite ohne Build-Schritt.
GitHub Pages veröffentlicht den Ordner unverändert; Ordner mit `_` am Anfang
(wie dieser) lässt Jekyll weg.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `index.html`, `style.css`, `app.js` | Oberfläche und Zustand |
| `src/pipeline.js` | Dateityp erkennen, auslesen, optimieren |
| `src/text.js` | allgemeine Textbereinigung, Kommentare entfernen |
| `src/formats.js` | PDF-Text, CSV, JSON, Untertitel, Notebooks, Tabellen, Folien |
| `src/html.js` | HTML → Markdown (Webseiten und Word über mammoth) |
| `src/office.js` | `.xlsx` / `.pptx` auslesen |
| `src/pdf.js` | Text aus PDFs mit pdf.js |
| `src/image.js` | Bild-Tokens berechnen, verkleinern, Ränder abschneiden |
| `src/estimate.js` | Token-Schätzung ohne Netzwerk |
| `src/count.js` | exakte Zählung über die Token-Counting-API (optional, eigener Key) |
| `src/options.js`, `src/models.js` | Einstellungen, Presets, Modelle |
| `vendor/` | Fremdbibliotheken (pdf.js, mammoth, fflate, Anthropic-SDK) |

## Tests

```sh
cd token-sparer/_dev
node --test test/*.test.mjs
```

Die Tests decken die DOM-freien Module ab. Für einen Blick im Browser reicht
ein lokaler Server im Repo-Wurzelverzeichnis, z. B. `python3 -m http.server`,
dann <http://localhost:8000/token-sparer/> öffnen.

## Fremdbibliotheken aktualisieren

```sh
cd token-sparer/_dev
npm install          # Versionen stehen in package.json
npm run vendor       # schreibt nach ../vendor
```
