# BGE-M3 本地嵌入服务（OpenAI 兼容 /v1/embeddings）
#
# 模型缓存: HF_HOME（挂载卷持久化）；国内默认走 hf-mirror（可用 HF_ENDPOINT 覆盖）。
# 设备: DEVICE=cpu|cuda:0；GPU 时默认 fp16（HALF_PRECISION=0 可强制 fp32）。

import os
from typing import List, Optional

import torch
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

os.environ.setdefault("HF_HOME", "/models")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
# 国内源：未设 HF_ENDPOINT 时默认走 hf-mirror
if not os.environ.get("HF_ENDPOINT"):
    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

app = FastAPI(title="BGE-M3 Embedding Service")

MODEL_NAME = os.environ.get("MODEL_NAME", "BAAI/bge-m3")
DEVICE = os.environ.get("DEVICE", "cuda:0" if torch.cuda.is_available() else "cpu")
HALF_FLAG = os.environ.get("HALF_PRECISION", "auto").lower()
HALF = str(DEVICE).startswith("cuda") and HALF_FLAG in ("auto", "1", "true", "yes")
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "32"))

model = None
tokenizer = None


class EmbedRequest(BaseModel):
    inputs: str | List[str]
    model: Optional[str] = None
    normalize_embeddings: bool = True
    truncation: bool = True
    max_length: int = 8192


@app.on_event("startup")
async def load_model():
    global model, tokenizer
    from transformers import AutoModel, AutoTokenizer

    print(f"[embedding] loading {MODEL_NAME} on {DEVICE} (fp16={HALF})", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    dtype = torch.float16 if HALF else torch.float32
    model = AutoModel.from_pretrained(MODEL_NAME, torch_dtype=dtype).to(DEVICE)
    model.eval()
    print("[embedding] model ready", flush=True)


@app.get("/health")
async def health():
    return {
        "status": "ok" if model is not None else "loading",
        "model": MODEL_NAME,
        "device": str(DEVICE),
    }


def _embed(inputs: List[str], normalize: bool, max_length: int) -> list:
    out = []
    with torch.no_grad():
        for i in range(0, len(inputs), BATCH_SIZE):
            chunk = inputs[i : i + BATCH_SIZE]
            encoded = tokenizer(
                chunk,
                padding=True,
                truncation=True,
                max_length=max_length,
                return_tensors="pt",
            ).to(DEVICE)
            hidden = model(**encoded).last_hidden_state[:, 0]
            if normalize:
                hidden = torch.nn.functional.normalize(hidden, p=2, dim=1)
            out.extend(hidden.cpu().numpy().tolist())
    return out


@app.post("/v1/embeddings")
async def embeddings(req: EmbedRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    inputs = [req.inputs] if isinstance(req.inputs, str) else list(req.inputs)
    if not inputs:
        raise HTTPException(status_code=400, detail="inputs is empty")
    data = await run_in_threadpool(_embed, inputs, req.normalize_embeddings, req.max_length)
    return {
        "model": MODEL_NAME,
        "data": [{"embedding": vec, "index": i} for i, vec in enumerate(data)],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8002")))
