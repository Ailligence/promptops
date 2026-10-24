import { applyUiLanguage, formatRelativeTime, formatUiDate, isRtlLanguage, uiLocale } from './ui-locale';

describe('ui-locale', () => {
  let saved: string | null;
  beforeEach(() => { saved = localStorage.getItem('promptops_lang'); });
  afterEach(() => {
    if (saved === null) localStorage.removeItem('promptops_lang');
    else localStorage.setItem('promptops_lang', saved);
  });

  it('formats dates in the UI language, not the OS locale', () => {
    localStorage.setItem('promptops_lang', 'en');
    const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' };
    expect(formatUiDate('2026-10-22T12:00:00Z', opts)).toBe('Oct 22, 2026');
    localStorage.setItem('promptops_lang', 'it');
    expect(formatUiDate('2026-10-22T12:00:00Z', opts)).toBe('22 ott 2026');
  });

  it('defaults to English and keeps invalid input as is', () => {
    localStorage.removeItem('promptops_lang');
    expect(uiLocale()).toBe('en');
    expect(formatUiDate('not a date')).toBe('not a date');
  });
});

describe('ui-locale direction and relative time', () => {
  let saved: string | null;
  beforeEach(() => { saved = localStorage.getItem('promptops_lang'); localStorage.setItem('promptops_lang', 'en'); });
  afterEach(() => {
    if (saved === null) localStorage.removeItem('promptops_lang');
    else localStorage.setItem('promptops_lang', saved);
  });

  it('marks Arabic as right to left and the others as left to right', () => {
    const doc = document.implementation.createHTMLDocument('t');
    applyUiLanguage('ar', doc);
    expect(doc.documentElement.dir).toBe('rtl');
    expect(doc.documentElement.lang).toBe('ar');
    applyUiLanguage('it', doc);
    expect(doc.documentElement.dir).toBe('ltr');
    expect(isRtlLanguage('ar-EG')).toBeTrue();
    expect(isRtlLanguage(null)).toBeFalse();
  });

  it('formats elapsed time in the UI language', () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    expect(formatRelativeTime(now - 20_000, { now })).toBe('now');
    expect(formatRelativeTime(now - 5 * 60_000, { now })).toBe('5m ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, { now })).toBe('3h ago');
    expect(formatRelativeTime(now + 60_000, { now })).toBe('now');
    expect(formatRelativeTime(now - 3 * 3_600_000, { now, minUnit: 'day' })).toBe('today');
    expect(formatRelativeTime(now - 10 * 86_400_000, { now, minUnit: 'day' })).toBe('1w ago');
    localStorage.setItem('promptops_lang', 'it');
    expect(formatRelativeTime(now - 5 * 60_000, { now })).toBe('5 min fa');
    expect(formatRelativeTime('garbage', { now })).toBe('');
  });
});
