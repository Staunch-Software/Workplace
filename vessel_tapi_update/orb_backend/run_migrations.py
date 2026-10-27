"""Bring the vessel's ORB database to the latest schema (what `alembic upgrade head` does).

Run from C:\WORKPLACE\orb_backend with the bundled python. Used instead of create_all so that columns added
later reach vessels that already hold data. Safe to run again.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, HERE)

from alembic import command                      # noqa: E402  (the real package, not ./alembic)
from alembic.config import Config                # noqa: E402

cfg = Config(os.path.join(HERE, "alembic.ini"))
cfg.set_main_option("script_location", os.path.join(HERE, "alembic"))
command.upgrade(cfg, "head")
print("ORB database is up to date.")
