FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/api
COPY pyproject.toml ./
COPY app ./app
COPY fixtures ./fixtures
RUN pip install --no-cache-dir . && useradd -r -u 10001 scallion
USER scallion
EXPOSE 8000
# No DEV_AUTH_BYPASS, no GEMINI_FAKE: production is closed by default.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
