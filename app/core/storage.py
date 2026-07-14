"""Object storage for attachments (TZ section 9) - MinIO locally, any
S3-compatible endpoint in production. Open/org zone only for now
(plaintext) - personal-zone client-side encryption is Phase 1c, not
built here."""

import uuid

import boto3
from botocore.exceptions import ClientError
from flask import current_app


def _client():
    return boto3.client(
        "s3",
        endpoint_url=current_app.config["MINIO_ENDPOINT_URL"],
        aws_access_key_id=current_app.config["MINIO_ACCESS_KEY"],
        aws_secret_access_key=current_app.config["MINIO_SECRET_KEY"],
    )


def _ensure_bucket(client):
    bucket = current_app.config["MINIO_BUCKET"]
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError:
        client.create_bucket(Bucket=bucket)
    return bucket


def put_object(fileobj, content_type):
    """Stores fileobj under a fresh random key - never trusts the
    original filename as a path component. Returns the storage key."""
    client = _client()
    bucket = _ensure_bucket(client)
    key = str(uuid.uuid4())
    client.upload_fileobj(fileobj, bucket, key, ExtraArgs={"ContentType": content_type or "application/octet-stream"})
    return key


def get_object_bytes(storage_key):
    """Reads the whole object into memory rather than handing back
    botocore's raw StreamingBody - simpler and more robust to pass to
    Flask's send_file (seek/Content-Length behave predictably on
    BytesIO), and MAX_ATTACHMENT_BYTES already caps objects small enough
    that buffering isn't a real cost."""
    client = _client()
    bucket = current_app.config["MINIO_BUCKET"]
    try:
        obj = client.get_object(Bucket=bucket, Key=storage_key)
    except ClientError:
        return None
    return obj["Body"].read(), obj.get("ContentType")


def delete_object(storage_key):
    client = _client()
    bucket = current_app.config["MINIO_BUCKET"]
    client.delete_object(Bucket=bucket, Key=storage_key)
