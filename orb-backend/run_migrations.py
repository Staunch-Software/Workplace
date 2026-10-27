"""Bring the ORB database to the latest schema (runs `alembic upgrade head`).

Run from orb-backend directory with the active python interpreter / venv.
Safe to run repeatedly.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, HERE)

from alembic import command                      # noqa: E402
from alembic.config import Config                # noqa: E402

cfg = Config(os.path.join(HERE, "alembic.ini"))
cfg.set_main_option("script_location", os.path.join(HERE, "alembic"))
command.upgrade(cfg, "head")
print("ORB database is up to date.")
