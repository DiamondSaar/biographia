"""Mirrors dominex/app/core/access.py::ACCESS_CLASS_ORDER exactly. Kept as
a local constant rather than fetched over the network - it's a fixed
8-letter scale hardcoded in Dominex's own source (not admin-editable,
not stored in its DB), so there's nothing to actually read from an API;
a network round-trip on every access-level comparison would just be
latency for no freshness benefit. Resolves the open question from TZ
section 12 - update by hand if Dominex's own tuple ever changes."""

ACCESS_CLASS_ORDER = ("G", "F", "E", "D", "C", "B", "A", "S")


def access_rank(value):
    return ACCESS_CLASS_ORDER.index(value) if value in ACCESS_CLASS_ORDER else 0


def stricter_access_class(a, b):
    return ACCESS_CLASS_ORDER[max(access_rank(a), access_rank(b))]
