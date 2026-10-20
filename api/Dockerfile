FROM python:3.13-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app
COPY api/requirements.txt api/requirements-test.txt /app/api/
RUN pip install --no-cache-dir -r api/requirements.txt
COPY api /app/api
COPY db /app/db
RUN useradd --create-home app && chown -R app:app /app
USER app
EXPOSE 8000
CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

FROM base AS test
USER root
RUN pip install --no-cache-dir -r api/requirements-test.txt
USER app
CMD ["pytest", "api/tests", "-q"]

FROM base AS runtime
