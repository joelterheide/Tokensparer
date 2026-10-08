// Modelle, für die das Tool schätzt bzw. exakt zählt.
// tokenizer: "new" = Tokenizer ab Claude Opus 4.7 (laut Anthropic ca. 30 % mehr
//            Tokens für denselben Text als der ältere Tokenizer "old").
// imageTier: Auflösungsstufe für Bilder, siehe IMAGE_TIERS in image.js.
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', tokenizer: 'new', imageTier: 'high' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tokenizer: 'new', imageTier: 'high' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', tokenizer: 'new', imageTier: 'high' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tokenizer: 'old', imageTier: 'standard' },
];

export const DEFAULT_MODEL = 'claude-opus-5-5';

export function getModel(id) {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
