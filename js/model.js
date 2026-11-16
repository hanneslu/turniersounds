// Datenmodell: Boards, Jingles ("tracks"), Audiodateien, Einstellungen.
// Das Format von boards/tracks entspricht der soundboard.json von Soundboard Studio,
// damit bestehende Sammlungen direkt übernommen werden können.

import * as store from './store.js';
import { crc32Blob, makeZip, readZip } from './zip.js';
import { decodeBlob } from './audio.js';

export const DEFAULTS = { appName: 'Turniersounds', accent: '#bf0fdc', bg: '#1c1c1e' };
export const state = { boards: {}, tracks: {}, files: {}, settings: { ...DEFAULTS }, activeBoard: null };

export const norm = s => String(s || '').normalize('NFC');
const AUDIO_RE = /\.(mp3|m4a|mp4|aac|wav|aif|aiff|caf|flac|ogg|oga|opus)$/i;
const MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  aif: 'audio/aiff', aiff: 'audio/aiff', caf: 'audio/x-caf', flac: 'audio/flac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
};
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const rid = p => p + '-' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => CHARS[b & 63]).join('');
const baseName = n => n.split(/[\\/]/).pop();

// ---------- Laden & Speichern ----------

export async function load() {
  const [sb, st, fi, ab, keys] = await Promise.all([
    store.get('soundboard'), store.get('settings'), store.get('files'),
    store.get('activeBoard'), store.fileKeys(),
  ]);
  if (sb) { state.boards = sb.boards || {}; state.tracks = sb.tracks || {}; }
  if (st) Object.assign(state.settings, st);
  // Dateiindex mit tatsächlich gespeicherten Dateien abgleichen
  const index = fi || {};
  state.files = {};
  for (const k of keys) {
    if (index[k]) { state.files[k] = index[k]; continue; }
    const rec = await store.getFile(k);
    if (rec) state.files[k] = { size: rec.size, crc: rec.crc, type: rec.type };
  }
  state.activeBoard = ab;
  fixActive();
}

export const saveBoards = () => store.set('soundboard', { boards: state.boards, tracks: state.tracks });
export const saveSettings = () => store.set('settings', state.settings);
const saveFiles = () => store.set('files', state.files);

function fixActive() {
  if (!state.boards[state.activeBoard]) {
    const first = boardsSorted()[0];
    state.activeBoard = first ? first.id : null;
  }
}

export function setActive(id) {
  state.activeBoard = id;
  store.set('activeBoard', id);
}

// ---------- Abfragen ----------

export const boardsSorted = () => Object.values(state.boards).sort((a, b) => (a.order || 0) - (b.order || 0));
export const tracksOf = id => Object.values(state.tracks).filter(t => t.board === id)
  .sort((a, b) => (a.order || 0) - (b.order || 0));
export const hasFile = t => !!state.files[norm(t.file)];
export const getBlob = async name => { const r = await store.getFile(norm(name)); return r ? r.blob : null; };
const usedKeys = () => new Set(Object.values(state.tracks).map(t => norm(t.file)));
export const missingFiles = () => [...usedKeys()].filter(k => !state.files[k]).sort();
export const unusedFiles = () => { const u = usedKeys(); return Object.keys(state.files).filter(k => !u.has(k)); };
export const storageBytes = () => Object.values(state.files).reduce((s, f) => s + (f.size || 0), 0);

// ---------- Boards ----------

export function addBoard(title, colorScheme) {
  const id = rid('board');
  state.boards[id] = { id, title: title || 'Neues Board', colorScheme: colorScheme || 'purple', order: boardsSorted().length };
  setActive(id);
  saveBoards();
  return state.boards[id];
}

function reorder(list, id, dir) {
  const i = list.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((x, n) => { x.order = n; });
  saveBoards();
}

export const moveBoard = (id, dir) => reorder(boardsSorted(), id, dir);
export const moveTrack = (id, dir) => reorder(tracksOf(state.tracks[id].board), id, dir);

export async function deleteBoard(id) {
  const files = tracksOf(id).map(t => { delete state.tracks[t.id]; return t.file; });
  delete state.boards[id];
  fixActive();
  await saveBoards();
  await pruneFiles(files);
}

// ---------- Jingles ----------

export function moveTrackToBoard(id, boardId) {
  const t = state.tracks[id];
  if (!t || t.board === boardId) return;
  t.order = tracksOf(boardId).length;
  t.board = boardId;
  saveBoards();
}

export async function deleteTrack(id) {
  const t = state.tracks[id];
  if (!t) return;
  delete state.tracks[id];
  await saveBoards();
  await pruneFiles([t.file]);
}

// Audiodateien entfernen, die von keinem Jingle mehr verwendet werden.
async function pruneFiles(names) {
  const used = usedKeys();
  for (const k of new Set(names.map(norm))) {
    if (used.has(k) || !state.files[k]) continue;
    await store.delFile(k);
    delete state.files[k];
  }
  await saveFiles();
}

export const removeUnused = () => pruneFiles(unusedFiles());

export async function wipe() {
  await store.clearAll();
  state.boards = {}; state.tracks = {}; state.files = {};
  state.settings = { ...DEFAULTS }; state.activeBoard = null;
}

// ---------- Import ----------

function applySoundboard(data, mode, sum) {
  const boards = Object.values(data.boards || {}).filter(b => b && b.id);
  const tracks = Object.values(data.tracks || {}).filter(t => t && t.id && t.file && data.boards[t.board]);
  if (mode === 'replace') {
    state.boards = {}; state.tracks = {};
    const s = data.turniersounds && data.turniersounds.settings;
    if (s) { Object.assign(state.settings, s); saveSettings(); }
  }
  const shift = boardsSorted().length;
  for (const b of boards) {
    const isNew = !state.boards[b.id];
    state.boards[b.id] = { ...b, order: isNew ? (b.order || 0) + shift : state.boards[b.id].order };
  }
  for (const t of tracks) state.tracks[t.id] = { ...t };
  boardsSorted().forEach((b, n) => { b.order = n; });
  sum.boards += boards.length;
  sum.tracks += tracks.length;
  fixActive();
}

// files: FileList/Array aus Dateiauswahl. Akzeptiert Paket (.zip), soundboard.json und Audiodateien.
// opts: { boardId, askMode(): 'replace'|'add'|null, onProgress(done, total, name) }
export async function importFiles(files, opts = {}) {
  const sum = { boards: 0, tracks: 0, audio: 0, newPads: 0, failed: [], ignored: 0 };
  const items = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      for (const e of await readZip(f)) {
        const name = baseName(e.name);
        if (e.name.startsWith('__MACOSX/') || name.startsWith('.')) continue;
        items.push({ name, get: () => e.blob() });
      }
    } else {
      items.push({ name: f.name, get: async () => f });
    }
  }

  // 1. Board-Daten (soundboard.json)
  for (const it of items.filter(i => /\.json$/i.test(i.name))) {
    let data;
    try { data = JSON.parse(await (await it.get()).text()); } catch { continue; }
    if (!data || typeof data.boards !== 'object' || typeof data.tracks !== 'object') continue;
    let mode = 'replace';
    if (Object.keys(state.boards).length && opts.askMode) {
      mode = await opts.askMode();
      if (!mode) return null;
    }
    applySoundboard(data, mode, sum);
    await saveBoards();
    break;
  }

  // 2. Audiodateien
  const audio = items.filter(i => AUDIO_RE.test(i.name));
  sum.ignored = items.length - audio.length - (sum.boards ? 1 : 0);
  let done = 0;
  for (const it of audio) {
    if (opts.onProgress) opts.onProgress(done++, audio.length, it.name);
    const key = norm(it.name);
    try {
      let blob = await it.get();
      const ext = key.split('.').pop().toLowerCase();
      if (!blob.type) blob = new Blob([blob], { type: MIME[ext] || 'application/octet-stream' });
      const referenced = Object.values(state.tracks).some(t => norm(t.file) === key);
      let duration = 0;
      if (!referenced) {
        // Neuer Song: prüfen, ob er abspielbar ist (kopiergeschützte Dateien scheitern hier).
        duration = (await decodeBlob(blob)).duration;
      }
      const rec = { name: key, type: blob.type, size: blob.size, crc: await crc32Blob(blob), blob };
      await store.putFile(key, rec);
      state.files[key] = { size: rec.size, crc: rec.crc, type: rec.type };
      sum.audio++;
      if (!referenced) {
        let boardId = state.boards[opts.boardId] ? opts.boardId : state.activeBoard;
        if (!state.boards[boardId]) boardId = addBoard('Board 1').id;
        const id = rid('track');
        state.tracks[id] = {
          id, trackType: 'track', title: key.replace(/\.[^.]+$/, ''), file: key,
          board: boardId, order: tracksOf(boardId).length,
          colorScheme: state.boards[boardId].colorScheme,
          fullDuration: duration, trimInPoint: 0, trimOutPoint: duration,
          volume: 1, fadesIn: false, fadesInDuration: 0.2, fadesOut: true, fadesOutDuration: 1,
        };
        sum.newPads++;
      }
    } catch (e) {
      sum.failed.push(it.name);
    }
  }
  await saveFiles();
  await saveBoards();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  return sum;
}

// ---------- Export ----------

export async function exportPackage() {
  const json = JSON.stringify({
    boards: state.boards, tracks: state.tracks,
    turniersounds: { version: 1, settings: state.settings },
  }, null, 2);
  const entries = [{ name: 'soundboard.json', blob: new Blob([json], { type: 'application/json' }) }];
  for (const k of [...usedKeys()].sort()) {
    if (!state.files[k]) continue;
    const rec = await store.getFile(k);
    if (rec) entries.push({ name: k, blob: rec.blob, crc: rec.crc });
  }
  const blob = await makeZip(entries);
  const day = new Date().toISOString().slice(0, 10);
  const safe = state.settings.appName.replace(/[^\w\-äöüÄÖÜß]+/g, '-') || 'Turniersounds';
  return new File([blob], `${safe}-Paket-${day}.zip`, { type: 'application/zip' });
}
