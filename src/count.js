// Exakte Token-Zählung über die (kostenlose) Token-Counting-Schnittstelle von Anthropic.
// Der API-Key wird nur für Anfragen direkt an api.anthropic.com verwendet.

let sdkPromise;

function loadSdk() {
  sdkPromise ??= import('../vendor/anthropic-sdk.js').then((m) => m.default);
  return sdkPromise;
}

/** Zähler für ein Modell anlegen. Zieht den festen Anteil einer leeren Nachricht ab. */
export async function createCounter(apiKey, model) {
  const Anthropic = await loadSdk();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const count = async (content) => {
    const res = await client.messages.countTokens({ model, messages: [{ role: 'user', content }] });
    return res.input_tokens;
  };
  const baseline = await count('.');
  const net = async (content) => Math.max(0, (await count(content)) - baseline);
  return {
    text: (s) => (s ? net(s) : 0),
    pdf: (base64) => net([{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }]),
    image: (base64, mediaType) => net([{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }]),
  };
}

/** Verständliche Fehlermeldung für SDK-Fehler. */
export async function describeError(err) {
  const Anthropic = await loadSdk();
  if (err instanceof Anthropic.AuthenticationError) return 'API-Key ungültig.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Keine Berechtigung für dieses Modell.';
  if (err instanceof Anthropic.NotFoundError) return 'Modell nicht gefunden.';
  if (err instanceof Anthropic.RateLimitError) return 'Zu viele Anfragen – bitte kurz warten und erneut versuchen.';
  if (err instanceof Anthropic.BadRequestError) return `Anfrage abgelehnt: ${err.error?.error?.message ?? err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Keine Verbindung zu api.anthropic.com.';
  if (err instanceof Anthropic.APIError) return `Fehler von der API (${err.status ?? '?'}): ${err.message}`;
  return err?.message ?? String(err);
}

/** Blob/File als Base64 (ohne data:-Präfix). */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
