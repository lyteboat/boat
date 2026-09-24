---
name: asset-overview
description: 查看资产总览，只出 1 张资产卡，不诊断、不给配置建议。用户想看全部资产的观察类问题（资产分布 / 总资产多少 / 有多少钱 / 钱在哪 / 看看资产）归此；评价类（合不合理 / 健康吗 / 怎么优化）归 asset-diagnosis。
metadata:
  lyteboat:
    group: demo
    version: "1.0"
    requiredTools: [asset_overview]
---

# 资产总览

本 skill 激活的每一轮，第一个动作都是调用 `asset_overview()` 一次：它重新取数、重新备卡，并把资产状态写进会话。

终稿话术按工具 digest 组稿：卡前一句 ≤25 字的引导，卡后一句 ≤25 字的收尾；不复述卡内数字、占比与按钮文案。用户追问金额或占比时，逐字引用 digest 里的数字，不用总资产乘百分比推算。

只呈现客观分布；诊断、收益率、产品评价留给 asset-diagnosis。
