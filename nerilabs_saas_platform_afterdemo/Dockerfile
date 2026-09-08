FROM python:3.11-slim

WORKDIR /app

# Install system dependencies & curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends     curl     && rm -rf /var/lib/apt/lists/*

# Copy dependency manifest and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Set executable permissions
RUN chmod +x entrypoint.sh simulate_saas.py 2>/dev/null || true

ENV PYTHONPATH=/app
ENV PORT=8000
ENV HOST=0.0.0.0
ENV WORKERS=4

EXPOSE 8000

# Container healthcheck for AWS App Runner, ECS, and Docker
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3   CMD curl -f http://localhost:${PORT:-8000}/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
