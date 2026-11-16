// Wiedergabe über die Web Audio API.
// Pro Jingle wird nur der zugeschnittene Ausschnitt dekodiert im Speicher gehalten,
// damit er beim Antippen ohne Verzögerung startet.

//
// Wichtig für iPhone/iPad: Der Wiedergabe-Kontext darf erst bei einer Berührung des Nutzers
// entstehen und muss in derselben Berührung "entsperrt" werden, sonst bleibt er stumm.
// Dekodiert wird deshalb über einen getrennten Offline-Kontext, der keine Berührung braucht.

let ctx = null;         // Wiedergabe (entsteht bei der ersten Berührung)
let decodeCtx = null;   // nur zum Dekodieren
let silentEl = null;
let needsFresh = false; // Tonausgabe bei der nächsten Berührung neu anlegen

const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function silentWavUrl() {
  const n = 4000, b = new ArrayBuffer(44 + n), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(b, 44).fill(128);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

// Muss innerhalb einer Nutzer-Berührung aufgerufen werden.
export function ensureCtx() {
  // Nach App-Wechsel, Sperrbildschirm oder Anruf liefert iOS oft eine "tote" Tonausgabe,
  // die sich nicht wieder aufwecken lässt. Dann wird sie verworfen und neu angelegt.
  // Die vorbereiteten Jingles bleiben erhalten, weil sie nicht an der Tonausgabe hängen.
  if (ctx && (needsFresh || ctx.state === 'interrupted' || ctx.state === 'closed')) {
    const old = ctx, v = current;
    ctx = null;
    current = null;
    old.onstatechange = null;
    try { old.close().catch(() => {}); } catch { /* egal */ }
    if (v && v.onEnd) v.onEnd();
  }
  needsFresh = false;
  if (silentEl && silentEl.paused) silentEl.play().catch(() => {});
  if (!ctx) {
    // iOS: als Medienwiedergabe anmelden, damit der Stummschalter den Ton nicht unterdrückt.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* egal */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    ctx.onstatechange = () => {
      // Wird die Wiedergabe vom System unterbrochen (Anruf, App-Wechsel), Anzeige zurücksetzen.
      if (ctx.state !== 'running' && current) {
        const v = current;
        current = null;
        try { v.src.stop(); } catch { /* egal */ }
        if (v.onEnd) v.onEnd();
      }
    };
  }
  if (ctx.state !== 'running') {
    ctx.resume().catch(() => {});
    // Stiller Klang innerhalb der Berührung: entsperrt die Tonausgabe auf iOS zuverlässig.
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch { /* egal */ }
  }
  // Ältere iOS-Versionen ohne audioSession: stilles Audio-Element erzwingt die Medienwiedergabe.
  if (IS_IOS && !navigator.audioSession && !silentEl) {
    try {
      silentEl = new Audio(silentWavUrl());
      silentEl.loop = true;
      silentEl.play().catch(() => {});
    } catch { /* egal */ }
  }
  return ctx;
}

// Jede Berührung versucht, eine unterbrochene Tonausgabe wieder aufzunehmen.
for (const ev of ['touchend', 'click', 'keydown']) {
  document.addEventListener(ev, () => { if (!ctx || needsFresh || ctx.state !== 'running') ensureCtx(); }, true);
}
// War die App im Hintergrund, wird die Tonausgabe auf iOS bei der nächsten Berührung erneuert.
const wentAway = () => { if (IS_IOS && ctx) needsFresh = true; };
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') wentAway(); });
window.addEventListener('pagehide', wentAway);

function getDecodeCtx() {
  if (!decodeCtx) {
    const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    decodeCtx = new OC(2, 44100, 44100);
  }
  return decodeCtx;
}

export function decodeBlob(blob) {
  const c = getDecodeCtx();
  return blob.arrayBuffer().then(ab => new Promise((res, rej) => {
    const p = c.decodeAudioData(ab, res, rej);
    if (p && p.catch) p.catch(rej);
  }));
}

// Erzwingt bei der nächsten Berührung eine neue Tonausgabe.
export function refresh() { if (ctx) needsFresh = true; }

// Für die Fehlersuche (Einstellungen → Hilfe).
export function status() {
  const session = navigator.audioSession ? navigator.audioSession.type : 'nicht vorhanden';
  return ctx
    ? `Tonausgabe: ${ctx.state}, ${ctx.sampleRate} Hz · Audio-Session: ${session}`
    : `Tonausgabe: noch nicht gestartet · Audio-Session: ${session}`;
}

// Kurzer Testton, unabhängig von importierten Songs.
export function beep() {
  const c = ensureCtx();
  const start = () => {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 880;
    o.connect(g); g.connect(c.destination);
    const t = c.currentTime + 0.02;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.02);
    g.gain.linearRampToValueAtTime(0, t + 0.5);
    o.start(t); o.stop(t + 0.55);
  };
  if (c.state === 'running') { start(); return Promise.resolve(); }
  return Promise.race([c.resume(), new Promise((_, rej) => setTimeout(rej, 1500))])
    .then(start, () => { needsFresh = true; });
}

// ---------- Ausschnitt-Cache ----------

const CACHE_SECONDS = 600;          // Obergrenze dekodierter Audiosekunden im Speicher
const cache = new Map();            // trackId -> { key, buffer, used }
const pending = new Map();          // trackId -> { key, promise, job }
const queue = [];
let busy = false, tick = 0;

const clipKey = t => `${t.file}|${t.trimInPoint || 0}|${t.trimOutPoint || 0}`;
const clipLen = t => Math.max(0, (t.trimOutPoint || t.fullDuration || 0) - (t.trimInPoint || 0));
const cachedSeconds = () => [...cache.values()].reduce((s, c) => s + c.buffer.duration, 0);

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try { await job(); } catch { /* Fehler landet im Promise des Jobs */ }
  }
  busy = false;
}

function evict(keepId) {
  let total = cachedSeconds();
  const byAge = [...cache.entries()].sort((a, b) => a[1].used - b[1].used);
  for (const [id, c] of byAge) {
    if (total <= CACHE_SECONDS) break;
    if (id === keepId) continue;
    cache.delete(id);
    total -= c.buffer.duration;
  }
}

function slice(full, from, to) {
  const sr = full.sampleRate;
  const s = Math.min(full.length - 1, Math.max(0, Math.floor((from || 0) * sr)));
  let e = Math.min(full.length, Math.ceil((to || 0) * sr));
  if (e <= s) e = full.length;
  const buf = getDecodeCtx().createBuffer(full.numberOfChannels, e - s, sr);
  for (let ch = 0; ch < full.numberOfChannels; ch++) {
    buf.copyToChannel(full.getChannelData(ch).subarray(s, e), ch);
  }
  return buf;
}

// Liefert den dekodierten Ausschnitt eines Tracks. high = sofort (Nutzer hat getippt).
export function getClip(track, getBlob, high) {
  const key = clipKey(track);
  const c = cache.get(track.id);
  if (c && c.key === key) { c.used = ++tick; return Promise.resolve(c.buffer); }
  const p = pending.get(track.id);
  if (p && p.key === key) {
    if (high) {
      p.job.cancelled = false;
      const i = queue.indexOf(p.job);
      if (i > 0) { queue.splice(i, 1); queue.unshift(p.job); }
    }
    return p.promise;
  }
  const rec = { key };
  rec.promise = new Promise((res, rej) => {
    rec.job = async () => {
      try {
        if (rec.job.cancelled) throw new Error('abgebrochen');
        const blob = await getBlob(track.file);
        if (!blob) throw new Error('Datei fehlt');
        const full = await decodeBlob(blob);
        const buffer = slice(full, track.trimInPoint, track.trimOutPoint);
        cache.set(track.id, { key, buffer, used: ++tick });
        evict(track.id);
        res(buffer);
      } catch (e) {
        rej(e);
      } finally {
        if (pending.get(track.id) === rec) pending.delete(track.id);
      }
    };
  });
  rec.promise.catch(() => {});
  pending.set(track.id, rec);
  if (high) queue.unshift(rec.job); else queue.push(rec.job);
  pump();
  return rec.promise;
}

// Lädt die Jingles des sichtbaren Boards im Hintergrund vor.
export function preload(tracks, getBlob) {
  for (const p of pending.values()) if (queue.includes(p.job)) p.job.cancelled = true;
  let budget = CACHE_SECONDS;
  for (const t of tracks) {
    const len = clipLen(t);
    if (len > budget) continue;
    budget -= len;
    const c = cache.get(t.id);
    if (c && c.key === clipKey(t)) { c.used = ++tick; continue; }
    const p = pending.get(t.id);
    if (p && p.key === clipKey(t)) { p.job.cancelled = false; continue; }
    getClip(t, getBlob, false);
  }
}

export function clearCache() {
  cache.clear();
}

// ---------- Wiedergabe (immer nur ein Klang gleichzeitig) ----------

let current = null;
let playSeq = 0;

export async function playBuffer(buffer, o) {
  const c = ensureCtx();
  stop(0.1);
  const seq = ++playSeq;
  if (c.state !== 'running') {
    // Tonausgabe ist noch gesperrt oder unterbrochen: kurz auf die Freigabe warten.
    await Promise.race([c.resume().catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
    if (seq !== playSeq) return;
    if (c.state !== 'running') { needsFresh = true; throw new Error('Tonausgabe gesperrt'); }
  }
  const offset = Math.max(0, o.offset || 0);
  const duration = Math.max(0.05, Math.min(o.duration || buffer.duration, buffer.duration - offset));
  const vol = o.volume == null ? 1 : o.volume;
  const fi = Math.min(o.fadeIn || 0, duration / 2);
  const fo = Math.min(o.fadeOut || 0, duration / 2);
  const src = c.createBufferSource();
  const env = c.createGain();     // geplante Ein-/Ausblendung
  const gate = c.createGain();    // manuelles Stoppen/Ausblenden
  src.buffer = buffer;
  src.connect(env); env.connect(gate); gate.connect(c.destination);
  const t0 = c.currentTime + 0.02;
  env.gain.setValueAtTime(fi > 0 ? 0 : vol, t0);
  if (fi > 0) env.gain.linearRampToValueAtTime(vol, t0 + fi);
  if (fo > 0) {
    env.gain.setValueAtTime(vol, t0 + duration - fo);
    env.gain.linearRampToValueAtTime(0, t0 + duration);
  }
  const voice = { id: o.id, src, gate, t0, duration, offset, onEnd: o.onEnd };
  src.onended = () => {
    try { gate.disconnect(); } catch { /* egal */ }
    if (current === voice) { current = null; if (voice.onEnd) voice.onEnd(); }
  };
  src.start(t0, offset, duration);
  current = voice;
}

export function stop(fade) {
  playSeq++;
  const v = current;
  if (!v) return;
  current = null;
  const now = ctx.currentTime;
  const f = Math.max(0.03, fade || 0);
  v.gate.gain.setValueAtTime(1, now);
  v.gate.gain.linearRampToValueAtTime(0, now + f);
  try { v.src.stop(now + f + 0.02); } catch { /* bereits beendet */ }
  if (v.onEnd) v.onEnd();
}

export const currentId = () => (current ? current.id : null);

export function position() {
  if (!current) return null;
  const elapsed = Math.min(current.duration, Math.max(0, ctx.currentTime - current.t0));
  return { id: current.id, elapsed, duration: current.duration, offset: current.offset };
}
