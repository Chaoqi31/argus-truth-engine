# Argus backend — production container for Fly.io / Render / any Docker host.
#
# Build:  docker build -t argus .
# Run:    docker run -p 8080:8080 -e ARGUS_MIROMIND_API_KEY=sk_xxx argus
#
# Uses uv for fast, reproducible installs from uv.lock. Multi-stage so the
# runtime image doesn't carry the build toolchain.

# -------- builder ----------------------------------------------------------
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app

# Lockfile first → cached layer when only source changes.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

# Now the source.
COPY src ./src
COPY alembic.ini ./
RUN uv sync --frozen --no-dev

# -------- runtime ----------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

# pdfplumber/pymupdf need a few shared libs; WeasyPrint (PDF audit report)
# needs the pango/cairo/gdk-pixbuf stack — libpango pulls glib (gobject-2.0),
# harfbuzz, fontconfig, freetype. Without these, importing argus.reporting.pdf
# at startup crashes: OSError cannot load library 'gobject-2.0-0'.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libstdc++6 \
        libgomp1 \
        ca-certificates \
        curl \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libgdk-pixbuf-2.0-0 \
        libffi8 \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    ARGUS_STORAGE_ROOT=/data/uploads

# Non-root user.
RUN useradd --create-home --uid 1000 argus
WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /app/src ./src
COPY --from=builder /app/alembic.ini ./
RUN mkdir -p /data/uploads && chown -R argus:argus /data /app

USER argus

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

# Fly.io and most PaaS set PORT; default to 8080 for local runs.
CMD ["sh", "-c", "argus serve --host 0.0.0.0 --port ${PORT:-8080}"]
