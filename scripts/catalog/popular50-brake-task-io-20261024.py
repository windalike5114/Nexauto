"""Local-only sparse-fact handoff. No network, database or fitment writes."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

from schema_subset import check_schema, read_json

ROOT = Path(__file__).resolve().parents[1]


def read(name):
    return read_json(ROOT / name)


def emit(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def questions():
    return {q["question_id"]: q for q in
            (read_json(p) for p in sorted((ROOT / "AI_ONLY/questions").glob("*.json")))}


def integrity():
    errors = []
    for name, expected in read("manifest.json")["data_sha256"].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            errors.append(f"Reference changed: {name}")
    return errors


def validate(data, bank=None):
    schema = read("AI_ONLY/result.schema.json")
    errors = check_schema(data, schema, schema)
    if errors:
        return errors
    bank = questions() if bank is None else bank
    q = bank.get(data["question_id"])
    if q is None:
        return ["Unknown question ID"]
    limits = q.get("limits", {})
    if len(json.dumps(data, ensure_ascii=False, separators=(",", ":"))) > limits.get("max_result_characters", 3500):
        errors.append("Result exceeds character budget")
    if len(data["facts"]) > limits.get("max_facts", 6):
        errors.append("Too many facts")
    evidence = {e["evidence_id"]: e for e in data["evidence"]}
    if len(evidence) != len(data["evidence"]):
        errors.append("Duplicate evidence IDs")
    if len({e["url"] for e in data["evidence"]}) > limits.get("max_opened_source_pages", 2):
        errors.append("Too many source pages")
    if len({f["fact_id"] for f in data["facts"]}) != len(data["facts"]):
        errors.append("Duplicate fact IDs")
    permitted = {"shared_identity": {"identity_confirmed", "model_correction"},
                 "source_discovery": {"source_catalog_found", "identity_confirmed", "model_correction"},
                 "source_year_semantics": {"year_boundary_unknown"}}[q["kind"]]
    for fact in data["facts"]:
        if fact["kind"] not in permitted:
            errors.append(f"{fact['fact_id']}: fact kind outside assigned question")
        if set(fact["group_ranks"]) - set(q["ranks"]):
            errors.append(f"{fact['fact_id']}: group outside assigned question")
        if set(fact["evidence_ids"]) - set(evidence):
            errors.append(f"{fact['fact_id']}: unknown evidence IDs")
        if fact["kind"] == "model_correction" and not (fact["proposed_model"] or "").strip():
            errors.append(f"{fact['fact_id']}: correction requires proposed_model")
        if fact["kind"] in {"identity_confirmed", "model_correction"} and not fact["series_codes"]:
            errors.append(f"{fact['fact_id']}: identity requires exact series codes")
    if data["status"] == "supported" and (not data["facts"] or data["unresolved"]):
        errors.append("supported requires facts and no unresolved scope; otherwise use partial")
    if data["status"] in {"unresolved", "budget_stop"} and not data["unresolved"]:
        errors.append("Unresolved/budget_stop must state the remaining question")
    return errors


def status():
    m = read("manifest.json")
    return {"baseline": m["baseline"], "snapshot_live": False,
            "workers": [{k: w[k] for k in ("worker_id", "model_groups", "gap_applications", "gaps_outside_v4", "status")}
                        for w in m["workers"]],
            "shared_research_queued": m["shared_research_queued"],
            "result_files_present": len(list((ROOT / "results").glob("*.json"))),
            "research_all50_complete": False, "production_changed": False,
            "notice": "Initial offline triage complete; presence of a result is not evidence verification or publication."}


def view(args):
    if args.section == "applications":
        rows = [a for a in read("local_data/applications.json") if a["rank"] == args.rank]
    else:
        idx = next(g for g in read("local_data/source-index.json") if g["rank"] == args.rank)
        source = read("local_data/source-rows.json")
        rows = [source[str(i)] for i in idx["source_row_ids"]]
    return {"rank": args.rank, "section": args.section, "total": len(rows),
            "offset": args.offset, "rows": rows[args.offset:args.offset + args.limit],
            "notice": "Retrieval clues only, not proof of compatible brake fitment."}


def collect(destination):
    dest = (ROOT / destination).resolve()
    allowed = (ROOT / "collected").resolve()
    if dest == allowed or allowed not in dest.parents:
        raise ValueError("Output must be a new child directory inside this package's collected directory")
    if dest.exists():
        raise ValueError("Output already exists; choose a new name to preserve earlier results")
    bank, answers, errors = questions(), {}, []
    for file in sorted((ROOT / "results").glob("*.json")):
        data = read_json(file)
        issues = validate(data, bank)
        if data.get("question_id") in answers:
            issues.append("Duplicate answer for question ID")
        if issues:
            errors.append({"file": file.name, "errors": issues})
        else:
            answers[data["question_id"]] = data
    if errors:
        raise ValueError(json.dumps(errors, ensure_ascii=False))
    pending = [q for qid, q in bank.items()
               if qid not in answers or answers[qid]["status"] != "supported"]
    facts = [{"question_id": qid, "worker_id": bank[qid]["worker_id"],
              "status": data["status"], "evidence": data["evidence"], "facts": data["facts"],
              "unresolved": data["unresolved"]} for qid, data in answers.items()]
    owners = [{"worker_id": worker, "assigned_shared_questions": 3,
               "answers_received": sum(bank[qid]["worker_id"] == worker and qid != "P50-DATA-00" for qid in answers),
               "supported_shared_questions": sum(bank[qid]["worker_id"] == worker and qid != "P50-DATA-00" and a["status"] == "supported"
                                                 for qid, a in answers.items())}
              for worker in ("W1", "W2", "W3")]
    summary = {"answers_received": len(answers), "pending_questions": len(pending),
               "shared_research_questions": 9, "offline_data_check": 1,
               "research_all50_complete": False, "production_changed": False,
               "evidence_truth_verified": False,
               "notice": "Sparse fact collection only. No application mapping, identity correction or fitment has been applied."}
    dest.mkdir(parents=True, exist_ok=False)
    for name, value in (("shared-facts.json", facts), ("pending-questions.json", pending),
                        ("owner-status.json", owners), ("summary.json", summary)):
        (dest / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"output": str(dest), **summary}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    p = sub.add_parser("view")
    p.add_argument("--rank", required=True, type=int, choices=range(1, 51))
    p.add_argument("--section", choices=("applications", "sources"), default="applications")
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--limit", type=int, choices=range(1, 51), default=15)
    p = sub.add_parser("check")
    p.add_argument("--result", required=True, type=Path)
    p = sub.add_parser("collect")
    p.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        errors = integrity()
        if errors:
            raise ValueError("; ".join(errors))
        if args.command == "status":
            emit(status())
        elif args.command == "view":
            if args.offset < 0:
                raise ValueError("offset must not be negative")
            emit(view(args))
        elif args.command == "check":
            errors = validate(read_json(args.result))
            emit({"valid": not errors, "errors": errors, "evidence_truth_verified": False,
                  "production_changed": False})
            return 1 if errors else 0
        else:
            emit(collect(args.output))
        return 0
    except (ValueError, OSError, KeyError, TypeError, StopIteration) as exc:
        emit({"valid": False, "error": str(exc), "production_changed": False})
        return 2


if __name__ == "__main__":
    sys.exit(main())
