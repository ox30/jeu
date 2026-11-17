// Sounds, all made in the browser (no recorded files): the alert signal, radio squelch,
// machine-gun bursts and distant bombs. Browsers only allow sound after a user gesture, so
// the audio context is created on the first click or key press.

const MIN_GAP_MS = { alarm: 1500, notice: 1500, radio: 350, guns: 500, bombs: 900 };

export function unlockAudio(app) {
  if (app.audio || typeof AudioContext === 'undefined') return;
  try {
    app.audio = new AudioContext();
    app.soundLast = {};
  } catch {
    app.audio = null;
  }
}

function ready(app, kind) {
  const ctx = app.audio;
  if (!ctx || !app.settings.sound) return null;
  if (ctx.state === 'suspended') ctx.resume();
  const now = performance.now();
  if (now - (app.soundLast[kind] || 0) < MIN_GAP_MS[kind]) return null;
  app.soundLast[kind] = now;
  return ctx;
}

function noiseBuffer(app) {
  if (app.noise) return app.noise;
  const ctx = app.audio;
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    data[i] = (seed / 2147483647) * 2 - 1;
  }
  app.noise = buffer;
  return buffer;
}

function burst(app, at, duration, { type = 'bandpass', freq = 1000, q = 1, gain = 0.05, endFreq = null } = {}) {
  const ctx = app.audio;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(app);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, at);
  if (endFreq) filter.frequency.exponentialRampToValueAtTime(endFreq, at + duration);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.01, duration / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(at, Math.random() * 0.5);
  src.stop(at + duration + 0.02);
}

function tone(app, at, duration, freq, gain, type = 'sine') {
  const ctx = app.audio;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

/** Two-tone alert, as in an operations room. */
export function playAlarm(app) {
  const ctx = ready(app, 'alarm');
  if (!ctx) return;
  const now = ctx.currentTime;
  [[880, 0], [660, 0.22], [880, 0.44], [660, 0.66]].forEach(([freq, at]) => tone(app, now + at, 0.18, freq, 0.05, 'square'));
}

/** A softer signal for an alert that needs a decision, not an immediate reaction. */
export function playNotice(app) {
  const ctx = ready(app, 'notice');
  if (!ctx) return;
  const now = ctx.currentTime;
  tone(app, now, 0.22, 740, 0.04);
  tone(app, now + 0.2, 0.3, 988, 0.035);
}

/** Radio-telephone squelch before a message from a squadron. */
export function playRadio(app) {
  const ctx = ready(app, 'radio');
  if (!ctx) return;
  const now = ctx.currentTime;
  burst(app, now, 0.16, { freq: 1900, q: 1.2, gain: 0.035 });
  tone(app, now + 0.17, 0.06, 1250, 0.02);
  burst(app, now + 0.25, 0.08, { freq: 2400, q: 2, gain: 0.02 });
}

/** Distant machine-gun bursts during a round of combat. */
export function playGuns(app) {
  const ctx = ready(app, 'guns');
  if (!ctx) return;
  const now = ctx.currentTime;
  for (let b = 0; b < 2; b++) {
    const start = now + b * 0.55 + Math.random() * 0.1;
    const shots = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < shots; i++) burst(app, start + i * 0.07, 0.035, { freq: 700 + Math.random() * 300, q: 0.8, gain: 0.05 });
  }
}

/** Distant bombs on an installation. */
export function playBombs(app) {
  const ctx = ready(app, 'bombs');
  if (!ctx) return;
  const now = ctx.currentTime;
  for (let i = 0; i < 4; i++) {
    const at = now + i * 0.28 + Math.random() * 0.1;
    burst(app, at, 1.1, { type: 'lowpass', freq: 500, endFreq: 90, q: 0.7, gain: 0.09 });
    tone(app, at, 0.4, 55 + Math.random() * 15, 0.06);
  }
}
