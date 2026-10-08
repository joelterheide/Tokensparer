// Bilder: Token-Berechnung nach Anthropic-Dokumentation und Verkleinerung im Browser.
//
// Claude zerlegt Bilder in 28×28-Pixel-Felder; jedes Feld ist ein Token:
//   Tokens = ⌈Breite / 28⌉ × ⌈Höhe / 28⌉
// Dateigröße, Format, Qualität und Farbe spielen keine Rolle – nur die Pixelmaße.

export const IMAGE_TIERS = {
  // Claude Opus 4.7 und neuer
  high: { maxEdge: 2576, maxTokens: 4784 },
  // ältere Modelle (z. B. Claude Haiku 4.5)
  standard: { maxEdge: 1568, maxTokens: 1568 },
};

export function countImageTokens(width, height) {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

function roundTiesToEven(value) {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Größte seitenverhältnistreue Größe innerhalb der Grenzen
 * (Referenzimplementierung aus der Anthropic-Dokumentation).
 */
export function resizedSize(width, height, maxEdge, maxTokens) {
  const fits = (w, h) =>
    Math.ceil(w / 28) * 28 <= maxEdge && Math.ceil(h / 28) * 28 <= maxEdge && countImageTokens(w, h) <= maxTokens;

  if (fits(width, height)) return [width, height];
  if (height > width) {
    const [h, w] = resizedSize(height, width, maxEdge, maxTokens);
    return [w, h];
  }
  const aspectRatio = width / height;
  let lo = 1;
  let hi = width;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, Math.max(roundTiesToEven(mid / aspectRatio), 1))) lo = mid;
    else hi = mid;
  }
  return [lo, Math.max(roundTiesToEven(lo / aspectRatio), 1)];
}

/** Zielgröße für ein Bild: Modellgrenzen plus optionales Token-Budget. */
export function targetSize(width, height, tierName, budget = Infinity) {
  const tier = IMAGE_TIERS[tierName] ?? IMAGE_TIERS.high;
  return resizedSize(width, height, tier.maxEdge, Math.min(tier.maxTokens, budget));
}

// ---------------------------------------------------------------------------
// Browser-Funktionen

/** Bild laden (EXIF-Ausrichtung wird berücksichtigt). */
export async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Fallback unten (z. B. HEIC in Safari)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    throw new Error('Dieses Bildformat kann der Browser nicht öffnen – bitte als JPG oder PNG speichern.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Einfarbige Ränder finden (z. B. weiße Flächen um einen Screenshot-Ausschnitt).
 * Liefert den Inhaltsbereich in Originalpixeln.
 */
export function findContentBox(source, width, height) {
  const full = { x: 0, y: 0, w: width, h: height };
  const scale = Math.min(1, 600 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const px = (x, y) => (y * w + x) * 4;
  const ref = px(0, 0);
  const tol = 14;
  const same = (i) =>
    Math.abs(data[i] - data[ref]) <= tol &&
    Math.abs(data[i + 1] - data[ref + 1]) <= tol &&
    Math.abs(data[i + 2] - data[ref + 2]) <= tol &&
    Math.abs(data[i + 3] - data[ref + 3]) <= tol;
  const rowBlank = (y) => {
    for (let x = 0; x < w; x++) if (!same(px(x, y))) return false;
    return true;
  };
  const colBlank = (x, y0, y1) => {
    for (let y = y0; y <= y1; y++) if (!same(px(x, y))) return false;
    return true;
  };

  let top = 0;
  while (top < h && rowBlank(top)) top++;
  if (top >= h) return full; // komplett einfarbig
  let bottom = h - 1;
  while (bottom > top && rowBlank(bottom)) bottom--;
  let left = 0;
  while (left < w && colBlank(left, top, bottom)) left++;
  let right = w - 1;
  while (right > left && colBlank(right, top, bottom)) right--;

  // Etwas Rand stehen lassen und zurück auf Originalpixel rechnen
  const margin = 2;
  const x0 = Math.max(0, Math.floor((left - margin) / scale));
  const y0 = Math.max(0, Math.floor((top - margin) / scale));
  const x1 = Math.min(width, Math.ceil((right + 1 + margin) / scale));
  const y1 = Math.min(height, Math.ceil((bottom + 1 + margin) / scale));
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const trimmedShare = 1 - (box.w * box.h) / (width * height);
  return trimmedShare >= 0.02 ? box : full;
}

/** Ausschnitt in Zielgröße zeichnen und als Blob ausgeben. */
export async function renderImage(source, crop, outW, outH, mimeType, quality = 0.9) {
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (mimeType === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, outH);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden'))), mimeType, quality),
  );
}
