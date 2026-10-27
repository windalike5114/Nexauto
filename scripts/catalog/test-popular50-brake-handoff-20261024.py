"""Offline QA for the handoff bundle; synthetic answers are never saved as results."""
import copy
import hashlib
import importlib.util
import json
import shutil
import sys
import uuid
from argparse import Namespace
from pathlib import Path

BASE = Path.cwd()
OUT = BASE / "outputs/brake-popular50-delegation-20261024"
PKG = OUT / "NexAuto_Popular50_Brake_Agents"
sys.path.insert(0, str(PKG / "tools"))
import task_io


def load_module(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read(file):
    return json.loads(file.read_text(encoding="utf-8-sig"))


def main():
    checks = []
    assert not task_io.integrity()
    checks.append("Bundle input hashes match")
    allocations = read(PKG / "assignments/all50.json")
    assert sorted(a["rank"] for a in allocations) == list(range(1, 51))
    assert [sum(a["worker"] == w for a in allocations) for w in ("W1", "W2", "W3")] == [17, 17, 16]
    apps = read(PKG / "local_data/applications.json")
    assert len(apps) == len({a["application_id"] for a in apps}) == 3501
    assert sum(len(a["years"]) for a in apps) == 20059
    assert all(a["years"] and all(2000 <= y <= 2026 for y in a["years"]) for a in apps)
    gaps = [a for a in apps if not a["published"]]
    assert len(gaps) == 1531 and sum(len(a["years"]) for a in gaps) == 8723
    assert sum(not a["v4_review_ids"] for a in gaps) == 902
    assert len(read(PKG / "local_data/model-years.json")) == 1350
    checks.append("All50 owned once; all3501 applications and20059 years preserved;1531 gaps include902 outsideV4")
    raw = [json.loads(line) for line in (OUT / "scope/all-applications.jsonl").read_text(encoding="utf-8").splitlines()]
    by_id = {a["application_id"]: a for a in raw}
    for a in apps:
        for key in ("series", "series_id", "body", "drive", "engine", "engine_codes", "years", "model_id", "variant_id", "powertrain_id"):
            assert a[key] == by_id[a["application_id"]][key]
    checks.append("Original IDs/chassis/body/drive/engine/discrete years unchanged")
    old = BASE / "outputs/brake-agent-v4-lowtoken-20261024/NexAuto_Brake_LowToken_V4"
    semantic = read(OUT / "first-round/summary.json")
    hash_entries = next(v for k, v in semantic.items() if isinstance(v, dict) and "results/LQ-01.json" in v)
    for name, digest in hash_entries.items():
        assert hashlib.sha256((old / name).read_bytes()).hexdigest() == digest
    checks.append(f"All{len(hash_entries)} original question/result/plan input hashes unchanged")
    clean = read(OUT / "first-round/clean-plan/summary.json")
    assert (clean["complete_candidate_proposals"], clean["partial_candidate_proposals"], clean["true_model_correction_applications"]) == (14, 158, 20)
    assert clean["production_changed"] is False
    checks.append("First-round offline cleanup:14 complete/158 partial proposals,20 model-correction applications")
    bank = task_io.questions()
    assert len(bank) == 10 and sum(q["status"] == "assigned_queued_not_researched" for q in bank.values()) == 9
    q = bank["P50-W1-1"]
    answer = {"question_id": q["question_id"], "status": "partial", "reviewer": "synthetic QA only",
              "reviewed_at": "2026-10-24T12:00:00+13:00", "evidence": [{"evidence_id": "E1", "url": "https://example.com/qa-only",
              "publisher": "Synthetic fixture", "locator": "fixture", "claim": "Not real evidence"}],
              "facts": [{"fact_id": "F1", "kind": "identity_confirmed", "group_ranks": [q["ranks"][0]],
              "series_codes": ["TEST"], "proposed_model": None, "supported_date_text": None,
              "evidence_ids": ["E1"], "claim": "Synthetic validation fixture, never imported"}],
              "unresolved": ["Synthetic remaining scope"]}
    assert not task_io.validate(answer)
    bad = copy.deepcopy(answer); bad["question_id"] = "unknown"; assert task_io.validate(bad)
    bad = copy.deepcopy(answer); bad["facts"][0]["evidence_ids"] = ["missing"]; assert task_io.validate(bad)
    bad = copy.deepcopy(answer); bad["evidence"].append(copy.deepcopy(bad["evidence"][0])); assert task_io.validate(bad)
    bad = copy.deepcopy(answer); bad["facts"].append(copy.deepcopy(bad["facts"][0])); assert task_io.validate(bad)
    bad = copy.deepcopy(answer); bad["facts"][0]["group_ranks"] = [next(r for r in range(1, 51) if r not in q["ranks"])]; assert task_io.validate(bad)
    bad = copy.deepcopy(answer); bad["status"] = "supported"; assert task_io.validate(bad)
    bad = copy.deepcopy(answer); bad["facts"][0]["db"] = "DB1234"; assert task_io.validate(bad)
    bad = copy.deepcopy(answer); bad["unresolved"] = ["x" * 4000]; assert task_io.validate(bad)
    unresolved = copy.deepcopy(answer); unresolved["facts"] = []; unresolved["evidence"] = []; unresolved["status"] = "unresolved"
    assert not task_io.validate(unresolved)
    checks.append("Validator rejects unknown scope, DB fields, duplicates, missing evidence IDs, false supported scope and excessive length")
    assert len(task_io.view(Namespace(rank=1, section="applications", offset=0, limit=2))["rows"]) == 2
    assert len(task_io.view(Namespace(rank=1, section="sources", offset=0, limit=2))["rows"]) <= 2
    original_root = task_io.ROOT
    scratch = OUT / ("qa-synthetic-" + uuid.uuid4().hex)
    scratch.mkdir()
    try:
        sandbox = scratch / "bundle"
        shutil.copytree(PKG, sandbox)
        task_io.ROOT = sandbox
        try:
            assert not task_io.integrity()
            empty = task_io.collect("collected/empty-qa")
            assert empty["answers_received"] == 0 and empty["pending_questions"] == 10
            (sandbox / "results/qa.json").write_text(json.dumps(answer), encoding="utf-8")
            partial = task_io.collect("collected/partial-qa")
            assert partial["answers_received"] == 1 and partial["pending_questions"] == 10
            for rejected in ("collected", "../escape", "collected/partial-qa"):
                try:
                    task_io.collect(rejected)
                except ValueError:
                    pass
                else:
                    raise AssertionError("Unsafe or existing output was accepted")
            (sandbox / "results/duplicate-qa.json").write_text(json.dumps(answer), encoding="utf-8")
            try:
                task_io.collect("collected/duplicate-qa")
            except ValueError:
                pass
            else:
                raise AssertionError("Duplicate answer accepted")
            assert not (sandbox / "collected/duplicate-qa").exists()
        finally:
            task_io.ROOT = original_root
    finally:
        # Delete only this test's freshly generated UUID-named child, never a workspace root.
        assert scratch.resolve().parent == OUT.resolve() and scratch.name.startswith("qa-synthetic-")
        shutil.rmtree(scratch)
    checks.append("Scoped views and isolated collection tested; pending answers retained, duplicates/path escape/overwrite rejected")
    mod = load_module("clean_plan_qa", BASE / "scripts/catalog/finalize-brake-round1-clean-plan-20261024.py")
    case = {"position": "front", "body": "", "drive": "2WD", "engine": "", "displacement_cc": 0}
    unknown = {"source_id": "U", "years": [2005, 0], "db": "DB1", "position": "front", "body": "", "drive": "2WD"}
    known = {**unknown, "source_id": "K", "years": [2005, 2020]}
    assert mod.bounded_assess(case, 2010, [unknown])["recommendation"] == "review_source_year_boundary_unknown"
    assert mod.bounded_assess(case, 2010, [unknown, known])["recommendation"] == "single_candidate_proposal"
    assert mod.bounded_assess(case, 2010, [unknown, {**known, "db": "DB2"}])["recommendation"] == "review_multiple_candidates"
    assert not mod.bounded_assess(case, 2010, [{**known, "drive": "4WD"}])["candidate_db"]
    assert not mod.bounded_assess(case, 2000, [unknown])["candidate_db"]
    checks.append("Unknown source ends retained without false unique; same-DB corroboration and drive exclusion tested")
    assert not list((PKG / "results").glob("*.json")) and not list((PKG / "collected").rglob("*.json"))
    assert not list(PKG.rglob("__pycache__"))
    report = {"valid": True, "checks": checks, "production_changed": False,
              "synthetic_fixtures_saved_as_results": False, "evidence_truth_verified": False}
    (OUT / "handoff-qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
