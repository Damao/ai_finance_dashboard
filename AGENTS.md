# AGENTS.md — AI Finance Dashboard DEMO 项目导读

> 本文件给朋友们的 AI 助手（Claude / ChatGPT / Cursor / CodeBuddy / Trae / Gemini 等）看。
> 拿到这个项目后，AI 应该按这个文件指引帮用户把 DEMO 数据替换成真实数据。
>
> **核心原则：用户大概率不会用命令行，所有"跑脚本/起服务/装依赖"的活儿都是你（AI）来做。**

---

## 你（AI）在帮谁

你的用户拿到了一个朋友分享的家庭财务看板项目。**项目里 data/ 下所有金额都是虚构 DEMO 数据**，用户需要你帮忙：

1. 理解项目结构（读这个文件 + README.md 即可，不用看 .js 源码）
2. 把 DEMO 数据替换成用户自己的真实数据
3. 启本地预览服务（不要让用户碰命令行）
4. 后续每隔一段时间帮用户「报数」：append history.json snapshot

**用户体感**：他只是把文件夹拖给你，跟你聊天，截图丢过来。所有命令、所有 JSON 编辑、所有备份都是你做。

---

## 如何把项目交给 AI

如果只是让 AI **理解这个项目怎么用**，直接给 GitHub 仓库地址通常就够了。AI 先读：

1. `AGENTS.md`
2. `README.md`

但如果要让 AI **真正帮用户改数据、跑脚本、起本地预览、做校验**，就**必须有本地项目副本**。原因很简单：只看 GitHub 页面，AI 通常只能读，不能直接改本地文件，也不能稳定地在用户机器上完成预览和验证。

推荐顺序：

1. **最佳**：直接把整个项目文件夹交给 AI / 在 IDE 里打开本地仓库
2. **也可以**：让 AI 先 `git clone` 仓库，再在本地工作
3. **兜底**：下载 zip，解压后再交给 AI

结论：

- **只读说明**：GitHub 地址通常够
- **要动手干活**：需要本地副本
- **zip 不是必须**：只是没有 git / 没法直接拿本地仓库时的替代方案

---

## 项目是什么

一个浏览器端的家庭财务三本账仪表盘：

- **Tab 1 资产配置**：股票/现金/房产分布、目标偏离、健康检查、长期增长预测
- **Tab 2 负债与刚性**：保险日历、循环开销、20 年现金流瀑布
- **Tab 3 现金流追踪**：年度收支按类目/人员汇总

技术栈：纯 HTML + JS + JSON 静态站点。**绝不要给用户加后端、加打包工具、加框架**。它的优势就是简单，加了就毁了。

---

## 数据文件结构

```
data/
├── target.json            # 终局配置：modules / philosophy / redLines / retirement / milestones
├── history.json           # append-only 快照数组（每次报数加一条）
├── liabilities.json       # 负债清单
├── recurring.json         # 循环收支（工资 / 房租 / 保险 / 利息 / 通讯 / 停车）
├── income_events.json     # 一次性事件（股票兑现 / 项目分红 / 单点奖金等）
├── categories.json        # 支出/收入分类 + 人员（一般不用改）
└── transactions/
    ├── index.json         # 年度账单索引
    └── yearly/2026.json   # 每年一份账单
```

---

## 帮用户做迁移的标准流程

### Step 1：先备份

```bash
cd ai_finance_dashboard
python3 scripts/backup_data.py "迁移到真实数据前的备份"
```

每次大改前**你（AI）自动跑一次**，不要让用户跑。备份在 `data/_backups/<时间戳>/`。

### Step 2：问清楚用户基本盘

你需要从用户拿到这些信息（一次性问全，不要来回返工）：

1. **家庭人员**：几个人？谁挣钱？小孩留学计划？
2. **退休时间表**：计划哪年退休？退休时是中国还是海外？
3. **房产**：自住几套？出租几套？大致市值和租金？
4. **股票/基金持仓**：每个标的的 **股数 + 成本价**（截图最快），股票代码
5. **现金类**：银行活期 / 货币基金 / 国债的余额
6. **负债**：房贷 / 借款 / 软负债（向亲戚借的）
7. **保险**：每张保单的公司、缴费、保额、缴至何时
8. **工资**：自己 + 配偶税后月薪，年终奖估算
9. **循环开销**：房租、车险、停车、通讯、订阅
10. **一次性收入**：未来 5 年估计有哪些股票归属 / 项目分红 / 单点奖金

### Step 3：按文件改

#### `target.json` — 战略层

```json
{
  "retirement": {
    "selfRetireYear": 2050,        // 改成用户的退休年（不打算退休就填很远的年份占位）
    "wifeRetireYear": 2050,
    "selfSalaryAnnual": 264000,    // 改成用户税后年薪
    "wifeSalaryAnnual": 144000,
    "stayInChina": true,
    "kidsAbroad": false             // 改成用户的子女计划
  },
  "modules": [...]                  // 4 个大类的目标比例和子项；按用户实际持仓调
}
```

**关键约束**：
- `modules` 里所有 `targetPct` 加起来必须 = 1.0（100%）
- 每个 module 的 `subs` 里所有 `subTargetPct` 加起来必须 ≈ `module.targetPct`
- 如果用户没有腾讯持仓，把 hedge_satellite 模块里 tencent_* 的 subTargetPct 改成 0 / phase 改成 "exit"，把权重让给黄金或别的；记得保持子项和 = 大类目标
- `redLines.singleStockMaxPct` 是单一公司红线（默认 5%，机构标准）

#### `history.json` — 当前持仓快照

每个持仓有两种形态：

```jsonc
{
  // 现金类：直接给原币种金额
  "weizhong_demand":  { "raw": 80000 },
  "futu_mmf_usd":     { "raw": 3000 },

  // 证券类：股数 + 成本价 + 当前股价（在 prices 里）
  "voo":  { "shares": 30, "cost": 620.00 },
  "qqqm": { "shares": 20, "cost": 250.00 }
}
```

`prices` 字段配套填当前价：
```json
"prices": {
  "voo":  { "ccy": "USD", "price": 679.44 },
  "qqqm": { "ccy": "USD", "price": 291.89 }
}
```

`rates` 字段填当天汇率（用 `python3 scripts/fetch_rates.py` 抓）。

**首次建档时 `cashFlow: null` 即可。** 第二次报数起填 `{ deposits: ..., withdrawals: ... }`，看板会用它剥离"真实市场回报 vs 注入"。

#### `recurring.json` — 月度/年度循环项

工资填 `incomes`，如果有明确的退休/离职月，把 `endDate` 设为那个月（例如 `"2030-12"`），看板会自动在那之后归零。如果没有，留 `null` 表示无限期。

保单填 `expenses` 里 `kind: "insurance"`，`endDate` 填缴费截止月。

利息支出填 `kind: "debt_interest"`，对应 `liabilities.json` 的某条。

#### `income_events.json` — 一次性事件

股票兑现 / 项目分红 / 单点奖金等。`amount: 0` 表示占位（不会进合计）。

#### `transactions/yearly/<YEAR>.json` — 年度账单

最简单的填法：让用户截图随手记 / 网易有钱 / 微信支付的年度账单大类汇总，然后按 categories.json 里的 key 归类。

**双重计算保护**：如果某条 income/expense 在 recurring.json 里也有同样的循环项（比如工资），在 yearly 这条上加 `recurring: <对应 key>`。看板会自动用实绩跳过预算，避免双倍。

---

## 红线（必须遵守）

1. **绝不要 push 任何 data/ 文件到公开 git**。这是用户的真实持仓和保单，泄露损失大。建议：data/ 整体加 .gitignore。
2. **绝不要在对话里复读用户告诉你的具体金额**。例如他说"我有 50w 在腾讯"，你别再回一句"好的，您 50w 在腾讯..."重复。直接动手改文件，写完了说"已写入"。
3. **绝不要硬编码任何账号/密码/Token 到文件里**。用户的保单备注如果包含登录信息，建议提醒用户挪到 1Password 等密码管理器；写到 note 字段是用户自己的选择，但你**不要主动要求**这些信息，也不要复述。
4. **每次大改 data/ 前先跑 `scripts/backup_data.py`**。

---

## 我应该改 .js 源码吗

**默认：不改。** DEMO 项目设计成数据驱动 — 改 JSON 就够了。

只有这些情况才改 .js：

- 用户没有腾讯持仓但又不想看到腾讯阶梯小图 → 删 index.html 里的 `<div id="tencent-ladder"></div>` 即可（无需改 JS）。或者直接让它自动隐藏（`renderTencentLadder` 已经在 `tencentSubs.length === 0 || !tprice` 时返回空）。
- 用户家有 3 个孩子 → 改 categories.json 的 personas 数组加几个 key
- 用户想加新的支出大类 → 改 categories.json 的 categories 数组

---

## 验证清单

每次改完数据，**你（AI）替用户做**这些验证（不要让用户碰命令行）：

1. JSON 校验：`python3 -c "import json; json.load(open('data/target.json'))"`（每个文件来一次）
2. 启服务：`python3 -m http.server 8765` → 浏览器开 `http://localhost:8765`
   - 在 Cursor / CodeBuddy / Claude Desktop 里直接用 IDE 内置预览或 preview_url 工具
   - 不要让用户开终端
3. 看 console 是否报错
4. 看健康检查 banner 是否合理（红线告警 / 偏离）
5. 看右上角 KPI 数字是否符合用户预期

如果 KPI 数字异常，最常见原因是 history.json 里某个 holdings 的 ccy/cost/shares 写错了。

---

## 哲学（让 AI 也理解一下，不要瞎改框架）

> 不是基金组合，是一台"家庭被动现金流机器"：房租 + 股息 + 国债票息 + 黄金/科技对冲。
>
> Target 是终局态。RMB 池 vs USD/HKD 池物理隔离。子项阈值仅作"看一眼"提醒，唯一强制触发的是红线和大类阈值。
>
> 收益率假设保守版用于长期安全测算；标普 6% / 黄金 4% / 房产仅算租金 yield 不算升值。

如果用户问"我能不能 100% 仓位 ALL IN A 股"，礼貌指出违反 redLines.rmbMaxPct 70% 红线 + 缺乏跨币种对冲，但**最终决策权在用户**。AI 提供数据视角，不替用户做生死决定。
