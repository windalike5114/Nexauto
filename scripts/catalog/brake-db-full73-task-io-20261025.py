"""Full DB-task package reader/validator. Offline only; does not apply answers."""
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
    qid = data["question_id"]
    if not re.fullmatch(r"DBQ-[0-9a-f]{12}", qid) or not (ROOT / "questions" / (qid + ".json")).is_file():
        return ["Unknown task ID"]
    all_cfg = read(f"local_data/{qid}.json")["configurations_all"]
    configs = {c["config_id"]: c for c in all_cfg}
    selected = set(data["scope_config_ids"])
    if selected - set(configs):
        return ["Unknown config ID in work slice"]
    if len(json.dumps(data, ensure_ascii=False, separators=(",", ":"))) > 12000:
        errors.append("Result exceeds 12000 characters; split into smaller work slices")
    evidence = {e["evidence_id"]: e for e in data["evidence"]}
    if len(evidence) != len(data["evidence"]):
        errors.append("Duplicate evidence IDs")
    if len({f["finding_id"] for f in data["findings"]}) != len(data["findings"]):
        errors.append("Duplicate finding IDs")
    covered = {cid: {} for cid in selected}
    pending = {cid: set() for cid in selected}
    for f in data["findings"]:
        if set(f["config_ids"]) - selected:
            errors.append("Finding outside declared work slice")
        if set(f["evidence_ids"]) - set(evidence):
            errors.append("Finding references missing evidence")
        if f["decision"] == "db_confirmed" and not re.fullmatch(r"DB\d+[A-Z]*", f["db"] or ""):
            errors.append("db_confirmed requires a canonical DB number")
        if f["decision"] == "not_applicable" and f["db"] is not None:
            errors.append("not_applicable must have null DB")
        for cid in set(f["config_ids"]) & selected:
            cfg = configs[cid]
            if f["position"] != cfg["position"] or set(f["years"]) - set(cfg["years"]):
                errors.append(f"{cid}: position or years outside target")
            value = (f["decision"], f["db"], tuple(f["conditions"]))
            for y in f["years"]:
                if y in covered[cid] and covered[cid][y] != value:
                    errors.append(f"{cid}/{y}: conflicting findings; retain as unresolved")
                covered[cid][y] = value
    for item in data["unresolved"]:
        cid = item["config_id"]
        if cid not in selected:
            errors.append("Unresolved config outside work slice")
            continue
        yy = set(item["years"])
        if yy - set(configs[cid]["years"]) or yy & pending[cid]:
            errors.append(f"{cid}: unknown or duplicate unresolved years")
        pending[cid].update(yy)
    for cid in selected:
        hit = set(covered[cid])
        if hit & pending[cid] or hit | pending[cid] != set(configs[cid]["years"]):
            errors.append(f"{cid}: findings/unresolved must exactly partition work-slice years")
    if data["status"] == "resolved" and (not data["findings"] or data["unresolved"]):
        errors.append("resolved requires direct DB or drum findings and no unresolved slice")
    if data["status"] == "partial" and (not data["findings"] or not data["unresolved"]):
        errors.append("partial requires both findings and unresolved scope")
    if data["status"] == "unresolved" and data["findings"]:
        errors.append("Use partial when some fitment findings exist")
    return errors


def integrity():
    for name, expected in read("manifest.json")["input_sha256"].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Changed task input: {name}")


def collect(output):
    dest = (ROOT / output).resolve()
    if (ROOT / "collected").resolve() not in dest.parents or dest.exists():
        raise ValueError("Choose a new child of collected; never overwrite results")
    answers, work_ids, resolved, conflicts, conditional = [], set(), {}, [], set()
    for p in sorted((ROOT / "results").glob("*.json")):
        data = read_json(p); errors = validate(data)
        if errors:
            raise ValueError(f"{p.name}: {errors}")
        key = (data["question_id"], data["work_id"])
        if key in work_ids:
            raise ValueError("Duplicate work_id for the same task")
        work_ids.add(key); answers.append(data)
        for f in data["findings"]:
            for cid in f["config_ids"]:
                for y in f["years"]:
                    k = (data["question_id"], cid, y)
                    signature = json.dumps([f["decision"], f["db"], f["conditions"]], sort_keys=True)
                    if k in resolved and resolved[k] != signature:
                        conflicts.append({"question_id": k[0], "config_id": cid, "year": y})
                    resolved[k] = signature
                    if f["conditions"]:
                        conditional.add(k)
    conflict_keys = {(c["question_id"], c["config_id"], c["year"]) for c in conflicts}
    remaining = []
    for q in read("index.json"):
        data = read(f"local_data/{q['question_id']}.json")
        for cfg in data["configurations_all"]:
            pending = [y for y in cfg["years"] if (q["question_id"], cfg["config_id"], y) not in resolved
                       or (q["question_id"], cfg["config_id"], y) in conflict_keys
                       or (q["question_id"], cfg["config_id"], y) in conditional]
            if pending:
                remaining.append({"question_id": q["question_id"], "config_id": cfg["config_id"], "years": pending})
    dest.mkdir(parents=True, exist_ok=False)
    result = {"result_files": len(answers), "remaining_configurations": len(remaining), "cross_result_conflicts": len(conflicts),
              "conditional_config_years_awaiting_local_match": len(conditional),
              "production_changed": False, "evidence_truth_verified": False,
              "notice": "Collection only. Conditional findings still require condition matching; no result is imported."}
    for filename, value in (("answers.json", answers), ("remaining-configurations.json", remaining),
                            ("conflicts.json", conflicts), ("summary.json", result)):
        (dest / filename).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    s = p.add_subparsers(dest="command", required=True)
    s.add_parser("status")
    v = s.add_parser("view"); v.add_argument("--question", required=True); v.add_argument("--offset", type=int, default=0)
    v.add_argument("--limit", type=int, choices=range(1, 31), default=8)
    c = s.add_parser("check"); c.add_argument("--result", required=True, type=Path)
    c = s.add_parser("collect"); c.add_argument("--output", required=True)
    args = p.parse_args()
    try:
        integrity()
        if args.command == "status":
            result = read("scope.json")
        elif args.command == "view":
            if not re.fullmatch(r"DBQ-[0-9a-f]{12}", args.question) or args.offset < 0:
                raise ValueError("Invalid question or offset")
            cfg = read(f"local_data/{args.question}.json")["configurations_all"]
            result = {"question_id": args.question, "total_configs": len(cfg), "offset": args.offset,
                      "configurations": cfg[args.offset:args.offset + args.limit]}
        elif args.command == "check":
            errors = validate(read_json(args.result))
            print(json.dumps({"valid": not errors, "errors": errors, "evidence_truth_verified": False}, ensure_ascii=False, indent=2))
            return 1 if errors else 0
        else:
            result = collect(args.output)
        print(json.dumps(result, ensure_ascii=False, indent=2)); return 0
    except (ValueError, OSError, TypeError, KeyError) as exc:
        print(json.dumps({"valid": False, "error": str(exc), "production_changed": False}, ensure_ascii=False)); return 2


if __name__ == "__main__":
    sys.exit(main())
