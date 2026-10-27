"""QA and UTF-8 ZIP packaging. Synthetic answers are only held in memory."""
import copy
import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path.cwd() / "outputs/brake-db-all73-prioritized-20261025/NexAuto_Brake_DB_All73_Prioritized"
sys.path.insert(0, str(ROOT / "tools"))
import task_io


def read(file):
    return json.loads((ROOT / file).read_text(encoding="utf-8"))


def main():
    task_io.integrity()
    index = read("index.json")
    scope = read("scope.json")
    assert len(index) == len({q["question_id"] for q in index}) == 73
    assert [q["priority_order"] for q in index] == list(range(1, 74))
    assert {p: sum(q["priority"] == p for q in index) for p in ("P0", "P1", "P2")} == {"P0": 18, "P1": 31, "P2": 24}
    original = json.loads(Path("outputs/brake-popular50-script-first-20261024/deliverable/AI_DB_ONLY/index.json").read_text(encoding="utf-8"))
    assert {q["question_id"] for q in index} == {q["question_id"] for q in original}
    deferred = json.loads(Path("outputs/brake-popular50-script-first-20261024/deliverable/deferred-source-and-catalog-problems.json").read_text(encoding="utf-8"))
    assert not {q["question_id"] for q in deferred} & {q["question_id"] for q in index}
    all_configs, all_cases, all_apps = set(), set(), set()
    source_ids = set()
    for q in index:
        task = read(q["question_file"])
        local = read(q["local_data_file"])
        cfg = {c["config_id"]: c for c in local["configurations_all"]}
        assert len(cfg) == q["configuration_count"] == task["configuration_count"]
        assert len(cfg) >= len(task["configuration_preview"])
        all_configs.update((q["question_id"], c) for c in cfg)
        for row in local["targets"]:
            assert row["case_id"] not in all_cases
            assert row["config_id"] in cfg and set(row["years"]) <= set(cfg[row["config_id"]]["years"])
            all_cases.add(row["case_id"]); all_apps.add(row["application_id"])
        source_ids.update(task["existing_source_ids"])
    assert (len(all_configs), len(all_cases), len(all_apps)) == (579, 587, 486)
    assert source_ids == set(read("reference/source-rows.json"))
    assert not list((ROOT / "results").glob("*.json"))
    assert not list((ROOT / "collected").rglob("*.json"))
    assert not list(ROOT.rglob("__pycache__"))
    base = read("reference/result-shape-example.json")["example_result"]
    assert not task_io.validate(base)
    cfg = read(f"local_data/{base['question_id']}.json")["configurations_all"][0]
    valid = copy.deepcopy(base)
    valid["status"] = "resolved"; valid["unresolved"] = []
    valid["evidence"] = [{"evidence_id": "QA", "url": "https://example.com/synthetic-qa-only",
                          "publisher": "Synthetic fixture", "locator": "fixture", "claim": "Not real evidence"}]
    valid["findings"] = [{"finding_id": "QA", "config_ids": [cfg["config_id"]], "position": cfg["position"],
                          "years": cfg["years"], "decision": "db_confirmed", "db": "DB1234", "conditions": [],
                          "evidence_ids": ["QA"], "claim": "Synthetic fixture, never stored as a result"}]
    assert not task_io.validate(valid)
    invalid = copy.deepcopy(valid); invalid["findings"][0]["db"] = None; assert task_io.validate(invalid)
    invalid = copy.deepcopy(valid); invalid["findings"][0]["position"] = "rear" if cfg["position"] == "front" else "front"; assert task_io.validate(invalid)
    invalid = copy.deepcopy(valid); invalid["findings"][0]["years"] = [2100]; assert task_io.validate(invalid)
    invalid = copy.deepcopy(valid); invalid["findings"][0]["evidence_ids"] = ["missing"]; assert task_io.validate(invalid)
    invalid = copy.deepcopy(valid); invalid["scope_config_ids"] = ["not-in-input"]; assert task_io.validate(invalid)
    invalid = copy.deepcopy(valid); invalid["findings"][0]["identity_only"] = True; assert task_io.validate(invalid)
    invalid = copy.deepcopy(valid); invalid["findings"].append({**invalid["findings"][0], "finding_id": "QA2", "db": "DB4321"}); assert task_io.validate(invalid)
    report = {"valid": True, "tasks": 73, "priority_counts": scope["priority_counts"], "full_configurations": 579,
              "application_position_cases": 587, "unique_applications": 486, "deferred_tasks_excluded": 76,
              "synthetic_answers_saved_as_results": False, "production_changed": False,
              "checks": ["All executable IDs included once; no deferred task included", "All complete local configurations retained, not just previews",
                         "Sources correspond exactly to included tasks", "Manifest input hashes match", "Missing DB, identity-only fields, wrong axle/year/scope/evidence and conflicting answers rejected"]}
    (ROOT / "qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    archive = ROOT.parent / "NexAuto_Brake_DB_All73_Prioritized_2026-10-25.zip"
    if archive.exists():
        raise ValueError("Archive exists; preserve it and choose another name")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(ROOT.name + "/results/", "")
        z.writestr(ROOT.name + "/collected/", "")
        for file in sorted(ROOT.rglob("*")):
            if file.is_file():
                z.write(file, ROOT.name + "/" + file.relative_to(ROOT).as_posix())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        prefix = ROOT.name + "/"
        for name, expected in read("manifest.json")["input_sha256"].items():
            assert hashlib.sha256(z.read(prefix + name)).hexdigest() == expected
        for name in ("START_HERE.txt", "任务优先级与目录.txt", "qa.json"):
            assert prefix + name in z.namelist()
        assert z.getinfo(prefix + "任务优先级与目录.txt").flag_bits & 0x800
    print(json.dumps({**report, "archive": str(archive), "zip_valid": True, "bytes": archive.stat().st_size}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
