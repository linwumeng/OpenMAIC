#!/usr/bin/env node
// scripts/kokoro-tts/server.js
// ─────────────────────────────────────────────────────────────────────────────
// Kokoro TTS server — OpenAI /v1/audio/speech compatible
//
// Uses @huggingface/transformers StyleTextToSpeech2Model directly (no kokoro-js).
// Model: onnx-community/Kokoro-82M-v1.0-ONNX (82M params, CPU-optimized).
// Supports 100+ voices including Chinese (zf_*, zm_*), Japanese (jf_*, jk_*), Korean (kf_*, km_*).
// Expected synthesis time: 0.5–2s per clip.
//
// Protocol:
//   POST /v1/audio/speech   → { model, input, voice, speed, response_format }
//   GET  /models            → kokoro-v1.0
//   GET  /voices            → full voice catalog
//   GET  /health            → ok
//
// Env:
//   PORT            = 8004
//   MODEL           = onnx-community/Kokoro-82M-v1.0-ONNX
//   HF_ENDPOINT     = https://hf-mirror.com
//   DEFAULT_VOICE   = af_heart
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import { StyleTextToSpeech2Model, AutoTokenizer, Tensor, env as hfEnv } from '@huggingface/transformers';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Must be set before any HF Hub calls
process.env.HF_ENDPOINT = process.env.HF_ENDPOINT || 'https://hf-mirror.com';
hfEnv.remoteHost = process.env.HF_ENDPOINT;
hfEnv.allowRemoteModels = true;

const PORT = parseInt(process.env.PORT || '8004', 10);
const MODEL = process.env.MODEL || 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE = process.env.DEFAULT_VOICE || 'zf_xiaoxiao';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

let model = null;
let tokenizer = null;
const voiceCache = new Map();

// ── Kokoro voice catalog (from onnx-community/Kokoro-82M-v1.0-ONNX) ──
const KOKORO_VOICES = {
  // English (American Female)
  af_heart:   { id: 'af_heart',   name: 'Heart',     language: 'en-us', gender: 'female' },
  af_alloy:   { id: 'af_alloy',   name: 'Alloy',     language: 'en-us', gender: 'female' },
  af_aoede:   { id: 'af_aoede',   name: 'Aoede',     language: 'en-us', gender: 'female' },
  af_bella:   { id: 'af_bella',   name: 'Bella',     language: 'en-us', gender: 'female' },
  af_jessica: { id: 'af_jessica', name: 'Jessica',   language: 'en-us', gender: 'female' },
  af_kore:    { id: 'af_kore',    name: 'Kore',      language: 'en-us', gender: 'female' },
  af_nicole:  { id: 'af_nicole',  name: 'Nicole',    language: 'en-us', gender: 'female' },
  af_nova:    { id: 'af_nova',    name: 'Nova',      language: 'en-us', gender: 'female' },
  af_river:   { id: 'af_river',   name: 'River',     language: 'en-us', gender: 'female' },
  af_sarah:   { id: 'af_sarah',   name: 'Sarah',     language: 'en-us', gender: 'female' },
  af_sky:     { id: 'af_sky',     name: 'Sky',       language: 'en-us', gender: 'female' },
  // English (American Male)
  am_adam:    { id: 'am_adam',    name: 'Adam',      language: 'en-us', gender: 'male' },
  am_echo:    { id: 'am_echo',    name: 'Echo',      language: 'en-us', gender: 'male' },
  am_eric:    { id: 'am_eric',    name: 'Eric',      language: 'en-us', gender: 'male' },
  am_fenrir:  { id: 'am_fenrir',  name: 'Fenrir',    language: 'en-us', gender: 'male' },
  am_liam:    { id: 'am_liam',    name: 'Liam',      language: 'en-us', gender: 'male' },
  am_michael: { id: 'am_michael', name: 'Michael',   language: 'en-us', gender: 'male' },
  am_onyx:    { id: 'am_onyx',    name: 'Onyx',      language: 'en-us', gender: 'male' },
  am_puck:    { id: 'am_puck',    name: 'Puck',      language: 'en-us', gender: 'male' },
  am_santa:   { id: 'am_santa',   name: 'Santa',     language: 'en-us', gender: 'male' },
  // English (British Female)
  bf_alice:   { id: 'bf_alice',   name: 'Alice',     language: 'en-gb', gender: 'female' },
  bf_emma:    { id: 'bf_emma',    name: 'Emma',      language: 'en-gb', gender: 'female' },
  bf_isabella:{ id: 'bf_isabella',name: 'Isabella',  language: 'en-gb', gender: 'female' },
  bf_lily:    { id: 'bf_lily',    name: 'Lily',      language: 'en-gb', gender: 'female' },
  // English (British Male)
  bm_daniel:  { id: 'bm_daniel',  name: 'Daniel',    language: 'en-gb', gender: 'male' },
  bm_fable:   { id: 'bm_fable',   name: 'Fable',     language: 'en-gb', gender: 'male' },
  bm_george:  { id: 'bm_george',  name: 'George',    language: 'en-gb', gender: 'male' },
  bm_lewis:   { id: 'bm_lewis',   name: 'Lewis',     language: 'en-gb', gender: 'male' },
  // Chinese (Female)
  zf_xiaobei: { id: 'zf_xiaobei', name: 'Xiaobei',   language: 'zh-cn', gender: 'female' },
  zf_xiaoni:  { id: 'zf_xiaoni',  name: 'Xiaoni',    language: 'zh-cn', gender: 'female' },
  zf_xiaoxiao:{ id: 'zf_xiaoxiao',name: 'Xiaoxiao',  language: 'zh-cn', gender: 'female' },
  // Chinese (Male)
  zm_yunlei:  { id: 'zm_yunlei',  name: 'Yunlei',    language: 'zh-cn', gender: 'male' },
  zm_yunhao:  { id: 'zm_yunhao',  name: 'Yunhao',    language: 'zh-cn', gender: 'male' },
  zm_yunji:   { id: 'zm_yunji',   name: 'Yunji',     language: 'zh-cn', gender: 'male' },
  // Japanese (Female)
  jf_alpha:   { id: 'jf_alpha',   name: 'Alpha',     language: 'ja-jp', gender: 'female' },
  jf_gao:     { id: 'jf_gao',     name: 'Gao',       language: 'ja-jp', gender: 'female' },
  jf_moyori:  { id: 'jf_moyori',  name: 'Moyori',    language: 'ja-jp', gender: 'female' },
  jf_suzume:  { id: 'jf_suzume',  name: 'Suzume',    language: 'ja-jp', gender: 'female' },
  // Japanese (Male)
  jk_kuroha:  { id: 'jk_kuroha',  name: 'Kuroha',    language: 'ja-jp', gender: 'male' },
  jk_prota:   { id: 'jk_prota',   name: 'Prota',     language: 'ja-jp', gender: 'male' },
  // Korean (Female)
  kf_hiona:   { id: 'kf_hiona',   name: 'Hiona',     language: 'ko-kr', gender: 'female' },
  // Korean (Male)
  km_inoon:   { id: 'km_inoon',   name: 'Inoon',     language: 'ko-kr', gender: 'male' },
  km_jiyeoob: { id: 'km_jiyeoob', name: 'Jiyeob',    language: 'ko-kr', gender: 'male' },
};

const VOICE_LIST = Object.entries(KOKORO_VOICES).map(([id, info]) => ({
  id, name: info.name, language: info.language, gender: info.gender,
}));

const NAME_ALIASES = {
  '中文女': 'zf_xiaoxiao', '中文男': 'zm_yunlei',
  'xiaoxiao': 'zf_xiaoxiao', 'xiaoyi': 'zf_xiaoyi',
  'yunlei': 'zm_yunlei', 'heart': 'af_heart',
  'bella': 'af_bella', 'kore': 'af_kore', 'sky': 'af_sky',
  'sarah': 'af_sarah', 'adam': 'am_adam', 'eric': 'am_eric',
  'michael': 'am_michael', 'onyx': 'am_onyx',
};

function resolveVoice(inputVoice) {
  if (!inputVoice) return DEFAULT_VOICE;
  const v = inputVoice.toLowerCase().trim();
  if (KOKORO_VOICES[v]) return v;
  if (NAME_ALIASES[v]) return NAME_ALIASES[v];
  for (const [id, info] of Object.entries(KOKORO_VOICES)) {
    if (info.name.toLowerCase() === v) return id;
    if (id.toLowerCase() === v) return id;
  }
  return DEFAULT_VOICE;
}

function speedToRate(speed) {
  return Math.max(0.5, Math.min(2.0, speed || 1.0));
}

// Load voice style vector from .bin file (256-dim float32)
async function loadVoiceStyle(voiceId) {
  if (voiceCache.has(voiceId)) return voiceCache.get(voiceId);

  let buf;
  // First try loading from local voices/ directory (bundled with package)
  try {
    const path = resolve(__dirname, 'voices', `${voiceId}.bin`);
    buf = await readFile(path);
  } catch {
    // Fall back to fetching from HF Hub
    const url = `${process.env.HF_ENDPOINT}/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${voiceId}.bin`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load voice ${voiceId}: ${resp.status}`);
    buf = Buffer.from(await resp.arrayBuffer());
  }

  // Convert Float32 binary data to Float32Array (little-endian)
  const floatCount = buf.length / 4;
  const float32 = new Float32Array(floatCount);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < floatCount; i++) {
    float32[i] = view.getFloat32(i * 4, true);
  }
  voiceCache.set(voiceId, float32);
  return float32;
}

// ── Routes ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'kokoro-tts',
    voices: VOICE_LIST.length,
    model: MODEL,
    ready: model !== null,
  });
});

app.get('/models', (_req, res) => {
  res.json({ data: [{ id: MODEL, name: 'Kokoro 82M v1.0' }] });
});

app.get('/voices', (_req, res) => {
  res.json({ data: VOICE_LIST });
});

// Accept both /audio/speech and /v1/audio/speech for OpenAI-compatible clients.
// Lemonade TTS client concatenates ${baseUrl}/audio/speech, while some callers
// pass baseUrl ending in /v1 — handle both gracefully.
app.post('/audio/speech', (req, res) => generateSpeech(req, res));
app.post('/v1/audio/speech', (req, res) => generateSpeech(req, res));

async function generateSpeech(req, res) {
  const t0 = Date.now();
  const { model: _model, input, voice, speed, response_format = 'wav' } = req.body;
  if (!input) return res.status(400).json({ error: { message: 'input is required' } });

  try {
    const voiceId = resolveVoice(voice);
    const rate = speedToRate(speed);

    // 1) Tokenize text
    const tokenized = await tokenizer(input, { truncation: true });
    const inputIds = tokenized.input_ids;

    // 2) Load voice style vector (256-dim) from .bin file
    const voiceStyle = await loadVoiceStyle(voiceId);
    // Style vector is sliced based on token length (see kokoro-js implementation)
    const L = 256 * Math.min(Math.max(inputIds.dims.at(-1) - 2, 0), 509);
    const styleData = voiceStyle.slice(L, L + 256);
    const styleTensor = new Tensor('float32', styleData, [1, 256]);
    const speedTensor = new Tensor('float32', new Float32Array([rate]), [1]);

    // 3) Synthesize — call model directly (not .generate())
    const out = await model({
      input_ids: inputIds,
      style: styleTensor,
      speed: speedTensor,
    });
    const waveform = out.waveform.data;

    // 4) Convert Float32 → Int16 PCM (little-endian), then wrap in WAV header
    const pcm = new Int16Array(waveform.length);
    for (let i = 0; i < waveform.length; i++) {
      const s = Math.max(-1, Math.min(1, waveform[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Build WAV file header (44 bytes)
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcm.byteLength;
    const fileSize = 36 + dataSize; // 4 (RIFF) + 4 (fileSize-8) + 4 ("WAVE") + 32 (fmt chunk) + dataSize

    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    let offset = 0;
    // RIFF header
    view.setUint32(offset, 0x46464952, true); offset += 4; // "RIFF"
    view.setUint32(offset, fileSize - 8, true); offset += 4;
    view.setUint32(offset, 0x45564157, true); offset += 4; // "WAVE"
    // fmt chunk
    view.setUint32(offset, 0x20746d66, true); offset += 4; // "fmt "
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2; // PCM
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, byteRate, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, bitsPerSample, true); offset += 2;
    // data chunk
    view.setUint32(offset, 0x61746164, true); offset += 4; // "data"
    view.setUint32(offset, dataSize, true); offset += 4;

    const bytes = Buffer.concat([Buffer.from(wavHeader), Buffer.from(pcm.buffer)]);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[kokoro-tts] synth ok voice=${voiceId} speed=${rate} chars=${input.length} elapsed=${elapsed}s size=${bytes.length}`);

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="speech.wav"`);
    res.end(bytes);
  } catch (err) {
    console.error('[kokoro-tts] synth error:', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
}

// ── Startup ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`[kokoro-tts] loading ${MODEL}...`);
  try {
    model = await StyleTextToSpeech2Model.from_pretrained(MODEL, { dtype: 'fp32' });
    tokenizer = await AutoTokenizer.from_pretrained(MODEL);
    console.log(`[kokoro-tts] loaded ${VOICE_LIST.length} voices`);
  } catch (err) {
    console.error('[kokoro-tts] failed to load model:', err.message);
    process.exit(1);
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[kokoro-tts] listening on :${PORT}`);
  });
}

main();
