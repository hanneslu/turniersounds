// Kleine Helfer: DOM-Erzeugung, Zeitformat, Farben.

export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) e.style.setProperty(p, val);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function fmtTime(s) {
  s = Math.max(0, Math.round(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export function fmtTenths(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m + ':' + (r < 9.95 ? '0' : '') + r.toFixed(1).replace('.', ',');
}

export function fmtSize(bytes) {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(2).replace('.', ',') + ' GB';
  return Math.max(0, Math.round(bytes / 1e6)) + ' MB';
}

// Farbnamen aus Soundboard Studio. Eigene Farben werden als "#rrggbb" gespeichert.
export const PALETTE = {
  gray: '#8e8e93', purple: '#bf0fdc', orange: '#f5a623', green: '#5fb50a',
  red: '#ff2d43', blue: '#4a90e2', yellow: '#ffd60a', cyan: '#32c8ff',
};

export function colorOf(scheme, fallback) {
  if (PALETTE[scheme]) return PALETTE[scheme];
  if (/^#[0-9a-f]{6}$/i.test(scheme || '')) return scheme;
  return fallback;
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a, b, t) {
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function luminance(hex) {
  const [r, g, b] = rgb(hex).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Gut lesbare Schriftfarbe (dunkel oder hell) für einen Hintergrund.
export function contrast(hex) {
  return luminance(hex) > 0.4 ? '#111111' : '#ffffff';
}

// Farbauswahl: feste Palette plus freie Farbe.
export function swatches(current, fallback, onPick) {
  const box = h('div', { class: 'swatches' });
  const draw = () => {
    box.replaceChildren(
      ...Object.entries(PALETTE).map(([name, hex]) =>
        h('button', {
          type: 'button', class: 'swatch' + (current === name ? ' on' : ''),
          style: { background: hex }, 'aria-label': name,
          onclick: () => { current = name; onPick(name); draw(); },
        })),
      h('label', { class: 'swatch custom' + (/^#/.test(current || '') ? ' on' : ''), title: 'Eigene Farbe',
        style: { background: /^#/.test(current || '') ? current : 'transparent' } },
        h('input', {
          type: 'color', value: colorOf(current, fallback),
          oninput: e => { current = e.target.value; onPick(current); draw(); },
        }), /^#/.test(current || '') ? '' : '+'),
    );
  };
  draw();
  return box;
}
