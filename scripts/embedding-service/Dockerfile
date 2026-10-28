# BGE-M3 Embedding Service - Local
FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install remaining dependencies (PyTorch already in base image)
# transformers 固定 4.49.0: bge-m3 仓库只有 pytorch_model.bin（无 safetensors），
# 5.x / 4.53+ 因 CVE-2025-32434 拒绝在 torch<2.6 上 torch.load .bin 权重
RUN pip3 install --no-cache-dir \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    "transformers==4.49.0" fastapi uvicorn python-multipart pydantic

WORKDIR /app
COPY server.py .

EXPOSE 8002
CMD ["python3", "server.py"]
