from flask import abort, session


def require_session():
    if "username" not in session:
        abort(401)
    return session
