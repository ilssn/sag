FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/*

# 先装依赖（利于缓存）
COPY pyproject.toml README.md ./
COPY zleap_api ./zleap_api
RUN pip install --upgrade pip && pip install ".[postgres]"

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:8000/api/v1/system/health || exit 1

CMD ["uvicorn", "zleap_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
