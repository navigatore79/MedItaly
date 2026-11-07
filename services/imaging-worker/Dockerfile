FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends clamav ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker.py .
RUN useradd --uid 10001 --create-home medi
USER medi
# Mount an up-to-date ClamAV database read-only at /var/lib/clamav.
# With no functioning antivirus database the worker refuses all publication.
CMD ["python", "worker.py"]
