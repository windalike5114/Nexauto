"""Offline validator for the bundled NexAuto V2 schema subset and case semantics.

No dependencies, network access, database access, or evidence-truth verification.
This intentionally implements only the JSON Schema keywords used by this package.
"""
import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


def unique_object(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError(f"Duplicate JSON key: {key}")
        out[key] = value
    return out


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"),
                      object_pairs_hook=unique_object,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def check_schema(value, spec, root, loc="$", errors=None):
    errors = [] if errors is None else errors
    if "$ref" in spec:
        ref = root
        for part in spec["$ref"].split("/")[1:]:
            ref = ref[part]
        return check_schema(value, ref, root, loc, errors)
    if "anyOf" in spec:
        if not any(not check_schema(value, branch, root, loc, []) for branch in spec["anyOf"]):
            errors.append(f"{loc}: does not match any permitted shape")
        return errors
    types = spec.get("type", [])
    types = [types] if isinstance(types, str) else types
    tests = {"object": lambda v: isinstance(v, dict), "array": lambda v: isinstance(v, list),
             "string": lambda v: isinstance(v, str), "null": lambda v: v is None,
             "integer": lambda v: isinstance(v, int) and not isinstance(v, bool)}
    if types and not any(tests[t](value) for t in types):
        errors.append(f"{loc}: expected {types}")
        return errors
    if "const" in spec and value != spec["const"]:
        errors.append(f"{loc}: invalid constant")
    if "enum" in spec and value not in spec["enum"]:
        errors.append(f"{loc}: invalid enum")
    if isinstance(value, dict):
        for key in spec.get("required", []):
            if key not in value:
                errors.append(f"{loc}.{key}: missing required field")
        props = spec.get("properties", {})
        for key, val in value.items():
            if key in props:
                check_schema(val, props[key], root, f"{loc}.{key}", errors)
            elif spec.get("additionalProperties") is False:
                errors.append(f"{loc}.{key}: unexpected field")
    elif isinstance(value, list):
        if len(value) < spec.get("minItems", 0):
            errors.append(f"{loc}: too few items")
        if spec.get("uniqueItems") and len({json.dumps(v, sort_keys=True) for v in value}) != len(value):
            errors.append(f"{loc}: duplicate items")
        for index, val in enumerate(value):
            if "items" in spec:
                check_schema(val, spec["items"], root, f"{loc}[{index}]", errors)
    elif isinstance(value, str):
        if len(value.strip()) < spec.get("minLength", 0):
            errors.append(f"{loc}: empty string")
        if "pattern" in spec and not re.search(spec["pattern"], value):
            errors.append(f"{loc}: invalid pattern")
        if spec.get("format") == "date-time":
            try:
                parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
                if parsed.tzinfo is None or "T" not in value:
                    raise ValueError()
            except ValueError:
                errors.append(f"{loc}: expected ISO date-time with timezone")
        if spec.get("format") == "uri":
            parsed = urlparse(value)
            if parsed.scheme not in ("http", "https") or not parsed.hostname:
                errors.append(f"{loc}: expected absolute HTTP(S) URL")
    elif isinstance(value, int) and not isinstance(value, bool):
        if value < spec.get("minimum", value) or value > spec.get("maximum", value):
            errors.append(f"{loc}: outside permitted range")
    return errors


def validate(data, batch, comparison, schema):
    errors = check_schema(data, schema, schema)
    if errors:
        return errors
    for key in ("schema_version", "batch_id", "batch_fingerprint"):
        if data[key] != batch[key]:
            errors.append(f"{key}: differs from input")
    targets = batch["targets"]
    evidence = {e["evidence_id"]: e for e in data["evidence"]}
    findings = {f["finding_id"]: f for f in data["findings"]}
    results = {r["review_id"]: r for r in data["results"]}
    for label, mapping, rows in (("evidence", evidence, data["evidence"]),
                                 ("findings", findings, data["findings"]),
                                 ("results", results, data["results"])):
        if len(mapping) != len(rows):
            errors.append(f"{label}: duplicate IDs")
    if set(results) != set(targets):
        errors.append(f"results: missing={sorted(set(targets)-set(results))}; extra={sorted(set(results)-set(targets))}")
    for fid, finding in findings.items():
        if set(finding["review_ids"]) - set(targets):
            errors.append(f"{fid}: unknown review IDs")
        if set(finding["evidence_ids"]) - set(evidence):
            errors.append(f"{fid}: unknown evidence IDs")
        for rid in finding["review_ids"]:
            if rid in results and fid not in results[rid]["finding_ids"]:
                errors.append(f"{fid}: target {rid} does not reference finding")
    for rid, result in results.items():
        if rid not in targets:
            continue
        target = targets[rid]
        covered, unresolved = set(result["covered_years"]), set(result["unresolved_years"])
        if covered & unresolved or covered | unresolved != set(target["years"]):
            errors.append(f"{rid}: covered/unresolved years must partition target years")
        if set(result["finding_ids"]) - set(findings):
            errors.append(f"{rid}: unknown finding IDs")
        used = [findings[f] for f in result["finding_ids"] if f in findings]
        if any(rid not in f["review_ids"] for f in used):
            errors.append(f"{rid}: finding does not explicitly support this target")
        fit = [f for f in used if f["kind"] == "fitment" and f["position"] == target["position"]]
        decision = result["decision"]
        identity = result["identity_status"]
        if identity == "correction_proposed" and not any(f["kind"] == "identity" for f in used):
            errors.append(f"{rid}: identity correction requires an evidenced identity finding")
        if identity == "confirmed_as_is" and not used:
            errors.append(f"{rid}: confirmed identity requires an evidenced finding")
        if identity == "correction_proposed" and result["proposed_vehicle"] is None:
            errors.append(f"{rid}: correction requires proposed_vehicle")
        if identity != "correction_proposed" and result["proposed_vehicle"] is not None:
            errors.append(f"{rid}: proposed_vehicle requires correction_proposed")
        if decision in ("keep_current", "replace_db", "split_fitment") and identity != "confirmed_as_is":
            errors.append(f"{rid}: confirm target identity or return catalog_correction first")
        if decision in ("keep_current", "replace_db"):
            if result["fitment_status"] != "supported" or not result["confirmed_db"]:
                errors.append(f"{rid}: keep/replace requires supported fitment and DB")
            if unresolved or result["unresolved_questions"] or result["confidence"] == "unknown":
                errors.append(f"{rid}: keep/replace cannot have unresolved scope")
            current = comparison["comparisons"][rid]["current_db"]
            if (decision == "keep_current") != (result["confirmed_db"] == current):
                errors.append(f"{rid}: keep/replace disagrees with current DB comparison")
        if decision == "split_fitment":
            if result["fitment_status"] not in ("supported", "conditional") or result["confirmed_db"] is not None:
                errors.append(f"{rid}: split requires supported/conditional and null top-level DB")
            if not fit or not any(f["conditions"] for f in fit):
                errors.append(f"{rid}: split requires condition-specific fitment findings")
        if decision == "catalog_correction" and identity != "correction_proposed":
            errors.append(f"{rid}: catalog_correction requires identity correction")
        if decision == "not_applicable" and result["fitment_status"] != "excluded":
            errors.append(f"{rid}: not_applicable requires excluded fitment")
        if decision == "unable_to_determine":
            if result["confirmed_db"] is not None or not result["unresolved_questions"] or not unresolved:
                errors.append(f"{rid}: unresolved result needs null DB, unanswered questions and unresolved years")
        if result["fitment_status"] in ("supported", "conditional", "excluded"):
            relevant = [f for f in fit if f["db"] is not None and
                        (result["confirmed_db"] is None or f["db"] == result["confirmed_db"])]
            supported_years = set().union(*(set(f["years"]) for f in relevant)) if relevant else set()
            if not relevant or not covered or not covered <= supported_years:
                errors.append(f"{rid}: fitment conclusion lacks position/DB/year-specific findings")
        cfg = result["proposed_vehicle"] or batch["configs"][target["config_id"]]
        for finding in fit:
            if any(str(finding["vehicle"][k]).strip().casefold() != str(cfg[k]).strip().casefold()
                   for k in ("make", "model", "series")):
                errors.append(f"{rid}: fitment finding vehicle differs; normalize aliases explicitly")
            for key in ("body", "drive"):
                if cfg.get(key) and finding["vehicle"].get(key) != cfg[key]:
                    errors.append(f"{rid}: finding must retain known target {key}")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--result", required=True, type=Path)
    args = parser.parse_args()
    try:
        batch = read_json(args.input)
        package = args.input.resolve().parents[2]
        schema = read_json(package / batch["result_schema_file"])
        comparison = read_json(package / batch["comparison_file"])
        errors = validate(read_json(args.result), batch, comparison, schema)
        print(json.dumps({"valid": not errors, "batch_id": batch["batch_id"],
                          "target_count": len(batch["targets"]), "errors": errors,
                          "notice": "Structure/scope checks only. Evidence truth not verified; no publishing performed."},
                         ensure_ascii=False, indent=2))
        return 1 if errors else 0
    except (ValueError, KeyError, OSError, TypeError) as exc:
        print(json.dumps({"valid": False, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
