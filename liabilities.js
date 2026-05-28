// =============================================================
// Tab 2: 💸 负债与刚性支出
// 数据：data/liabilities.json + data/recurring.json + data/target.json (汇率)
// =============================================================
(function () {
  const $  = (s, r=document) => r.querySelector(s);
  const fmt = n => n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString("en-US");
  const fmtK = n => {
    if (n == null || isNaN(n)) return "—";
    if (Math.abs(n) >= 1e8) return (n/1e8).toFixed(2) + "亿";
    if (Math.abs(n) >= 1e4) return (n/1e4).toFixed(1) + "万";
    return Math.round(n).toLocaleString("en-US");
  };
  const pct = (x, d=1) => (isNaN(x) ? "—" : (x*100).toFixed(d) + "%");
  const today = new Date();

  Promise.all([
    fetch("./data/liabilities.json", {cache:"no-store"}).then(r => r.json()),
    fetch("./data/recurring.json",   {cache:"no-store"}).then(r => r.json()),
    fetch("./data/history.json",     {cache:"no-store"}).then(r => r.json()),
    fetch("./data/target.json",      {cache:"no-store"}).then(r => r.json()),
    fetch("./data/income_events.json", {cache:"no-store"}).then(r => r.json()).catch(() => ({events:[]})),
  ]).then(([lia, rec, hist, target, incEv]) => {
    try {
    // 取最新汇率
    const snaps = (hist.snapshots || []).slice().sort((a,b) => a.date.localeCompare(b.date));
    const rates = snaps.length ? snaps[snaps.length-1].rates : { USD:7, HKD:0.91 };

    const toRMB = (amt, ccy) => amt * (ccy === "RMB" ? 1 : (rates[ccy] || 1));

    // ---- 收集 active 循环项（KPI 和表格共用同一份数据源） ----
    const monthlyRows = [];
    (rec.incomes || []).forEach(it => {
      if (!isActive(it)) return;
      const monthly = toRMB(it.amount, it.ccy) * (it.frequency === "annual" ? 1/12 : 1);
      monthlyRows.push({ ...it, monthlyRMB: monthly, dir: "in" });
    });
    (rec.expenses || []).forEach(it => {
      if (!isActive(it)) return;
      const monthly = toRMB(it.amount, it.ccy) * (it.frequency === "annual" ? 1/12 : 1);
      monthlyRows.push({ ...it, monthlyRMB: monthly, dir: "out" });
    });
    monthlyRows.sort((a,b) => b.monthlyRMB - a.monthlyRMB);

    // 合计基于实际渲染行
    const monthlyIncomeRMB  = monthlyRows.filter(r => r.dir === "in").reduce((a,r)=>a+r.monthlyRMB, 0);
    const monthlyExpenseRMB = monthlyRows.filter(r => r.dir === "out").reduce((a,r)=>a+r.monthlyRMB, 0);
    const monthlyNet = monthlyIncomeRMB - monthlyExpenseRMB;

    // ---- 年保费合计 ----
    const annualInsuranceRMB = (rec.expenses || [])
      .filter(e => e.kind === "insurance" && isActive(e))
      .reduce((a,e) => a + toRMB(e.amount, e.ccy) * (e.frequency === "annual" ? 1 : 12), 0);

    // ---- 总负债（剔除 soft）+ 年利息 ----
    // 对 accrual=monthly_inflow 的负债（如妈妈月存），动态算累积本金
    const liaList = (lia.liabilities || []).map(l => {
      if (l.accrual === "monthly_inflow" && l.startDate && l.monthlyInflow) {
        const start = parseDate(l.startDate);
        const months = Math.max(0, Math.floor((today - start) / (1000*60*60*24*30.44)));
        return { ...l, principal: months * l.monthlyInflow, _accrued: true, _months: months };
      }
      return l;
    });
    const totalDebtRMB = liaList
      .filter(l => l.deductFromNet !== false || l.type === "hard")
      .reduce((a,l) => a + toRMB(l.principal, l.ccy), 0);
    const softDebtRMB = liaList
      .filter(l => l.deductFromNet === false || l.type === "soft")
      .reduce((a,l) => a + toRMB(l.principal, l.ccy), 0);
    const annualInterestRMB = liaList
      .reduce((a,l) => a + toRMB(l.annualInterest || 0, l.ccy), 0);

    // ---- 总资产（取最新 snapshot 总盘） ----
    const latestTotal = snaps.length ? computeSnapshotTotal(snaps[snaps.length-1], rates) : 0;
    const netWorth = latestTotal - totalDebtRMB;

    // ---- 过渡期 / 退休后净流（基于瀑布图 nominal 模型预算） ----
    // 注意：inflationRate / retirement 在这里声明，被本块的 IIFE 和后面的瀑布图共用
    const inflationRate = (target.inflation && target.inflation.annual) || 0.025;
    const retirement = target.retirement || {};
    const retirementYr = (retirement.selfRetireYear) || 2027;
    const yearsArrForKPI = (function () {
      // 不依赖 renderWaterfall 闭包，提前算一份 nominal
      const evByYear = {};
      (incEv.events || []).forEach(ev => {
        if (!ev.year || !ev.amount || ev.amount <= 0) return;
        const amtRMB = toRMB(ev.amount, ev.ccy || "RMB");
        (evByYear[ev.year] = evByYear[ev.year] || []).push({ ...ev, amtRMB });
      });
      const arr = [];
      const startYr = today.getFullYear();
      for (let dy = 0; dy < 20; dy++) {
        const yr = startYr + dy;
        let yIncome = 0, yExpense = 0;
        (rec.incomes || []).forEach(it => {
          const months = activeMonthsInYear(it, yr);
          if (months <= 0) return;
          let amt = it.frequency === "annual" ? toRMB(it.amount, it.ccy) : toRMB(it.amount, it.ccy) * months;
          if (it.kind === "rental_income") amt *= Math.pow(1 + inflationRate * 0.5, dy);
          if (it.kind === "salary") amt *= Math.pow(1 + inflationRate * 0.7, dy);
          yIncome += amt;
        });
        (evByYear[yr] || []).forEach(ev => { yIncome += ev.amtRMB; });
        (rec.expenses || []).forEach(it => {
          const months = activeMonthsInYear(it, yr);
          if (months <= 0) return;
          let amt = it.frequency === "annual" ? toRMB(it.amount, it.ccy) : toRMB(it.amount, it.ccy) * months;
          amt *= Math.pow(1 + inflationRate, dy);
          yExpense += amt;
        });
        arr.push({ year: yr, income: yIncome, expense: yExpense, net: yIncome - yExpense });
      }
      return arr;
    })();
    // 工作期 = 现在到退休年（含），退休后 = 退休年+1 之后
    const transitionNet = yearsArrForKPI
      .filter(y => y.year <= retirementYr)
      .reduce((a, y) => a + y.net, 0);
    const postRetireFirstYr = yearsArrForKPI.find(y => y.year === retirementYr + 1);
    const postRetireSteadyNet = postRetireFirstYr ? postRetireFirstYr.net : 0;

    // ---- KPI ----
    const kpis = [
      {
        label: "总资产 (RMB)",
        value: fmtK(latestTotal),
        sub: snaps.length ? `快照 ${snaps[snaps.length-1].date}` : "—",
        help: "来自history.json最新快照的总盘（折RMB）",
        tone: "ok",
      },
      {
        label: "总负债 / 软性",
        value: `${fmtK(totalDebtRMB)} / ${fmtK(softDebtRMB)}`,
        sub: `年利息 ${fmtK(annualInterestRMB)} RMB`,
        help: "总负债含硬性+软性；软性负债不扣减净资产；利息按本金×利率估算",
        tone: totalDebtRMB > latestTotal * 0.1 ? "warn" : "ok",
      },
      {
        label: "净资产 (RMB)",
        value: fmtK(netWorth),
        sub: `软性负债 ${fmtK(softDebtRMB)} 不计入扣减`,
        help: "净资产=总资产-硬性负债；软性负债单列（不扣减）",
        tone: "ok",
      },
      {
        label: "月度净流出",
        value: (monthlyNet >= 0 ? "+" : "") + fmtK(monthlyNet),
        sub: `收入 ${fmtK(monthlyIncomeRMB)} − 支出 ${fmtK(monthlyExpenseRMB)}`,
        help: "基于recurring.json活跃项目；月净流=月收入-月支出（折RMB）",
        tone: monthlyNet < 0 ? "warn" : "ok",
        delta: `年化 ${(monthlyNet>=0?"+":"")}${fmtK(monthlyNet*12)} RMB`,
        deltaCls: monthlyNet < 0 ? "down" : "up",
      },
      {
        label: "年保费合计",
        value: fmtK(annualInsuranceRMB),
        sub: `${(rec.expenses||[]).filter(e=>e.kind==='insurance'&&isActive(e)).length} 张保单`,
        help: "recurring.json里kind=insurance的活跃保费，折算为年合计（折RMB）",
        tone: "ok",
      },
      {
        label: "刚性支出 / 年",
        value: fmtK(monthlyExpenseRMB * 12),
        sub: `≈ 4 年开销 ${fmtK(monthlyExpenseRMB*48)}（防御现金底线）`,
        help: "把月度刚性支出折算为年；用于估算防御现金底线",
        tone: "ok",
      },
      {
        label: `过渡期累计净流 (${today.getFullYear()}-${retirementYr})`,
        value: (transitionNet >= 0 ? "+" : "") + fmtK(transitionNet),
        sub: `工资+股票+大礼包 - 开销，含通胀。请把数额填进 income_events.json`,
        help: "从今年到退休年（含）累计净流；含通胀假设；用于估算退休前可积累子弹",
        tone: transitionNet > 0 ? "ok" : "warn",
        delta: `${retirementYr - today.getFullYear() + 1} 年合计`,
        deltaCls: transitionNet > 0 ? "up" : "down",
      },
      {
        label: `退休稳态年净流 (${retirementYr + 1}+)`,
        value: (postRetireSteadyNet >= 0 ? "+" : "") + fmtK(postRetireSteadyNet),
        sub: `房租 + 妈妈月存 + 零散 − 开销·利息·保险（不含投资分红）`,
        help: "退休后第一年稳态净流；不含投资收益/分红，仅算稳定现金流",
        tone: postRetireSteadyNet >= 0 ? "ok" : "danger",
      },
    ];
    $("#liab-kpis").innerHTML = kpis.map(k => `
      <div class="kpi ${k.tone}">
        <div class="stripe"></div>
        <div class="label" title="${k.help || ""}">${k.label}</div>
        <div class="value num" title="${k.help || ""}">${k.value}</div>
        <div class="sub" title="${k.help || ""}">${k.sub}</div>
        ${k.delta ? `<div class="delta ${k.deltaCls||'flat'}" title="${k.help || ""}">${k.delta}</div>` : ""}
      </div>
    `).join("");

    // ---- 负债清单 ----
    $("#liab-list").innerHTML = `
      <div class="lia-card">
        <table class="lia-table">
          <thead><tr><th title="负债条目名称">项目</th><th class="r" title="本金按汇率折算到RMB展示">本金</th><th class="r" title="年化利率（用于估算利息）">利率</th><th class="r" title="月利息估算">月利息</th><th class="r" title="年利息估算">年利息</th><th title="硬性：扣减净资产；软性：不扣减净资产">性质</th><th title="备注信息">备注</th></tr></thead>
          <tbody>
            ${liaList.map(l => {
              const principalDisplay = l._accrued
                ? `${fmtK(toRMB(l.principal, l.ccy))} ${l.ccy} <div style="color:var(--text-2);font-size:11px">已累积 ${l._months} 月 × ${fmtK(l.monthlyInflow)}</div>`
                : `${fmtK(toRMB(l.principal, l.ccy))} ${l.ccy}`;
              return `
                <tr>
                  <td><b>${l.name}</b></td>
                  <td class="r">${principalDisplay}</td>
                  <td class="r">${l.interestRate ? pct(l.interestRate,1) : "—"}</td>
                  <td class="r">${fmtK(toRMB(l.monthlyInterest||0, l.ccy))}</td>
                  <td class="r">${fmtK(toRMB(l.annualInterest||0, l.ccy))}</td>
                  <td>${l.type === "soft" ? `<span class="chip ok">软性（不扣减净资产）</span>` : `<span class="chip warn">硬性</span>`}</td>
                  <td><span style="color:var(--text-2);font-size:12px">${l.note || ""}</span></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    // ---- 循环收支 月度净流出（monthlyRows 已在上面计算） ----
    $("#recurring-monthly").innerHTML = `
      <div class="lia-card">
        <table class="lia-table">
          <thead><tr><th title="循环收支条目名称">项目</th><th title="收支类型(kind)">类型</th><th class="r" title="原币金额与频率">原币种</th><th class="r" title="按频率折算后的月度金额（折RMB）">月折算 (RMB)</th><th class="r" title="按频率折算后的年度金额（折RMB）">年折算 (RMB)</th><th title="startDate/endDate 生效区间">有效期</th></tr></thead>
          <tbody>
            ${monthlyRows.map(r => {
              const sign = r.dir === "in" ? "+" : "-";
              const cls  = r.dir === "in" ? "ok" : (r.kind === "insurance" ? "" : "");
              const colored = r.dir === "in" ? `style="color:var(--ok)"` : `style="color:var(--text-0)"`;
              return `
                <tr>
                  <td><b>${r.name}</b><div style="color:var(--text-2);font-size:11px;margin-top:2px">${r.note || ""}</div></td>
                  <td><span style="font-size:11px;color:var(--text-2)">${kindLabel(r.kind)}</span></td>
                  <td class="r">${sign}${fmtK(r.amount)} ${r.ccy} <span style="color:var(--text-2);font-size:11px">/ ${r.frequency === "annual" ? "年" : "月"}</span></td>
                  <td class="r" ${colored}>${sign}${fmtK(r.monthlyRMB)}</td>
                  <td class="r" ${colored}>${sign}${fmtK(r.monthlyRMB*12)}</td>
                  <td><span style="font-size:11px;color:var(--text-2)">${r.startDate || "—"} → ${r.endDate || "永续"}</span></td>
                </tr>
              `;
            }).join("")}
            <tr style="background:var(--bg-2)">
              <td colspan="3" style="font-weight:600">合计 / 净额</td>
              <td class="r" style="font-weight:600;color:${monthlyNet>=0?'var(--ok)':'var(--danger)'}">${monthlyNet>=0?'+':''}${fmtK(monthlyNet)}</td>
              <td class="r" style="font-weight:600;color:${monthlyNet>=0?'var(--ok)':'var(--danger)'}">${monthlyNet>=0?'+':''}${fmtK(monthlyNet*12)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    // ---- 保单缴费日历 ----
    const policies = (rec.expenses || []).filter(e => e.kind === "insurance");
    const policyRows = policies.map(p => {
      const end = parseDate(p.endDate);
      const yearsLeft = end ? Math.max(0, (end - today) / (1000*60*60*24*365.25)) : null;
      const yearsLeftRound = yearsLeft != null ? Math.ceil(yearsLeft) : null;
      const annualRMB = toRMB(p.amount, p.ccy) * (p.frequency === "annual" ? 1 : 12);
      const remaining = yearsLeftRound != null ? annualRMB * yearsLeftRound : null;
      const cdCls = yearsLeftRound == null ? "ok" : (yearsLeftRound <= 5 ? "warn" : "ok");
      return { p, yearsLeft, yearsLeftRound, annualRMB, remaining, cdCls };
    }).sort((a,b) => (a.yearsLeftRound ?? 999) - (b.yearsLeftRound ?? 999));

    const totalRemaining = policyRows.reduce((a,r) => a + (r.remaining || 0), 0);

    $("#policy-list").innerHTML = `
      <div class="lia-card">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-2);margin-bottom:10px;flex-wrap:wrap;gap:10px">
          <span>共 <b style="color:var(--text-0)">${policies.length}</b> 张保单 · 年缴 <b class="num" style="color:var(--text-0)">${fmtK(annualInsuranceRMB)}</b> RMB</span>
          <span>剩余应缴尾款合计 <b class="num" style="color:var(--text-0)">${fmtK(totalRemaining)}</b> RMB</span>
        </div>
        <table class="lia-table">
          <thead><tr><th title="保单名称/编号（展示用）">保单</th><th title="被保人">被保人</th><th title="受益人">受益人</th><th class="r" title="原币年保费（按保单币种）">年保费</th><th class="r" title="折算成人民币的年保费（按统一汇率）">折算 (RMB/年)</th><th title="缴费截止年或缴费期">缴至</th><th class="r" title="剩余应缴总额（按年保费×剩余年数估算）">剩余应缴尾款</th><th title="距离下一次缴费/截止的倒计时">倒计时</th></tr></thead>
          <tbody>
            ${policyRows.map(({p, yearsLeftRound, annualRMB, remaining, cdCls}) => `
              <tr class="${cdCls === 'warn' ? 'urgent' : ''}">
                <td><b>${p.name}</b><div style="color:var(--text-2);font-size:11px">${p.policyNo || ""} · 保额 ${fmtK(p.coverage)} ${p.ccy}</div></td>
                <td>${p.insuredBy || "—"}</td>
                <td>${p.beneficiary || "—"}</td>
                <td class="r">${fmtK(p.amount)} ${p.ccy}</td>
                <td class="r">${fmtK(annualRMB)}</td>
                <td><span class="num" style="font-size:12px">${p.endDate || "—"}</span></td>
                <td class="r">${fmtK(remaining)}</td>
                <td><span class="countdown ${cdCls}">还 ${yearsLeftRound ?? "?"} 年</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    // ---- 未来 20 年现金流瀑布（ECharts 版本）----
    let waterfallChart = null;
    let inflationMode = (window.localStorage && localStorage.getItem("waterfallInflationMode")) || "nominal";

    function buildYearsArr(mode) {
      const arr = [];
      const startYr = today.getFullYear();
      const evByYear = {};
      (incEv.events || []).forEach(ev => {
        if (!ev.year || !ev.amount || ev.amount <= 0) return;
        const amtRMB = toRMB(ev.amount, ev.ccy || "RMB");
        (evByYear[ev.year] = evByYear[ev.year] || []).push({ ...ev, amtRMB });
      });
      for (let dy = 0; dy < 20; dy++) {
        const yr = startYr + dy;
        let yIncome = 0, yExpense = 0;
        const liveIncomes = [], liveExpenses = [];
        (rec.incomes || []).forEach(it => {
          const months = activeMonthsInYear(it, yr);
          if (months <= 0) return;
          let amt = it.frequency === "annual" ? toRMB(it.amount, it.ccy) : toRMB(it.amount, it.ccy) * months;
          if (mode === "nominal" && it.kind === "rental_income") amt *= Math.pow(1 + inflationRate * 0.5, dy);
          if (mode === "nominal" && it.kind === "salary") amt *= Math.pow(1 + inflationRate * 0.7, dy);
          yIncome += amt;
          liveIncomes.push({ key: it.key, name: it.name, kind: it.kind, amt, months, endDate: it.endDate });
        });
        (evByYear[yr] || []).forEach(ev => {
          yIncome += ev.amtRMB;
          liveIncomes.push({ key: ev.key, name: ev.name, kind: ev.kind, amt: ev.amtRMB, months: 1, endDate: null, _oneOff: true, confidence: ev.confidence });
        });
        (rec.expenses || []).forEach(it => {
          const months = activeMonthsInYear(it, yr);
          if (months <= 0) return;
          let amt = it.frequency === "annual" ? toRMB(it.amount, it.ccy) : toRMB(it.amount, it.ccy) * months;
          if (mode === "nominal") amt *= Math.pow(1 + inflationRate, dy);
          yExpense += amt;
          liveExpenses.push({ key: it.key, name: it.name, kind: it.kind, amt, months, endDate: it.endDate });
        });
        arr.push({ year: yr, income: yIncome, expense: yExpense, net: yIncome - yExpense, liveIncomes, liveExpenses });
      }
      return arr;
    }

    function getYearEvents(yearsArr) {
      const startYear = today.getFullYear();
      yearsArr.forEach((y, i) => {
        const events = [];
        y.liveIncomes.filter(e => e._oneOff).forEach(e => {
          const conf = e.confidence != null ? `（信心 ${(e.confidence*100).toFixed(0)}%）` : "";
          events.push({ type: "one_off_income", name: e.name, amt: e.amt, label: `💎 ${e.name} +${fmtK(e.amt)}${conf}` });
        });
        if (i === 0) { y.events = events; return; }
        const prev = yearsArr[i-1];
        const prevExpKeys = new Set(prev.liveExpenses.map(e => e.key));
        const curExpKeys  = new Set(y.liveExpenses.map(e => e.key));
        const recurringPrevInc = prev.liveIncomes.filter(e => !e._oneOff);
        const recurringCurInc  = y.liveIncomes.filter(e => !e._oneOff);
        const prevIncKeys = new Set(recurringPrevInc.map(e => e.key));
        const curIncKeys  = new Set(recurringCurInc.map(e => e.key));

        prev.liveExpenses.filter(e => !curExpKeys.has(e.key)).forEach(e => {
          events.push({ type: "expense_end", name: e.name, amt: e.amt, label: `🟢 ${e.name} 结束` });
        });
        y.liveExpenses.filter(e => !prevExpKeys.has(e.key)).forEach(e => {
          events.push({ type: "expense_start", name: e.name, amt: e.amt, label: `🔴 新增 ${e.name}` });
        });
        recurringPrevInc.filter(e => !curIncKeys.has(e.key)).forEach(e => {
          const isSalary = e.kind === "salary";
          events.push({ type: "income_end", name: e.name, amt: e.amt, label: `${isSalary?'🎯':'🔴'} ${isSalary?'退休 · ':''}${e.name} 终止` });
        });
        recurringCurInc.filter(e => !prevIncKeys.has(e.key)).forEach(e => {
          events.push({ type: "income_start", name: e.name, amt: e.amt, label: `🟢 新增收入 ${e.name}` });
        });

        const prevByKey = new Map([...prev.liveExpenses, ...recurringPrevInc].map(e => [e.key, e]));
        [...y.liveExpenses, ...recurringCurInc].forEach(cur => {
          const p = prevByKey.get(cur.key);
          if (!p) return;
          const diff = cur.amt - p.amt;
          const ratio = p.amt > 0 ? Math.abs(diff) / p.amt : 0;
          if (ratio < 0.05) return;
          const isExp = y.liveExpenses.includes(cur);
          if (isExp) {
            if (diff < 0) events.push({ type: "expense_end", name: cur.name, amt: -diff, label: `🟢 ${cur.name} 减少` });
          } else {
            if (diff > 0) events.push({ type: "income_start", name: cur.name, amt: diff, label: `🟢 ${cur.name} 增加` });
          }
        });

        const grouped = [];
        const insBuckets = {};
        events.forEach(ev => {
          const m = ev.name.match(/^(保诚|AIA|泰康)/);
          if (m && (ev.type === "expense_end" || ev.type === "expense_start")) {
            const k = `${ev.type}_${m[1]}`;
            if (!insBuckets[k]) {
              insBuckets[k] = { type: ev.type, company: m[1], names: [], totalAmt: 0 };
              grouped.push({ _bucket: k, kind: "ins" });
            }
            insBuckets[k].names.push(ev.name);
            insBuckets[k].totalAmt += ev.amt;
          } else {
            grouped.push({ ev, kind: "single" });
          }
        });
        const flat = grouped.map(g => {
          if (g.kind === "ins") {
            const b = insBuckets[g._bucket];
            const verb = b.type === "expense_end" ? "缴清" : "新缴";
            const icon = b.type === "expense_end" ? "🟢" : "🔴";
            return { type: b.type, label: `${icon} ${b.company} ${b.names.length} 单${verb}` };
          }
          return g.ev;
        }).filter(v => v && v.label).filter((v,i,arr) => arr.findIndex(x => x.label === v.label) === i);
        y.events = flat;
      });

      yearsArr.forEach(y => {
        if (retirement.selfRetireYear && y.year === retirement.selfRetireYear) {
          (y.events = y.events || []).unshift({ type: "milestone", label: `🎯 ${retirement.selfRetireYear} 起退休` });
        }
      });

      return yearsArr;
    }

    function renderWaterfall(mode) {
      const yearsArr = getYearEvents(buildYearsArr(mode));
      const startYear = today.getFullYear();

      const xData = yearsArr.map(y => y.year === startYear ? `${y.year} (今)` : String(y.year));
      const expenseData = yearsArr.map(y => -y.expense);
      const incomeData = yearsArr.map(y => y.income);
      const netData = yearsArr.map(y => y.net);

      const container = $("#waterfall");
      container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px">
          <div style="font-size:12px;color:var(--text-2)">通胀假设 <b style="color:var(--text-0);font-family:'JetBrains Mono',monospace">${(inflationRate*100).toFixed(1)}%/年</b> · ${retirement.selfRetireYear ? `计划 ${retirement.selfRetireYear} 退休` : '未设退休年'}</div>
          <div class="infl-toggle">
            <button class="${mode==='nominal'?'active':''}" data-mode="nominal">名义值（含通胀）</button>
            <button class="${mode==='real'?'active':''}" data-mode="real">实际购买力（今天币值）</button>
          </div>
        </div>
        <div id="waterfall-chart" style="width:100%;height:400px;"></div>
      `;

      const chartDom = container.querySelector('#waterfall-chart');
      if (waterfallChart) waterfallChart.dispose();
      waterfallChart = echarts.init(chartDom, 'dark');

      const option = {
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          backgroundColor: 'rgba(19, 23, 31, 0.95)',
          borderColor: '#1f2533',
          textStyle: { color: '#e8ecf3', fontSize: 11 },
          formatter: (params) => {
            const idx = params[0].dataIndex;
            const y = yearsArr[idx];
            let html = `<div style="font-family:'JetBrains Mono',monospace;font-weight:600;margin-bottom:6px">${y.year}年</div>`;
            html += `<div style="display:flex;justify-content:space-between;gap:20px">
              <span style="color:#ff5c7a">支出: <b>${fmtK(y.expense)}</b></span>
              <span style="color:#3ddc97">收入: <b>${fmtK(y.income)}</b></span>
            </div>`;
            html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #1f2533">
              <span style="color:${y.net >= 0 ? '#3ddc97' : '#ff5c7a'}">净流: <b>${y.net >= 0 ? '+' : ''}${fmtK(y.net)}</b></span>
            </div>`;
            if (y.events && y.events.length > 0) {
              html += `<div style="margin-top:8px;font-size:10px;color:#9ba4b6">${y.events.map(e => e.label).join(' · ')}</div>`;
            }
            return html;
          }
        },
        legend: {
          data: ['支出', '收入', '净流'],
          textStyle: { color: '#9ba4b6', fontSize: 11 },
          top: 0
        },
        grid: { top: 40, right: 20, bottom: 40, left: 70 },
        xAxis: {
          type: 'category',
          data: xData,
          axisLine: { lineStyle: { color: '#1f2533' } },
          axisLabel: { color: '#5e677a', fontSize: 10, fontFamily: 'JetBrains Mono', rotate: 45 },
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
            formatter: (v) => fmtK(Math.abs(v))
          }
        },
        dataZoom: [{
          type: 'inside',
          start: 0,
          end: 100
        }, {
          type: 'slider',
          start: 0,
          end: 100,
          height: 20,
          bottom: 0,
          borderColor: '#1f2533',
          fillerColor: 'rgba(122,162,255,0.2)',
          handleStyle: { color: '#7aa2ff' },
          textStyle: { color: '#5e677a' }
        }],
        series: [
          {
            name: '支出',
            type: 'bar',
            stack: 'total',
            data: expenseData,
            itemStyle: { color: '#ff5c7a', borderRadius: [2, 2, 0, 0] }
          },
          {
            name: '收入',
            type: 'bar',
            stack: 'total',
            data: incomeData,
            itemStyle: { color: '#3ddc97', borderRadius: [2, 2, 0, 0] }
          },
          {
            name: '净流',
            type: 'line',
            data: netData,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { color: '#7aa2ff', width: 2 },
            itemStyle: { color: '#7aa2ff' },
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { color: '#5e677a', type: 'dashed', width: 1 },
              data: [{ yAxis: 0 }]
            }
          }
        ]
      };
      waterfallChart.setOption(option);

      container.querySelectorAll(".infl-toggle button").forEach(btn => {
        btn.addEventListener("click", () => {
          const newMode = btn.dataset.mode;
          inflationMode = newMode;
          if (window.localStorage) localStorage.setItem("waterfallInflationMode", newMode);
          renderWaterfall(newMode);
        });
      });
    }
    renderWaterfall(inflationMode);
    } catch (e) {
      console.error("liabilities render error:", e);
      $("#liab-kpis").innerHTML = `<div style="padding:24px;color:var(--danger);font-family:monospace;white-space:pre-wrap">渲染异常：${e.message}\n\n${e.stack || ""}</div>`;
    }
  }).catch(err => {
    $("#liab-kpis").innerHTML = `<div style="padding:24px;color:var(--text-1)">加载失败：${err.message}</div>`;
    console.error(err);
  });

  // ---- 工具函数 ----
  function isActive(item, ref = today) {
    const start = parseDate(item.startDate);
    const end   = parseDate(item.endDate);
    if (start && start > ref) return false;
    if (end && end < ref) return false;
    return true;
  }
  function isActiveAtYear(item, year) {
    return activeMonthsInYear(item, year) > 0;
  }
  function activeMonthsInYear(item, year) {
    const yStart = new Date(year, 0, 1);
    const yEnd   = new Date(year, 11, 31);
    const start = parseDate(item.startDate) || new Date(1970,0,1);
    const end   = parseDate(item.endDate)   || new Date(9999,11,31);
    if (start > yEnd || end < yStart) return 0;
    const effStart = start > yStart ? start : yStart;
    const effEnd   = end < yEnd ? end : yEnd;
    // 月数 = (effEnd.year - effStart.year) * 12 + (effEnd.month - effStart.month) + 1
    const months = (effEnd.getFullYear() - effStart.getFullYear()) * 12 + (effEnd.getMonth() - effStart.getMonth()) + 1;
    return Math.max(0, Math.min(12, months));
  }
  function parseDate(s) {
    if (!s) return null;
    // 支持 "2026", "2026-05", "2026-05-16", "2035-07-01"
    const m = String(s).match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (!m) return null;
    return new Date(parseInt(m[1]), (parseInt(m[2]||1)||1)-1, parseInt(m[3]||1)||1);
  }
  function kindLabel(kind) {
    const map = {
      living: "🏠 居住",
      rental_income: "🏠 房租收入",
      debt_interest: "💰 利息支出",
      insurance: "🛡 保险",
      salary: "💼 工资",
      side_gig: "🪢 零散收入",
      family_deposit: "👵 家庭代管",
      stock_vest: "📜 股票兑现",
      severance: "🎁 离职大礼包",
      bonus: "🎉 奖金",
      transport: "🚗 行车交通",
      telecom: "📡 通讯",
    };
    return map[kind] || kind || "—";
  }
  function computeSnapshotTotal(snap, rates) {
    return Object.values(snap.holdings || {}).reduce((a, h) => {
      const ccy = h.ccy || "RMB";
      const rate = ccy === "RMB" ? 1 : (rates[ccy] || 1);
      return a + (Number(h.raw) || 0) * rate;
    }, 0);
  }
})();
