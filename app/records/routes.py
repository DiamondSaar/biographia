import io

from flask import abort, jsonify, request, send_file

from app.core import dominex_client, storage
from app.core.access import access_rank, stricter_access_class
from app.core.auth import require_session
from app.extensions import db
from app.models import (
    Attachment,
    BiographyRecord,
    BiographyRecordOwnershipChange,
    BiographyRecordVersion,
    RecordType,
    Zone,
)
from app.records import records_bp

MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024  # 25 MB - plain sanity cap, not from TZ; revisit once real media sizes are known


def can_view_record(record, viewer):
    """TZ section 3/10: open = by rank; org = org-admin group + rank
    (see biographia_tz.md's clarification on section 3's table - both
    checks apply together, membership isn't a substitute for the rank
    check); personal = owner only. Interpretation: "org-admin group"
    reuses Dominex's own Role semantics (superadmin sees any org,
    admin only their own org) since that's already what
    admin_scope_organization_id() means on the Dominex side - not
    re-confirmed word-for-word with the user, flagged in the TZ."""
    if record.status == "hidden" and viewer.get("role") != "superadmin" and record.owner_username != viewer.get(
        "username"
    ):
        return False

    if record.zone == Zone.PERSONAL:
        return record.author_username == viewer.get("username")

    if record.zone == Zone.OPEN:
        return access_rank(record.access_level) <= access_rank(viewer.get("access_class"))

    if record.zone == Zone.ORG:
        role = viewer.get("role")
        organization = viewer.get("organization") or {}
        is_scoped_admin = role == "admin" and organization.get("id") == record.org_id
        if role != "superadmin" and not is_scoped_admin:
            return False
        return access_rank(record.access_level) <= access_rank(viewer.get("access_class"))

    return False


def can_edit_record(record, viewer):
    """Whether this viewer can mutate the record DIRECTLY (apply an edit
    immediately, reassign the owner, change access_level, hide/unhide) -
    narrower than can_view_record on purpose, being able to *see* an
    official record never implies being able to change it. Gated by
    ownership ("Владелец/Ответственный"), not authorship - the two start
    out equal at creation (see create_record) but the author role never
    changes while ownership can be reassigned. A superadmin always
    qualifies too (administrative override, mirrors Dominex's own
    unrestricted-SUPERADMIN pattern) - including for the owner-rank
    ceiling on access_level, which is checked separately against the
    *owner's* rank, not the superadmin's own (see _validate_access_level).
    Someone who can view but not edit directly doesn't get 403 on
    /records/<id>/edit though - see record_edit(), their edit becomes a
    pending proposal instead."""
    if viewer.get("role") == "superadmin":
        return True
    return record.owner_username == viewer.get("username")


def _record_payload(record):
    return {
        "id": record.id,
        "entity_kind": record.entity_kind,
        "entity_id": record.entity_id,
        "zone": record.zone,
        "org_id": record.org_id,
        "access_level": record.access_level,
        "record_type": record.record_type,
        "title": record.title,
        "body": record.body,
        "encrypted_content": record.encrypted_content,
        "nonce": record.nonce,
        "author_username": record.author_username,
        "author_display_name": record.author_display_name,
        "owner_username": record.owner_username,
        "owner_display_name": record.owner_display_name,
        "status": record.status,
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
        "version_count": len([v for v in record.versions if v.status == "applied"]),
        "pending_count": len([v for v in record.versions if v.status == "pending"]),
        "attachments": [_attachment_payload(a) for a in record.attachments],
    }


def _attachment_payload(attachment):
    return {
        "id": attachment.id,
        "filename": attachment.filename,
        "content_type": attachment.content_type,
        "size_bytes": attachment.size_bytes,
        "caption": attachment.caption,
        "uploaded_by": attachment.uploaded_by,
        "created_at": attachment.created_at.isoformat(),
    }


def _fetch_bound_entity(entity_kind, entity_id):
    if entity_kind == "entity":
        return dominex_client.fetch_entity(entity_id)
    if entity_kind == "organization":
        return dominex_client.fetch_organization(entity_id)
    return None


def _validate_access_level_ceiling(access_level, owner_access_class):
    """"Ранг доступа не может быть выше ранга владельца" - checked against
    the CURRENT owner's own access_class, not whoever is making the
    change (a superadmin reassigning access_level on someone else's
    record is still capped by that record's owner - if a higher rank is
    needed, reassign ownership first, per the user's own worked example).
    Returns an error string, or None if the level is acceptable."""
    if owner_access_class and access_rank(access_level) > access_rank(owner_access_class):
        return "access_level_exceeds_owner_rank"
    return None


def _reconcile_floor(record):
    """Lazy self-heal for the asymmetric floor rule (TZ 10.1): if the
    bound entity's access_class has risen since this record was created/
    last checked, raise the record to match - never lowers it back down
    automatically. Best-effort: skipped silently if Dominex can't be
    reached, since a stale-but-present class beats blocking every read
    on a Dominex outage."""
    if record.entity_id is None or record.zone == Zone.PERSONAL:
        return
    entity = _fetch_bound_entity(record.entity_kind, record.entity_id)
    if entity is None:
        return
    entity_class = entity.get("access_class")
    if entity_class and access_rank(entity_class) > access_rank(record.access_level):
        record.access_level = entity_class
        db.session.commit()


@records_bp.post("/records")
def create_record():
    viewer = require_session()
    data = request.get_json(silent=True) or {}

    zone = data.get("zone")
    if zone not in Zone.CHOICES:
        return jsonify({"ok": False, "error": "invalid_zone"}), 400

    record_type = data.get("record_type")
    if record_type not in RecordType.CHOICES:
        return jsonify({"ok": False, "error": "invalid_record_type"}), 400

    title = (data.get("title") or "").strip() or None
    body = (data.get("body") or "").strip() or None
    encrypted_content = (data.get("encrypted_content") or "").strip() or None
    nonce = (data.get("nonce") or "").strip() or None

    if zone == Zone.PERSONAL:
        # Fail closed on the plaintext side too, not just missing-field:
        # a client that sent title/body for a personal record is either
        # buggy or bypassing the crypto layer on purpose - either way this
        # must not silently store it as plaintext.
        if title or body:
            return jsonify({"ok": False, "error": "plaintext_not_allowed_for_personal_zone"}), 400
        if not encrypted_content or not nonce:
            return jsonify({"ok": False, "error": "encrypted_content_and_nonce_required"}), 400
    else:
        if encrypted_content or nonce:
            return jsonify({"ok": False, "error": "encrypted_content_only_allowed_for_personal_zone"}), 400
        if not title and not body:
            return jsonify({"ok": False, "error": "title_or_body_required"}), 400

    entity_kind = data.get("entity_kind")
    entity_id = data.get("entity_id")
    access_level = data.get("access_level")
    org_id = data.get("org_id")

    if zone == Zone.PERSONAL:
        access_level = None
        org_id = None
    else:
        access_level = access_level or "G"
        if zone == Zone.ORG and not org_id:
            return jsonify({"ok": False, "error": "org_id_required_for_org_zone"}), 400

    # Floor rule (TZ 10.1): access_level can't be looser than the bound
    # entity's own access_class - only applies when there's an actual
    # entity_id (unattached diary/org records have no entity to floor
    # against, per TZ 10.1's own carve-out).
    if entity_id is not None:
        if entity_kind not in ("entity", "organization"):
            return jsonify({"ok": False, "error": "invalid_entity_kind"}), 400
        entity = _fetch_bound_entity(entity_kind, entity_id)
        if entity is None:
            # Fail closed - can't verify the floor, must not silently allow.
            return jsonify({"ok": False, "error": "dominex_unreachable_or_unknown_entity"}), 502
        entity_class = entity.get("access_class")
        if zone != Zone.PERSONAL and entity_class:
            access_level = stricter_access_class(access_level, entity_class)

    if zone != Zone.PERSONAL:
        # Owner == author at creation (see below), so the ceiling is the
        # viewer's own rank - no Dominex round-trip needed here, unlike
        # record_edit()/reassign_owner() where the owner may be someone else.
        ceiling_error = _validate_access_level_ceiling(access_level, viewer.get("access_class"))
        if ceiling_error:
            return jsonify({"ok": False, "error": ceiling_error}), 400

    record = BiographyRecord(
        entity_kind=entity_kind,
        entity_id=entity_id,
        zone=zone,
        org_id=org_id,
        access_level=access_level,
        record_type=record_type,
        title=title,
        body=body,
        encrypted_content=encrypted_content,
        nonce=nonce,
        author_username=viewer["username"],
        author_display_name=viewer.get("display_name"),
        owner_username=viewer["username"],
        owner_display_name=viewer.get("display_name"),
    )
    db.session.add(record)
    db.session.flush()

    db.session.add(
        BiographyRecordVersion(
            record_id=record.id,
            version_number=1,
            title=title,
            body=body,
            encrypted_content=encrypted_content,
            nonce=nonce,
            record_type=record_type,
            author_username=viewer["username"],
        )
    )
    db.session.commit()

    return jsonify(_record_payload(record)), 201


@records_bp.get("/records/<int:record_id>")
def record_detail(record_id):
    viewer = require_session()
    record = BiographyRecord.query.get_or_404(record_id)
    _reconcile_floor(record)
    if not can_view_record(record, viewer):
        abort(403)

    payload = _record_payload(record)
    payload["versions"] = [
        {
            "version_number": v.version_number,
            "title": v.title,
            "body": v.body,
            "encrypted_content": v.encrypted_content,
            "nonce": v.nonce,
            "record_type": v.record_type,
            "author_username": v.author_username,
            "status": v.status,
            "created_at": v.created_at.isoformat(),
        }
        for v in record.versions
        if v.status != "rejected" or can_edit_record(record, viewer)
    ]
    return jsonify(payload)


@records_bp.post("/records/<int:record_id>/edit")
def record_edit(record_id):
    """Append-only edit - never overwrites history, always adds a new
    version (TZ 6.2: "правка создаёт новую версию с историей"). Whether it
    applies immediately or waits for approval depends on can_edit_record
    (owner/superadmin edit directly; anyone else who can merely *see* the
    record gets a pending proposal instead of a 403 - proposing needs no
    special right beyond visibility, only *applying* one does)."""
    viewer = require_session()
    record = BiographyRecord.query.get_or_404(record_id)
    if not can_view_record(record, viewer):
        abort(404)  # invisible to this viewer at all - don't reveal it exists

    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip() or None
    body = (data.get("body") or "").strip() or None
    encrypted_content = (data.get("encrypted_content") or "").strip() or None
    nonce = (data.get("nonce") or "").strip() or None
    access_level = data.get("access_level")

    if record.zone == Zone.PERSONAL:
        if title or body:
            return jsonify({"ok": False, "error": "plaintext_not_allowed_for_personal_zone"}), 400
        if not encrypted_content or not nonce:
            return jsonify({"ok": False, "error": "encrypted_content_and_nonce_required"}), 400
    else:
        if encrypted_content or nonce:
            return jsonify({"ok": False, "error": "encrypted_content_only_allowed_for_personal_zone"}), 400
        if not title and not body:
            return jsonify({"ok": False, "error": "title_or_body_required"}), 400

    if not can_edit_record(record, viewer):
        # Not the owner/superadmin - this becomes a proposal, the live
        # record is untouched. access_level is never offered on this path
        # at all - only owner/superadmin can move that dial (see the
        # direct-apply branch below).
        next_version = (record.versions[-1].version_number if record.versions else 0) + 1
        db.session.add(
            BiographyRecordVersion(
                record_id=record.id,
                version_number=next_version,
                title=title,
                body=body,
                encrypted_content=encrypted_content,
                nonce=nonce,
                record_type=record.record_type,
                author_username=viewer["username"],
                status="pending",
            )
        )
        db.session.commit()
        return (
            jsonify({"ok": True, "pending": True, "message": "Изменение отправлено на согласование владельцу."}),
            202,
        )

    if access_level and record.zone != Zone.PERSONAL:
        # Ceiling is always the CURRENT OWNER's rank, not the editor's -
        # when the editor IS the owner these are the same value, but a
        # superadmin editing someone else's record is still capped by
        # that record's owner (see _validate_access_level_ceiling's
        # docstring for the worked example this implements).
        if viewer.get("username") == record.owner_username:
            owner_access_class = viewer.get("access_class")
        else:
            owner_projection = dominex_client.fetch_user_projection(record.owner_username)
            owner_access_class = owner_projection.get("access_class") if owner_projection else None
        ceiling_error = _validate_access_level_ceiling(access_level, owner_access_class)
        if ceiling_error:
            return jsonify({"ok": False, "error": ceiling_error}), 400
        record.access_level = access_level

    record.title = title
    record.body = body
    record.encrypted_content = encrypted_content
    record.nonce = nonce
    next_version = (record.versions[-1].version_number if record.versions else 0) + 1
    db.session.add(
        BiographyRecordVersion(
            record_id=record.id,
            version_number=next_version,
            title=title,
            body=body,
            encrypted_content=encrypted_content,
            nonce=nonce,
            record_type=record.record_type,
            author_username=viewer["username"],
        )
    )
    db.session.commit()
    return jsonify(_record_payload(record))


@records_bp.get("/records/<int:record_id>/proposals")
def record_proposals(record_id):
    """The approval queue for this record - multiple pending proposals can
    coexist (not "one active replaces the previous" - the user explicitly
    asked for a queue), each reviewed/applied independently. Visible to
    anyone who can view the record (so a proposer can see their own
    proposal's status), but only can_edit_record() may act on one."""
    viewer = require_session()
    record = BiographyRecord.query.get_or_404(record_id)
    if not can_view_record(record, viewer):
        abort(404)

    pending = [v for v in record.versions if v.status == "pending"]
    return jsonify(
        {
            "results": [
                {
                    "version_number": v.version_number,
                    "title": v.title,
                    "body": v.body,
                    "record_type": v.record_type,
                    "author_username": v.author_username,
                    "created_at": v.created_at.isoformat(),
                }
                for v in pending
            ]
        }
    )


@records_bp.post("/records/<int:record_id>/proposals/<int:version_number>/approve")
def approve_proposal(record_id, version_number):
    """Copies the proposed version's content onto the live record and
    marks it applied. Other still-pending proposals for the same record
    are left alone (queue semantics) - whichever gets approved next simply
    overwrites on top, last-applied wins; no auto-merge or auto-rejection
    of the rest."""
    viewer = require_session()
    record = BiographyRecord.query.get_or_404(record_id)
    if not can_view_record(record, viewer):
        abort(404)
    if not can_edit_record(record, viewer):
        abort(403)

    version = BiographyRecordVersion.query.filter_by(
        record_id=record.id, version_number=version_number, status="pending"
    ).first_or_404()

    record.title = version.title
    record.body = version.body
    record.encrypted_content = version.encrypted_content
    record.nonce = version.nonce
    version.status = "applied"
    db.session.commit()
    return jsonify(_record_payload(record))


@records_bp.post("/records/<int:record_id>/proposals/<int:version_number>/reject")
def reject_proposal(record_id, version_number):
    viewer = require_session()
    record = BiographyRecord.query.get_or_404(record_id)
    if not can_view_record(record, viewer):
        abort(404)
    if not can_edit_record(record, viewer):
        abort(403)

    version = BiographyRecordVersion.query.filter_by(
        record_id=record.id, version_number=version_number, status="pending"
    ).first_or_404()
    version.status = "rejected"
    db.session.commit()
    return jsonify({"ok": True})


@records_bp.post("/records/<int:record_id>/reassign-owner")
def reassign_owner(record_id):
    """Unconditional for whoever's allowed to do it at all (current owner,
    voluntarily, or a superadmin) - not routed through the proposal queue,
    reassignment isn't content. Logged separately in
    BiographyRecordOwnershipChange (see that model's docstring for why)."""
    viewer = require_session()
    record = BiographyRecord.query.get_or_404(record_id)
    if not can_view_record(record, viewer):
        abort(404)
    if not can_edit_record(record, viewer):
        abort(403)

    data = request.get_json(silent=True) or {}
    new_username = (data.get("username") or "").strip()
    if not new_username:
        return jsonify({"ok": False, "error": "username_required"}), 400

    projection = dominex_client.fetch_user_projection(new_username)
    if projection is None:
        return jsonify({"ok": False, "error": "unknown_user"}), 404

    db.session.add(
        BiographyRecordOwnershipChange(
            record_id=record.id,
            from_username=record.owner_username,
            to_username=new_username,
            changed_by_username=viewer["username"],
        )
    )
    record.owner_username = new_username
    record.owner_display_name = projection.get("display_name")
    db.session.commit()
    return jsonify(_record_payload(record))


@records_bp.post("/records/<int:record_id>/hide")
def hide_record(record_id):
    """Soft-delete for "I made a mistake testing this" or general
    archival - not content, so no approval needed, same gate as direct
    edits. Already-existing status="active" filters on every feed/list
    query mean a hidden record just stops showing up there; still
    fetchable by id for the owner/superadmin (see can_view_record)."""
    viewer = require_session()
    record = BiographyRecord.query.get_or_404(record_id)
    if not can_view_record(record, viewer):
        abort(404)
    if not can_edit_record(record, viewer):
        abort(403)
    record.status = "hidden"
    db.session.commit()
    return jsonify(_record_payload(record))


@records_bp.post("/records/<int:record_id>/unhide")
def unhide_record(record_id):
    viewer = require_session()
    record = BiographyRecord.query.get_or_404(record_id)
    if not can_view_record(record, viewer):
        abort(404)
    if not can_edit_record(record, viewer):
        abort(403)
    record.status = "active"
    db.session.commit()
    return jsonify(_record_payload(record))


@records_bp.get("/entities/<entity_kind>/<int:entity_id>")
def entity_card(entity_kind, entity_id):
    """Thin proxy to Dominex's own entity/organization detail (TZ 7.2's
    object page needs to show what the object *is*, not just its
    biography feed) - same reasoning as /entities/lookup, the browser
    never talks to Dominex directly."""
    require_session()
    if entity_kind not in ("entity", "organization"):
        abort(404)
    entity = _fetch_bound_entity(entity_kind, entity_id)
    if entity is None:
        abort(404)
    return jsonify(entity)


@records_bp.get("/entities/<entity_kind>/<int:entity_id>/records")
def entity_feed(entity_kind, entity_id):
    """Object-page feed (TZ 7.2) - filtered per viewer; records the
    viewer can't see just don't appear (TZ 3: "для него не отображаются
    вовсе"), no partial-access hint here since this is a content feed,
    not the "недостаточно прав" case from TZ 10.2 (that's for Dominex's
    own entity-card endpoints, not Biographia's record feed)."""
    viewer = require_session()
    if entity_kind not in ("entity", "organization"):
        abort(404)

    records = (
        BiographyRecord.query.filter_by(entity_kind=entity_kind, entity_id=entity_id, status="active")
        .order_by(BiographyRecord.created_at.desc())
        .all()
    )
    for record in records:
        _reconcile_floor(record)

    visible = [r for r in records if can_view_record(r, viewer)]
    return jsonify({"results": [_record_payload(r) for r in visible]})


@records_bp.get("/records/recent")
def records_recent():
    """Global "лента последних правок" for the wiki home (TZ 7.1),
    across every entity - unlike entity_feed above, this doesn't call
    _reconcile_floor per record (could mean dozens of Dominex round-trips
    for one page load); visibility here uses each record's already-
    stored access_level. Still eventually consistent - reconciliation
    still runs whenever a record's own detail/entity feed is opened."""
    viewer = require_session()
    limit = min(int(request.args.get("limit") or 10), 50)

    candidates = (
        BiographyRecord.query.filter_by(status="active").order_by(BiographyRecord.updated_at.desc()).limit(200).all()
    )
    visible = [r for r in candidates if can_view_record(r, viewer)]
    return jsonify({"results": [_record_payload(r) for r in visible[:limit]]})


@records_bp.get("/records/mine")
def records_mine():
    """ЛК автора (TZ 7.3): every record authored by the viewer, across
    all three zones - filtered by authorship only, not can_view_record,
    since an author can always see their own writing regardless of zone/
    rank (personal records included by construction). The frontend
    groups the flat list into the three sections TZ 7.3 describes
    (общие/по организациям/личные) - one source, multiple views, same
    principle as TZ 6.5."""
    viewer = require_session()
    records = (
        BiographyRecord.query.filter_by(author_username=viewer["username"], status="active")
        .order_by(BiographyRecord.created_at.desc())
        .all()
    )
    return jsonify({"results": [_record_payload(r) for r in records]})


@records_bp.get("/entities/lookup")
def entities_lookup():
    """Thin proxy to Dominex's own /api/v1/entities/search (biographia TZ
    section 8) - the browser never talks to Dominex directly (no API
    key, no reason to expose that surface), only to Biographia."""
    require_session()
    q = (request.args.get("q") or "").strip()
    parents_only = (request.args.get("parents_only") or "").lower() in ("1", "true", "yes")
    return jsonify(dominex_client.search(q, parents_only=parents_only))


@records_bp.get("/users/lookup")
def users_lookup():
    """Thin proxy to Dominex's own /api/v1/identity/users/search - the
    "Владелец" picker (UserPicker.jsx) uses this, same "browser never
    talks to Dominex directly" reasoning as entities_lookup above."""
    require_session()
    q = (request.args.get("q") or "").strip()
    return jsonify(dominex_client.search_users(q))


@records_bp.post("/records/<int:record_id>/attachments")
def upload_attachment(record_id):
    """Plaintext object-storage upload (TZ section 9) - open/org zone
    only; personal-zone client-side encryption is Phase 1c, not this
    endpoint. Gated by can_edit_record, same as text edits - adding a
    file is a content mutation like any other."""
    viewer = require_session()
    record = BiographyRecord.query.get_or_404(record_id)
    if not can_view_record(record, viewer):
        abort(404)
    if not can_edit_record(record, viewer):
        abort(403)
    if record.zone == Zone.PERSONAL:
        return jsonify({"ok": False, "error": "personal_zone_attachments_not_implemented"}), 501

    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify({"ok": False, "error": "file_required"}), 400

    upload.stream.seek(0, 2)
    size_bytes = upload.stream.tell()
    upload.stream.seek(0)
    if size_bytes == 0:
        return jsonify({"ok": False, "error": "empty_file"}), 400
    if size_bytes > MAX_ATTACHMENT_BYTES:
        return jsonify({"ok": False, "error": "file_too_large"}), 413

    storage_key = storage.put_object(upload.stream, upload.content_type)

    attachment = Attachment(
        record_id=record.id,
        storage_key=storage_key,
        filename=upload.filename,
        content_type=upload.content_type,
        size_bytes=size_bytes,
        caption=(request.form.get("caption") or "").strip() or None,
        uploaded_by=viewer["username"],
    )
    db.session.add(attachment)
    db.session.commit()

    return jsonify(_attachment_payload(attachment)), 201


@records_bp.get("/attachments/<int:attachment_id>")
def download_attachment(attachment_id):
    """Gated by the *parent record's* visibility, not a separate
    permission of its own - an attachment is exactly as visible as the
    record it's attached to (TZ section 9 doesn't call out attachments
    as a distinct access-control surface)."""
    viewer = require_session()
    attachment = Attachment.query.get_or_404(attachment_id)
    if not can_view_record(attachment.record, viewer):
        abort(404)

    result = storage.get_object_bytes(attachment.storage_key)
    if result is None:
        abort(404)
    data, content_type = result
    return send_file(
        io.BytesIO(data),
        mimetype=content_type or attachment.content_type or "application/octet-stream",
        as_attachment=False,
        download_name=attachment.filename,
    )
