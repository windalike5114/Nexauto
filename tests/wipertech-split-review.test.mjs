import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeDecisionYears,
  parseSplitConfiguration,
  prepareCollapsibleSplitDecisions
} from "../scripts/catalog/wipertech-split-review.mjs";

test("collapses a split review when every confirmed segment has one configuration", () => {
  const parsed = parseSplitConfiguration("拆分：2011-2015=24/16/-；2016-2018=24/16/-；2019-2021=24/16/-；2022-2026=待核");
  assert.deepEqual(parsed.configurationKeys, ["24/16/-"]);
  assert.equal(parsed.knownSegments.length, 3);
  assert.equal(parsed.pendingSegments.length, 1);
});

test("retains multiple configurations as a non-collapsible split", () => {
  const parsed = parseSplitConfiguration("拆分：1990=18/19/12；1991=待核；1992-1997=19/19/13");
  assert.deepEqual(parsed.configurationKeys, ["18/19/12", "19/19/13"]);
});

test("rejects a split that contains only pending periods", () => {
  const prepared = prepareCollapsibleSplitDecisions([reviewRow({ final: "拆分：2018-2026=待核" })]);
  assert.equal(prepared.decisions.length, 0);
  assert.deepEqual(prepared.skipped[0].reasons, ["split_has_no_confirmed_configuration"]);
});

test("rejects generic series codes", () => {
  const prepared = prepareCollapsibleSplitDecisions([reviewRow({ series: "_N1_" })]);
  assert.equal(prepared.decisions.length, 0);
  assert.ok(prepared.skipped[0].reasons.includes("missing_or_generic_series_code"));
});

test("separates confirmed and inferred NexAuto years", () => {
  const prepared = prepareCollapsibleSplitDecisions([reviewRow({})]);
  const analysis = analyzeDecisionYears(prepared.decisions[0], [2015, 2016, 2025, 2026]);
  assert.deepEqual(analysis.confirmedYears, [2015, 2016, 2025]);
  assert.deepEqual(analysis.pendingYears, [2026]);
  assert.deepEqual(analysis.inferredYears, [2026]);
});

function reviewRow({
  final = "拆分：2015-2025=22/16/-；2026=待核",
  series = "GUN125"
}) {
  return {
    "审核ID": "WT-AI-TEST",
    "application_id": "ap_test",
    "审核结论": "拆分Application",
    "最终配置": final,
    "审核置信度": "中",
    "审核理由": "同一底盘已确认配置，尾年超出来源范围。",
    "审核证据": "vehicle_id=2915",
    "审核AI": "test",
    "审核时间": "2026-10-23T00:00:00Z",
    "底盘/Series代码": series,
    "Series名称": series,
    "车身": "Utility",
    "问题类型": "incomplete_year_coverage",
    "现网配置": "",
    "WiperTech建议配置": "22/16/-"
  };
}
