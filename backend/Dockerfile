FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

# dependências primeiro: a camada só é refeita quando o requirements muda
COPY requirements.txt .
RUN pip install -r requirements.txt

# O modelo de embeddings vai dentro da imagem: o contêiner não baixa nada ao iniciar.
ENV FASTEMBED_CACHE_PATH=/srv/models \
    HF_HUB_DISABLE_TELEMETRY=1
ARG EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('${EMBEDDING_MODEL}')" \
    # o servidor roda sem root: precisa conseguir ler os arquivos do modelo
    && chmod -R a+rX /srv/models

COPY app ./app

# sem root dentro do contêiner
RUN useradd --system --no-create-home api
USER api

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=2)"]

# O Cloud Run informa a porta pela variável PORT; fora dele vale a 8000.
# `exec` faz o uvicorn receber os sinais de parada direto (encerramento limpo).
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
