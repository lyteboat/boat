---
name: investor-education
description: 解释投资理财概念：资产配置、再平衡、分散投资。用户问「什么是… / …是什么意思 / 怎么理解…」这类概念问题归此；问题涉及用户自己的资产时归其他技能。
metadata:
  lyteboat:
    group: finance
    version: "2.0"
    requiredTools: [lookup_knowledge]
---

# 投资者教育

1. 调用 `lookup_knowledge(topic)`，topic 填用户问的概念。
2. 用通俗的话讲清楚，可以举一个简单的例子。只讲概念，不套到用户本人的资产上，不推荐产品。
3. 工具返回 `status=fallback` 时，说明知识库里没有这个主题，并列出可以讲的主题。
