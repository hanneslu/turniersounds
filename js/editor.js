// Dialog "Jingle bearbeiten": Beschriftung, Farbe, Ausschnitt mit Wellenform, Lautstärke, Blenden.

import * as audio from './audio.js';
import * as model from './model.js';
import { h, fmtTenths, swatches } from './util.js';

const MIN_LEN = 0.2;

export function openPadEditor(track, { onSave, onDelete }) {
  const d = { ...track };                       // Arbeitskopie
  let boardId = track.board;
  let full = null;                              // vollständig dekodierter Song
  let total = d.fullDuration || d.trimOutPoint || 1;
  let view = [0, total];
  let zoomed = false, drag = null, raf = 0, peaks = null, peaksKey = '';

  const canvas = h('canvas', { class: 'wave' });
  const status = h('div', { class: 'hint' }, model.hasFile(track) ? 'Wellenform wird geladen …' : 'Die Audiodatei zu diesem Jingle fehlt. Bitte über „Einstellungen → Dateien importieren“ nachladen.');
  const lblIn = h('b'), lblOut = h('b'), lblLen = h('b');
  const zoomBtn = h('button', { type: 'button', class: 'btn small', onclick: toggleZoom }, 'Ausschnitt vergrößern');

  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function labels() {
    lblIn.textContent = fmtTenths(d.trimInPoint);
    lblOut.textContent = fmtTenths(d.trimOutPoint);
    lblLen.textContent = (d.trimOutPoint - d.trimInPoint).toFixed(1).replace('.', ',') + ' s';
  }

  function computePeaks(w) {
    const key = view.join('|') + '|' + w;
    if (!full || key === peaksKey) return;
    peaksKey = key;
    peaks = new Float32Array(w);
    const sr = full.sampleRate, a = full.getChannelData(0);
    const b = full.numberOfChannels > 1 ? full.getChannelData(1) : a;
    for (let x = 0; x < w; x++) {
      const s0 = Math.floor((view[0] + (x / w) * (view[1] - view[0])) * sr);
      const s1 = Math.min(a.length, Math.floor((view[0] + ((x + 1) / w) * (view[1] - view[0])) * sr));
      const step = Math.max(1, Math.floor((s1 - s0) / 120));
      let m = 0;
      for (let i = s0; i < s1; i += step) {
        const v = Math.max(Math.abs(a[i]), Math.abs(b[i]));
        if (v > m) m = v;
      }
      peaks[x] = m;
    }
  }

  const tToX = (t, w) => ((t - view[0]) / (view[1] - view[0])) * w;

  function draw() {
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const xi = tToX(d.trimInPoint, w), xo = tToX(d.trimOutPoint, w);
    const accent = cssVar('--accent'), muted = cssVar('--border'), text = cssVar('--text');
    g.fillStyle = cssVar('--surface');
    g.fillRect(0, 0, w, hgt);
    g.globalAlpha = 0.18; g.fillStyle = accent;
    g.fillRect(xi, 0, xo - xi, hgt);
    g.globalAlpha = 1;
    computePeaks(w);
    if (peaks) {
      for (let x = 0; x < w; x++) {
        const bar = Math.max(1, peaks[x] * (hgt - 16));
        g.fillStyle = x >= xi && x <= xo ? accent : muted;
        g.fillRect(x, (hgt - bar) / 2, 1, bar);
      }
    }
    // Griffe für Start und Ende
    g.fillStyle = text;
    for (const [x, dir] of [[xi, 1], [xo, -1]]) {
      g.fillRect(x - 1, 0, 2, hgt);
      g.beginPath();
      g.moveTo(x, 0); g.lineTo(x + dir * 12, 0); g.lineTo(x, 14); g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(x, hgt); g.lineTo(x + dir * 12, hgt); g.lineTo(x, hgt - 14); g.closePath(); g.fill();
    }
    // Abspielposition
    const p = audio.position();
    if (p && p.id === 'vorschau') {
      const x = tToX(p.offset + p.elapsed, w);
      g.fillStyle = text; g.globalAlpha = 0.9;
      g.fillRect(x - 0.5, 0, 1.5, hgt);
      g.globalAlpha = 1;
    }
  }

  function loop() {
    draw();
    const p = audio.position();
    raf = p && p.id === 'vorschau' ? requestAnimationFrame(loop) : 0;
  }

  function setTrim(which, t) {
    if (which === 'in') d.trimInPoint = Math.min(Math.max(0, t), d.trimOutPoint - MIN_LEN);
    else d.trimOutPoint = Math.max(Math.min(total, t), d.trimInPoint + MIN_LEN);
    labels(); draw();
  }

  function toggleZoom() {
    zoomed = !zoomed;
    const pad = Math.max(2, (d.trimOutPoint - d.trimInPoint) * 0.2);
    view = zoomed ? [Math.max(0, d.trimInPoint - pad), Math.min(total, d.trimOutPoint + pad)] : [0, total];
    zoomBtn.textContent = zoomed ? 'Ganzen Song zeigen' : 'Ausschnitt vergrößern';
    draw();
  }

  const evT = e => {
    const r = canvas.getBoundingClientRect();
    return view[0] + ((e.clientX - r.left) / r.width) * (view[1] - view[0]);
  };
  canvas.addEventListener('pointerdown', e => {
    if (!full) return;
    const t = evT(e);
    drag = Math.abs(t - d.trimInPoint) <= Math.abs(t - d.trimOutPoint) ? 'in' : 'out';
    canvas.setPointerCapture(e.pointerId);
    audio.stop();
    setTrim(drag, t);
  });
  canvas.addEventListener('pointermove', e => { if (drag) setTrim(drag, evT(e)); });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  function preview(fromEnd) {
    if (!full) return;
    audio.ensureCtx();
    const len = d.trimOutPoint - d.trimInPoint;
    const dur = fromEnd ? Math.min(4, len) : len;
    audio.playBuffer(full, {
      id: 'vorschau', offset: d.trimOutPoint - dur, duration: dur, volume: d.volume,
      fadeIn: !fromEnd && d.fadesIn ? d.fadesInDuration : 0,
      fadeOut: d.fadesOut ? d.fadesOutDuration : 0,
      onEnd: draw,
    });
    if (!raf) raf = requestAnimationFrame(loop);
  }

  const stepper = which => h('div', { class: 'stepper' },
    [[-1, '−1 s'], [-0.1, '−0,1'], [0.1, '+0,1'], [1, '+1 s']].map(([dv, txt]) =>
      h('button', { type: 'button', class: 'btn small', disabled: true,
        onclick: () => { audio.stop(); setTrim(which, (which === 'in' ? d.trimInPoint : d.trimOutPoint) + dv); } }, txt)));

  function fadeRow(label, onKey, durKey) {
    const val = h('span', { class: 'val' });
    const range = h('input', { type: 'range', min: 0.1, max: 5, step: 0.1, value: d[durKey] || 0.2,
      oninput: e => { d[durKey] = +e.target.value; show(); } });
    const show = () => {
      val.textContent = (+range.value).toFixed(1).replace('.', ',') + ' s';
      range.disabled = !d[onKey];
    };
    const row = h('div', { class: 'row' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!d[onKey], onchange: e => { d[onKey] = e.target.checked; show(); } }), label),
      range, val);
    show();
    return row;
  }

  const volVal = h('span', { class: 'val' }, Math.round((d.volume == null ? 1 : d.volume) * 100) + ' %');
  const trimBox = h('div', { class: 'trim' },
    canvas, status,
    h('div', { class: 'trimgrid' },
      h('div', {}, h('div', { class: 'cap' }, 'Start ', lblIn), stepper('in')),
      h('div', {}, h('div', { class: 'cap' }, 'Ende ', lblOut), stepper('out'))),
    h('div', { class: 'row wrap' },
      h('button', { type: 'button', class: 'btn', disabled: true, onclick: () => preview(false) }, '▶ Ausschnitt anhören'),
      h('button', { type: 'button', class: 'btn', disabled: true, onclick: () => preview(true) }, '▶ Nur das Ende'),
      h('button', { type: 'button', class: 'btn', disabled: true, onclick: () => audio.stop() }, '■'),
      zoomBtn),
    h('div', { class: 'hint' }, 'Länge des Ausschnitts: ', lblLen, ' · Start und Ende lassen sich in der Wellenform mit dem Finger verschieben.'));
  zoomBtn.disabled = true;

  const dialog = h('dialog', { class: 'sheet' },
    h('div', { class: 'sheet-in' },
      h('div', { class: 'sheet-head' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => dialog.close() }, 'Abbrechen'),
        h('h2', {}, 'Jingle bearbeiten'),
        h('button', { type: 'button', class: 'btn primary', onclick: save }, 'Speichern')),
      h('div', { class: 'sheet-body' },
        h('section', {},
          h('label', { class: 'field' }, h('span', {}, 'Beschriftung'),
            h('input', { type: 'text', value: d.title || '', maxLength: 60, oninput: e => { d.title = e.target.value; } })),
          h('div', { class: 'field' }, h('span', {}, 'Farbe'),
            swatches(d.colorScheme, cssVar('--accent'), c => { d.colorScheme = c; }))),
        h('section', {}, h('h3', {}, 'Ausschnitt'), trimBox),
        h('section', {}, h('h3', {}, 'Klang'),
          h('div', { class: 'row' }, h('span', { class: 'check' }, 'Lautstärke'),
            h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: d.volume == null ? 1 : d.volume,
              oninput: e => { d.volume = +e.target.value; volVal.textContent = Math.round(d.volume * 100) + ' %'; } }), volVal),
          fadeRow('Einblenden', 'fadesIn', 'fadesInDuration'),
          fadeRow('Ausblenden', 'fadesOut', 'fadesOutDuration')),
        h('section', {}, h('h3', {}, 'Ablage'),
          h('label', { class: 'field' }, h('span', {}, 'Board'),
            h('select', { onchange: e => { boardId = e.target.value; } },
              model.boardsSorted().map(b => h('option', { value: b.id, selected: b.id === boardId }, b.title)))),
          h('button', { type: 'button', class: 'btn danger', onclick: () => { dialog.close(); onDelete(track); } }, 'Jingle löschen')))));

  function save() {
    d.title = (d.title || '').trim() || track.title;
    Object.assign(track, d);
    dialog.close();
    onSave(track, boardId);
  }

  dialog.addEventListener('close', () => {
    audio.stop();
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', draw);
    dialog.remove();
  });
  window.addEventListener('resize', draw);
  document.body.append(dialog);
  dialog.showModal();
  labels();
  draw();

  if (model.hasFile(track)) {
    model.getBlob(track.file).then(b => audio.decodeBlob(b)).then(buf => {
      if (!dialog.isConnected) return;
      full = buf;
      total = d.fullDuration = buf.duration;
      if (!(d.trimOutPoint > 0) || d.trimOutPoint > total) d.trimOutPoint = total;
      if (d.trimInPoint > d.trimOutPoint - MIN_LEN) d.trimInPoint = 0;
      view = [0, total];
      status.remove();
      trimBox.querySelectorAll('button').forEach(b => { b.disabled = false; });
      labels(); draw();
    }).catch(() => { status.textContent = 'Die Audiodatei konnte nicht gelesen werden.'; });
  }
}
