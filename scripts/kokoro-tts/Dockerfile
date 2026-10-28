# Kokoro TTS Server - CPU-only, OpenAI /v1/audio/speech compatible
# Uses @huggingface/transformers StyleTextToSpeech2Model directly (no kokoro-js)
# Model: onnx-community/Kokoro-82M-v1.0-ONNX (82M params, supports 100+ voices)
FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

COPY package*.json ./

RUN npm install --production \
    && npm cache clean --force

# The ~310MB ONNX model is NOT baked into the image. transformers.js caches
# under its own package dir (node_modules/@huggingface/transformers/.cache);
# mount a named volume there (see docker-compose.yml) so the first start's
# download from $HF_ENDPOINT survives container recreation.
COPY server.js ./

EXPOSE 8004

ENV NODE_ENV=production
ENV PORT=8004
ENV MODEL=onnx-community/Kokoro-82M-v1.0-ONNX
ENV DEFAULT_VOICE=af_heart
ENV HF_ENDPOINT=https://hf-mirror.com

CMD ["node", "server.js"]
