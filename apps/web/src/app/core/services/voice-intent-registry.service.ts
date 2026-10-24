import { Injectable } from '@angular/core';
import { SupportedLang, VOICE_COMMANDS, VoiceCommand, VoiceCommandId } from '@/app/components/voice-agent/voice-commands-data';

export interface MatchedIntent {
  command: VoiceCommand;
  /** Free-text capture from `{param}` placeholder, if present. */
  param?: string;
  /** Numeric capture from `{n}` placeholder, if present. */
  n?: number;
  score: number;
  matchedLang: SupportedLang;
  /** The winning pattern string — used to re-extract `{param}` from raw text. */
  pattern?: string;
}

/**
 * Spelled-out numbers 1..9 per supported language.
 *
 * Note on ambiguous tokens we deliberately DO NOT include:
 *   • "un" (FR cardinal "1") — also the IT/ES indefinite article. Including it
 *     would turn "apri un nuovo sub agent" into "apri 1 nuovo sub agent".
 *   • "um" (PT cardinal "1") — also a common filler/interjection.
 * For these languages users say "uno", "uno", or "primeiro/primeira" — already covered.
 */
const NUMBER_WORDS: Record<SupportedLang, Record<string, number>> = {
  it: { uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9 },
  en: { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 },
  es: { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 },
  fr: { deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9 },
  pt: { dois: 2, três: 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9 },
};

/** Ordinals 1..9 mapped to digits, per language (incl. feminine forms where used). */
const ORDINAL_WORDS: Record<SupportedLang, Record<string, number>> = {
  it: {
    primo: 1, prima: 1, secondo: 2, seconda: 2, terzo: 3, terza: 3,
    quarto: 4, quarta: 4, quinto: 5, quinta: 5, sesto: 6, sesta: 6,
    settimo: 7, settima: 7, ottavo: 8, ottava: 8, nono: 9, nona: 9,
  },
  en: {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  },
  es: {
    primero: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3,
    cuarto: 4, cuarta: 4, quinto: 5, quinta: 5, sexto: 6, sexta: 6,
    séptimo: 7, septimo: 7, séptima: 7, septima: 7, octavo: 8, octava: 8,
    noveno: 9, novena: 9,
  },
  fr: {
    premier: 1, première: 1, premiere: 1, deuxième: 2, deuxieme: 2, second: 2, seconde: 2,
    troisième: 3, troisieme: 3, quatrième: 4, quatrieme: 4, cinquième: 5, cinquieme: 5,
    sixième: 6, sixieme: 6, septième: 7, septieme: 7, huitième: 8, huitieme: 8,
    neuvième: 9, neuvieme: 9,
  },
  pt: {
    primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3,
    quarto: 4, quarta: 4, quinto: 5, quinta: 5, sexto: 6, sexta: 6,
    sétimo: 7, setimo: 7, sétima: 7, setima: 7, oitavo: 8, oitava: 8, nono: 9, nona: 9,
  },
};

/**
 * Filler words to strip before matching, per language.
 *
 * Includes definite/indefinite articles and short prepositions because in
 * voice commands they are noise: "apri il ranking" should match the same
 * intent as "apri ranking".
 *
 * Be careful adding new entries — strip too much and you risk shortening
 * a session name the user actually said.
 */
const FILLERS: Record<SupportedLang, string[]> = {
  it: ['ehm', 'uhm', 'allora', 'tipo', 'cioè', 'praticamente', 'il', 'lo', 'la', 'i', 'gli', 'le', 'l'],
  en: ['uh', 'um', 'like', 'so', 'you know', 'the', 'an'],
  es: ['eh', 'em', 'pues', 'osea', 'o sea', 'tipo', 'el', 'la', 'los', 'las'],
  fr: ['euh', 'hum', 'ben', 'genre', 'enfin', 'du coup', 'le', 'la', 'les'],
  pt: ['é', 'tipo', 'então', 'sabe', 'né', 'o', 'a', 'os', 'as'],
};

/**
 * Whisper transcription aliases — terms it consistently hears wrong, mapped
 * back to the canonical keyword the patterns expect. Order matters: longer
 * phrases first so they win over shorter substrings.
 *
 * Each entry is matched as a whole-word phrase, case-insensitive, on the
 * already-normalized (lowercase, no punctuation, no hyphens) text.
 */
const WHISPER_ALIASES: [RegExp, string][] = [
  // "sub-agent" / "subagent" misheard variants — Whisper sometimes hears
  // unrelated words ("budget", "subaru") for this uncommon noun. Be generous.
  // Also normalizes the legitimate-but-glued forms (subagent / subagents)
  // into the spaced form that all patterns expect.
  [/\b(?:subagent|subagents|subagente|subagentes|sub\s*agents|sub\s*budget|use\s*(?:a\s*)?budget|a\s*budget|sub\s*a\s*budget|sub\s*bagent|sotto\s*agente|sotto\s*agent|sub\s*agente|sabbat|sabbatico|sabbatica|sabotage|sabotaggio|subaru|sub\s*aru|sub\s*agency|subjacent|subject\s*agent)\b/gi, 'sub agent'],
  // Strip the spurious "and" / "e" Whisper sometimes inserts after the verb.
  // E.g. "open and use a budget" → first the prev rule turns it into
  // "open and sub agent", then this rule collapses to "open sub agent".
  [/\b(open|create|new|spawn|make|apri|crea|fai|fammi|nuovo)\s+and\s+sub\s+agent\b/gi, '$1 sub agent'],
  [/\b(apri|crea|fai|fammi|nuovo)\s+e\s+sub\s+agent\b/gi, '$1 sub agent'],
  // workspace variants
  [/\b(?:work\s*place|world\s*space|word\s*space)\b/gi, 'workspace'],
  // session variants
  [/\b(?:session\s*e|sezione|sezioni)\b/gi, 'sessione'],
  // "apri" slips — whisper often renders it as "aprir"/"apre"/"april" at the start
  // of a sentence, or truncates it to "pri" when the onset is weak.
  [/^(?:aprir|april|apre|pri|prio)\b/gi, 'apri'],
  [/\baprir\b/gi, 'apri'],
  // ranking
  [/\b(?:run\s*king|rancking|renking|rankin)\b/gi, 'ranking'],
  // settings
  [/\b(?:set\s*things|setting)\b/gi, 'settings'],
];

@Injectable({ providedIn: 'root' })
export class VoiceIntentRegistryService {
  /**
   * Match a transcript against the registry. If `lang` is given, prefers that
   * language but falls back to all supported langs for short ambiguous inputs.
   */
  match(rawText: string, lang: SupportedLang | null): MatchedIntent | null {
    // Whisper's language detection on 2-3s clips is noisy (IT commands come
    // back tagged es/pt): treat it as a HINT. If normalizing with the hinted
    // language doesn't produce a full-score match, retry with the all-language
    // normalization (every filler table active) and keep the better result —
    // "apri le sessione" tagged "es" only matches once IT fillers strip "le".
    let best = this.matchNormalized(rawText, lang);
    if (lang !== null && (!best || best.score < 1.0)) {
      const retry = this.matchNormalized(rawText, null);
      if (retry && (!best || retry.score > best.score)) best = retry;
    }

    // The full normalization (fillers stripped, number words → digits) is right
    // for MATCHING but wrong for the captured free text: "invia rifattorizza le
    // due funzioni" must reach the agent verbatim, not as "rifattorizza 2
    // funzioni". Re-run the winning pattern against a LIGHT normalization of
    // the raw text (no filler/number rewriting) and prefer that capture.
    if (best?.param && best.pattern) {
      const light = this.normalize(rawText, lang, { fillers: false, numbers: false });
      const built = this.buildPatternRegex(best.pattern);
      const m = light.match(built.regex);
      if (m) {
        let idx = 1;
        for (const ph of built.placeholderOrder) {
          const captured = m[idx++]?.trim();
          if (ph === 'param' && captured) best.param = captured;
        }
      }
    }
    return best;
  }

  // ── private ──────────────────────────────────────────────────────────────

  /** One full match pass over a single normalization of the transcript. */
  private matchNormalized(rawText: string, lang: SupportedLang | null): MatchedIntent | null {
    const text = this.normalize(rawText, lang);
    console.info('[voice] normalized', { raw: rawText, normalized: text, lang });
    if (!text) return null;

    const allLangs: SupportedLang[] = ['it', 'en', 'es', 'fr', 'pt'];
    const langOrder: SupportedLang[] = lang
      ? [lang, ...allLangs.filter((l) => l !== lang)]
      : allLangs;

    let best: MatchedIntent | null = null;
    for (const tryLang of langOrder) {
      const m = this.matchInLang(text, tryLang);
      if (m && (!best || m.score > best.score)) {
        best = m;
        if (m.score >= 1.0) break; // exact: short-circuit
      }
    }
    return best;
  }

  private matchInLang(text: string, lang: SupportedLang): MatchedIntent | null {
    let best: MatchedIntent | null = null;
    const candidates: { id: string; score: number; pattern: string }[] = [];
    for (const cmd of VOICE_COMMANDS) {
      const patterns = cmd.patterns[lang];
      if (!patterns) continue;
      for (const pattern of patterns) {
        const m = this.matchPattern(text, pattern, lang);
        if (!m) continue;
        candidates.push({ id: cmd.id, score: m.score, pattern });
        const candidate: MatchedIntent = {
          command: cmd,
          param: m.param,
          n: m.n,
          score: m.score,
          matchedLang: lang,
          pattern,
        };
        if (!best || candidate.score > best.score) best = candidate;
      }
    }
    if (candidates.length > 1) {
      const top = candidates.sort((a, b) => b.score - a.score).slice(0, 3);
      console.info('[voice] candidates', { lang, top });
    }
    return best;
  }

  /** Compiled pattern cache — patterns are static, no reason to rebuild the
   *  same ~470 regexes on every utterance. */
  private patternCache = new Map<string, { regex: RegExp; placeholderOrder: ('param' | 'n')[] }>();

  private buildPatternRegex(pattern: string): { regex: RegExp; placeholderOrder: ('param' | 'n')[] } {
    const cached = this.patternCache.get(pattern);
    if (cached) return cached;
    const regexParts: string[] = [];
    const placeholderOrder: ('param' | 'n')[] = [];
    const tokens = pattern.split(/(\{param\}|\{n\})/g).filter((t) => t !== '');
    for (const tok of tokens) {
      if (tok === '{param}') {
        regexParts.push('(.+)');
        placeholderOrder.push('param');
      } else if (tok === '{n}') {
        regexParts.push('(\\d+)');
        placeholderOrder.push('n');
      } else {
        regexParts.push(this.escapeRegex(tok));
      }
    }
    const built = { regex: new RegExp(`^${regexParts.join('')}$`, 'i'), placeholderOrder };
    this.patternCache.set(pattern, built);
    return built;
  }

  private matchPattern(
    text: string,
    pattern: string,
    _lang: SupportedLang,
  ): { param?: string; n?: number; score: number } | null {
    const { regex, placeholderOrder } = this.buildPatternRegex(pattern);
    const match = text.match(regex);
    if (!match) {
      if (placeholderOrder.length === 0 && text.startsWith(pattern)) {
        return { score: 0.7 + this.specificityBonus(pattern) };
      }
      return null;
    }
    let captureIdx = 1;
    let param: string | undefined;
    let n: number | undefined;
    for (const ph of placeholderOrder) {
      const captured = match[captureIdx++]?.trim();
      if (!captured) continue;
      if (ph === 'param') param = captured;
      else if (ph === 'n') {
        const parsed = parseInt(captured, 10);
        if (parsed >= 1 && parsed <= 9) n = parsed;
        else return null;
      }
    }
    // Specificity-aware scoring:
    //  - Exact full match (no placeholders) gets a strong base of 1.0
    //  - Patterns with placeholders get 0.7 base plus a bonus proportional to
    //    how many literal characters the pattern requires. So
    //    "apri un nuovo sub agent che {param}" beats "apri {param}".
    const base = placeholderOrder.length === 0 ? 1.0 : 0.7;
    const score = Math.min(1.0, base + this.specificityBonus(pattern));
    return { param, n, score };
  }

  /** 0..0.25 bonus based on the number of literal (non-placeholder) characters. */
  private specificityBonus(pattern: string): number {
    const literal = pattern.replace(/\{param\}|\{n\}/g, '').replace(/\s+/g, ' ').trim();
    return Math.min(0.25, literal.length / 240);
  }

  /**
   * `opts.fillers` / `opts.numbers` gate the DESTRUCTIVE rewrites: the "light"
   * variant (both false) keeps the user's words intact and is used to
   * re-extract `{param}` free text after a match.
   */
  private normalize(
    raw: string,
    lang: SupportedLang | null,
    opts: { fillers: boolean; numbers: boolean } = { fillers: true, numbers: true },
  ): string {
    let s = raw.toLowerCase().trim();
    // Strip ALL punctuation (Whisper sprinkles it freely — commas/periods inside
    // a phrase like "focus sub agent 2, invia X" must not break matching). The
    // composite splitter runs on the raw text BEFORE normalization, so removing
    // commas here doesn't lose any chained command.
    s = s.replace(/[.,;:!?¿¡«»"'`]+/g, ' ');
    // Hyphens and underscores → spaces ("sub-agent" → "sub agent")
    s = s.replace(/[\-_]+/g, ' ');
    // Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();
    // Whisper-misheard aliases → canonical keyword
    for (const [re, replacement] of WHISPER_ALIASES) {
      s = s.replace(re, replacement);
    }
    s = s.replace(/\s+/g, ' ').trim();
    // Remove fillers — when language is unknown, strip every language's fillers
    if (opts.fillers) {
      const fillerLists: string[][] = lang
        ? [FILLERS[lang]]
        : [FILLERS.it, FILLERS.en, FILLERS.es, FILLERS.fr, FILLERS.pt];
      for (const list of fillerLists) {
        for (const f of list) {
          s = s.replace(new RegExp(`\\b${this.escapeRegex(f)}\\b`, 'gi'), '');
        }
      }
      s = s.replace(/\s+/g, ' ').trim();
    }
    // Convert spelled-out cardinals AND ordinals 1..9 to digits — when the
    // language is known, use ONLY that language's tables (avoids translating
    // articles/prepositions that double as numbers in other tongues, e.g.
    // FR "un" colliding with IT/ES "un" article). Fallback only when lang null.
    if (opts.numbers) {
      const allLangs: SupportedLang[] = ['it', 'en', 'es', 'fr', 'pt'];
      const numberMaps: Record<string, number>[] = lang
        ? [NUMBER_WORDS[lang], ORDINAL_WORDS[lang]]
        : allLangs.flatMap((l) => [NUMBER_WORDS[l], ORDINAL_WORDS[l]]);
      s = s.replace(/\b([a-zàâäçèéêëìíîïòóôõùúûüñºª]+)\b/g, (match) => {
        for (const map of numberMaps) {
          const n = map[match];
          if (n !== undefined) return String(n);
        }
        return match;
      });
    }
    return s;
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Lookup a command by its canonical ID. */
  getById(id: VoiceCommandId): VoiceCommand | undefined {
    return VOICE_COMMANDS.find((c) => c.id === id);
  }
}
