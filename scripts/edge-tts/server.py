"""
Edge TTS Server — OpenAI /v1/audio/speech compatible
Uses Microsoft Edge TTS (edge-tts) for high-quality Chinese TTS.
"""
import asyncio
import io
import json
import os
import tempfile

import edge_tts
import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

app = FastAPI(title="Edge TTS Server")

DEFAULT_VOICE = os.environ.get("DEFAULT_VOICE", "zh-CN-XiaoxiaoNeural")
SAMPLE_RATE = 24000


@app.get("/health")
async def health():
    return {"status": "ok", "service": "edge-tts", "voice": DEFAULT_VOICE}


async def _generate(text: str, voice: str):
    communicate = edge_tts.Communicate(text=text, voice=voice)

    # edge-tts save() requires a file path, so use a temp file
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp_path = tmp.name
        await communicate.save(tmp_path)

        # Read MP3 and convert to float32
        data, samplerate = sf.read(tmp_path, dtype="float32")

        # Resample to 24000 Hz
        if samplerate != SAMPLE_RATE:
            from scipy.signal import resample_poly
            factor = SAMPLE_RATE // samplerate
            data = resample_poly(data, factor, 1)

        # Convert to WAV in memory
        wav_buffer = io.BytesIO()
        sf.write(wav_buffer, data, SAMPLE_RATE, format="wav")
        wav_buffer.seek(0)

        return StreamingResponse(
            wav_buffer,
            media_type="audio/wav",
            headers={"Content-Disposition": 'attachment; filename="speech.wav"'},
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _parse_json_body(body_bytes: bytes) -> dict:
    """Parse JSON body safely, handling UTF-8 encoding."""
    try:
        return json.loads(body_bytes.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")


@app.post("/audio/speech")
async def speech(request: Request):
    body = _parse_json_body(await request.body())
    text = body.get("input") or body.get("text") or ""
    voice = body.get("voice", DEFAULT_VOICE)
    if not text:
        raise HTTPException(status_code=400, detail="input is required")
    return await _generate(text, voice)


@app.post("/v1/audio/speech")
async def speech_v1(request: Request):
    body = _parse_json_body(await request.body())
    text = body.get("input") or body.get("text") or ""
    voice = body.get("voice", DEFAULT_VOICE)
    if not text:
        raise HTTPException(status_code=400, detail="input is required")
    return await _generate(text, voice)


@app.get("/voices")
async def voices():
    return {
        "data": [
            {"id": "zh-CN-XiaoxiaoNeural", "name": "晓晓", "language": "zh-CN", "gender": "female"},
            {"id": "zh-CN-YunyangNeural", "name": "云扬", "language": "zh-CN", "gender": "male"},
            {"id": "zh-CN-YunjianNeural", "name": "云健", "language": "zh-CN", "gender": "male"},
            {"id": "zh-CN-XiaoniNeural", "name": "晓妮", "language": "zh-CN", "gender": "female"},
            {"id": "zh-CN-YunxiNeural", "name": "云希", "language": "zh-CN", "gender": "male"},
        ]
    }


@app.get("/models")
async def models():
    return {"data": [{"id": "edge-tts", "name": "Edge TTS"}]}


def main():
    port = int(os.environ.get("PORT", "8005"))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
