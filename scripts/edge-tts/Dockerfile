FROM nvidia/cuda:12.1.0-base-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
# Ubuntu 官方源在国内构建极慢/易卡；换清华源（与下方 pip 同源）
RUN sed -i 's|archive.ubuntu.com|mirrors.tuna.tsinghua.edu.cn|g; s|security.ubuntu.com|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list && \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg && \
    rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    fastapi uvicorn[standard] python-multipart edge-tts soundfile scipy numpy \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.py .

EXPOSE 8005
ENV PORT=8005
ENV DEFAULT_VOICE=zh-CN-XiaoxiaoNeural
ENV HF_ENDPOINT=https://hf-mirror.com

CMD ["python3", "server.py"]
