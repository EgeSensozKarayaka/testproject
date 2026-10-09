FROM ghcr.io/astral-sh/uv:0.12.20 AS uv
FROM python:3.14.8-slim-bookworm AS build

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
WORKDIR /app

COPY --from=uv /uv /uvx /bin/
COPY services/predictor/pyproject.toml services/predictor/uv.lock ./
RUN uv sync --locked

FROM build AS production-dependencies

RUN uv sync --locked --no-dev

FROM python:3.14.8-slim-bookworm AS runtime

ENV PATH=/app/.venv/bin:$PATH
ENV PYTHONPATH=/app/src
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app

RUN useradd --create-home --uid 10001 predictor

COPY --from=production-dependencies --chown=predictor:predictor /app/.venv ./.venv
COPY --chown=predictor:predictor services/predictor/src ./src

USER predictor
CMD ["python", "-m", "site_monitor_predictor"]
