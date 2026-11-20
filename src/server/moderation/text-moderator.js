import {
  EXEMPT_PHRASES,
  MODERATION_RULES,
  ModerationCategory,
  ModerationLevel,
} from './moderation-terms.js';
import { normalizeTerm, normalizeText } from './text-normalizer.js';

export { ModerationCategory, ModerationLevel } from './moderation-terms.js';

const ADULT_AGE = 18;
const PREFIX_MARK = '*';

// Motivos que ve el usuario; completan la frase "No se envió: ...".
export const MODERATION_REASONS = Object.freeze({
  [ModerationCategory.SEXUAL_EXPLICIT]: 'parece contener contenido sexual explícito',
  [ModerationCategory.MINORS_SEXUAL]: 'parece contener contenido sexual que involucra a menores',
  [ModerationCategory.DRUG_SALES]: 'parece ofrecer la venta de drogas',
  [ModerationCategory.WEAPON_SALES]: 'parece ofrecer la venta de armas',
  [ModerationCategory.VIOLENT_THREAT]: 'parece contener una amenaza violenta',
  [ModerationCategory.HATE]: 'parece contener discurso de odio',
  [ModerationCategory.PROFANITY]: 'parece contener groserías',
  [ModerationCategory.INSULT]: 'parece contener insultos',
});
const REASONS = new Map(Object.entries(MODERATION_REASONS));
const GENERIC_REASON = 'parece infringir las normas de la sala';

export function moderationReason(category) {
  return REASONS.get(category) ?? GENERIC_REASON;
}

const ALLOWED = Object.freeze({ allowed: true });

function padded(tokens) {
  return ` ${tokens.join(' ')} `;
}

// Vista del texto que comparten todos los grupos para no recalcularla por cada regla.
function buildView({ tokens, spelled, rawTokens, compact }) {
  return {
    words: new Set([...tokens, ...spelled, ...rawTokens]),
    texts: [padded(tokens), padded(rawTokens)],
    rawText: rawTokens.join(' '),
    compact,
  };
}

// Decide si un grupo de terminos aparece en el texto (por palabra, frase, prefijo, compacto o edad).
class TermMatcher {
  #words = new Set();
  #prefixes = [];
  #phrases;
  #compact;
  #minorAgePatterns;

  constructor({ words = [], phrases = [], compact = [], minorAgePatterns = [] }) {
    for (const word of words) {
      this.#addWord(word);
    }
    this.#phrases = phrases.map((phrase) => ` ${normalizeTerm(phrase)} `);
    this.#compact = compact.map((term) => normalizeTerm(term).replaceAll(' ', ''));
    this.#minorAgePatterns = minorAgePatterns;
  }

  #addWord(word) {
    if (word.endsWith(PREFIX_MARK)) {
      this.#prefixes.push(normalizeTerm(word.slice(0, -1)));
    } else {
      this.#words.add(normalizeTerm(word));
    }
  }

  matches(view) {
    return (
      this.#matchesWord(view.words) ||
      this.#phrases.some((phrase) => view.texts.some((text) => text.includes(phrase))) ||
      this.#compact.some((term) => view.compact.includes(term)) ||
      this.#mentionsMinorAge(view.rawText)
    );
  }

  #matchesWord(words) {
    for (const word of words) {
      if (this.#words.has(word) || this.#prefixes.some((prefix) => word.startsWith(prefix))) {
        return true;
      }
    }
    return false;
  }

  #mentionsMinorAge(rawText) {
    return this.#minorAgePatterns.some((pattern) =>
      [...rawText.matchAll(pattern)].some((match) => Number(match.groups.age) < ADULT_AGE),
    );
  }
}

function isStrictOnly(rule) {
  return rule.level === ModerationLevel.STRICT;
}

// Sin importar el orden recibido: primero menores, luego lo grave y al final lo leve (estricto).
function priorityOf(rule) {
  if (rule.category === ModerationCategory.MINORS_SEXUAL) {
    return 0;
  }
  return isStrictOnly(rule) ? 2 : 1;
}

/**
 * Revisa mensajes de texto con un diccionario de terminos. Es puro y determinista:
 * el mismo texto con el mismo nivel siempre recibe la misma decision.
 * Un nivel desconocido se trata como estricto: ante una configuracion erronea, bloquear de mas.
 */
export class TextModerator {
  #rulesByLevel;
  #exemptPhrases;

  constructor({ rules = MODERATION_RULES, exemptPhrases = EXEMPT_PHRASES } = {}) {
    const compiled = new Map();
    const compile = (group) => {
      if (!compiled.has(group)) {
        compiled.set(group, new TermMatcher(group));
      }
      return compiled.get(group);
    };
    const orderedRules = rules
      .toSorted((left, right) => priorityOf(left) - priorityOf(right))
      .map((rule) => ({ rule, category: rule.category, matchers: rule.all.map(compile) }));
    this.#rulesByLevel = new Map([
      [ModerationLevel.STANDARD, orderedRules.filter(({ rule }) => !isStrictOnly(rule))],
      [ModerationLevel.STRICT, orderedRules],
    ]);
    this.#exemptPhrases = exemptPhrases.map(normalizeTerm);
  }

  review(text, { level = ModerationLevel.STANDARD } = {}) {
    if (typeof text !== 'string' || text.trim() === '') {
      return ALLOWED;
    }
    const rules = this.#rulesByLevel.get(level) ?? this.#rulesByLevel.get(ModerationLevel.STRICT);
    const view = buildView(normalizeText(text, { exemptPhrases: this.#exemptPhrases }));
    const rule = rules.find(({ matchers }) => matchers.every((matcher) => matcher.matches(view)));
    return rule ? Object.freeze({ allowed: false, category: rule.category }) : ALLOWED;
  }
}
