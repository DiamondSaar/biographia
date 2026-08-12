from app.extensions import db
from app.models.integrations import utcnow


class Zone:
    OPEN = "open"
    ORG = "org"
    PERSONAL = "personal"

    CHOICES = (OPEN, ORG, PERSONAL)


class RecordType:
    INSTALLATION = "installation"
    DOCUMENTS = "documents"
    MAINTENANCE = "maintenance"
    COMPONENT_REPLACEMENT = "component_replacement"
    RELOCATION = "relocation"
    INCIDENT = "incident"
    NOTE = "note"
    DIARY_ENTRY = "diary_entry"  # personal zone only - see create_record()'s validation

    CHOICES = (
        INSTALLATION,
        DOCUMENTS,
        MAINTENANCE,
        COMPONENT_REPLACEMENT,
        RELOCATION,
        INCIDENT,
        DIARY_ENTRY,
        NOTE,
    )


class BiographyRecord(db.Model):
    """Official, authored record (TZ section 1/6.2) - not the same thing
    as a Comment (informal, editable/deletable, not built yet). This row
    always reflects the *current* version; full history lives in
    BiographyRecordVersion, append-only (TZ: "правка создаёт новую
    версию... факт не переписывается молча").

    entity_kind/entity_id/org_id are plain integers, not real foreign
    keys - Biographia doesn't own Dominex's tables (TZ section 2), and
    entity_kind matches the "kind" tag dominex/app/api/entities.py
    already returns ("entity"|"organization")."""

    __tablename__ = "biography_records"

    id = db.Column(db.Integer, primary_key=True)

    entity_kind = db.Column(db.String(20), nullable=True)
    entity_id = db.Column(db.Integer, nullable=True, index=True)

    # Отдельное от entity_kind/entity_id поле "Юрлицо" - по запросу
    # пользователя запись должна уметь одновременно указывать и на
    # сущность (например, конкретный ноутбук), и на организацию (кому он
    # принадлежит), а не только на что-то одно через общий пикер выше.
    # Всегда организация (Dominex Organization), поэтому отдельного
    # "kind"-столбца не нужно, в отличие от entity_kind.
    related_organization_id = db.Column(db.Integer, nullable=True, index=True)

    zone = db.Column(db.String(20), nullable=False)
    org_id = db.Column(db.Integer, nullable=True, index=True)
    # Null only for zone=personal (TZ 6.2: "у personal отсутствует").
    access_level = db.Column(db.String(1), nullable=True)

    record_type = db.Column(db.String(30), nullable=False)
    # Plaintext, used only for zone in (open, org). Zone=personal never
    # populates these - encrypted_content below instead (TZ section 4:
    # server only ever stores ciphertext for the personal zone). Kept as
    # a disjoint column from encrypted_content rather than one column
    # that means different things per zone, so a plaintext-zone reader
    # can never accidentally receive ciphertext by reading the "wrong"
    # field for that row's zone.
    title = db.Column(db.String(255), nullable=True)
    body = db.Column(db.Text, nullable=True)

    # zone=personal only - one XChaCha20-Poly1305 AEAD call (base64
    # ciphertext + its nonce) over a small JSON payload {"title":...,
    # "body":...} under the Biographia subkey (app/crypto, frontend/src/
    # crypto/masterKey.ts::deriveSubkey). Deliberately *not* two separate
    # ciphertext columns each needing their own nonce - reusing one nonce
    # across two different AEAD messages under the same key would leak
    # the XOR of their keystreams, a real stream-cipher mistake, not a
    # style choice.
    encrypted_content = db.Column(db.Text, nullable=True)
    nonce = db.Column(db.String(64), nullable=True)

    author_username = db.Column(db.String(150), nullable=False)
    author_display_name = db.Column(db.String(255), nullable=True)

    # "Владелец/Ответственный" - who can edit directly and approve/reject
    # proposed edits from others. Defaults to the author at creation, can
    # be reassigned later (unconditionally, by the current owner or a
    # superadmin - see app/records/routes.py::reassign_owner). A denormalized
    # username/display_name pair, same shape as author_* above - the person
    # is always a real Dominex User, this just isn't a foreign key since
    # Biographia doesn't own Dominex's tables (see the class docstring).
    owner_username = db.Column(db.String(150), nullable=False)
    owner_display_name = db.Column(db.String(255), nullable=True)

    status = db.Column(db.String(20), nullable=False, default="active")
    # "active" | "hidden" (soft-deleted/archived, e.g. cleaning up a
    # mistaken test record - still fetchable by id for the owner/superadmin,
    # excluded from all feed/list queries).

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    versions = db.relationship(
        "BiographyRecordVersion",
        backref="record",
        order_by="BiographyRecordVersion.version_number",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<BiographyRecord {self.id} zone={self.zone}>"


class BiographyRecordVersion(db.Model):
    """One immutable snapshot per edit. version_number starts at 1 for the
    record's initial creation - never mutated after insert."""

    __tablename__ = "biography_record_versions"

    id = db.Column(db.Integer, primary_key=True)
    record_id = db.Column(db.Integer, db.ForeignKey("biography_records.id"), nullable=False, index=True)
    version_number = db.Column(db.Integer, nullable=False)

    title = db.Column(db.String(255), nullable=True)
    body = db.Column(db.Text, nullable=True)
    encrypted_content = db.Column(db.Text, nullable=True)
    nonce = db.Column(db.String(64), nullable=True)
    record_type = db.Column(db.String(30), nullable=False)

    author_username = db.Column(db.String(150), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    # "applied" (already live on the record - the historical default for
    # every version before this column existed, and still true for direct
    # edits by the owner/superadmin) | "pending" (proposed by someone who
    # isn't the current owner, awaiting the owner's decision - the live
    # BiographyRecord row is untouched until approved) | "rejected" (owner
    # declined it - kept for the record's history, never applied).
    status = db.Column(db.String(20), nullable=False, default="applied")

    __table_args__ = (db.UniqueConstraint("record_id", "version_number", name="uq_record_version"),)

    def __repr__(self):
        return f"<BiographyRecordVersion record={self.record_id} v{self.version_number}>"


class BiographyRecordOwnershipChange(db.Model):
    """Lightweight audit trail for "Ответственный" reassignment - separate
    from BiographyRecordVersion on purpose: a reassignment isn't content
    and isn't subject to approval (always unconditional for whoever's
    allowed to do it at all - see reassign_owner()), so mixing it into the
    content-version log would conflate two different kinds of history."""

    __tablename__ = "biography_record_ownership_log"

    id = db.Column(db.Integer, primary_key=True)
    record_id = db.Column(db.Integer, db.ForeignKey("biography_records.id"), nullable=False, index=True)
    from_username = db.Column(db.String(150), nullable=True)
    to_username = db.Column(db.String(150), nullable=False)
    changed_by_username = db.Column(db.String(150), nullable=False)
    changed_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    def __repr__(self):
        return f"<BiographyRecordOwnershipChange record={self.record_id} -> {self.to_username}>"


class Attachment(db.Model):
    """Object-storage attachment (TZ section 9). `storage_key` is a random
    UUID, never the original filename. Open/org zone: `storage_key` points
    at plaintext bytes, `filename`/`content_type` are stored as-is. Personal
    zone (Phase 1c): `storage_key` points at client-side ciphertext (server
    never sees plaintext bytes or the real filename/type) - `filename`/
    `content_type` stay NULL, the encrypted equivalent lives in
    `encrypted_meta`/`meta_nonce` (same one-AEAD-block idea as
    BiographyRecord.encrypted_content/.nonce).

    `thumbnail_key` - a small preview generated CLIENT-SIDE (both zones -
    the server can't generate one itself for personal-zone files, so the
    same client-side step is reused for open/org too rather than having two
    different code paths). For personal zone, the thumbnail bytes ARE
    ciphertext, same as the main file - the AEAD nonce is embedded as the
    first 24 bytes of the stored blob (see encryptBytes/decryptBytes in
    src/crypto/masterKey.ts on both clients) rather than a separate column,
    exactly like the main file's storage_key needs no separate nonce column
    either.

    `preview_key` - a server-generated PDF conversion of an Office document
    (doc/docx/xls/xlsx/ppt/pptx), open/org zone only (impossible for
    personal zone - the server never sees the plaintext to convert). NULL
    whenever the source isn't an Office file or conversion failed/timed out;
    a missing preview is never fatal to the upload itself."""

    __tablename__ = "attachments"

    id = db.Column(db.Integer, primary_key=True)
    record_id = db.Column(db.Integer, db.ForeignKey("biography_records.id"), nullable=False, index=True)

    storage_key = db.Column(db.String(64), nullable=False, unique=True)
    filename = db.Column(db.String(255), nullable=True)
    content_type = db.Column(db.String(100), nullable=True)
    size_bytes = db.Column(db.Integer, nullable=False)
    caption = db.Column(db.String(500), nullable=True)

    encrypted_meta = db.Column(db.Text(), nullable=True)
    meta_nonce = db.Column(db.String(64), nullable=True)
    thumbnail_key = db.Column(db.String(64), nullable=True)
    preview_key = db.Column(db.String(64), nullable=True)

    uploaded_by = db.Column(db.String(150), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    record = db.relationship("BiographyRecord", backref=db.backref("attachments", cascade="all, delete-orphan"))

    def __repr__(self):
        return f"<Attachment {self.id} record={self.record_id}>"
