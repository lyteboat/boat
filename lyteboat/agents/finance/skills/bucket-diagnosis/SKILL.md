---
name: bucket-diagnosis
description: 细看某一笔钱（日常开销、稳健投资、进取收益之一）：占比、建议区间、由哪些账户组成。用户说「日常那笔细看一下 / 进取收益那块怎么样 / 看看下一笔」归此；没说清是哪一笔时先问用户，不要猜。整体配置是否合理归 allocation-diagnosis。
metadata:
  lyteboat:
    group: finance
    version: "1.0"
    requiredTools: [bucket_diagnosis]
---

# 单项下钻

1. 先确定是哪一笔钱：日常开销（活期、货币基金）、稳健投资（定期、债券、理财）、进取收益（股票、基金）。用户说「下一笔」时，按日常开销、稳健投资、进取收益的顺序接着上一次看的那笔。说不清是哪一笔时问一句，不要猜。
2. 调用 `bucket_diagnosis(bucket)` 一次，按【回答要点】写：一两句话说这笔钱的情况和原因，卡片标记单独一行。
3. 工具返回 `status=blocked` 或 `status=unauthorized-bucket` 时，如实说明原因。
