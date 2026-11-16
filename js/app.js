// Oberfläche: Boards, Pads, Bearbeiten-Modus, Einstellungen, Import/Export.

import * as model from './model.js';
import * as audio from './audio.js';
import { h, fmtTime, fmtSize, colorOf, contrast, swatches } from './util.js';
import { applyTheme, PRESETS } from './theme.js';
import { openPadEditor } from './editor.js';

const S = model.state;
const root = document.getElementById('app');
const FADE_BUTTON_SECONDS = 2.5;
const APP_VERSION = '1.3';
const ACCEPT = '.zip,.json,.mp3,.m4a,.mp4,.aac,.wav,.aif,.aiff,.caf,.flac,.ogg,.opus,audio/*,application/json,application/zip';

let editMode = false;
let loadingId = null;
let importBoard = null;
const padEls = new Map();
let nowTitle = null, nowTime = null;

const fileInput = h('input', { type: 'file', multiple: true, accept: ACCEPT, class: 'visually-hidden', tabIndex: -1,
  onchange: async e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) await runImport(files); } });
document.body.append(fileInput);

const accent = () => S.settings.accent;
const trackLen = t => Math.max(0, (t.trimOutPoint || t.fullDuration || 0) - (t.trimInPoint || 0));

// ---------- Dialog-Helfer ----------

function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

// Rückfrage mit frei wählbaren Schaltflächen; liefert den Wert der gewählten oder null.
function ask(title, text, buttons) {
  return new Promise(res => {
    let result = null;
    const dlg = h('dialog', { class: 'ask' },
      h('h2', {}, title),
      text && h('p', {}, text),
      h('div', { class: 'ask-btns' }, buttons.map(b =>
        h('button', { type: 'button', class: 'btn ' + (b.cls || ''), onclick: () => { result = b.value; dlg.close(); } }, b.label))));
    dlg.addEventListener('close', () => { dlg.remove(); res(result); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

const confirmDelete = (title, text) => ask(title, text, [
  { label: 'Abbrechen', value: null }, { label: 'Löschen', value: true, cls: 'danger' }]);

function busy(text) {
  const label = h('p', {}, text);
  const dlg = h('dialog', { class: 'ask busy' }, h('div', { class: 'spinner' }), label);
  dlg.addEventListener('cancel', e => e.preventDefault());
  document.body.append(dlg);
  dlg.showModal();
  return { set: t => { label.textContent = t; }, close: () => { dlg.close(); dlg.remove(); } };
}

// ---------- Import / Export ----------

function pickFiles(boardId) {
  importBoard = boardId || null;
  fileInput.click();
}

async function runImport(files) {
  const b = busy('Dateien werden gelesen …');
  let sum;
  try {
    sum = await model.importFiles(files, {
      boardId: importBoard,
      askMode: () => ask('Boards übernehmen', 'Die Auswahl enthält eine Board-Sammlung. Sollen die vorhandenen Boards ersetzt oder die neuen zusätzlich aufgenommen werden?', [
        { label: 'Abbrechen', value: null },
        { label: 'Hinzufügen', value: 'add' },
        { label: 'Ersetzen', value: 'replace', cls: 'primary' }]),
      onProgress: (done, total, name) => b.set(`Audiodatei ${done + 1} von ${total}\n${name}`),
    });
  } catch (e) {
    b.close();
    await ask('Import fehlgeschlagen', e.message || String(e), [{ label: 'OK', value: true, cls: 'primary' }]);
    return;
  }
  b.close();
  if (!sum) return;
  audio.clearCache();
  applyTheme(S.settings);
  render();
  const lines = [];
  if (sum.boards) lines.push(`${sum.boards} Boards mit ${sum.tracks} Jingles übernommen.`);
  if (sum.audio) lines.push(`${sum.audio} Audiodateien gespeichert` + (sum.newPads ? `, davon ${sum.newPads} als neue Jingles angelegt.` : '.'));
  const missing = model.missingFiles();
  if (missing.length) lines.push(`Für ${missing.length} Jingles fehlt noch die Audiodatei – einfach die Songs im selben Schritt oder nachträglich importieren.`);
  if (sum.failed.length) lines.push(`Nicht lesbar (evtl. kopiergeschützt oder unbekanntes Format): ${sum.failed.join(', ')}`);
  if (!lines.length) lines.push('In der Auswahl wurden keine passenden Dateien gefunden. Unterstützt werden Pakete (.zip), soundboard.json und Audiodateien (MP3, M4A, WAV …).');
  await ask('Import abgeschlossen', lines.join('\n\n'), [{ label: 'OK', value: true, cls: 'primary' }]);
  if (sum.newPads && !editMode) toast('Tipp: Über „Bearbeiten“ lässt sich der Ausschnitt jedes neuen Jingles festlegen.');
}

async function runExport() {
  if (!Object.keys(S.boards).length) { toast('Es gibt noch nichts zu exportieren.'); return; }
  const b = busy('Paket wird erstellt …');
  let file;
  try { file = await model.exportPackage(); } catch (e) {
    b.close();
    await ask('Export fehlgeschlagen', e.message || String(e), [{ label: 'OK', value: true, cls: 'primary' }]);
    return;
  }
  b.close();
  const how = await ask('Paket ist fertig', `${file.name} (${fmtSize(file.size)}) enthält alle Boards, Ausschnitte und Songs.`, [
    { label: 'Abbrechen', value: null },
    ...(navigator.canShare && navigator.canShare({ files: [file] }) ? [{ label: 'Teilen …', value: 'share' }] : []),
    { label: 'Als Datei sichern', value: 'save', cls: 'primary' }]);
  if (how === 'share') {
    try { await navigator.share({ files: [file], title: file.name }); return; } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  if (how) {
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: file.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

// ---------- Wiedergabe ----------

async function tapPad(t) {
  audio.ensureCtx();
  if (!model.hasFile(t)) { toast('Zu diesem Jingle fehlt die Audiodatei. Bitte in den Einstellungen importieren.'); return; }
  if (audio.currentId() === t.id) { audio.stop(t.fadesOut ? t.fadesOutDuration || 0.2 : 0.05); return; }
  if (loadingId === t.id) { loadingId = null; updatePads(); return; }
  audio.stop(0.12);
  loadingId = t.id;
  updatePads();
  let buf;
  try {
    buf = await audio.getClip(t, model.getBlob, true);
  } catch (e) {
    if (loadingId === t.id) loadingId = null;
    toast(`„${t.title}“ konnte nicht gelesen werden.`);
    updatePads();
    return;
  }
  if (loadingId !== t.id) return;
  try {
    await audio.playBuffer(buf, {
      id: t.id, volume: t.volume == null ? 1 : t.volume,
      fadeIn: t.fadesIn ? t.fadesInDuration || 0 : 0,
      fadeOut: t.fadesOut ? t.fadesOutDuration || 0 : 0,
      onEnd: updatePads,
    });
  } catch (e) {
    toast('Die Tonausgabe ist noch gesperrt. Bitte den Jingle noch einmal antippen.');
  }
  if (loadingId === t.id) loadingId = null;
  updatePads();
}

function updatePads() {
  const cur = audio.currentId();
  for (const [id, el] of padEls) {
    const on = id === cur;
    if (el.classList.contains('playing') && !on) {
      el.style.removeProperty('--p');
      el.querySelector('.time').textContent = fmtTime(trackLen(S.tracks[id]));
    }
    el.classList.toggle('playing', on);
    el.classList.toggle('loading', id === loadingId);
  }
  const t = S.tracks[cur];
  if (nowTitle) nowTitle.textContent = t ? t.title : '';
  if (nowTime && !t) nowTime.textContent = '';
}

function frame() {
  const p = audio.position();
  if (p && S.tracks[p.id]) {
    const rest = '−' + fmtTime(p.duration - p.elapsed);
    const el = padEls.get(p.id);
    if (el) {
      el.style.setProperty('--p', (p.elapsed / p.duration).toFixed(4));
      el.querySelector('.time').textContent = rest;
    }
    if (nowTime) nowTime.textContent = rest;
  }
  requestAnimationFrame(frame);
}

// ---------- Aufbau der Oberfläche ----------

function render() {
  const oldGrid = root.querySelector('.grid'), oldTabs = root.querySelector('.tabs');
  const scroll = [oldGrid ? oldGrid.scrollTop : 0, oldTabs ? oldTabs.scrollLeft : 0];
  document.title = S.settings.appName;
  padEls.clear();
  const boards = model.boardsSorted();
  root.classList.toggle('editing', editMode);
  root.replaceChildren(header(boards.length > 0),
    ...(boards.length ? [tabs(boards), editMode ? toolbar() : '', grid(), transport()] : [welcome()]));
  const g = root.querySelector('.grid'), tb = root.querySelector('.tabs');
  if (g) g.scrollTop = scroll[0];
  if (tb) tb.scrollLeft = scroll[1];
  updatePads();
  if (S.activeBoard) audio.preload(model.tracksOf(S.activeBoard).filter(model.hasFile), model.getBlob);
}

function header(hasBoards) {
  return h('header', { class: 'top' },
    h('button', { class: 'btn icon', 'aria-label': 'Einstellungen', onclick: openSettings }, '⚙'),
    h('h1', {}, S.settings.appName),
    hasBoards
      ? h('button', { class: 'btn ' + (editMode ? 'primary' : ''), onclick: () => { editMode = !editMode; audio.stop(); render(); } },
        editMode ? 'Fertig' : 'Bearbeiten')
      : h('span', { class: 'spacer' }));
}

function tabs(boards) {
  return h('nav', { class: 'tabs' }, boards.map(b => {
    const c = colorOf(b.colorScheme, accent());
    const on = b.id === S.activeBoard;
    return h('button', {
      class: 'tab' + (on ? ' on' : ''), style: { '--c': c, '--on-c': contrast(c) },
      onclick: () => { if (!on) { model.setActive(b.id); render(); } },
    }, h('i', {}), b.title);
  }));
}

function toolbar() {
  return h('div', { class: 'toolbar' },
    h('button', { class: 'btn', onclick: () => pickFiles(S.activeBoard) }, '＋ Songs hinzufügen'),
    h('button', { class: 'btn', onclick: () => openBoardDialog(S.boards[S.activeBoard]) }, 'Board bearbeiten'),
    h('button', { class: 'btn', onclick: () => { const b = model.addBoard('Neues Board'); render(); openBoardDialog(b); } }, '＋ Neues Board'));
}

function grid() {
  const tracks = model.tracksOf(S.activeBoard);
  const box = h('main', { class: 'grid' });
  if (!tracks.length) {
    box.append(h('div', { class: 'empty' },
      h('p', {}, 'Dieses Board ist noch leer.'),
      h('button', { class: 'btn primary', onclick: () => pickFiles(S.activeBoard) }, '＋ Songs hinzufügen')));
    return box;
  }
  tracks.forEach((t, i) => {
    const c = colorOf(t.colorScheme, accent());
    const act = () => (editMode ? editPad(t) : tapPad(t));
    const el = h('div', {
      class: 'pad' + (model.hasFile(t) ? '' : ' missing'), role: 'button', tabIndex: 0,
      style: { '--c': c, '--on-c': contrast(c) },
      onclick: act,
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } },
    },
    h('span', { class: 'title' }, t.title),
    h('span', { class: 'time' }, model.hasFile(t) ? fmtTime(trackLen(t)) : 'Datei fehlt'),
    editMode && h('span', { class: 'pencil' }, '✎'),
    editMode && h('button', { class: 'mv l', disabled: i === 0, 'aria-label': 'Nach vorne',
      onclick: e => { e.stopPropagation(); model.moveTrack(t.id, -1); render(); } }, '◀'),
    editMode && h('button', { class: 'mv r', disabled: i === tracks.length - 1, 'aria-label': 'Nach hinten',
      onclick: e => { e.stopPropagation(); model.moveTrack(t.id, 1); render(); } }, '▶'));
    padEls.set(t.id, el);
    box.append(el);
  });
  return box;
}

function transport() {
  nowTitle = h('div', { class: 'now-title' });
  nowTime = h('div', { class: 'now-time' });
  if (editMode) {
    return h('footer', { class: 'transport note' }, 'Bearbeiten-Modus: Jingle antippen, um ihn zu ändern. Mit ◀ ▶ die Reihenfolge anpassen.');
  }
  return h('footer', { class: 'transport' },
    h('div', { class: 'now' }, nowTitle, nowTime),
    h('button', { class: 'btn big', onclick: () => { loadingId = null; audio.stop(FADE_BUTTON_SECONDS); updatePads(); } }, '◣ Ausblenden'),
    h('button', { class: 'btn big stop', onclick: () => { loadingId = null; audio.stop(0.05); updatePads(); } }, '■ Stopp'));
}

function welcome() {
  return h('main', { class: 'welcome' },
    h('h2', {}, 'Willkommen!'),
    h('p', {}, 'Hier entstehen Ihre Boards mit Jingles für Tore, Ecken und Siegerehrung. Zum Start gibt es zwei Wege:'),
    h('button', { class: 'btn primary big', onclick: () => pickFiles(null) }, 'Paket oder Songs importieren'),
    h('p', { class: 'hint' }, 'Wählen Sie ein fertiges Paket (.zip), das Sie von jemandem bekommen haben – oder eigene Songs (MP3, M4A, WAV). Auch eine soundboard.json aus „Soundboard Studio“ zusammen mit den zugehörigen Songs funktioniert.'),
    h('button', { class: 'btn', onclick: () => { model.addBoard('Board 1'); editMode = true; render(); } }, 'Mit leerem Board beginnen'),
    h('p', { class: 'hint' }, 'Alle Songs bleiben auf diesem Gerät. Es wird nichts ins Internet übertragen.'));
}

// ---------- Bearbeiten ----------

function editPad(t) {
  openPadEditor(t, {
    onSave: (track, boardId) => {
      model.moveTrackToBoard(track.id, boardId);
      model.saveBoards();
      render();
    },
    onDelete: async track => {
      if (await confirmDelete('Jingle löschen?', `„${track.title}“ wird vom Board entfernt.`)) {
        await model.deleteTrack(track.id);
        render();
      }
    },
  });
}

function openBoardDialog(b) {
  if (!b) return;
  const name = h('input', { type: 'text', value: b.title, maxLength: 30 });
  const dlg = h('dialog', { class: 'sheet small' },
    h('div', { class: 'sheet-in' },
      h('div', { class: 'sheet-head' }, h('span', { class: 'spacer' }), h('h2', {}, 'Board bearbeiten'),
        h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Fertig')),
      h('div', { class: 'sheet-body' },
        h('section', {},
          h('label', { class: 'field' }, h('span', {}, 'Name'), name),
          h('div', { class: 'field' }, h('span', {}, 'Farbe'),
            swatches(b.colorScheme, accent(), c => { b.colorScheme = c; })),
          h('div', { class: 'field' }, h('span', {}, 'Position'),
            h('div', { class: 'row' },
              h('button', { class: 'btn', onclick: () => { model.moveBoard(b.id, -1); render(); } }, '◀ Nach links'),
              h('button', { class: 'btn', onclick: () => { model.moveBoard(b.id, 1); render(); } }, 'Nach rechts ▶')))),
        h('section', {},
          h('button', { class: 'btn danger', onclick: async () => {
            const n = model.tracksOf(b.id).length;
            if (await confirmDelete('Board löschen?', `„${b.title}“ und die ${n} enthaltenen Jingles werden entfernt.`)) {
              dlg.close();
              await model.deleteBoard(b.id);
              if (!Object.keys(S.boards).length) editMode = false;
              render();
            }
          } }, 'Board löschen')))));
  dlg.addEventListener('close', () => {
    if (S.boards[b.id]) { b.title = name.value.trim() || b.title; model.saveBoards(); }
    dlg.remove();
    render();
  });
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- Einstellungen ----------

function openSettings() {
  audio.stop();
  const st = S.settings;
  const accentIn = h('input', { type: 'color', value: st.accent, oninput: e => setColors({ accent: e.target.value }) });
  const bgIn = h('input', { type: 'color', value: st.bg, oninput: e => setColors({ bg: e.target.value }) });
  function setColors(c) {
    Object.assign(st, c);
    accentIn.value = st.accent; bgIn.value = st.bg;
    applyTheme(st);
    model.saveSettings();
  }
  const diag = h('p', { class: 'hint' }, `Version ${APP_VERSION} · ${audio.status()} · ${wakeStatus()}`);
  const data = h('div', {});
  function drawData() {
    const missing = model.missingFiles(), unused = model.unusedFiles();
    data.replaceChildren(
      h('p', { class: 'hint' }, `${Object.keys(S.boards).length} Boards · ${Object.keys(S.tracks).length} Jingles · ${Object.keys(S.files).length} Audiodateien (${fmtSize(model.storageBytes())}) auf diesem Gerät.`),
      missing.length ? h('details', { class: 'warn' },
        h('summary', {}, `Für ${missing.length} Jingles fehlt die Audiodatei`),
        h('ul', {}, missing.map(m => h('li', {}, m)))) : null,
      unused.length ? h('button', { class: 'btn', onclick: async () => { await model.removeUnused(); drawData(); } },
        `${unused.length} unbenutzte Audiodateien entfernen`) : null);
  }
  drawData();
  const dlg = h('dialog', { class: 'sheet' },
    h('div', { class: 'sheet-in' },
      h('div', { class: 'sheet-head' }, h('span', { class: 'spacer' }), h('h2', {}, 'Einstellungen'),
        h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Fertig')),
      h('div', { class: 'sheet-body' },
        h('section', {}, h('h3', {}, 'Aussehen'),
          h('label', { class: 'field' }, h('span', {}, 'Name der App'),
            h('input', { type: 'text', value: st.appName, maxLength: 30,
              onchange: e => { st.appName = e.target.value.trim() || 'Turniersounds'; model.saveSettings(); } })),
          h('div', { class: 'field' }, h('span', {}, 'Farbvorlagen'),
            h('div', { class: 'presets' }, PRESETS.map(p =>
              h('button', { class: 'preset', style: { background: p.bg, color: contrast(p.bg), 'border-color': p.accent },
                onclick: () => setColors({ accent: p.accent, bg: p.bg }) },
              h('i', { style: { background: p.accent } }), p.name)))),
          h('div', { class: 'row' },
            h('label', { class: 'color' }, accentIn, 'Akzentfarbe'),
            h('label', { class: 'color' }, bgIn, 'Hintergrund')),
          h('p', { class: 'hint' }, 'Die Farbe einzelner Boards und Jingles wird im Bearbeiten-Modus gewählt.')),
        h('section', {}, h('h3', {}, 'Songs und Boards'),
          data,
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn primary', onclick: () => { dlg.close(); pickFiles(S.activeBoard); } }, 'Dateien importieren'),
            h('button', { class: 'btn', onclick: () => { dlg.close(); runExport(); } }, 'Paket exportieren')),
          h('p', { class: 'hint' }, 'Importieren: Paket (.zip), soundboard.json oder einzelne Songs (MP3, M4A, WAV – ohne Kopierschutz). Exportieren: erzeugt ein Paket mit allen Boards, Ausschnitten und Songs – als Sicherung oder zur Weitergabe an andere.')),
        h('section', {}, h('h3', {}, 'Hilfe'),
          h('p', { class: 'hint' }, 'Antippen startet einen Jingle, erneutes Antippen stoppt ihn. Es läuft immer nur ein Jingle. „Bearbeiten“ oben rechts öffnet den Modus zum Ändern von Ausschnitt, Beschriftung, Farbe und Reihenfolge.'),
          h('div', { class: 'row wrap' },
            h('a', { class: 'btn', href: 'ANLEITUNG.html', target: '_blank', rel: 'noopener' }, 'Kurzanleitung öffnen'),
            h('button', { class: 'btn', onclick: () => {
              audio.beep().catch(() => {}).then(() => setTimeout(() => { diag.textContent = `Version ${APP_VERSION} · ${audio.status()} · ${wakeStatus()}`; }, 300));
            } }, '🔊 Testton')),
          diag),
        h('section', {},
          h('button', { class: 'btn danger', onclick: async () => {
            if (await confirmDelete('Wirklich alles löschen?', 'Alle Boards, Jingles, Songs und Einstellungen werden von diesem Gerät entfernt. Das lässt sich nicht rückgängig machen – exportieren Sie vorher ein Paket, wenn Sie die Sammlung behalten möchten.')) {
              await model.wipe();
              audio.clearCache();
              editMode = false;
              applyTheme(S.settings);
              dlg.close();
            }
          } }, 'Alles auf diesem Gerät löschen')))));
  dlg.addEventListener('close', () => { dlg.remove(); render(); });
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- Start ----------

// Bildschirm anlassen, solange die App sichtbar ist. iOS gibt die Sperre beim App-Wechsel
// oder ohne ersichtlichen Grund frei; sie wird deshalb bei jeder Berührung erneut angefordert.
let wakeLock = null, wakePending = false;
async function keepAwake() {
  if (wakeLock || wakePending || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  wakePending = true;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
  wakePending = false;
}
const wakeStatus = () => (!('wakeLock' in navigator) ? 'Bildschirm anlassen: vom Gerät nicht unterstützt'
  : wakeLock ? 'Bildschirm bleibt an' : 'Bildschirm anlassen: nicht aktiv');

async function start() {
  try {
    await model.load();
  } catch (e) {
    root.replaceChildren(h('main', { class: 'welcome' }, h('h2', {}, 'Speicher nicht verfügbar'),
      h('p', {}, 'Der Browser erlaubt dieser Seite keinen lokalen Speicher (z. B. im privaten Modus). Bitte die Seite in einem normalen Browserfenster öffnen.')));
    return;
  }
  applyTheme(S.settings);
  render();
  requestAnimationFrame(frame);
  keepAwake();
  document.addEventListener('visibilitychange', keepAwake);
  document.addEventListener('pointerdown', keepAwake, true);
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    if (files.length) { importBoard = S.activeBoard; runImport(files); }
  });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

window.turniersounds = { model, audio, runImport };
start();
