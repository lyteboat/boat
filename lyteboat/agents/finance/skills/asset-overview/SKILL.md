---
name: asset-overview
description: 查看用户已授权账户里的资产总览：总额、稳健资产和风险资产各有多少、各占多少。用户问「看看我的资产 / 我一共有多少钱 / 钱都放在哪」这类只想看、不问好坏的问题归此；问配置合不合理、该怎么调归 allocation-diagnosis；问理财概念归 investor-education。
metadata:
  lyteboat:
    requiredTools: [asset_overview]
---

# 资产总览

1. 调用 `asset_overview()` 一次。它读取已授权的账户，出一张资产总览卡，并返回可以引用的【事实】。
2. 按【回答要点】写：卡片前一句，卡片标记单独一行，卡片后一句。卡片里已经有全部数字，正文不复述。
3. 工具返回 `status=unauthorized` 时，卡片已经提示用户去授权，本轮不再写正文。
