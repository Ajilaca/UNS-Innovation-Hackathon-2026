# Konteks build: root repo (lihat docker-compose.yml).
# --- frontend (React) ---
FROM node:22-alpine AS web
WORKDIR /web
COPY dashboard/web/package*.json ./
RUN if [ -f package.json ]; then npm ci; fi
COPY dashboard/web/ ./
RUN if [ -f package.json ]; then npm run build; else mkdir -p dist; fi

# --- backend + mesin simulasi/ML ---
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app/ML
COPY ML/requirements.txt ML/requirements.txt
COPY dashboard/backend/requirements.txt dashboard/backend/requirements.txt
RUN pip install --no-cache-dir -r dashboard/backend/requirements.txt
COPY ML/sobat_ml ./ML/sobat_ml
COPY ML/config ./ML/config
COPY ML/data/external ./ML/data/external
COPY dashboard/backend/app ./dashboard/backend/app
COPY --from=web /web/dist ./dashboard/web/dist
WORKDIR /app/dashboard/backend
RUN useradd -m bj && mkdir -p /data /app/ML/results /app/ML/models /app/docs && chown -R bj /data /app/ML/results /app/ML/models /app/docs
USER bj
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
