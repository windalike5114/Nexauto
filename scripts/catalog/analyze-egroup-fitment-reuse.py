"""Re-run the original V6 source matcher against the additive Egroup catalogue.

The original supplier workbooks remain unchanged. This wrapper changes only the
input vehicle SQLite database and output directory before executing the audited
matcher used to produce data/fitment-v6.
"""

from pathlib import Path


ROOT = Path(r"C:\Users\Sanli\Documents\nexauto")
BUILDER = Path(
    r"C:\Users\Sanli\Documents\Codex\2026-10-21\referenced-chatgpt-conversation-this-is-an"
    r"\work\build_fitment_match_test.py"
)
EGROUP_DB = ROOT / "outputs" / "vehicle-library-egroup-20261024" / "package" / "vehicle_catalog.sqlite"
OUTPUT = ROOT / "outputs" / "egroup-fitment-reuse-20261024" / "legacy-source-rematch"


source = BUILDER.read_text(encoding="utf-8")
source = source.replace(
    'BASE_DB = ROOT / "outputs" / "nexautoparts_vehicle_database" / "vehicle_catalog.sqlite"',
    f'BASE_DB = Path(r"{EGROUP_DB}")',
)
source = source.replace(
    'OUT = ROOT / "outputs" / "nexautoparts_fitment_test"',
    f'OUT = Path(r"{OUTPUT}")',
)

if f'BASE_DB = Path(r"{EGROUP_DB}")' not in source:
    raise RuntimeError("Could not redirect matcher vehicle database.")
if f'OUT = Path(r"{OUTPUT}")' not in source:
    raise RuntimeError("Could not redirect matcher output directory.")

exec(compile(source, str(BUILDER), "exec"), {"__name__": "__main__"})
