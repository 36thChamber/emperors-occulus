"""Compatibility entrypoint for map browser QA (uses read-only AWS calls)."""
import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).with_name('map_check.py')), run_name='__main__')
