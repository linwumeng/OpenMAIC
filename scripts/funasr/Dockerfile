# FunASR 本地语音识别服务（OpenAI 兼容接口）
# 复用本地已有的 pytorch 基础镜像（torch/torchaudio 已内置，无需网络下载）

FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖
RUN pip3 install --no-cache-dir \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    funasr modelscope fastapi uvicorn python-multipart pydantic

WORKDIR /app
COPY server.py .

EXPOSE 26690
CMD ["python3", "server.py"]
