# AI Finance Dashboard · DEMO

> 一份给朋友的家庭财务三本账仪表盘。
> 纯 HTML + JS + JSON，**没有后端、没有打包、没有依赖**，浏览器打开就能看。
>
> 🤖 **这是个"AI 原生"项目** —— 你不需要懂代码、不需要跑命令行，
> 把整个文件夹丢给你的 AI 助手（Claude / ChatGPT / Cursor / CodeBuddy / Gemini 都行），
> 让它读 [`AGENTS.md`](./AGENTS.md)，剩下的对话搞定。
>
> ⚠️ 仓库里所有金额都是**虚构 DEMO 数据**，请让 AI 帮你换成真实数据后使用。

---

## 给"人"看的三句话简介

这是一个完整的家庭财务三本账：

1. **资产配置** — 股票/现金/房产分布、目标偏离告警、长期增长预测、退休缺口
2. **负债与刚性支出** — 保险缴费日历、循环开销、未来 20 年现金流瀑布（含通胀切换）
3. **现金流追踪** — 年度收支按类目/人员汇总、预算 vs 实际、储蓄率

设计哲学：**不是基金组合，是一台"家庭被动现金流机器"** — 房租 + 股息 + 国债票息 + 黄金/科技对冲。

---

## 怎么用：丢给 AI，三句话开聊

### 推荐路径（零命令行）

1. **下载** 整个仓库（GitHub 右上角 `Code → Download ZIP`，或 `git clone`），解压
2. **拖进 AI** —— 把整个文件夹拖进 Claude Desktop / Cursor / CodeBuddy / VS Code + Copilot / 任何能读本地文件的 AI 应用
3. **跟它说**：
   > "帮我读一下 AGENTS.md，然后把 `data/` 里的 DEMO 数据换成我的真实数据，我给你截图。"
4. AI 会引导你把持仓截图、保单照片、随手记年度账单丢进对话，自动改 JSON

### 看效果（可选，0 命令行）

主流 AI 工具（Claude / Cursor / CodeBuddy 等）都能在工作区里**直接预览 HTML**，让 AI：
> "帮我在浏览器里打开 index.html"

它会启动一个本地预览，你不需要碰命令行。

> 💡 如果你确实想自己手动看：在文件夹里双击 `index.html` 是不行的（浏览器跨域拦截 fetch JSON），
> 必须起一个本地 HTTP 服务。这种事让 AI 替你做即可。

---

## 数据文件结构（AI 会帮你改这些）

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

**关键约束 AI 都知道**（写在 AGENTS.md 里了）：
- `modules.targetPct` 加起来 = 100%
- 持仓有"现金（raw）"和"证券（shares + cost + prices）"两种形态
- 每次大改前 AI 会自动备份 `data/_backups/<时间戳>/`

---

## 看板能看到什么

### Tab 1 · 📊 资产配置

- **顶部状态栏**：快照日期切换 + 实时汇率
- **健康检查 strip**：单一公司红线 / RMB 占比 / 大类偏离 / 待变现资产，逐条列出告警等级 + 触发条件 + 推荐动作
- **腾讯阶梯小图**（如有腾讯持仓）：当前价位 vs 进攻档/防御档/红线档
- **8 张 KPI**：总资产 / 单一股票敞口 / RMB 占比 / 告警数 / 持仓盈亏 / 整体年化 / 金融盘年化 / 退休年缺口
- **模块画像**：每个大类一张卡 — 进度条 + 目标线 + 阈值带 + 子项明细
- **币种分布 + 池分离**：RMB 池 vs 海外池物理隔离视图
- **趋势图**：4 个 sparkline，过去快照点可点击切换
- **长期增长预测**：保守/中性/乐观三档，名义/实际购买力切换
- **里程碑 P0/P1/P2/P3 清单**

### Tab 2 · 💸 负债与刚性

- KPI: 总资产 / 总负债 / 净资产 / 月度净流出 / 年保费 / 刚性支出 / 过渡期累计净流 / 退休稳态净流
- 负债清单（含软性负债如向亲属借款，本金不扣减净资产）
- 循环收支月度表（自动按汇率折算 RMB）
- **保单缴费日历**（按到期排序，倒计时 + 剩余应缴尾款）
- **未来 20 年现金流瀑布**：每年支出/收入条 + 关键事件 chip（保单缴清 🟢 / 工资终止 🎯 / 股票兑现 💎），通胀名义/实际购买力切换

### Tab 3 · 📈 现金流追踪

- 年度 KPI: 总收入 / 总支出 / 净结余 / 储蓄率 / 弹性 vs 刚性占比
- 支出大类堆叠条 + 按人维度
- **预算 vs 实际表**：recurring.json 的循环项 vs 当年实绩自动 diff

---

## 项目结构

```
ai_finance_dashboard/
├── index.html              # 三 Tab 主入口
├── core.js                 # 共享工具：fmt / 汇率换算 / 加权年化 / 健康检查 / 资产对账
├── app.js                  # Tab 1 资产配置
├── liabilities.js          # Tab 2 负债与刚性
├── cashflow.js             # Tab 3 现金流追踪
├── data/
│   ├── target.json
│   ├── history.json
│   ├── liabilities.json
│   ├── recurring.json
│   ├── income_events.json
│   ├── categories.json
│   └── transactions/
│       ├── index.json
│       └── yearly/2026.json
├── scripts/
│   ├── fetch_rates.py      # 抓 USD/HKD 汇率（AI 会替你跑）
│   └── backup_data.py      # 改 data/ 之前自动跑
├── README.md               # 给"人"看的（你正在读）
└── AGENTS.md               # 给 AI 看的工作指南（核心文件）
```

---

## 配置框架（保留作为参考）

DEMO 里保留了一套真实可用的配置思路 — 金额是虚构的，但结构和股票代码是真的：

| 大类 | 目标 | 阈值 | 子项 |
|---|---:|---:|---|
| 一·防御现金 | 16% | ±3% | 微众活期 / 国债阶梯 / 短债 ETF / 美元货币基金 / 美国国债 |
| 二·稳健现金流 | 50% | ±5% | 房产 A（出租收租金）/ 红利低波 512890 |
| 三·全球增长 | 20% | ±5% | CSPX·UCITS / VOO / QQQM / BRK.B |
| 四·避险卫星 | 14% | ±3% | IAU 黄金 / 腾讯 ×3 账户 |

> 自己用的时候，按你的风险偏好和持仓重写 modules 即可。结构（philosophy / redLines / 双层阈值 / 池分离）可以留着当框架。

---

## 隐私红线（AGENTS.md 已强制约束 AI）

- ❌ AI **不会**让你 push `data/` 到公开 git（仓库根 `.gitignore` 已忽略）
- ❌ AI **不会**在对话里复读你的具体金额
- ❌ AI **不会**主动索要登录密码 / Token
- ✅ AI **会**在每次大改前自动备份 `data/_backups/<时间戳>/`
- ✅ 推荐做法：项目放在 iCloud / Dropbox / 个人私有 git 仓库，**不要 push 到公开仓库**

---

## 常见问题

**Q: 我完全不会编程，能用吗？**
A: 能。这就是"AI 原生"项目的意义 — 你只需要会跟 AI 对话。AGENTS.md 是给 AI 看的说明书，AI 会引导你一步步把数据填进去。

**Q: 必须用 Claude 吗？**
A: 不必须。任何能读本地文件的 AI 都行（Claude Desktop / Cursor / CodeBuddy / Trae / Gemini CLI / VS Code Copilot 等）。它们都会读 `AGENTS.md`。

**Q: 数据安全吗？**
A: 你的数据**只在本地**。这个 demo 是纯静态站点，不联网（除了让 AI 帮你抓汇率那一下）。仓库根 `.gitignore` 已默认忽略 `data/_backups/`。建议把整个项目放在 iCloud / 个人私有 git，**不要推到公开 GitHub**。

**Q: 我的浏览器打开后 console 报 "JSON 解析失败"？**
A: 你（或 AI）改 JSON 时多了/少了逗号。让 AI 跑一次 JSON lint 即可：`python3 -c "import json; json.load(open('data/target.json'))"`

**Q: 怎么加新股票 / 新支出大类？**
A: 跟 AI 说就行：「我要加一只 ARKK 持仓，30 股，成本 65 美元」/「我要加一个『宠物』支出大类」。AI 会改对应 JSON。

**Q: 我没有腾讯持仓，腾讯阶梯小图怎么办？**
A: 不影响。`renderTencentLadder` 检测到 tencent_* 子项全为空时会自动隐藏。

---

## 致谢

这套看板由 [@Damao](https://github.com/Damao) 在 2026 年和他的 AI 助手共同迭代而来，开放给朋友 Fork 使用。
配色致敬 Bloomberg Terminal · 等宽数字 JetBrains Mono · 设计语言参考 Linear / Vercel / Tremor。

如果你的 AI 帮你改出更好的版本，欢迎 PR / 或者把截图（**记得脱敏**）发给我看看 :)
