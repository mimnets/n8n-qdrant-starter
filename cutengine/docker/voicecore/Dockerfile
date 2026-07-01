FROM pytorch/pytorch:2.4.0-cuda12.4-cudnn9-runtime

RUN apt-get update && apt-get install -y portaudio19-dev git && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
RUN git clone https://github.com/fishaudio/fish-speech.git && \
    cd fish-speech && git checkout v1.5.0 && \
    pip install -e . && \
    pip install torchvision==0.23.0 --no-deps

# Models downloaded at runtime via volume mount
EXPOSE 8080

CMD ["python", "-m", "tools.api_server", \
     "--llama-checkpoint-path", "/workspace/models/fish-speech-1.5", \
     "--decoder-checkpoint-path", "/workspace/models/fish-speech-1.5/firefly-gan-vq-fsq-8x1024-21hz-generator.pth", \
     "--listen", "0.0.0.0:8080"]
