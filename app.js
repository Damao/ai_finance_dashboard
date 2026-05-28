// =============================================================
// 资产配置看板 · 视图渲染（V2.3）
// 数据源：data/target.json + data/history.json
// 共享：core.js（fmt/fmtK/pct/parseDate/enrichSnapshot/healthCheck/reconcile/...）
// =============================================================
(function () {
  const C = window.AssetCore;
  const fmt = C.fmt, fmtK = C.fmtK, pct = C.pct;
  const pp = (x, d=1) => (x == null || isNaN(x)) ? "—" : (x*100).toFixed(d) + "pp";
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  // ---- 0. 加载数据 ----
  Promise.all([
    fetch("./data/target.json", {cache:"no-store"}).then(r => r.json()),
    fetch("./data/history.json",{cache:"no-store"}).then(r => r.json()),
  ]).then(([target, history]) => {
    const snaps = (history.snapshots || []).slice().sort((a,b) => a.date.localeCompare(b.date));
    if (snaps.length === 0) {
      document.body.innerHTML = `<div style="padding:40px;color:#fff;font-family:system-ui">history.json 中没有任何 snapshot。请先添加一条。</div>`;
      return;
    }

    // 给所有 snapshot 预先算出 RMB 等值 + 模块/总计
    const enriched = snaps.map(s => enrichSnapshot(s, target));

    // ---- 日期选择器 ----
    const picker = $("#date-picker");
    picker.innerHTML = enriched.slice().reverse().map(s => `<option value="${s.date}">${s.date}　·　${fmtK(s.total)} RMB</option>`).join("");
    picker.addEventListener("change", () => render(picker.value));

    function render(dateKey) {
      const idx = enriched.findIndex(s => s.date === dateKey);
      const cur = enriched[idx];
      const prev = idx > 0 ? enriched[idx-1] : null;
      renderHeader(cur, target);
      renderHealthCheck(cur, target);
      renderTencentLadder(cur);
      renderReconcile(prev, cur);
      renderKPIs(cur, prev, target);
      renderCoastCard(cur, target);
      renderModules(cur);
      renderAlerts(cur);
      renderCurrency(cur, target);
      renderTrends(enriched, dateKey);
      renderTimeline(enriched, dateKey, picker);
      renderPools(cur, target);
      renderGrowthProjection(cur, target);
      renderMilestones(target);
    }
    render(enriched[enriched.length-1].date);
    picker.value = enriched[enriched.length-1].date;
  }).catch(err => {
    document.body.innerHTML = `<div style="padding:40px;color:#fff;font-family:system-ui">
      <h2>加载数据失败</h2>
      <p>${err.message}</p>
      <p style="color:#aaa">请通过本地 HTTP 服务打开（fetch 不能用 file://）：</p>
      <pre style="background:#222;padding:12px;border-radius:6px">cd memory/areas/life_planning/asset_dashboard
python3 -m http.server 8765</pre>
    </div>`;
    console.error(err);
  });

  // ---- 计算单个快照（委托 core.js）----
  function enrichSnapshot(snap, target) {
    return C.enrichSnapshot(snap, target);
  }

  function renderHeader(cur, target) {
    $("#rate-usd").textContent = (cur.rates?.USD || 1).toFixed(4);
    $("#rate-hkd").textContent = (cur.rates?.HKD || 1).toFixed(4);
    const src = cur.ratesSource ? `<div style="color:var(--text-2);font-size:11px">汇率源：${cur.ratesSource}</div>` : "";
    $("#snapshot-comment").innerHTML = (cur.comment ? `“${cur.comment}”` : "") + src;
  }

  function renderKPIs(cur, prev, target) {
    const total = cur.total;
    const financialTotal = cur.financialTotal || 0;
    const rmbPct = total > 0 ? cur.ccyTotals.RMB / total : 0;
    const tencentSubs = cur.modules.flatMap(m => m.subs).filter(s => /^tencent_/.test(s.key) || s.key === "tencent");
    const tencentRMB = tencentSubs.reduce((a,s)=>a+s.rmb,0);
    const tencentPct = total > 0 ? tencentRMB / total : 0;
    const redLine = target.redLines?.singleStockMaxPct ?? 0.05;

    const deltaTotal = prev ? (total - prev.total) : 0;
    const deltaPct   = prev && prev.total ? (total - prev.total) / prev.total : 0;
    const deltaText = !prev ? "首次建档"
      : `${deltaTotal>=0?"+":""}${fmtK(deltaTotal)} (${(deltaPct*100).toFixed(2)}%)`;
    const deltaCls = !prev ? "flat" : (deltaTotal > 0 ? "up" : (deltaTotal < 0 ? "down" : "flat"));

    const overModules  = cur.modules.filter(m => m.status === "over").length;
    const underModules = cur.modules.filter(m => m.status === "under").length;
    const overSubs     = cur.modules.flatMap(m => m.subs).filter(s => s.status === "over").length;
    const underSubs    = cur.modules.flatMap(m => m.subs).filter(s => s.status === "under").length;

    // === 主 KPI（4 张）===
    const main = [
      {
        label: "总资产 (RMB)",
        value: fmtK(total),
        sub: `金融盘 ${fmtK(financialTotal)} · 不动产 ${fmtK(total - financialTotal)}`,
        help: "总盘=所有模块子项折RMB市值之和；金融盘=剔除房产+待变现；不动产=总盘-金融盘",
        delta: deltaText, deltaCls,
        tone: "ok",
      },
      {
        label: "腾讯单一敞口",
        value: pct(tencentPct, 1),
        sub: `红线 ≤ ${pct(redLine,0)} · ${fmtK(tencentRMB)} RMB`,
        help: "合并所有腾讯子项后占总盘比例；用于检查单一公司红线（默认5%）",
        tone: tencentPct > redLine ? "danger" : "ok",
      },
      {
        label: "RMB 占比",
        value: pct(rmbPct, 1),
        sub: rmbPct > 0.70 ? "已超 70% 红线" : (rmbPct > 0.60 ? "高于 V2.0 目标 60%" : "在目标内"),
        help: "RMB子项折RMB市值占总盘比例；红线70%/目标60%",
        tone: rmbPct > 0.70 ? "danger" : (rmbPct > 0.60 ? "warn" : "ok"),
      },
      {
        label: "大类 / 子项告警",
        value: `${overModules+underModules} / ${overSubs+underSubs}`,
        sub: (overModules+underModules) === 0 ? "全部模块在阈值内" : `模块超${overModules} 偏低${underModules} · 子项超${overSubs} 偏低${underSubs}`,
        help: "告警数：超/偏低模块数 / 超/偏低子项数（基于阈值判定）",
        tone: overModules > 0 ? "danger" : (underModules > 0 || overSubs > 0 ? "warn" : "ok"),
      },
    ];
    $("#kpis").innerHTML = main.map(k => `
      <div class="kpi ${k.tone}">
        <div class="stripe"></div>
        <div class="label" title="${k.help || ""}">${k.label}</div>
        <div class="value num" title="${k.help || ""}">${k.value}</div>
        <div class="sub" title="${k.help || ""}">${k.sub}</div>
        ${k.delta ? `<div class="delta ${k.deltaCls}" title="环比变化=本次快照总盘-上次快照总盘">${k.delta}</div>` : ""}
      </div>
    `).join("");

    // === 次 KPI（4 张：盈亏 + 整体年化 + 金融盘年化 + 退休缺口）===
    const scenario = (target.assumptions?.return_scenario?.value) || "conservative";
    const totalReturn     = C.weightedExpectedReturn(cur, scenario, { excludeOrphan:true, excludeRealEstate:false });
    const financialReturn = C.weightedExpectedReturn(cur, scenario, { excludeOrphan:true, excludeRealEstate:true });

    let mvSec = 0, costSec = 0;
    cur.modules.forEach(m => m.subs.forEach(s => {
      if (s.shares != null) { mvSec += s.rmb; costSec += s.costRMB ?? s.rmb; }
    }));
    const pl = mvSec - costSec;
    const plPct = costSec ? pl / costSec : 0;

    // 退休缺口（粗算）：年支出 - 被动现金流
    const ret = target.retirement || {};
    const annualExpense = computeAnnualExpenseEstimate(target);
    const annualPassive = computeAnnualPassiveIncome(cur, target);
    const gap = annualExpense - annualPassive;

    const secondary = [
      {
        label: "证券持仓盈亏",
        value: (pl >= 0 ? "+" : "") + fmtK(pl),
        sub: `市值 ${fmtK(mvSec)} / 成本 ${fmtK(costSec)} · ${pct(plPct, 1)}`,
        help: "仅统计有shares字段的证券持仓；浮盈亏=市值-成本",
        tone: pl >= 0 ? "ok" : "warn",
      },
      {
        label: "整体盘预期年化",
        value: pct(totalReturn, 2),
        sub: `含房产；20 年终值 ${fmtK(total * Math.pow(1+totalReturn, 20))}`,
        help: "按各子项expectedReturn加权；整体盘口径含房产",
        tone: "ok",
      },
      {
        label: "金融盘预期年化",
        value: pct(financialReturn, 2),
        sub: `剔除房产 · ${fmtK(financialTotal)} → ${fmtK(financialTotal * Math.pow(1+financialReturn, 20))}`,
        help: "按各子项expectedReturn加权；金融盘口径剔除房产",
        tone: "ok",
      },
      {
        label: "退休年现金流缺口",
        value: gap >= 0 ? "+" + fmtK(-gap) : "-" + fmtK(gap),
        sub: `年开销 ${fmtK(annualExpense)} − 被动收入 ${fmtK(annualPassive)} ${ret.selfRetireYear ? "· 假设 " + ret.selfRetireYear + " 退休" : ""}`,
        help: "退休年开销估算-被动收入估算；为正表示缺口（需要投资收益或降低开销弥补）",
        tone: gap > 0 ? "warn" : "ok",
      },
    ];
    $("#kpis-secondary").innerHTML = secondary.map(k => `
      <div class="kpi ${k.tone}">
        <div class="stripe"></div>
        <div class="label" title="${k.help || ""}">${k.label}</div>
        <div class="value num" title="${k.help || ""}">${k.value}</div>
        <div class="sub" title="${k.help || ""}">${k.sub}</div>
      </div>
    `).join("");
  }

  // ---- 年支出 / 被动收入估算（用于退休缺口）----
  // 注意：依赖 recurring.json，但 app.js 本身不加载它；放一个占位读取
  let _recurringCache = null;
  function loadRecurringOnce() {
    if (_recurringCache) return Promise.resolve(_recurringCache);
    return fetch("./data/recurring.json", {cache:"no-store"}).then(r => r.json()).then(d => _recurringCache = d).catch(() => null);
  }
  function computeAnnualExpenseEstimate(target) {
    if (!_recurringCache) return 0;
    const rates = _recurringCache._rates || { USD:6.8, HKD:0.87 }; // 退休测算用一个稳定汇率
    const toRMB = (a,c) => a * (c==="RMB" ? 1 : (rates[c] || 1));
    const recurringAnnual = (_recurringCache.expenses || []).reduce((acc,e) => {
      // 用 isActive 简单过滤
      if (!C.isActive(e)) return acc;
      const a = toRMB(e.amount, e.ccy) * (e.frequency === "annual" ? 1 : 12);
      return acc + a;
    }, 0);
    // 弹性支出按 ~26 万估（cashflow Tab 的 2026 预测）
    const elasticAnnual = 260000;
    return recurringAnnual + elasticAnnual;
  }
  function computeAnnualPassiveIncome(cur, target) {
    if (!_recurringCache) return 0;
    const rates = _recurringCache._rates || { USD:6.8, HKD:0.87 };
    const toRMB = (a,c) => a * (c==="RMB" ? 1 : (rates[c] || 1));
    // 1) recurring 收入 — 退休口径只算被动（房租 / 妈妈月存 / 退休后零散），剔除工资
    const PASSIVE_KINDS = new Set(["rental_income","family_deposit","side_gig"]);
    const recurringIn = (_recurringCache.incomes || []).reduce((acc,i) => {
      if (!PASSIVE_KINDS.has(i.kind)) return acc;
      // 用退休年作为参考时点（若 endDate 在退休前则不算）
      const refYear = (target.retirement && target.retirement.selfRetireYear) || (new Date().getFullYear() + 1);
      const refDate = new Date(refYear + 1, 0, 1);
      if (!C.isActive(i, refDate)) return acc;
      return acc + toRMB(i.amount, i.ccy) * (i.frequency === "annual" ? 1 : 12);
    }, 0);
    // 2) 投资被动现金流（用金融盘 × 加权预期年化的"票息部分" — 简化为 50% × 预期年化）
    const scenario = target.assumptions?.return_scenario?.value || "conservative";
    const fr = C.weightedExpectedReturn(cur, scenario, { excludeOrphan:true, excludeRealEstate:true });
    const yieldPart = (cur.financialTotal || 0) * fr * 0.5; // 假设一半是票息一半是增值
    return recurringIn + yieldPart;
  }

  // 把年支出拆成「刚性 / 弹性」两个口径，用于 SWR 反推
  function computeAnnualExpenseBreakdown() {
    if (!_recurringCache) return { rigid: 0, elastic: 260000, total: 260000 };
    const rates = _recurringCache._rates || { USD:6.8, HKD:0.87 };
    const toRMB = (a,c) => a * (c==="RMB" ? 1 : (rates[c] || 1));
    const rigid = (_recurringCache.expenses || []).reduce((acc,e) => {
      if (!C.isActive(e)) return acc;
      const a = toRMB(e.amount, e.ccy) * (e.frequency === "annual" ? 1 : 12);
      return acc + a;
    }, 0);
    const elastic = 260000; // 与 computeAnnualExpenseEstimate 保持同一假设（cashflow Tab 的弹性估算）
    return { rigid, elastic, total: rigid + elastic };
  }

  // ---- Coast FIRE 卡：今天的本金不再注资，靠复利到法退年能否养到底 ----
  // 公式：CoastNumber = (annualMultiple × 年开销) / (1 + r)^years
  // 如果当前总盘 ≥ CoastNumber → 已 Coast：可以停止注资
  // 注：realReturns 是"扣除通胀的实际收益率"，所以 25× 年开销也是今天购买力，无需再调通胀
  function renderCoastCard(cur, target) {
    const root = $("#swr-card"); // 容器名沿用 #swr-card，避免改 HTML
    if (!root) return;
    if (!_recurringCache) { root.innerHTML = ""; return; }

    const exp = computeAnnualExpenseBreakdown();
    const total = cur.total || 0;

    const cfg = target.coastFire || {};
    const currentAge = cfg.selfCurrentAge || 40;
    const retireAge  = cfg.legalRetireAge || 60;
    const years      = Math.max(0, retireAge - currentAge);
    const mult       = cfg.annualMultiple || 25;
    const realReturns = cfg.realReturns || { conservative:0.05, neutral:0.06, optimistic:0.07 };

    const targetCorpus = mult * exp.total; // 退休时所需本金（今天购买力）

    const LEVELS = [
      { key: "conservative", label: "保守", r: realReturns.conservative, hint: "实际 5% · 类全球股债 60/40 长期" },
      { key: "neutral",      label: "中性", r: realReturns.neutral,      hint: "实际 6% · 偏股全球分散" },
      { key: "optimistic",   label: "乐观", r: realReturns.optimistic,   hint: "实际 7% · 偏股+小盘价值溢价" },
    ];

    const fmtPct = p => `${(p*100).toFixed(0)}%`;
    const rowsHTML = LEVELS.map(lv => {
      const factor = Math.pow(1 + lv.r, years); // 复利倍数
      const coastNumber = targetCorpus / factor;
      const ratio = coastNumber > 0 ? total / coastNumber : 0;
      const done = ratio >= 1;
      const far  = ratio < 0.5;
      const fillW = Math.max(2, Math.min(100, ratio * 100));
      const gap = coastNumber - total;
      const gapStr = gap > 0 ? `差 ${fmtK(gap)}` : `已超 ${fmtK(-gap)}`;

      // 反算：当前总盘按这个收益率，多少年能复利到 targetCorpus
      // years_needed = log(targetCorpus / total) / log(1+r)
      let yearsToCoast = "—";
      if (total > 0 && targetCorpus > total) {
        const n = Math.log(targetCorpus / total) / Math.log(1 + lv.r);
        if (isFinite(n) && n > 0) yearsToCoast = `${n.toFixed(1)} 年`;
      } else if (total >= targetCorpus) {
        yearsToCoast = "已达成";
      }

      return `
        <div class="swr-row">
          <div class="tag">${lv.label}<span class="pct">${(lv.r*100).toFixed(0)}%</span></div>
          <div class="bar"><div class="fill ${done?'done':''}" style="width:${fillW}%"></div></div>
          <div class="target">需 ≥ ${fmtK(coastNumber)}<br><span style="color:var(--text-3);font-size:10px">复利后 ${fmtK(total * factor)}</span></div>
          <div class="progress ${done?'done':(far?'far':'')}">${fmtPct(ratio)}<br><span style="color:var(--text-3);font-weight:400;font-size:10px">${gapStr}</span></div>
        </div>
      `;
    }).join("");

    // 兜底：Bengen 3.5% 安全提取（只显示 1 行，作为参考）
    const bengenTarget = exp.total / 0.035;
    const bengenRatio  = bengenTarget > 0 ? total / bengenTarget : 0;
    const bengenDone   = bengenRatio >= 1;
    const bengenGap    = bengenTarget - total;
    const bengenGapStr = bengenGap > 0 ? `差 ${fmtK(bengenGap)}` : `已超 ${fmtK(-bengenGap)}`;

    // 整体已 Coast 状态（中性档为准）
    const neutralFactor = Math.pow(1 + realReturns.neutral, years);
    const neutralCoast  = targetCorpus / neutralFactor;
    const overallDone   = total >= neutralCoast;

    root.innerHTML = `
      <div class="swr-card ${overallDone ? 'achieved' : ''}">
        <div class="swr-head">
          <div class="title">
            <span class="icon">${overallDone ? '✅' : '🔥'}</span>
            Coast FIRE ${overallDone ? '· 已达成' : '· 进度'}
            <span style="color:var(--text-2);font-weight:400;font-size:var(--fs-xs);margin-left:8px">现在 ${currentAge} 岁 → ${retireAge} 岁停止打工，靠复利养到底</span>
          </div>
          <div class="now">总盘 <b>${fmtK(total)}</b> · 年开销 <b>${fmtK(exp.total)}</b> · ${retireAge}岁需 <b>${fmtK(targetCorpus)}</b></div>
        </div>
        <div class="swr-rows">${rowsHTML}</div>
        <div class="swr-bengen ${bengenDone?'done':''}">
          <span class="bengen-label">Full FIRE 兜底</span>
          <span class="bengen-detail">Bengen 3.5% 安全提取 → 本金需 ≥ <b>${fmtK(bengenTarget)}</b></span>
          <span class="bengen-progress ${bengenDone?'done':''}">${fmtPct(bengenRatio)} · ${bengenGapStr}</span>
        </div>
        <div class="swr-foot">
          口径：年开销 <code>${fmtK(exp.total)}</code> · ${mult}× 倍数 · 实际收益率（已含通胀对冲）· 房产计入总盘 · 公式 <code>Need = ${mult}×Exp / (1+r)^${years}</code>
        </div>
      </div>
    `;
  }

  // 启动加载
  loadRecurringOnce().then(() => {
    // 触发一次重渲染（如果首屏已经渲过）
    const picker = $("#date-picker");
    if (picker && picker.value) picker.dispatchEvent(new Event("change"));
  });

  function statusChip(status, delta) {
    if (status === "over")  return `<span class="chip danger" title="偏离Δ=实际占比-目标占比（单位pp）">超 +${pp(delta,1)}</span>`;
    if (status === "under") return `<span class="chip warn" title="偏离Δ=实际占比-目标占比（单位pp）">偏低 ${pp(delta,1)}</span>`;
    return `<span class="chip ok" title="偏离Δ在阈值范围内">在阈值内</span>`;
  }
  const ccyTag = c => `<span class="ccy ${c}">${c}</span>`;
  function phaseBadgeHTML(phase) {
    if (!phase || phase === "active") return "";
    const map = {
      blocked: { txt:"⏳ 阻塞", color:"#a4adbf", bg:"rgba(164,173,191,.12)" },
      exit:    { txt:"📉 清仓中", color:"#ff5c7a", bg:"rgba(255,92,122,.14)" },
      planned: { txt:"🛠 计划中", color:"#7aa2ff", bg:"rgba(122,162,255,.14)" },
    };
    const c = map[phase];
    if (!c) return "";
    return `<span style="font-size:10px;padding:1px 6px;border-radius:4px;color:${c.color};background:${c.bg};letter-spacing:.3px">${c.txt}</span>`;
  }

  function renderModules(cur) {
    $("#mods").innerHTML = cur.modules.map(m => {
      const lower = (m.targetPct - m.thresholdPct);
      const upper = (m.targetPct + m.thresholdPct);
      const axisMax = Math.max(upper, m.actualPct, m.targetPct) * 1.25 || 0.01;
      const fillW   = Math.min(100, (m.actualPct / axisMax) * 100);
      const targetX = (m.targetPct / axisMax) * 100;
      const bandL   = Math.max(0, (lower / axisMax) * 100);
      const bandR   = Math.min(100, (upper / axisMax) * 100);
      const fillCls = m.status === "over" ? "over" : (m.status === "under" ? "under" : "");
      const pctCls  = m.status === "over" ? "over" : (m.status === "under" ? "under" : "");
      const modPctTitle = `模块实际占比=模块小计/总盘；目标=${pct(m.targetPct,0)}；偏离Δ=${pp(m.delta,1)}；阈值±${pct(m.thresholdPct,0)}`;

      return `
        <div class="mod">
          <div class="mod-head">
            <div>
              <div class="mod-name">
                <span class="roman serif">${m.roman}</span>${m.name}
                ${statusChip(m.status, m.delta)}
              </div>
              <div style="color:var(--text-2);font-size:11px;margin-top:4px" title="模块小计=该模块所有子项市值（折RMB）之和">小计 <span class="num">${fmt(m.total)}</span> RMB</div>
            </div>
            <div class="mod-meta">
              <div class="pct ${pctCls} num" title="${modPctTitle}">${pct(m.actualPct,1)}</div>
              <div class="target" title="${modPctTitle}">目标 ${pct(m.targetPct,0)} · 阈值 ±${pct(m.thresholdPct,0)}</div>
            </div>
          </div>
          <div class="bar">
            <div class="band" style="left:${bandL}%;width:${bandR-bandL}%"></div>
            <div class="fill ${fillCls}" style="width:${fillW}%"></div>
            <div class="target-mark" style="left:${targetX}%"></div>
          </div>
          <div class="subs">
            ${m.subs.map(s => {
              const subTarget = (s.subTargetPct != null) ? pct(s.subTargetPct,1) : "—";
              const subDeltaTxt = s.subThresholdPct != null && s.subThresholdPct > 0
                ? `Δ ${s.delta>=0?"+":""}${pp(s.delta,1)}`
                : "";
              const subStateCls = (s.status === "over" || s.status === "under") ? s.status : "ok";
              const venue = s.venue ? `<span style="color:var(--text-2);font-size:11px">· ${s.venue}</span>` : "";
              const phaseBadge = phaseBadgeHTML(s.phase);
              const rawTitle = s.shares != null
                ? `原币口径：${fmt(s.shares)} 股 × ${(s.price||0).toFixed(2)} ${s.ccy}（成本 ${(s.costPerShare||0).toFixed(2)}）`
                : `原币口径：${fmt(s.raw)} ${s.ccy}`;
              const rmbTitle = s.shares != null && s.costRMB ? (() => {
                const pl = s.rmb - s.costRMB;
                const plPct = pl / s.costRMB;
                return `市值（折RMB）=${fmt(s.rmb)}；成本（折RMB）=${fmt(s.costRMB)}；浮盈亏=${pl>=0?"+":""}${fmtK(pl)}（${(plPct*100).toFixed(1)}%）`;
              })() : `市值（折RMB）=${fmt(s.rmb)}`;
              const stateTitle = `实际占比=${pct(s.actualPct,1)}（=市值/总盘）；目标=${subTarget}；偏离Δ=${pp(s.delta,1)}；阈值±${pct(s.subThresholdPct||0,1)}；Δ单位为pp`;
              return `
                <div class="sub-row">
                  <div class="sub-name">${ccyTag(s.ccy)}<span class="nm">${s.name}</span>${phaseBadge}${venue}</div>
                  <div class="sub-raw num" title="${rawTitle}">
                    ${s.shares != null
                      ? `${fmt(s.shares)} × ${(s.price||0).toFixed(2)}`
                      : `${fmt(s.raw)} ${s.ccy}`}
                  </div>
                  <div class="sub-rmb num" title="${rmbTitle}">
                    ${fmt(s.rmb)}
                    ${s.shares != null && s.costRMB ? (() => {
                      const pl = s.rmb - s.costRMB;
                      const plPct = pl / s.costRMB;
                      // 色温：plPct 映射到颜色（-30% 深红 → 0 灰 → +30% 深绿）
                      const t = Math.max(-1, Math.min(1, plPct / 0.3));
                      const color = t > 0
                        ? `hsl(150, ${(40 + t*40).toFixed(0)}%, ${(55 - t*10).toFixed(0)}%)`
                        : `hsl(${(0 - t*-10).toFixed(0)}, ${(40 + (-t)*40).toFixed(0)}%, ${(60 - (-t)*15).toFixed(0)}%)`;
                      return `<div class="pl" style="color:${color}" title="浮盈亏=市值-成本（证券类才有成本）">${pl>=0?'+':''}${fmtK(pl)} (${(plPct*100).toFixed(1)}%)</div>`;
                    })() : ''}
                  </div>
                  <div class="sub-state ${subStateCls}" title="${stateTitle}">
                    ${pct(s.actualPct,1)}<br/><span style="font-size:10px">${subDeltaTxt}</span>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }).join("");
  }

  function renderAlerts(cur) {
    const tbody = $("#alerts tbody");
    const rows = [];
    cur.modules.forEach(m => {
      const stateLabel = m.status === "over"
        ? `<span class="chip danger">大类超标</span>`
        : m.status === "under"
          ? `<span class="chip warn">大类偏低</span>`
          : `<span class="chip ok">正常</span>`;

      // 1) 模块汇总行（独占一行，带高亮背景）
      rows.push(`
        <tr class="al-mod-row">
          <td colspan="2" style="font-weight:600;color:var(--text-0)">
            <span class="roman serif" style="color:var(--text-2);margin-right:6px">${m.roman}</span>${m.name}
            <span style="color:var(--text-2);font-weight:400;font-size:11px;margin-left:8px">小计</span>
          </td>
          <td class="r" style="font-weight:600">${fmt(m.total)}</td>
          <td class="r" style="font-weight:600">${pct(m.actualPct,1)}</td>
          <td class="r">${pct(m.targetPct,0)}</td>
          <td class="r">±${pct(m.thresholdPct,0)}</td>
          <td class="r"><span class="delta ${m.status}" title="偏离Δ=实际占比-目标占比（单位pp）">${m.delta>0?"+":""}${pp(m.delta,1)}</span></td>
          <td>${stateLabel}</td>
        </tr>
      `);

      // 2) 子项行（缩进、灰一点）
      m.subs.forEach(s => {
        const subStatusInline = (s.status === "over" || s.status === "under")
          ? ` <span class="chip ${s.status==='over'?'danger':'warn'}" style="margin-left:4px;font-size:10px;padding:1px 6px">子项${s.status==='over'?'超':'偏低'}</span>`
          : "";
        const phaseBadge = phaseBadgeHTML(s.phase);
        rows.push(`
          <tr class="al-sub-row">
            <td></td>
            <td style="padding-left:24px;color:var(--text-1)">
              <span style="color:var(--text-2);margin-right:6px">└</span>
              <span class="ccy ${s.ccy}" style="margin-right:6px">${s.ccy}</span>${s.name}${phaseBadge}${subStatusInline}
            </td>
            <td class="r" style="color:var(--text-1)">${fmt(s.rmb)}</td>
            <td class="r" style="color:var(--text-1)">${pct(s.actualPct,1)}</td>
            <td class="r" style="color:var(--text-2);font-size:11px">${s.subTargetPct != null ? pct(s.subTargetPct,1) : ""}</td>
            <td class="r" style="color:var(--text-2);font-size:11px">${s.subThresholdPct ? "±" + pct(s.subThresholdPct,1) : ""}</td>
            <td class="r" style="color:var(--text-2);font-size:11px" title="偏离Δ=实际占比-目标占比（单位pp）">${s.subThresholdPct ? `${s.delta>=0?"+":""}${pp(s.delta,1)}` : ""}</td>
            <td></td>
          </tr>
        `);
      });
    });
    tbody.innerHTML = rows.join("");
  }

  function renderCurrency(cur, target) {
    const total = cur.total;
    const colors = { RMB:"var(--rmb)", USD:"var(--usd)", HKD:"var(--hkd)" };
    const ccyOrder = ["RMB","USD","HKD"];
    $("#ccy-mix").innerHTML = ccyOrder.map(c => {
      const w = total > 0 ? (cur.ccyTotals[c]/total)*100 : 0;
      return `<div title="${c} ${pct(cur.ccyTotals[c]/total,1)}" style="width:${w}%;background:${colors[c]}"></div>`;
    }).join("");
    $("#ccy-legend").innerHTML = ccyOrder.map(c => `
      <div><i style="background:${colors[c]}"></i>${c}
        <span class="num" style="color:var(--text-0);margin-left:6px">${pct(total>0?cur.ccyTotals[c]/total:0,1)}</span>
        <span class="num" style="margin-left:6px;color:var(--text-2)">${fmtK(cur.ccyTotals[c])}</span>
      </div>
    `).join("");
    const rmbPct = total > 0 ? cur.ccyTotals.RMB / total : 0;
    $("#ccy-status").innerHTML = rmbPct > 0.70
      ? `<span class="chip danger">RMB ${pct(rmbPct,1)} 已超红线</span>`
      : rmbPct > 0.60
        ? `<span class="chip warn">RMB ${pct(rmbPct,1)} 高于目标</span>`
        : `<span class="chip ok">RMB ${pct(rmbPct,1)} 在目标内</span>`;
  }

  // ---- 趋势卡（ECharts 版本）----
  let trendCharts = [];
  function renderTrends(enriched, activeDate) {
    // 清理旧图表
    trendCharts.forEach(c => c.dispose());
    trendCharts = [];

    const dates = enriched.map(s => s.date);
    const series = {
      total:    enriched.map(s => s.total),
      rmbPct:   enriched.map(s => s.total ? s.ccyTotals.RMB / s.total : 0),
      tencent:  enriched.map(s => {
        const ts = s.modules.flatMap(m=>m.subs).filter(x => /^tencent_/.test(x.key) || x.key === "tencent");
        const sum = ts.reduce((a,x)=>a+x.rmb,0);
        return s.total ? sum / s.total : 0;
      }),
      modOver:  enriched.map(s => s.modules.filter(m=>m.status!=="ok").length),
    };
    const cards = [
      { name:"金融资产总值 (RMB)", value:fmtK(series.total[series.total.length-1]), data:series.total, fmt:fmtK, color:"#7aa2ff", isPct:false },
      { name:"RMB 占比", value:pct(series.rmbPct[series.rmbPct.length-1],1), data:series.rmbPct, fmt:v=>pct(v,1), color:"#5b8bff", isPct:true, refLine:0.70 },
      { name:"腾讯单一敞口", value:pct(series.tencent[series.tencent.length-1],1), data:series.tencent, fmt:v=>pct(v,1), color:"#ff5c7a", isPct:true, refLine:0.05 },
      { name:"模块告警数", value:String(series.modOver[series.modOver.length-1]), data:series.modOver, fmt:v=>String(v|0), color:"#ffb454", isPct:false },
    ];

    const container = $("#trends");
    container.innerHTML = cards.map((c, i) => `
      <div class="trend" id="trend-chart-${i}">
        <div class="trend-head">
          <div class="t-name">${c.name}</div>
          <div class="t-val" style="color:${c.color}">${c.value}</div>
        </div>
        <div style="width:100%;height:120px;"></div>
      </div>
    `).join("");

    cards.forEach((c, i) => {
      const chartDom = container.querySelector(`#trend-chart-${i} > div:last-child`);
      const chart = echarts.init(chartDom, 'dark');
      trendCharts.push(chart);

      const activeIndex = enriched.findIndex(s => s.date === activeDate);

      const option = {
        backgroundColor: 'transparent',
        grid: { top: 5, right: 5, bottom: 5, left: 5 },
        tooltip: {
          trigger: 'axis',
          backgroundColor: 'rgba(19, 23, 31, 0.95)',
          borderColor: '#1f2533',
          textStyle: { color: '#e8ecf3', fontSize: 11 },
          formatter: (params) => {
            const idx = params[0].dataIndex;
            const date = dates[idx];
            const val = c.isPct ? pct(c.data[idx], 2) : fmtK(c.data[idx]);
            return `<div style="font-family:'JetBrains Mono',monospace">${date}<br/>${c.name}: <b>${val}</b></div>`;
          }
        },
        xAxis: {
          type: 'category',
          data: dates,
          show: false
        },
        yAxis: {
          type: 'value',
          show: false,
          scale: true
        },
        series: [{
          data: c.data,
          type: 'line',
          smooth: true,
          symbol: (val, params) => params.dataIndex === activeIndex ? 'circle' : 'none',
          symbolSize: 8,
          lineStyle: { color: c.color, width: 2 },
          itemStyle: { color: c.color },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: c.color + '33' },
              { offset: 1, color: c.color + '05' }
            ])
          },
          markLine: c.refLine ? {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#5e677a', type: 'dashed', width: 1 },
            data: [{ yAxis: c.refLine }]
          } : undefined
        }]
      };
      chart.setOption(option);
    });
  }

  // ---- 时间线 ----
  function renderTimeline(enriched, activeDate, picker) {
    const tl = $("#timeline");
    tl.innerHTML = enriched.slice().reverse().map((s,idx) => {
      // idx 是倒序后的；找原 index
      const origIdx = enriched.length - 1 - idx;
      const prev = origIdx > 0 ? enriched[origIdx-1] : null;
      const d = prev ? s.total - prev.total : 0;
      const dPct = prev && prev.total ? d/prev.total : 0;
      const cls = !prev ? "flat" : (d>0 ? "up" : (d<0 ? "down" : "flat"));
      const txt = !prev ? "—" : `${d>=0?"+":""}${(dPct*100).toFixed(2)}%`;
      return `
        <div class="tl-row ${s.date===activeDate?'active':''}" data-date="${s.date}">
          <div class="d">${s.date}</div>
          <div class="c">${s.comment || ""}</div>
          <div class="v">${fmtK(s.total)}</div>
          <div class="chg ${cls}">${txt}</div>
        </div>
      `;
    }).join("");
    tl.querySelectorAll(".tl-row").forEach(r => {
      r.addEventListener("click", () => {
        picker.value = r.dataset.date;
        picker.dispatchEvent(new Event("change"));
      });
    });
  }

  // ---- 长期增长预测（ECharts 版本）----
  let growthChart = null;
  function renderGrowthProjection(cur, target) {
    const root = $("#growth-projection");
    if (!root) return;

    const scenarios = target.returnAssumptions?.scenarios || {};
    const scenarioKeys = Object.keys(scenarios);
    if (scenarioKeys.length === 0) {
      root.innerHTML = `<div style="padding:14px;color:var(--text-2)">target.json 未定义 returnAssumptions</div>`;
      return;
    }

    const inflRate = (target.inflation && target.inflation.annual) || 0.025;
    const mode = (window.localStorage && localStorage.getItem("growthMode")) || "nominal";

    // 各情景下的组合年化（用 core）
    const portfolioReturns = {};
    scenarioKeys.forEach(sk => {
      portfolioReturns[sk] = C.weightedExpectedReturn(cur, sk, { excludeOrphan: true });
    });

    const years = 20;
    const xData = Array.from({length: years+1}, (_,i) => `+${i}年`);
    const series = scenarioKeys.map(sk => {
      const r = portfolioReturns[sk];
      const data = [];
      for (let y = 0; y <= years; y++) {
        const nominal = cur.total * Math.pow(1 + r, y);
        const real = nominal / Math.pow(1 + inflRate, y);
        data.push(mode === "real" ? real : nominal);
      }
      const realReturn = (1+r)/(1+inflRate) - 1;
      return { key: sk, label: scenarios[sk].label, color: scenarios[sk].color, nominalReturn: r, realReturn, data };
    });

    const startYear = new Date(cur.date).getFullYear();
    const cardsHTML = series.map(s => `
      <div style="background:var(--bg-2);border-left:3px solid ${s.color};border-radius:8px;padding:12px 14px">
        <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px">${s.label}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:${s.color};margin:4px 0">${pct(s.nominalReturn,2)} <span style="font-size:11px;color:var(--text-2)">名义 / 实际 ${pct(s.realReturn,2)}</span></div>
        <div style="font-size:11px;color:var(--text-1);font-family:'JetBrains Mono',monospace">
          5年 ${fmtK(s.data[5])}<br/>
          10年 ${fmtK(s.data[10])}<br/>
          20年 ${fmtK(s.data[20])} <span style="color:${s.color}">${(s.data[20]/cur.total).toFixed(1)}×</span>
        </div>
      </div>
    `).join("");

    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;gap:14px;flex-wrap:wrap">
        <div style="font-size:12px;color:var(--text-2)">起点：${startYear} 年总盘 <b style="color:var(--text-0);font-family:'JetBrains Mono',monospace">${fmtK(cur.total)}</b> RMB · 通胀 ${(inflRate*100).toFixed(1)}%/年 · 假设无新注入 / 无消费 / 复利</div>
        <div class="infl-toggle">
          <button class="${mode==='nominal'?'active':''}" data-mode="nominal">名义值（含通胀）</button>
          <button class="${mode==='real'?'active':''}" data-mode="real">实际购买力</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(${series.length},1fr);gap:10px;margin-bottom:14px">
        ${cardsHTML}
      </div>
      <div id="growth-chart" style="width:100%;height:280px;"></div>
      <div style="font-size:11px;color:var(--text-2);margin-top:8px;text-align:right">⚠️ 是预测不是承诺；实际波动远大于这条平滑曲线</div>
    `;

    // 初始化 ECharts
    const chartDom = root.querySelector('#growth-chart');
    if (growthChart) growthChart.dispose();
    growthChart = echarts.init(chartDom, 'dark');

    const option = {
      backgroundColor: 'transparent',
      grid: { top: 20, right: 30, bottom: 30, left: 70 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(19, 23, 31, 0.95)',
        borderColor: '#1f2533',
        textStyle: { color: '#e8ecf3', fontSize: 11 },
        formatter: (params) => {
          let html = `<div style="font-family:'JetBrains Mono',monospace">${params[0].axisValue}</div>`;
          params.forEach(p => {
            const val = fmtK(p.value);
            const multiple = (p.value / cur.total).toFixed(1);
            html += `<div style="display:flex;align-items:center;gap:6px;margin-top:4px">
              <span style="display:inline-block;width:8px;height:8px;background:${p.color};border-radius:50%"></span>
              <span>${p.seriesName}: <b>${val}</b> (${multiple}×)</span>
            </div>`;
          });
          return html;
        }
      },
      xAxis: {
        type: 'category',
        data: xData,
        axisLine: { lineStyle: { color: '#1f2533' } },
        axisLabel: { color: '#5e677a', fontSize: 10, fontFamily: 'JetBrains Mono' },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        splitLine: { lineStyle: { color: '#1f2533', type: 'dashed' } },
        axisLabel: {
          color: '#5e677a',
          fontSize: 10,
          fontFamily: 'JetBrains Mono',
          formatter: (v) => fmtK(v)
        }
      },
      dataZoom: [{
        type: 'inside',
        start: 0,
        end: 100
      }],
      series: series.map(s => ({
        name: s.label,
        data: s.data,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: s.color, width: 2.5 },
        itemStyle: { color: s.color },
        endLabel: {
          show: true,
          formatter: '{c}',
          color: s.color,
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          formatter: (p) => `${(p.value/cur.total).toFixed(1)}×`
        }
      }))
    };
    growthChart.setOption(option);

    root.querySelectorAll(".infl-toggle button").forEach(btn => {
      btn.addEventListener("click", () => {
        if (window.localStorage) localStorage.setItem("growthMode", btn.dataset.mode);
        renderGrowthProjection(cur, target);
      });
    });
  }

  // ---- 池分离视图 ----
  function renderPools(cur, target) {
    const pools = $("#pools");
    if (!pools) return;

    // 按币种把所有 sub 拆到两个池
    const isOverseasCcy = c => c === "USD" || c === "HKD";
    const all = cur.modules.flatMap(m => m.subs.map(s => ({...s, _modKey: m.key})));
    const rmbSubs = all.filter(s => s.ccy === "RMB");
    const ovsSubs = all.filter(s => isOverseasCcy(s.ccy));

    // 池目标占比 = 该池所有子项 subTargetPct 之和（含 phase=blocked，假设通道开通后回归）
    const rmbTarget = rmbSubs.reduce((a,s)=>a+(s.subTargetPct||0),0);
    const ovsTarget = ovsSubs.reduce((a,s)=>a+(s.subTargetPct||0),0);
    const rmbActual = cur.total > 0 ? rmbSubs.reduce((a,s)=>a+s.rmb,0) / cur.total : 0;
    const ovsActual = cur.total > 0 ? ovsSubs.reduce((a,s)=>a+s.rmb,0) / cur.total : 0;

    const card = (label, color, target, actual, subs) => {
      const delta = actual - target;
      const cls = Math.abs(delta) > 0.05 ? (delta > 0 ? "over" : "under") : "ok";
      const chip = cls === "over" ? `<span class="chip danger" title="偏离Δ=实际占比-目标占比（单位pp）">偏多 +${pp(delta,1)}</span>`
                 : cls === "under" ? `<span class="chip warn" title="偏离Δ=实际占比-目标占比（单位pp）">偏少 ${pp(delta,1)}</span>`
                 : `<span class="chip ok">在阈值内</span>`;
      const axisMax = Math.max(target, actual) * 1.3 || 0.01;
      const fillW = Math.min(100, (actual/axisMax)*100);
      const targetX = (target/axisMax)*100;
      const fillCls = cls;
      const sumRMB = subs.reduce((a,s)=>a+s.rmb,0);

      // 子项明细：按金额降序展示
      const sorted = subs.slice().sort((a,b) => b.rmb - a.rmb);
      const subsHTML = sorted.map(s => `
        <div class="sub-row">
          <div class="sub-name">${ccyTag(s.ccy)}<span class="nm">${s.name}</span>${phaseBadgeHTML(s.phase)}</div>
          <div class="sub-raw num">${fmt(s.raw)} ${s.ccy}</div>
          <div class="sub-rmb num">${fmt(s.rmb)}</div>
          <div class="sub-state ok">${pct(s.actualPct,1)}</div>
        </div>
      `).join("");

      return `
        <div class="mod" style="border-left:3px solid ${color}">
          <div class="mod-head">
            <div>
              <div class="mod-name">${label} ${chip}</div>
              <div style="color:var(--text-2);font-size:11px;margin-top:4px">小计 <span class="num">${fmt(sumRMB)}</span> RMB · ${subs.length} 个子项</div>
            </div>
            <div class="mod-meta">
              <div class="pct ${fillCls} num">${pct(actual,1)}</div>
              <div class="target">目标 ${pct(target,1)}</div>
            </div>
          </div>
          <div class="bar">
            <div class="fill ${fillCls}" style="width:${fillW}%"></div>
            <div class="target-mark" style="left:${targetX}%"></div>
          </div>
          <div class="subs">${subsHTML}</div>
        </div>
      `;
    };

    pools.innerHTML =
      card("🇨🇳 RMB 池（人民币）",   "var(--rmb)", rmbTarget, rmbActual, rmbSubs) +
      card("🌏 海外池（USD + HKD）", "var(--usd)", ovsTarget, ovsActual, ovsSubs);
  }

  // ---- 健康检查（紧凑单行版）----
  function renderHealthCheck(cur, target) {
    const issues = C.healthCheck(cur, target);
    const root = $("#health-check");
    if (!root) return;
    if (issues.length === 0) {
      root.innerHTML = `
        <div class="hc-strip">
          <div class="hc-row ok">
            <span class="lvl">OK</span>
            <span class="body"><b>全部健康</b>所有红线 / 大类阈值 / 待办均在控</span>
            <span class="action">继续季度复盘</span>
          </div>
        </div>`;
      return;
    }
    const lvlLabel = { danger: "红线", warn: "偏离", info: "待办", ok: "OK" };
    root.innerHTML = `<div class="hc-strip">${issues.map(i => `
      <div class="hc-row ${i.level}">
        <span class="lvl">${lvlLabel[i.level] || i.level}</span>
        <span class="body"><b>${i.title}</b>${i.detail}</span>
        <span class="action">→ ${i.action}</span>
      </div>
    `).join("")}</div>`;
  }

  // ---- 腾讯减仓阶梯（ECharts 版本）----
  let tencentLadderChart = null;
  function renderTencentLadder(cur) {
    const root = $("#tencent-ladder");
    if (!root) return;
    const tencentSubs = cur.modules.flatMap(m => m.subs).filter(s => /^tencent_/.test(s.key) || s.key === "tencent");
    if (tencentSubs.length === 0) { root.innerHTML = ""; return; }
    const tprice = (cur.prices && cur.prices.tencent_futu && cur.prices.tencent_futu.price) || tencentSubs[0].price;
    if (!tprice) { root.innerHTML = ""; return; }
    const totalShares = tencentSubs.reduce((a,s) => a + (s.shares || 0), 0);
    const totalRMB    = tencentSubs.reduce((a,s) => a + s.rmb, 0);
    const tencentPct  = cur.total > 0 ? totalRMB / cur.total : 0;

    const ladders = [
      { type:"attack",  label:"进攻 1",  trigger: 500, action:"富途 -1,500", color: "#3ddc97" },
      { type:"attack",  label:"进攻 2",  trigger: 580, action:"富途 -1,500", color: "#3ddc97" },
      { type:"attack",  label:"进攻 3",  trigger: 680, action:"富途清仓 -2,385", color: "#3ddc97" },
      { type:"defend",  label:"防御 1",  trigger: 420, action:"富途 -1,800", color: "#ffb454" },
      { type:"redline", label:"红线",    trigger: 380, action:"非主仓清完",   color: "#ff5c7a" },
    ];

    const allPrices = ladders.map(l => l.trigger).concat([tprice]);
    const minP = Math.min(...allPrices) * 0.9;
    const maxP = Math.max(...allPrices) * 1.1;

    root.innerHTML = `
      <div class="lia-card" style="margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;flex-wrap:wrap;gap:10px">
          <div>
            <span style="font-weight:600;font-size:14px">📍 腾讯减仓阶梯</span>
            <span style="color:var(--text-2);font-size:12px;margin-left:8px">合计 ${fmt(totalShares)} 股 · ${pct(tencentPct,1)} 占比</span>
          </div>
          <a href="../腾讯减仓阶梯_2026-05-16.md" style="color:var(--accent);font-size:11px;text-decoration:none">📄 查看完整方案</a>
        </div>
        <div id="tencent-ladder-chart" style="width:100%;height:120px;"></div>
        <div style="font-size:11px;color:var(--text-2);text-align:right;margin-top:8px">${getNextTrigger(tprice, ladders)}</div>
      </div>
    `;

    const chartDom = root.querySelector('#tencent-ladder-chart');
    if (tencentLadderChart) tencentLadderChart.dispose();
    tencentLadderChart = echarts.init(chartDom, 'dark');

    const option = {
      backgroundColor: 'transparent',
      grid: { top: 30, right: 30, bottom: 30, left: 30 },
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(19, 23, 31, 0.95)',
        borderColor: '#1f2533',
        textStyle: { color: '#e8ecf3', fontSize: 11 },
        formatter: (params) => {
          if (params.componentType === 'markLine') {
            const l = ladders.find(x => x.trigger === params.value);
            return `<div style="font-family:'JetBrains Mono',monospace">
              <div style="color:${l.color};font-weight:600">${l.label}</div>
              <div>触发价: <b>${l.trigger} HKD</b></div>
              <div style="color:#9ba4b6;font-size:10px;margin-top:4px">${l.action}</div>
            </div>`;
          }
          return `<div style="font-family:'JetBrains Mono',monospace">
            <div style="color:#7aa2ff;font-weight:600">当前价格</div>
            <div><b>${tprice} HKD</b></div>
          </div>`;
        }
      },
      xAxis: {
        type: 'value',
        min: minP,
        max: maxP,
        axisLine: { lineStyle: { color: '#1f2533' } },
        axisLabel: { color: '#5e677a', fontSize: 10, fontFamily: 'JetBrains Mono' },
        splitLine: { show: false },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        show: false,
        min: 0,
        max: 1
      },
      series: [
        {
          type: 'scatter',
          data: [[tprice, 0.5]],
          symbolSize: 20,
          itemStyle: { color: '#7aa2ff', borderColor: '#fff', borderWidth: 2 },
          label: {
            show: true,
            position: 'top',
            formatter: `现价 ${tprice}`,
            color: '#7aa2ff',
            fontFamily: 'JetBrains Mono',
            fontSize: 11,
            fontWeight: 'bold'
          }
        },
        {
          type: 'line',
          data: [],
          markLine: {
            symbol: 'none',
            label: {
              position: 'start',
              formatter: '{b}',
              color: '#9ba4b6',
              fontSize: 10,
              fontFamily: 'JetBrains Mono'
            },
            lineStyle: { type: 'dashed', width: 1.5 },
            data: ladders.map(l => ({
              xAxis: l.trigger,
              name: l.label,
              lineStyle: { color: l.color },
              label: { color: l.color }
            }))
          }
        }
      ]
    };
    tencentLadderChart.setOption(option);
  }
  function getNextTrigger(price, ladders) {
    const upcoming = ladders.filter(l => l.type === "attack" && l.trigger > price).sort((a,b) => a.trigger - b.trigger);
    const downcoming = ladders.filter(l => (l.type === "defend" || l.type === "redline") && l.trigger < price).sort((a,b) => b.trigger - a.trigger);
    const u = upcoming[0], d = downcoming[0];
    const parts = [];
    if (u) parts.push(`📈 涨到 ${u.trigger} 触发 ${u.label} — 还需 +${((u.trigger-price)/price*100).toFixed(1)}%`);
    if (d) parts.push(`📉 跌到 ${d.trigger} 触发 ${d.label} — 还需 ${((d.trigger-price)/price*100).toFixed(1)}%`);
    return parts.join(" · ") || "✅ 已超出所有阶梯";
  }

  // ---- 资产 vs 现金流对账 ----
  function renderReconcile(prev, cur) {
    const root = $("#reconcile-bar");
    if (!root) return;
    const r = C.reconcile(prev, cur);
    if (!r) {
      root.innerHTML = `<div class="recon">📍 首次建档（${cur.date}）。再报数 1 次后，这里会显示真实回报率。</div>`;
      return;
    }
    const sign = r.marketReturn >= 0 ? "ret-pos" : "ret-neg";
    const mark = r.marketReturn >= 0 ? "+" : "";
    root.innerHTML = `
      <div class="recon">
        <span>📊 距上次报数 <b>${r.days} 天</b></span>
        <span>·</span>
        <span>总盘变化 <b class="${sign}">${mark}${fmtK(r.dTotal)}</b></span>
        <span>·</span>
        <span>注入 <b>${fmtK(r.netInjection)}</b></span>
        <span>·</span>
        <span>真实回报 <b class="${sign}">${mark}${fmtK(r.marketReturn)}</b> (${(r.returnPct*100).toFixed(2)}%)</span>
        <span>·</span>
        <span>年化 <b class="${sign}">${(r.annualized*100).toFixed(1)}%</b></span>
      </div>`;
  }

  // ---- 里程碑 P0/P1/P2/P3 ----
  function renderMilestones(target) {
    const root = $("#milestones");
    if (!root) return;
    const ms = (target.milestones && target.milestones.items) || [];
    if (ms.length === 0) { root.innerHTML = `<div style="color:var(--text-2)">target.json 未配置 milestones</div>`; return; }
    const counts = { P0:[0,0], P1:[0,0], P2:[0,0], P3:[0,0] };
    ms.forEach(m => { if (counts[m.priority]) { counts[m.priority][1]++; if (m.done) counts[m.priority][0]++; } });
    const summary = ["P0","P1","P2","P3"].map(p => {
      const [d,t] = counts[p];
      const rate = t ? d/t : 0;
      return `<div style="padding:8px 14px;background:var(--bg-2);border-radius:8px;font-size:12px"><span class="ms-prio ${p}" style="margin-right:8px">${p}</span>${d}/${t} <span style="color:var(--text-2);margin-left:6px">${(rate*100).toFixed(0)}%</span></div>`;
    }).join("");

    const cards = ms.map(m => `
      <div class="ms-card ${m.done ? 'done' : ''}">
        <div class="ms-check">${m.done ? '✓' : ''}</div>
        <span class="ms-prio ${m.priority}">${m.priority}</span>
        <div style="flex:1">
          <div class="ms-name">${m.name}</div>
          ${m.note ? `<div class="ms-note">${m.note}</div>` : ''}
        </div>
      </div>
    `).join("");

    root.innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">${summary}</div>
      ${target.milestones.note ? `<div style="color:var(--text-2);font-size:12px;margin-bottom:8px">${target.milestones.note}</div>` : ''}
      <div class="ms-grid">${cards}</div>
    `;
  }
})();
