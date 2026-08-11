"""Best-effort Office document -> PDF preview conversion, open/org zone
only (see app/models/biography.py::Attachment's `preview_key` docstring -
personal zone can never use this, the server never sees its plaintext).

Shells out to the system `libreoffice` binary rather than a Python library
on purpose - LibreOffice's own document filters are what real-world
doc/docx/xls/xlsx/ppt/pptx files actually need, no pure-Python library
covers that ground. A timeout keeps one pathological file from hanging a
gunicorn worker; any failure just means no preview - never fatal to the
upload itself, see upload_attachment()."""

import subprocess
import tempfile
import uuid
from pathlib import Path

CONVERTIBLE_CONTENT_TYPES = {
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

CONVERT_TIMEOUT_SECONDS = 30


def is_convertible(content_type):
    return content_type in CONVERTIBLE_CONTENT_TYPES


def convert_to_pdf(source_bytes, original_filename):
    """Returns the converted PDF as bytes, or None if conversion failed,
    timed out, or LibreOffice isn't available - callers must treat None as
    "no preview", not as an error to surface to the uploader."""
    suffix = Path(original_filename or "document").suffix or ".bin"
    with tempfile.TemporaryDirectory() as tmpdir:
        source_path = Path(tmpdir) / f"{uuid.uuid4()}{suffix}"
        source_path.write_bytes(source_bytes)
        try:
            subprocess.run(
                [
                    "libreoffice",
                    "--headless",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    tmpdir,
                    str(source_path),
                ],
                timeout=CONVERT_TIMEOUT_SECONDS,
                capture_output=True,
                check=True,
            )
        except (subprocess.SubprocessError, OSError):
            return None

        pdf_path = source_path.with_suffix(".pdf")
        if not pdf_path.exists():
            return None
        return pdf_path.read_bytes()
