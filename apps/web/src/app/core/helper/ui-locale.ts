/** Where the app keeps the UI language (see AppComponent and the language picker). */
const LANG_KEY = 'promptops_lang';

/**
 * Locale of the UI language, for date and number formatting. Dates follow
 * the language the app is shown in, not the OS locale nor a fixed one.
 */
export function uiLocale(): string {
  let lang: string | null = null;
  try {
    lang = localStorage.getItem(LANG_KEY);
  } catch {
    /* storage blocked: fall back to English */
  }
  return lang || 'en';
}

/** Formats a date in the UI language; an invalid date comes back as given. */
export function formatUiDate(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    return date.toLocaleString(uiLocale(), options);
  } catch {
    return date.toLocaleString('en', options);
  }
}

/** Languages written right to left (of the ones the app ships or may ship). */
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

export function isRtlLanguage(lang: string | null | undefined): boolean {
  return RTL_LANGUAGES.has((lang ?? '').toLowerCase().split('-')[0]);
}

/**
 * Marks the document with the UI language and its direction, so screen
 * readers pick the right voice and Arabic lays out right to left.
 * Terminals and code editors stay left to right (see styles.scss).
 */
export function applyUiLanguage(lang: string, doc: Document = document): void {
  const root = doc.documentElement;
  root.lang = lang || 'en';
  root.dir = isRtlLanguage(lang) ? 'rtl' : 'ltr';
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.345],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

/**
 * Short "5m ago" / "today" style label in the UI language. `minUnit: 'day'`
 * reports anything from today as "today" instead of minutes or hours.
 */
export function formatRelativeTime(
  value: string | number | Date,
  options: { minUnit?: 'second' | 'day'; now?: number } = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = options.now ?? Date.now();
  // "auto" only for the current unit ("now", "today"): for the others it
  // would say "last wk." instead of "1w ago".
  const formatter = (numeric: 'auto' | 'always'): Intl.RelativeTimeFormat => {
    try {
      return new Intl.RelativeTimeFormat(uiLocale(), { numeric, style: 'narrow' });
    } catch {
      return new Intl.RelativeTimeFormat('en', { numeric, style: 'narrow' });
    }
  };
  // Past only: a clock a little ahead must not print "in 2m".
  let amount = Math.max(0, (now - date.getTime()) / 1000);
  let steps = RELATIVE_STEPS;
  if (options.minUnit === 'day') {
    amount = amount / 86400;
    steps = RELATIVE_STEPS.slice(3);
  }
  for (const [unit, size] of steps) {
    if (amount < size) {
      const whole = unit === 'second' ? 0 : Math.floor(amount);
      return whole === 0 ? formatter('auto').format(0, unit) : formatter('always').format(-whole, unit);
    }
    amount = amount / size;
  }
  return '';
}
