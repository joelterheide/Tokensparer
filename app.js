import { estimateTokens } from './src/estimate.js';
import { DEFAULT_MODEL, getModel, MODELS } from './src/models.js';
import { DEFAULT_SETTINGS, IMAGE_BUDGETS, matchingPreset, OPTION_GROUPS, PRESETS } from './src/options.js';
import { detectKind, detectPastedKind, extract, kindLabel, optimize } from './src/pipeline.js';
import { combineDocuments } from './src/text.js';

const $ = (sel) => document.querySelector(sel);
const fmt = new Intl.NumberFormat('de-DE');
const STORAGE_KEY = 'tokenSparer.settings';
const KEY_STORAGE_KEY = 'tokenSparer.apiKey';

const state = {
  items: [],
  settings: { ...DEFAULT_SETTINGS },
  model: DEFAULT_MODEL,
  outputEdited: false,
  exactTotal: null, // { before, after } nach exakter Zählung
};

let nextId = 1;
let pasteCount = 0;
let screenshotCount = 0;

// ---------------------------------------------------------------------------
// Speicher (optional – funktioniert auch ohne)

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // privater Modus o. Ä.
  }
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${fmt.format(Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

function savingText(before, after) {
  if (!before) return '';
  const pct = Math.round((1 - after / before) * 100);
  if (pct > 0) return `−${pct} %`;
  if (pct < 0) return `+${-pct} %`;
  return '±0 %';
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flash(button, text) {
  const old = button.dataset.label ?? button.textContent;
  button.dataset.label = old;
  button.textContent = text;
  clearTimeout(button._flash);
  button._flash = setTimeout(() => {
    button.textContent = old;
  }, 1600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Dateiname ohne Endung, nur ASCII (manche Browser verwerfen sonst den Namen beim Download). */
function baseName(name) {
  const map = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };
  const ascii = name
    .replace(/\.[^.]+$/, '')
    .replace(/[äöüÄÖÜß]/g, (c) => map[c])
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_');
  return ascii.replace(/^_+|_+$/g, '') || 'datei';
}

const model = () => getModel(state.model);

// ---------------------------------------------------------------------------
// Dateien verarbeiten

function addFiles(files) {
  state.outputEdited = false;
  for (const file of files) {
    const { kind, lang, guessed } = detectKind(file.name, file.type);
    const item = { id: nextId++, file, name: file.name, kind, lang, guessed, status: 'loading', pageRange: '' };
    state.items.push(item);
    process(item);
  }
  render();
}

function addPastedText(text) {
  if (!text.trim()) return;
  const { kind } = detectPastedKind(text);
  const ext = { json: 'json', html: 'html', xml: 'xml', subtitles: 'srt' }[kind] ?? 'txt';
  addFiles([new File([text], `eingefügt-${++pasteCount}.${ext}`, { type: 'text/plain' })]);
}

async function process(item) {
  try {
    item.source = await extract(item, (page, total) => {
      item.progress = `Seite ${page} von ${total} …`;
      renderListSoon();
    });
    await reoptimize(item);
  } catch (err) {
    console.error(err);
    item.status = 'error';
    item.error = err?.message ?? String(err);
  }
  render();
}

async function reoptimize(item) {
  if (!item.source) return;
  item.result = await optimize(item, state.settings, model());
  item.status = 'ready';
  item.exact = null;
  state.exactTotal = null;
}

const reoptimizeAll = debounce(async () => {
  state.exactTotal = null;
  state.outputEdited = false;
  await Promise.all(
    state.items.filter((i) => i.source).map((i) =>
      reoptimize(i).catch((err) => {
        i.status = 'error';
        i.error = err?.message ?? String(err);
      }),
    ),
  );
  render();
}, 120);

function removeItem(id) {
  const item = state.items.find((i) => i.id === id);
  if (item?.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  state.items = state.items.filter((i) => i.id !== id);
  state.exactTotal = null;
  state.outputEdited = false;
  render();
}

// ---------------------------------------------------------------------------
// Ausgabe

function textDocs() {
  return state.items
    .filter((i) => i.status === 'ready' && i.result?.text !== undefined)
    .map((i) => ({ name: i.name, text: i.result.text }));
}

function combinedText() {
  return combineDocuments(textDocs(), state.settings.outputFormat);
}

function totals() {
  const ready = state.items.filter((i) => i.status === 'ready');
  const tk = model().tokenizer;
  const before = ready.reduce((s, i) => s + i.result.before, 0);
  const imageAfter = ready.filter((i) => i.kind === 'image').reduce((s, i) => s + i.result.after, 0);
  const text = $('#output').value;
  return { before, after: estimateTokens(text, tk) + imageAfter, count: ready.length };
}

function renderSummary() {
  const t = state.exactTotal && !state.outputEdited ? { ...state.exactTotal, exact: true } : { ...totals(), exact: false };
  const prefix = t.exact ? '' : '≈ ';
  $('#sum-before').textContent = `${prefix}${fmt.format(t.before)}`;
  $('#sum-after').textContent = `${prefix}${fmt.format(t.after)}`;
  $('#sum-saving').textContent = savingText(t.before, t.after);
  $('#sum-saving').classList.toggle('worse', t.after > t.before);
  $('#sum-bar').style.width = `${t.before ? Math.min(100, (t.after / t.before) * 100) : 0}%`;
  const loading = state.items.some((i) => i.status === 'loading');
  $('#sum-hint').innerHTML = loading
    ? 'Wird verarbeitet …'
    : t.exact
      ? `Exakt gezählt für ${escapeHtml(model().label)} über die Token-Counting-Schnittstelle.`
      : `Geschätzte Tokens für ${escapeHtml(model().label)} (Text geschätzt, Bilder exakt berechnet). <a href="#exact">Exakt zählen</a>`;
}

function tokenCell(item) {
  if (item.status !== 'ready') return '';
  const r = item.result;
  const exact = item.exact;
  const approx = item.kind === 'image' || exact ? '' : '≈ ';
  const before = exact ? exact.before : r.before;
  const after = exact ? exact.after : r.after;
  return `
    <span class="t-before">${approx}${fmt.format(before)}</span>
    <span class="t-arrow">→</span>
    <strong class="t-after">${approx}${fmt.format(after)}</strong>
    <span class="t-saving ${after > before ? 'worse' : ''}">${savingText(before, after)}</span>
    ${exact ? '<span class="t-exact">exakt</span>' : ''}`;
}

function renderItem(item) {
  const meta = `${kindLabel(item.kind)} · ${formatBytes(item.file.size)}`;
  let body = '';
  if (item.status === 'loading') {
    body = `<div class="file-notes"><span class="spinner" aria-hidden="true"></span>${escapeHtml(item.progress ?? 'Wird gelesen …')}</div>`;
  } else if (item.status === 'error') {
    body = `<div class="file-notes error">${escapeHtml(item.error)}</div>`;
  } else {
    body = `<div class="file-notes">${item.result.notes.map(escapeHtml).join(' · ')}</div>`;
    if (item.kind === 'pdf') {
      body += `<label class="range">Seiten <input type="text" inputmode="numeric" data-action="range" value="${escapeHtml(item.pageRange)}" placeholder="alle (z. B. 1-3, 7)"></label>`;
    }
    if (item.kind === 'image') {
      body += `<div class="file-actions">
        <button type="button" class="button small" data-action="copy-image">Bild kopieren</button>
        <button type="button" class="button small" data-action="download-image">Herunterladen</button>
      </div>`;
    } else {
      body += `<details class="preview"${item.previewOpen ? ' open' : ''}><summary>Vorschau</summary><pre>${escapeHtml(item.result.text.slice(0, 3000))}${item.result.text.length > 3000 ? '\n…' : ''}</pre></details>`;
    }
  }

  const ext = (item.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? kindLabel(item.kind)).slice(0, 5);
  let icon = `<div class="file-icon kind-${item.kind}">${escapeHtml(ext)}</div>`;
  if (item.kind === 'image' && item.result?.image) {
    if (item.thumbBlob !== item.result.image.blob) {
      if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
      item.thumbUrl = URL.createObjectURL(item.result.image.blob);
      item.thumbBlob = item.result.image.blob;
    }
    icon = `<img class="thumb" src="${item.thumbUrl}" alt="">`;
  }

  return `<li class="card file ${item.status}" data-id="${item.id}">
    ${icon}
    <div class="file-main">
      <div class="file-head"><span class="file-name">${escapeHtml(item.name)}</span><span class="file-meta">${meta}</span></div>
      ${body}
    </div>
    <div class="file-tokens">${tokenCell(item)}</div>
    <button type="button" class="remove" data-action="remove" aria-label="${escapeHtml(item.name)} entfernen" title="Entfernen">×</button>
  </li>`;
}

function renderList() {
  const list = $('#file-list');
  // Fokus im Seitenbereich-Feld erhalten
  const active = document.activeElement;
  const focusId = active?.dataset?.action === 'range' ? active.closest('.file')?.dataset.id : null;
  const caret = focusId ? active.selectionStart : null;
  list.innerHTML = state.items.map(renderItem).join('');
  if (focusId) {
    const input = list.querySelector(`.file[data-id="${focusId}"] input[data-action="range"]`);
    if (input) {
      input.focus();
      input.setSelectionRange(caret, caret);
    }
  }
}

const renderListSoon = debounce(renderList, 100);

function render() {
  const has = state.items.length > 0;
  $('#results').hidden = !has;
  renderList();
  const docs = textDocs();
  $('#output-card').hidden = docs.length === 0;
  if (!state.outputEdited) $('#output').value = combinedText();
  $('#image-hint').hidden = !state.items.some((i) => i.kind === 'image' && i.status === 'ready');
  renderSummary();
}

// ---------------------------------------------------------------------------
// Einstellungen

function renderSettings() {
  const presetBox = $('#presets');
  presetBox.insertAdjacentHTML(
    'beforeend',
    Object.entries(PRESETS)
      .map(
        ([id, p]) =>
          `<label class="preset"><input type="radio" name="preset" value="${id}"><span>${escapeHtml(p.label)}</span></label>`,
      )
      .join(''),
  );
  $('#model').innerHTML = MODELS.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
  $('#imageBudget').innerHTML = IMAGE_BUDGETS.map((b) => `<option value="${b.value}">${escapeHtml(b.label)}</option>`).join('');
  $('#option-groups').innerHTML = OPTION_GROUPS.map(
    (g) => `<fieldset class="option-group"><legend>${escapeHtml(g.title)}</legend>${g.items
      .map(
        (o) => `<label class="check"><input type="checkbox" data-option="${o.key}"><span>${escapeHtml(o.label)}${
          o.hint ? `<small>${escapeHtml(o.hint)}</small>` : ''
        }</span></label>`,
      )
      .join('')}</fieldset>`,
  ).join('');
}

function syncSettingsUi() {
  const s = state.settings;
  const preset = matchingPreset(s);
  for (const r of document.querySelectorAll('input[name="preset"]')) r.checked = r.value === preset;
  $('#preset-hint').textContent = preset ? PRESETS[preset].hint : 'Benutzerdefinierte Einstellungen.';
  for (const cb of document.querySelectorAll('[data-option]')) cb.checked = Boolean(s[cb.dataset.option]);
  $('#imageBudget').value = String(s.imageBudget);
  $('#imageFormat').value = s.imageFormat;
  $('#outputFormat').value = s.outputFormat;
  $('#model').value = state.model;
}

function settingsChanged() {
  save(STORAGE_KEY, { settings: state.settings, model: state.model });
  syncSettingsUi();
  reoptimizeAll();
}

function restoreSettings() {
  const saved = load(STORAGE_KEY);
  if (saved?.settings) state.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
  if (saved?.model && MODELS.some((m) => m.id === saved.model)) state.model = saved.model;
}

// ---------------------------------------------------------------------------
// Exakte Zählung

async function countExact() {
  const key = $('#api-key').value.trim();
  const status = $('#count-status');
  const button = $('#count-exact');
  if (!key) {
    status.textContent = 'Bitte zuerst einen API-Key eingeben.';
    return;
  }
  const ready = state.items.filter((i) => i.status === 'ready');
  if (!ready.length) {
    status.textContent = 'Füge zuerst Dateien hinzu.';
    return;
  }
  save(KEY_STORAGE_KEY, $('#remember-key').checked ? key : null);
  button.disabled = true;
  status.classList.remove('error');
  const { createCounter, describeError, blobToBase64 } = await import('./src/count.js');
  try {
    status.textContent = 'Verbinde …';
    const counter = await createCounter(key, state.model);
    let done = 0;
    let before = 0;
    for (const item of ready) {
      status.textContent = `Zähle ${++done} von ${ready.length} …`;
      const r = item.result;
      if (item.kind === 'image') {
        item.exact = { before: r.before, after: r.after };
      } else if (item.kind === 'pdf') {
        const tooBig = item.file.size > 30 * 1024 * 1024 || item.source.numPages > 600;
        const b = tooBig ? r.before : await counter.pdf(await blobToBase64(item.file));
        item.exact = { before: b, after: await counter.text(r.text) };
      } else {
        item.exact = { before: await counter.text(r.beforeText ?? ''), after: await counter.text(r.text) };
      }
      before += item.exact.before;
      renderList();
    }
    const imageAfter = ready.filter((i) => i.kind === 'image').reduce((s, i) => s + i.result.after, 0);
    const after = (await counter.text($('#output').value)) + imageAfter;
    state.exactTotal = { before, after };
    state.outputEdited = false;
    status.textContent = 'Fertig – die Zahlen oben sind jetzt exakt.';
  } catch (err) {
    console.error(err);
    status.textContent = await describeError(err);
    status.classList.add('error');
  } finally {
    button.disabled = false;
    renderSummary();
  }
}

// ---------------------------------------------------------------------------
// Ereignisse

function bindEvents() {
  const input = $('#file-input');
  const dropzone = $('#dropzone');
  $('#pick-files').addEventListener('click', () => input.click());
  dropzone.addEventListener('click', (e) => {
    if (e.target === dropzone || e.target.closest('.dz-icon, .dz-title')) input.click();
  });
  input.addEventListener('change', () => {
    addFiles([...input.files]);
    input.value = '';
  });

  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    dropzone.classList.add('dragging');
  });
  document.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropzone.classList.remove('dragging');
  });
  document.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    dragDepth = 0;
    dropzone.classList.remove('dragging');
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    addFiles([...e.dataTransfer.files]);
  });

  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    const inField = e.target.closest?.('textarea, input');
    if (files.length) {
      e.preventDefault();
      addFiles(
        files.map((f) =>
          f.name && f.name !== 'image.png' ? f : new File([f], `bildschirmfoto-${++screenshotCount}.png`, { type: f.type }),
        ),
      );
    } else if (!inField) {
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text.trim()) {
        e.preventDefault();
        addPastedText(text);
      }
    }
  });

  $('#paste-add').addEventListener('click', () => {
    addPastedText($('#paste-text').value);
    $('#paste-text').value = '';
  });

  $('#presets').addEventListener('change', (e) => {
    const preset = PRESETS[e.target.value];
    if (!preset) return;
    state.settings = { ...state.settings, ...preset.options };
    settingsChanged();
  });
  $('#option-groups').addEventListener('change', (e) => {
    const key = e.target.dataset.option;
    if (!key) return;
    state.settings[key] = e.target.checked;
    settingsChanged();
  });
  $('#imageBudget').addEventListener('change', (e) => {
    state.settings.imageBudget = Number(e.target.value);
    settingsChanged();
  });
  $('#imageFormat').addEventListener('change', (e) => {
    state.settings.imageFormat = e.target.value;
    settingsChanged();
  });
  $('#outputFormat').addEventListener('change', (e) => {
    state.settings.outputFormat = e.target.value;
    settingsChanged();
  });
  $('#model').addEventListener('change', (e) => {
    state.model = e.target.value;
    settingsChanged();
  });

  const list = $('#file-list');
  list.addEventListener(
    'toggle',
    (e) => {
      if (!e.target.matches?.('details.preview')) return;
      const item = state.items.find((i) => i.id === Number(e.target.closest('.file').dataset.id));
      if (item) item.previewOpen = e.target.open;
    },
    true,
  );
  list.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-action]');
    if (!button || button.tagName === 'INPUT') return;
    const item = state.items.find((i) => i.id === Number(button.closest('.file').dataset.id));
    if (!item) return;
    const action = button.dataset.action;
    if (action === 'remove') removeItem(item.id);
    if (action === 'download-image') {
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[item.result.image.mime] ?? 'img';
      download(item.result.image.blob, `${baseName(item.name)}-klein.${ext}`);
    }
    if (action === 'copy-image') copyImage(item, button);
  });
  list.addEventListener(
    'input',
    debounce((e) => {
      if (e.target.dataset.action !== 'range') return;
      const item = state.items.find((i) => i.id === Number(e.target.closest('.file').dataset.id));
      if (!item) return;
      item.pageRange = e.target.value;
      state.outputEdited = false;
      reoptimize(item).then(render);
    }, 400),
  );

  $('#output').addEventListener(
    'input',
    debounce(() => {
      state.outputEdited = true;
      renderSummary();
    }, 250),
  );
  $('#copy-text').addEventListener('click', async (e) => {
    flash(e.currentTarget, (await copyText($('#output').value)) ? 'Kopiert ✓' : 'Kopieren fehlgeschlagen');
  });
  $('#download-text').addEventListener('click', () => {
    const docs = textDocs();
    const name = docs.length === 1 ? `${baseName(docs[0].name)}-fuer-claude.txt` : 'fuer-claude.txt';
    download(new Blob([$('#output').value], { type: 'text/plain;charset=utf-8' }), name);
  });
  $('#clear-all').addEventListener('click', () => {
    for (const i of state.items) if (i.thumbUrl) URL.revokeObjectURL(i.thumbUrl);
    state.items = [];
    state.exactTotal = null;
    state.outputEdited = false;
    render();
  });

  $('#count-exact').addEventListener('click', countExact);
  const savedKey = load(KEY_STORAGE_KEY);
  if (savedKey) {
    $('#api-key').value = savedKey;
    $('#remember-key').checked = true;
  }
  $('#remember-key').addEventListener('change', (e) => {
    if (!e.target.checked) save(KEY_STORAGE_KEY, null);
  });
}

function copyImage(item, button) {
  const { blob } = item.result.image;
  // Die Zwischenablage nimmt zuverlässig nur PNG an.
  const png =
    blob.type === 'image/png'
      ? Promise.resolve(blob)
      : createImageBitmap(blob).then((bmp) => {
          const c = document.createElement('canvas');
          c.width = bmp.width;
          c.height = bmp.height;
          c.getContext('2d').drawImage(bmp, 0, 0);
          return new Promise((res) => c.toBlob(res, 'image/png'));
        });
  if (!window.ClipboardItem || !navigator.clipboard?.write) {
    flash(button, 'Nicht unterstützt – bitte herunterladen');
    return;
  }
  navigator.clipboard
    .write([new ClipboardItem({ 'image/png': png })])
    .then(() => flash(button, 'Kopiert ✓'))
    .catch(() => flash(button, 'Kopieren fehlgeschlagen'));
}

// ---------------------------------------------------------------------------

restoreSettings();
renderSettings();
syncSettingsUi();
bindEvents();
