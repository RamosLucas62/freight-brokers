FROM python:3.13.15-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends binutils clamav qpdf poppler-utils && freshclam && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --create-home scanner
RUN chown -R scanner:scanner /var/lib/clamav
WORKDIR /app
COPY --chown=scanner:scanner server.py ./server.py
USER scanner
EXPOSE 8080
CMD ["python","server.py"]
