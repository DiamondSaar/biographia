FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=manage.py

WORKDIR /app

# TODO: libreoffice-{writer,calc,impress} (Office-document -> PDF preview,
# app/core/office_convert.py) intentionally NOT installed yet - three
# build attempts failed on this dev machine (flaky local network to
# deb.debian.org, then a Docker OOM) and Office preview is designed to
# degrade gracefully without it (convert_to_pdf() catches OSError, which
# covers "libreoffice binary not found", and just returns None - no
# preview, not a crash). Add the packages back here once the network/
# resource issue is sorted; nothing else in this feature depends on it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

ENTRYPOINT ["python", "/app/docker/entrypoint.py"]
CMD ["gunicorn", "manage:app", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "60"]
