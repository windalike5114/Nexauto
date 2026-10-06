# 车型库与产品适配数据库升级方案

## 目标

车型库是所有产品线共享的数据库主干。雨刷数据只提供产品适配证据，不能反向创建或覆盖标准品牌、车型、世代、版本和底盘身份。

本次升级采用增量迁移。旧表继续服务现有车型查询、客户车库和订单快照，新表完成清洗和审核后再切换读取。

## 标准数据层级

```text
vehicle_makes
  -> vehicle_models
    -> vehicle_generations
      -> vehicle_variants
        -> vehicle_fitment_applications
```

- `vehicle_makes`：品牌标准名称和独立 UUID。
- `vehicle_models`：品牌下的车型标准名称和独立 UUID。
- `vehicle_generations`：车型世代或平台代号，例如 E210。
- `vehicle_variants`：车身和具体版本。Sedan、Hatchback、Wagon 等分别保留。
- `vehicle_chassis_codes`：独立底盘代码字典，通过关联表绑定世代或版本。
- `vehicle_fitment_applications`：市场、左右舵和生产年份范围组成的可适配车辆记录。

不能仅凭底盘代号合并车型。相同底盘可能跨车身、年份或市场，雨刷配置也可能不同。

## 来源和清洗

每份来源先进入以下三层：

1. `catalog_import_batches` 保存文件、工作表、哈希和导入状态。
2. `catalog_source_records` 保存不可变的原始行和规范化候选值。
3. `source_entity_mappings` 把来源行映射到标准品牌、车型、世代、版本、底盘或适配车辆。

名称统一使用 Unicode NFKC、去首尾空格、压缩连续空格，并分别生成用于匹配的标准键。展示名称保留正确大小写。所有来源写法进入 `vehicle_entity_aliases`，不覆盖标准名称。

当前来源角色：

| 来源 | 主要用途 | 是否可以直接覆盖车型主干 |
| --- | --- | --- |
| Machter 车型库 | 车型主干 | 审核后可以 |
| Toyota NZ 年份表 | Toyota 市场和世代核验 | 只修正 Toyota，且保留证据 |
| Wiper Master | 雨刷适配观察 | 不可以 |
| CAT078 | 雨刷适配观察 | 不可以 |
| 日韩系雨刷表 | 雨刷适配观察和交叉核验 | 不可以 |

不同来源内容一致时可以提高置信度，但仍保留每条来源观察。内容冲突、身份不明确或非法尺寸写入 `fitment_review_queue`。

## 雨刷标准

数据库统一使用整数英寸 `smallint`。

- 前雨刷：`14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30`
- 后雨刷：`8, 10, 11, 12, 13, 14, 15, 16`

`wiper_sizes` 是唯一合法尺寸字典。`wiper_configuration_blades` 通过复合外键同时校验位置和尺寸，防止把后雨刷尺寸误用于前雨刷。

毫米来源只使用明确的行业规格别名转换，例如 `600 mm -> 24 in`。不在映射表中的毫米数以及非法英寸不自动四舍五入，进入审核队列。

雨刷配置分别保存：

- `driver`
- `passenger`
- `rear`

后雨刷另有 `fitted`、`not_applicable`、`unknown`、`conflicting` 状态，避免把“没有后雨刷”和“来源缺失”混为一谈。

## 产品适配

- `vehicle_wiper_fitments`：标准车辆适配记录到标准雨刷配置。
- `vehicle_product_fitments`：标准车辆适配记录到可销售的 `product_variants`，供雨刷、滤芯、刹车片、灯泡等产品线共用。
- `wiper_fitment_observations`：每个来源提供的雨刷证据，不直接作为前台结果。

同一车辆适配记录最多只有一条 `published` 雨刷配置。候选或冲突配置保留为 `draft`、`review` 或 `rejected`。

## 迁移步骤

### 第一阶段：结构和输入约束

- 创建 V2 车型、来源、别名、映射、审核、雨刷配置和通用产品适配表。
- 给客户车辆、订单项目、订单车型快照和雨刷履约记录增加 V2 外键。
- 保留原 `vehicle_application_id`，不删除旧数据。
- 导入器拦截非法雨刷尺寸并保留原始值。

### 第二阶段：车型主干导入

- 先导入 Machter 车型库的品牌、车型、世代、版本和底盘。
- 对名称和底盘建立别名。
- Toyota NZ 数据只作为核验和补充来源。
- 身份无法唯一确定的记录进入审核队列。

当前实现已经提供 `import-vehicle-catalog-v2.mjs`：

- 使用文件 SHA-256 防止同一来源文件重复导入。
- 保存全部 1,837 条来源行，不因清洗失败丢弃原始数据。
- 品牌和车型父级可以在第三层不完整时继续建立标准 ID。
- 只有年份和第三层来源 ID 完整的记录才建立正式世代、版本和 AU 适配范围。
- `Hatchback/Sedan` 等组合来源会拆成两个独立车型版本，同时保留同一来源记录映射。
- 底盘代码采用保守提取；营销文字和 `Series`、`GEN`、`MK` 等标记不会直接当成底盘代码。

当前报告结果为 68 个品牌、798 个车型、1,816 条可发布第三层记录和 21 条待审核记录。预计形成 1,814 个世代、1,820 个标准版本及 1,219 个底盘代码候选。正式写入前仍需在测试数据库复核底盘候选。

### 第三阶段：雨刷观察导入和合并

- Wiper Master、CAT078、Toyota NZ 和日韩系表分别导入为来源观察。
- 按品牌、车型、世代/底盘、年份、车身、市场和左右舵匹配标准车辆。
- 仅在标准车辆身份和全部位置尺寸一致时复用同一个雨刷配置。
- Sedan 和 Hatchback 默认不合并；审核确认完全一致后可以复用配置，但车型版本仍保持独立。

当前第三阶段预检已实现：

- `analyze-wiper-source-matches.mjs` 同时读取四个雨刷来源和 Machter 主干，生成只读匹配报告。
- 共生成 4,196 条来源观察，其中 3,605 条尺寸和基本字段通过，893 条达到高置信车型匹配。
- 识别出 99 组跨来源完全重复配置；来源证据保留，但标准雨刷配置复用。
- 识别出 68 组同一车型目标存在不同配置；全部进入审核，不覆盖、不发布。
- CAT078 缺少车身和底盘字段，因此 0 条自动匹配，323 条保留为车型候选，避免 Sedan/Hatchback 误合并。
- `import-wiper-observations-v2.mjs` 可把预检结果写入 V2 来源、观察、映射和审核表；所有新适配默认 `review`，自动发布数为 0。

详细待审核记录见 `docs/vehicle-catalog-review-notes.md`。

### 第四阶段：双读和切换

- 使用 `legacy_vehicle_application_map` 建立旧 ID 到 V2 ID 的审核映射。
- 应用先双读，再双写客户车辆和订单关联。
- 对比新旧查询结果、订单快照和履约数据。
- 全部核验完成后把前台查询切到 V2；旧表进入只读归档，不直接删除。

## 发布门槛

一条适配数据只有满足以下条件才可以发布：

- 品牌、车型、世代已映射到标准 UUID。
- 需要区分车身时已映射到标准 `vehicle_variant_id`。
- 年份范围有效，市场和左右舵明确。
- 前雨刷两个位置都有合法尺寸。
- 后雨刷状态明确；`fitted` 时必须有合法尺寸。
- 不存在未解决的身份冲突或尺寸冲突。
- 至少有一条可追溯来源记录。

## 已落地文件

- `supabase/migrations/20261006_vehicle_catalog_v2.sql`
- `scripts/fitment/wiper-normalization.mjs`
- `scripts/fitment/vehicle-catalog-normalization.mjs`
- `scripts/fitment/import-vehicle-catalog-v2.mjs`
- `scripts/fitment/wiper-source-normalization.mjs`
- `scripts/fitment/vehicle-wiper-matcher.mjs`
- `scripts/fitment/analyze-wiper-source-matches.mjs`
- `scripts/fitment/import-wiper-observations-v2.mjs`
- `tests/vehicle-catalog-v2-migration.test.mjs`
- `tests/wiper-fitment-normalization.test.mjs`
- `tests/vehicle-catalog-normalization.test.mjs`
- `tests/wiper-source-normalization.test.mjs`
- `tests/vehicle-wiper-matcher.test.mjs`

本阶段尚未把迁移执行到远程 Supabase，也尚未发布清洗后的正式车型和雨刷适配数据。执行远程迁移前应先在测试数据库应用并运行回归查询。
