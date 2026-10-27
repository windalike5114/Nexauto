from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path


ROOT = Path(r"C:\Users\Sanli\Documents\nexauto")
BUILDER = Path(r"C:\Users\Sanli\Documents\Codex\2026-10-21\referenced-chatgpt-conversation-this-is-an\work\build_vehicle_database.py")
SOURCE = Path(r"C:\Users\Sanli\Desktop\车型库\Egroup\data")
OUTPUT_ROOT = ROOT / "outputs" / "vehicle-library-egroup-20261024" / "package"


if not BUILDER.exists():
    raise FileNotFoundError(f"Vehicle library builder not found: {BUILDER}")
if not (SOURCE / "records.jsonl").exists():
    raise FileNotFoundError(f"Egroup records not found: {SOURCE / 'records.jsonl'}")

spec = spec_from_file_location("nexauto_vehicle_database_builder", BUILDER)
builder = module_from_spec(spec)
spec.loader.exec_module(builder)

builder.GROUPS = {"E": SOURCE}
builder.OUTPUT_ROOT = OUTPUT_ROOT
builder.ZIP_PATH = OUTPUT_ROOT.parent / "NexAutoParts_车型库_Egroup_2026-10-24.zip"
builder.REPORT_JSON = OUTPUT_ROOT.parent / "vehicle_build_report.json"
builder.main()
