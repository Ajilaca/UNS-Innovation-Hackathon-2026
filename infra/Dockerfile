# --- frontend (React) ---
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN if [ -f package.json ]; then npm ci; fi
COPY web/ ./
RUN if [ -f package.json ]; then npm run build; else mkdir -p dist; fi

# --- backend ---
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./backend/app
COPY config ./config
COPY data/external ./data/external
COPY --from=web /web/dist ./web/dist
WORKDIR /app/backend
RUN useradd -m bj && mkdir -p /data /app/data /app/models && chown -R bj /data /app/data /app/models
USER bj
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
