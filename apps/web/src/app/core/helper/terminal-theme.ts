import type { ITheme } from '@xterm/xterm';

/**
 * xterm palette for every agent terminal: the track bed of the Signal Box
 * panel (--po-bg-0), warm off-white ink, a violet cursor ("route set") and
 * ANSI hues tuned to the signal lamps so a CLI's green/red/yellow read the
 * same as the panel's working/blocked/idle.
 */
export const SIGNAL_TERMINAL_THEME: ITheme = {
  background: '#14171a',
  foreground: '#d6d5cc',
  cursor: '#a49cff',
  cursorAccent: '#14171a',
  selectionBackground: 'rgba(110, 98, 255, 0.34)',
  black: '#14171a',
  red: '#f0605a',
  green: '#5ecd80',
  yellow: '#ecbe5c',
  blue: '#6eb4d6',
  magenta: '#b4a6ff',
  cyan: '#5fcfc4',
  white: '#c9ccc6',
  brightBlack: '#5a6260',
  brightRed: '#ff8f86',
  brightGreen: '#83e0a0',
  brightYellow: '#f6d488',
  brightBlue: '#98cfe8',
  brightMagenta: '#cfc6ff',
  brightCyan: '#8ee3da',
  brightWhite: '#f1efe6',
};
