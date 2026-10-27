"""Validate/collect sparse DB fitment answers offline. Never applies results."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from schema_subset import read_json, check_schema

ROOT = Path(__file__).resolve().parents[1]


def read(name):
    return read_json(ROOT / name)


def validate(data):
    schema = read("result.schema.json")
    errors = check_schema(data, schema, schema)
    if errors:
        return errors
    qpath = ROOT / "questions" / (data["question_id"] + ".json")
    if not re.fullmatch(r"DBQ-[0-9a-f]{12}", data["question_id"]) or not qpath.is_file():
        return ["Unknown executable DB question"]
    q = read_json(qpath)
    if q["dispatch_lane"] != "ai_direct_db":
        errors.append("Question is not in the direct-DB execution lane")
    if len(json.dumps(data, ensure_ascii=False, separators=(",", ":"))) > q["limits"]["max_result_characters"]:
        errors.append("Result exceeds character budget")
    evidence = {e["evidence_id"]: e for e in data["evidence"]}
    if len(evidence) != len(data["evidence"]) or len({e["url"] for e in data["evidence"]}) > 2:
        errors.append("Duplicate evidence IDs or more than two source pages")
    if len({f["finding_id"] for f in data["findings"]}) != len(data["findings"]):
        errors.append("Duplicate finding IDs")
    configs = {c["config_id"]: c for c in q["configurations"]}
    coverage = {cid: {} for cid in configs}
    for f in data["findings"]:
        if set(f["config_ids"]) - set(configs):
            errors.append(f"{f['finding_id']}: config outside this batch")
        if set(f["evidence_ids"]) - set(evidence):
            errors.append(f"{f['finding_id']}: evidence ID not supplied")
        if f["decision"] == "db_confirmed" and not re.fullmatch(r"DB\d+[A-Z]*", f["db"] or ""):
            errors.append(f"{f['finding_id']}: confirmed fitment requires a canonical DB number")
        if f["decision"] == "not_applicable" and f["db"] is not None:
            errors.append(f"{f['finding_id']}: drum/not-applicable finding must have null DB")
        for cid in f["config_ids"]:
            if cid not in configs:
                continue
            cfg = configs[cid]
            if f["position"] != cfg["position"]:
                errors.append(f"{cid}: front/rear cannot be mixed")
            if set(f["years"]) - set(cfg["years"]):
                errors.append(f"{cid}: unsupported added target years")
            for year in f["years"]:
                signature = (f["decision"], f["db"], tuple(f["conditions"]))
                if year in coverage[cid] and coverage[cid][year] != signature:
                    errors.append(f"{cid}/{year}: conflicting DBs/conditions; return unresolved instead")
                coverage[cid][year] = signature
    pending = {cid: set() for cid in configs}
    for item in data["unresolved"]:
        cid = item["config_id"]
        if cid not in configs:
            errors.append("Unknown unresolved config ID")
            continue
        if set(item["years"]) - set(configs[cid]["years"]):
            errors.append(f"{cid}: unresolved years outside target")
        if pending[cid] & set(item["years"]):
            errors.append(f"{cid}: repeated unresolved years")
        pending[cid].update(item["years"])
    for cid, cfg in configs.items():
        solved = set(coverage[cid])
        if solved & pending[cid] or solved | pending[cid] != set(cfg["years"]):
            errors.append(f"{cid}: findings and unresolved years must exactly partition target years")
    if data["status"] == "resolved" and (data["unresolved"] or not data["findings"]):
        errors.append("resolved requires direct DB/not-applicable findings and no unresolved scope")
    if data["status"] == "unresolved" and data["findings"]:
        errors.append("Use partial when some direct fitments are supported")
    if data["status"] == "partial" and (not data["findings"] or not data["unresolved"]):
        errors.append("partial requires both findings and unresolved scope")
    return errors


def integrity():
    for name, expected in read("manifest.json")["input_sha256"].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Modified task input: {name}")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    check = sub.add_parser("check"); check.add_argument("--result", type=Path, required=True)
    collect = sub.add_parser("collect"); collect.add_argument("--output", required=True)
    args = p.parse_args()
    try:
        integrity()
        if args.command == "status":
            result = {"executable_questions": len(read("index.json")), "first_batch": read("first10.json"),
                      "actual_result_files": len(list((ROOT / "results").glob("*.json"))), "production_changed": False}
        elif args.command == "check":
            errors = validate(read_json(args.result))
            result = {"valid": not errors, "errors": errors, "evidence_truth_verified": False, "production_changed": False}
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 1 if errors else 0
        else:
            dest = (ROOT / args.output).resolve()
            allowed = (ROOT / "collected").resolve()
            if allowed not in dest.parents or dest.exists():
                raise ValueError("Use a new child directory inside collected; never overwrite")
            answers, seen = [], set()
            for f in sorted((ROOT / "results").glob("*.json")):
                answer = read_json(f)
                errors = validate(answer)
                if errors:
                    raise ValueError(f"{f.name}: {errors}")
                if answer["question_id"] in seen:
                    raise ValueError("Duplicate answer for a question")
                seen.add(answer["question_id"]); answers.append(answer)
            dest.mkdir(parents=True, exist_ok=False)
            (dest / "answers.json").write_text(json.dumps(answers, ensure_ascii=False, indent=2), encoding="utf-8")
            pending = [q for q in read("index.json") if q["question_id"] not in seen]
            (dest / "unanswered-questions.json").write_text(json.dumps(pending, ensure_ascii=False, indent=2), encoding="utf-8")
            result = {"answers": len(answers), "unanswered": len(pending), "production_changed": False,
                      "notice": "Collection only, not imported. Partial/conditional answers still need local expansion and conflict checks."}
            (dest / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(json.dumps({"valid": False, "error": str(exc), "production_changed": False}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
