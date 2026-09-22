---
name: asset-diagnosis
description: 诊断资产配置是否合理，给出调整方向。用户问「合不合理 / 健康吗 / 状况如何 / 怎么优化 / 配置建议」归此；只想看资产分布归 asset-overview。
metadata:
  boat:
    group: demo
    version: "1.0"
    requiredTools: [diagnose_assets]
---

# 资产配置诊断

本 skill 激活的每一轮，先调用 `diagnose_assets()` 一次：它读取本会话已查询的资产状态，按三笔钱的目标区间给出判定。会话里还没有资产状态时，工具会说明需要先查看资产，你就引导用户先看资产。

话术：先给结论（合理 / 偏离），再按工具返回的判定逐条说明，最后给一个明确的下一步。不编造工具没有给出的数字。
