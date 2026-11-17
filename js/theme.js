// Farbschema: aus Akzent- und Hintergrundfarbe werden alle übrigen Farben abgeleitet.

import { mix, contrast } from './util.js';

export const PRESETS = [
  { name: 'Dunkel', accent: '#bf0fdc', bg: '#1c1c1e' },
  { name: 'Hell', accent: '#0a66d8', bg: '#f2f2f7' },
  { name: 'Blau-Gelb', accent: '#ffd60a', bg: '#0b1f3a' },
  { name: 'Grün-Weiß', accent: '#ffffff', bg: '#0f3d24' },
  { name: 'Rot-Weiß', accent: '#ffffff', bg: '#6d0f18' },
  { name: 'Schwarz-Gelb', accent: '#ffd60a', bg: '#101010' },
];

export function applyTheme(s) {
  const ok = v => /^#[0-9a-f]{6}$/i.test(v || '');
  const bg = ok(s.bg) ? s.bg : '#1c1c1e';
  const accent = ok(s.accent) ? s.accent : '#bf0fdc';
  const text = contrast(bg);
  const set = (k, v) => document.documentElement.style.setProperty(k, v);
  set('--bg', bg);
  set('--text', text);
  set('--muted', mix(text, bg, 0.42));
  set('--surface', mix(bg, text, 0.08));
  set('--surface2', mix(bg, text, 0.16));
  set('--border', mix(bg, text, 0.22));
  // Kacheln heben sich deutlich vom Hintergrund ab: auf dunklem Grund heller, auf hellem Grund fast weiß.
  const dark = text === '#ffffff';
  set('--tile', dark ? mix(bg, '#ffffff', 0.1) : mix(bg, '#ffffff', 0.85));
  set('--raised', dark ? mix(bg, '#ffffff', 0.22) : '#ffffff');
  set('--hair', mix(bg, text, dark ? 0.16 : 0.14));
  set('--accent', accent);
  set('--on-accent', contrast(accent));
  document.documentElement.style.colorScheme = text === '#ffffff' ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = bg;
}
