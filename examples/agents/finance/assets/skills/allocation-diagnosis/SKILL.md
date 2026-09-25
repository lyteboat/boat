---
name: allocation-diagnosis
description: 按「100 减年龄」的公开常识诊断用户的资产配置是否合理，并给出方向性的调整建议。用户问「我的配置合理吗 / 健康吗 / 该怎么调 / 帮我诊断」归此；只想看资产、不问好坏归 asset-overview；问理财概念归 investor-education。
metadata:
  lyteboat:
    requiredTools: [allocation_diagnosis]
---

# 配置诊断

1. 调用 `allocation_diagnosis()` 一次。它出一张诊断卡和一张调整方向卡，并返回结论和可以引用的【事实】。
2. 按【回答要点】写：先给结论，两张卡片的标记各自单独一行，数字只照抄【事实】。
3. 用户追问结论的依据时，直接从最近一次的【事实】里答，不用再调用工具。
4. 工具返回 `status=unauthorized` 时，卡片已经提示用户去授权，本轮不再写正文。
