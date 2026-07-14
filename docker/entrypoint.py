import os
import subprocess
import sys
import time

import sqlalchemy as sa


def wait_for_database() -> None:
    database_url = os.environ["DATABASE_URL"]
    deadline = time.time() + 60
    last_error = None

    while time.time() < deadline:
        try:
            engine = sa.create_engine(database_url)
            with engine.connect() as connection:
                connection.execute(sa.text("select 1"))
            return
        except Exception as exc:
            last_error = exc
            time.sleep(1)

    raise SystemExit(f"Database is not ready: {last_error}")


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def main() -> None:
    wait_for_database()
    run(["flask", "db", "upgrade"])

    os.execvp(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    main()
