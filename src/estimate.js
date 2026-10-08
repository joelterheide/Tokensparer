// Token-Schätzung ohne Netzwerk.
//
// Claudes Tokenizer ist nicht öffentlich. Diese Heuristik zerlegt den Text grob
// so, wie BPE-Tokenizer es typischerweise tun (kurze Wörter = 1 Token, lange
// und nicht-englische Wörter = mehrere, Ziffern in Dreiergruppen, Satzzeichen
// einzeln) und rechnet das Ergebnis mit einem Faktor auf Claude hoch.
// Für Vorher/Nachher-Vergleiche reicht das; exakte Zahlen liefert die
// Token-Counting-Schnittstelle (siehe count.js).

const PIECE_RE =
  /([぀-ヿ㐀-䶿一-鿿가-힯豈-﫿])|(\p{Extended_Pictographic})|([\p{L}\p{M}]+)|(\p{N}+)|(\n+)|([ \t ]+)|([^\s\p{L}\p{M}\p{N}]+)/gu;

const ASCII_WORD_RE = /^[A-Za-z]+$/;
const LATIN_WORD_RE = /^[\p{Script=Latin}\p{M}]+$/u;
const SAME_CHAR_RUN_RE = /(.)\1*/gsu;

// Faktoren relativ zur Heuristik (die etwa einem gängigen englischsprachigen
// BPE-Tokenizer entspricht). Der neue Claude-Tokenizer liegt ca. 30 % über dem alten.
const TOKENIZER_FACTOR = { old: 1.2, new: 1.55 };

function scoreWord(word) {
  const n = word.length;
  if (ASCII_WORD_RE.test(word)) {
    if (n >= 4 && word === word.toUpperCase()) return Math.ceil(n / 3);
    return n <= 7 ? 1 : 1 + Math.ceil((n - 7) / 4);
  }
  if (LATIN_WORD_RE.test(word)) return Math.max(1, Math.ceil(n / 3.2));
  return Math.max(1, Math.ceil(n / 2.5));
}

function scorePunctuation(run) {
  // Gleiche Zeichen in Folge ("-----", "...", "**") werden zusammengefasst.
  let tokens = 0;
  for (const m of run.matchAll(SAME_CHAR_RUN_RE)) tokens += Math.ceil(m[0].length / 4);
  return tokens;
}

function scoreSpaces(run) {
  const tabs = run.split('\t').length - 1;
  const spaces = run.length - tabs;
  // Ein einzelnes Leerzeichen verschmilzt mit dem folgenden Wort.
  const spaceTokens = spaces <= 1 ? 0 : Math.ceil(spaces / 4);
  return tabs + spaceTokens;
}

/** Rohwert der Heuristik (ohne Tokenizer-Faktor). */
export function rawPieces(text) {
  let tokens = 0;
  for (const m of text.matchAll(PIECE_RE)) {
    if (m[1]) tokens += 1;
    else if (m[2]) tokens += 2;
    else if (m[3]) tokens += scoreWord(m[3]);
    else if (m[4]) tokens += Math.ceil(m[4].length / 3);
    else if (m[5]) tokens += Math.ceil(m[5].length / 2);
    else if (m[6]) tokens += scoreSpaces(m[6]);
    else if (m[7]) tokens += scorePunctuation(m[7]);
  }
  return tokens;
}

/** Geschätzte Claude-Tokens für einen Text. tokenizer: "new" | "old". */
export function estimateTokens(text, tokenizer = 'new') {
  if (!text) return 0;
  return Math.round(rawPieces(text) * (TOKENIZER_FACTOR[tokenizer] ?? TOKENIZER_FACTOR.new));
}
