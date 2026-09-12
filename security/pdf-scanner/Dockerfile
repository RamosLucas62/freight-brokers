FROM python:3.13.15-slim-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends binutils clamav clamav-daemon clamdscan qpdf poppler-utils \
    && apt-get install -y --no-install-recommends --only-upgrade libpcre2-8-0 \
    && freshclam \
    && rm -rf /var/lib/apt/lists/*
# The scanner uses only the standard library at runtime. Remove Python's
# package installers and their vendored dependencies from the final image.
RUN python -m pip uninstall -y pip setuptools && rm -rf /usr/local/lib/python3.13/ensurepip
RUN useradd --system --uid 10001 --create-home scanner
RUN chown -R scanner:scanner /var/lib/clamav
WORKDIR /app
COPY --chown=scanner:scanner server.py ./server.py
COPY --chown=scanner:scanner clamd.conf ./clamd.conf
USER scanner
EXPOSE 8080
CMD ["python","server.py"]
