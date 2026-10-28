# FunASR 本地语音识别服务（OpenAI 兼容接口）
#
# OpenMAIC 的 funasr-asr 提供商客户端调用方式:
#   POST {base}/audio/transcriptions  (multipart: file=audio.wav)
#     resp: {"text": "..."}
#
# 模型缓存由 MODELSCOPE_CACHE 指定（挂载卷持久化）。
# DEVICE=cpu|cuda:0 可切换推理设备。

import os
import tempfile
from typing import Optional

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

app = FastAPI(title="FunASR Local Service")

MODEL_NAME = os.environ.get("FUNASR_MODEL", "paraformer-zh")
DEVICE = os.environ.get("DEVICE", "cuda:0" if torch.cuda.is_available() else "cpu")

model = None


@app.on_event("startup")
async def load_model():
    global model
    from funasr import AutoModel

    print(f"[funasr] loading {MODEL_NAME} on {DEVICE}", flush=True)
    model = AutoModel(
        model=MODEL_NAME,
        vad_model="fsmn-vad",
        punc_model="ct-punc",
        device=DEVICE,
        disable_update=True,
    )
    print("[funasr] model ready", flush=True)


@app.get("/health")
async def health():
    return {
        "status": "ok" if model is not None else "loading",
        "model": MODEL_NAME,
        "device": DEVICE,
    }


def _transcribe_file(path: str) -> str:
    res = model.generate(input=path)
    if isinstance(res, dict):
        res = [res]
    return "".join(r.get("text", "") for r in res).strip()


async def _transcribe(file: UploadFile):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    suffix = os.path.splitext(file.filename or "")[1] or ".wav"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(await file.read())
            tmp_path = f.name
        text = await run_in_threadpool(_transcribe_file, tmp_path)
        return JSONResponse({"text": text})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@app.post("/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),
    response_format: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
):
    return await _transcribe(file)


@app.post("/v1/audio/transcriptions")
async def transcribe_v1(
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),
    response_format: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
):
    return await _transcribe(file)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "26690")))
