// =============================================================
// Tab 3: 📈 现金流追踪 · 年度
// 数据：data/transactions/yearly/{YYYY}.json + categories.json + recurring.json
// 设计：年度粒度，截图导入，抓大放小
// =============================================================
(function () {
  const $  = (s, r=document) => r.querySelector(s);
  const fmt = n => n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString("en-US");
  const fmtK = n => {
    if (n == null || isNaN(n)) return "—";
    if (Math.abs(n) >= 1e4) return (n/1e4).toFixed(1) + "万";
    return Math.round(n).toLocaleString("en-US");
  };
  const pct = (x, d=1) => (isNaN(x) ? "—" : (x*100).toFixed(d) + "%");

  Promise.all([
    fetch("./data/transactions/index.json", {cache:"no-store"}).then(r => r.json()),
    fetch("./data/categories.json",         {cache:"no-store"}).then(r => r.json()),
    fetch("./data/recurring.json",          {cache:"no-store"}).then(r => r.json()),
    fetch("./data/history.json",            {cache:"no-store"}).then(r => r.json()),
    fetch("./data/income_events.json",      {cache:"no-store"}).then(r => r.json()).catch(() => ({events:[]})),
  ]).then(async ([txIndex, cats, rec, hist, incEv]) => {
    const years = (txIndex.years || []).slice().sort();
    if (years.length === 0) {
      $("#cash-kpis").innerHTML = `<div style="padding:24px;color:var(--text-1)">还没有任何年度账单。把随手记年度截图发给小龙猫，她会写到 <code>data/transactions/yearly/YYYY.json</code>。</div>`;
      return;
    }

    const snaps = (hist.snapshots || []).slice().sort((a,b) => a.date.localeCompare(b.date));
    const rates = snaps.length ? snaps[snaps.length-1].rates : { USD:7, HKD:0.91 };
    const toRMB = (amt, ccy) => amt * (ccy === "RMB" ? 1 : (rates[ccy] || 1));

    const allYearData = await Promise.all(years.map(y =>
      fetch(`./data/transactions/yearly/${y}.json`, {cache:"no-store"}).then(r => r.json())
    ));

    const picker = $("#month-picker");
    picker.innerHTML = years.slice().reverse().map(y => `<option value="${y}">${y} 年</option>`).join("");
    picker.addEventListener("change", () => render(picker.value));

    function render(yearKey) {
      const idx = years.indexOf(yearKey);
      const data = allYearData[idx];
      const prevData = idx > 0 ? allYearData[idx-1] : null;

      const isPartial = data.status === "partial_with_projection";
      const yearProgress = data.yearProgress || 1;
      // 当 partial 时：actual = amount（截止值），projected = projected_annual 或 amount/yearProgress
      const exps = (data.expenses || []).map(t => {
        const rmb = toRMB(t.amount, t.ccy || "RMB");
        const proj = isPartial ? toRMB(t.projected_annual ?? (t.amount / yearProgress), t.ccy || "RMB") : rmb;
        return { ...t, rmb, projected: proj };
      });
      const ins = (data.incomes || []).map(t => {
        const rmb = toRMB(t.amount, t.ccy || "RMB");
        const proj = isPartial ? toRMB(t.projected_annual ?? (t.amount / yearProgress), t.ccy || "RMB") : rmb;
        return { ...t, rmb, projected: proj };
      });
      const totalExpenseYTD = exps.reduce((a,t) => a + t.rmb, 0);
      const totalIncomeYTD  = ins.reduce((a,t) => a + t.rmb, 0);
      const totalExpenseProj = exps.reduce((a,t) => a + t.projected, 0);
      const totalIncomeProj  = ins.reduce((a,t) => a + t.projected, 0);
      // 把 recurring（房租/利息/保险/工资）按当年实际有效月数年化
      // 双重计算保护：如果 yearly/*.json 已经记录了对应 recurring=<key>，则 recurring 那一侧跳过该 key（实绩优先）
      const yearNum = parseInt(yearKey, 10);
      const C = window.AssetCore;
      const yearlyRecurringKeys = new Set([...exps, ...ins].filter(t => t.recurring).map(t => t.recurring));
      const recurringAnnual = (rec.expenses || []).reduce((a,e) => {
        if (yearlyRecurringKeys.has(e.key)) return a;
        if (e.kind === "insurance" && yearlyRecurringKeys.has("_insurance_pool")) return a;
        const months = C.activeMonthsInYear(e, yearNum);
        if (months <= 0) return a;
        const baseAnnual = toRMB(e.amount, e.ccy) * (e.frequency === "annual" ? 1 : months);
        return a + baseAnnual;
      }, 0);
      const recurringIncomeAnnual = (rec.incomes || []).reduce((a,e) => {
        if (yearlyRecurringKeys.has(e.key)) return a;
        const months = C.activeMonthsInYear(e, yearNum);
        if (months <= 0) return a;
        const baseAnnual = toRMB(e.amount, e.ccy) * (e.frequency === "annual" ? 1 : months);
        return a + baseAnnual;
      }, 0);
      // income_events.json 当年的一次性事件（股票兑现/离职大礼包/项目分红）
      const oneOffEvents = (incEv.events || []).filter(ev => ev.year === yearNum && ev.amount > 0);
      const oneOffAnnual = oneOffEvents.reduce((a, ev) => a + toRMB(ev.amount, ev.ccy || "RMB"), 0);
      const totalExpense = totalExpenseProj + recurringAnnual;
      const totalIncome  = totalIncomeProj + recurringIncomeAnnual + oneOffAnnual;
      const net = totalIncome - totalExpense;

      let prevExpense = 0;
      if (prevData) {
        prevExpense = (prevData.expenses || []).reduce((a,t) => a + toRMB(t.amount, t.ccy || "RMB"), 0);
      }
      const expDelta = prevExpense ? (totalExpenseProj - prevExpense) / prevExpense : 0;

      // ---- KPI ----
      const projectedHint = isPartial ? `（含 recurring 年化）` : `（含 recurring）`;
      const ytdHint = isPartial ? `<br/><span style="color:var(--warn);font-size:11px">⏳ 截止 ${data.asOf}（${(yearProgress*100).toFixed(0)}%）</span>` : "";
      const oneOffHint = oneOffAnnual > 0 ? ` · 一次性 ${fmtK(oneOffAnnual)}` : "";
      const kpis = [
        { label: "本年总收入（年化）",  value: fmtK(totalIncome),  sub: `工资+房租+股息+代管${oneOffHint} ${projectedHint}`, tone: "ok",
          help: "年化口径：对未满一年的数据按进度推算全年；含recurring循环收入与一次性事件" },
        { label: "本年总支出（年化）",  value: fmtK(totalExpense), sub: `${exps.length} 大类 + 刚性 ${fmtK(recurringAnnual)}${ytdHint}`,
          tone: net >= 0 ? "ok" : "warn",
          help: "年化口径：弹性支出按yearProgress推算全年；刚性支出来自recurring.json折算全年",
          delta: prevData ? `同比 ${expDelta>=0?'+':''}${(expDelta*100).toFixed(1)}%` : (isPartial ? "首年完整数据待年底" : "首年数据"),
          deltaCls: expDelta > 0.1 ? "down" : (expDelta < -0.1 ? "up" : "flat") },
        { label: "净结余（年化）",    value: (net>=0?"+":"") + fmtK(net),
          sub: net >= 0 ? "本年有结余" : "支出超过收入",
          help: "净结余=总收入-总支出（年化口径）",
          tone: net >= 0 ? "ok" : "danger" },
        { label: "储蓄率（年化）",    value: pct(totalIncome ? net/totalIncome : 0,1),
          sub: totalIncome && net/totalIncome > 0.3 ? "≥ 30% 健康" : "建议 ≥ 30%",
          help: "储蓄率=净结余/总收入（年化口径）",
          tone: totalIncome && net/totalIncome > 0.3 ? "ok" : "warn" },
        { label: "弹性支出（截止）",  value: fmtK(totalExpenseYTD),
          sub: isPartial ? `已花 ${fmtK(totalExpenseYTD)} → 年化 ${fmtK(totalExpenseProj)}` : `非刚性部分`,
          help: "弹性支出=非recurring的支出；若是partial则展示截止金额与推算全年",
          tone: "ok" },
        { label: "刚性 vs 弹性",     value: `${pct(recurringAnnual/totalExpense,0)} : ${pct(totalExpenseProj/totalExpense,0)}`,
          sub: `刚性 ${fmtK(recurringAnnual)}/年 · 弹性 ${fmtK(totalExpenseProj)}/年`,
          help: "支出结构占比：刚性（recurring）与弹性（可变支出）各占总支出的比例",
          tone: "ok" },
      ];
      $("#cash-kpis").innerHTML = kpis.map(k => `
        <div class="kpi ${k.tone}">
          <div class="stripe"></div>
          <div class="label" title="${k.help || ""}">${k.label}</div>
          <div class="value num" title="${k.help || ""}">${k.value}</div>
          <div class="sub" title="${k.help || ""}">${k.sub}</div>
          ${k.delta ? `<div class="delta ${k.deltaCls||'flat'}" title="${k.help || ""}">${k.delta}</div>` : ""}
        </div>
      `).join("");

      // ---- 大类堆叠（用 projected） ----
      const byCat = aggregate(exps, t => t.category, t => t.projected);
      const catCfg = (cats.categories || []).reduce((m,c) => (m[c.key] = c, m), {});
      const sortedCats = Object.entries(byCat).sort((a,b) => b[1] - a[1]);
      const catTotal = sortedCats.reduce((a,[,v]) => a+v, 0);
      $("#cat-bar").innerHTML = sortedCats.map(([k,v]) => {
        const c = catCfg[k] || { color:"#6b7280", name:k };
        return `<div title="${c.name} ${fmtK(v)}" style="width:${(v/catTotal*100).toFixed(1)}%;background:${c.color}"></div>`;
      }).join("");
      $("#cat-list").innerHTML = sortedCats.map(([k,v]) => {
        const c = catCfg[k] || { color:"#6b7280", name:k };
        const ytdVal = exps.filter(e => e.category === k).reduce((a,t) => a + t.rmb, 0);
        const ytdSuffix = isPartial && ytdVal !== v ? `<span style="color:var(--text-2);font-size:10px;margin-left:4px">截止 ${fmtK(ytdVal)}</span>` : "";
        return `
          <div class="cat-row">
            <div class="swatch" style="background:${c.color}"></div>
            <div class="nm">${c.name}${ytdSuffix}</div>
            <div class="amt">${fmtK(v)}</div>
            <div class="pp">${pct(catTotal?v/catTotal:0,1)}</div>
          </div>
        `;
      }).join("");

      // ---- 人员维度（用 projected） ----
      const byPersona = aggregate(exps, t => t.by || "self", t => t.projected);
      const personaCfg = (cats.personas || []).reduce((m,p) => (m[p.key] = p, m), {});
      const sortedPer = Object.entries(byPersona).sort((a,b) => b[1] - a[1]);
      const perTotal = sortedPer.reduce((a,[,v]) => a+v, 0);
      $("#persona-bar").innerHTML = sortedPer.map(([k,v]) => {
        const p = personaCfg[k] || { color:"#6b7280", name:k };
        return `<div title="${p.name} ${fmtK(v)}" style="width:${(v/perTotal*100).toFixed(1)}%;background:${p.color}"></div>`;
      }).join("");
      $("#persona-list").innerHTML = sortedPer.map(([k,v]) => {
        const p = personaCfg[k] || { color:"#6b7280", name:k };
        return `
          <div class="cat-row">
            <div class="swatch" style="background:${p.color}"></div>
            <div class="nm">${p.name}</div>
            <div class="amt">${fmtK(v)}</div>
            <div class="pp">${pct(perTotal?v/perTotal:0,1)}</div>
          </div>
        `;
      }).join("");

      // ---- 预算 vs 实际（年度） ----
      const recExpenseMap = (rec.expenses || []).reduce((m,e) => (m[e.key] = e, m), {});
      const recIncomeMap  = (rec.incomes  || []).reduce((m,e) => (m[e.key] = e, m), {});
      const allRec = [...Object.values(recExpenseMap), ...Object.values(recIncomeMap)];

      // 保险池：把所有 insurance 合并成一条
      const insurancePool = Object.values(recExpenseMap).filter(e => e.kind === "insurance");
      const insuranceAnnualBudget = insurancePool.reduce((a,e) => a + toRMB(e.amount, e.ccy) * (e.frequency === "annual" ? 1 : 12), 0);
      const insuranceActual = [...exps, ...ins].filter(t => t.recurring === "_insurance_pool").reduce((a,t) => a + t.rmb, 0);

      const tbody = $("#budget-vs-actual tbody");
      const rows = [];

      // 1) 保险池（合并）
      if (insurancePool.length > 0) {
        const diff = insuranceActual - insuranceAnnualBudget;
        const status = insuranceActual === 0
          ? `<span class="chip warn">未记录</span>`
          : Math.abs(diff) < insuranceAnnualBudget * 0.05
            ? `<span class="chip ok">持平</span>`
            : (diff > 0 ? `<span class="chip danger">超支</span>` : `<span class="chip ok">节省</span>`);
        rows.push(`
          <tr>
            <td><b>保险（${insurancePool.length} 张保单合并）</b><div style="color:var(--text-2);font-size:11px">支出 / recurring=_insurance_pool</div></td>
            <td class="r">${fmtK(insuranceAnnualBudget)}</td>
            <td class="r">${fmtK(insuranceActual)}</td>
            <td class="r" style="color:${diff>0?'var(--danger)':(diff<0?'var(--ok)':'var(--text-2)')}">${diff>=0?'+':''}${fmtK(diff)}</td>
            <td>${status}</td>
          </tr>
        `);
      }

      // 2) 非保险类的逐项
      allRec.filter(r => r.kind !== "insurance").forEach(r => {
        const annualBudget = toRMB(r.amount, r.ccy) * (r.frequency === "annual" ? 1 : 12);
        const actualEntries = [...exps, ...ins].filter(t => t.recurring === r.key);
        const actual = actualEntries.reduce((a,t) => a + t.rmb, 0);
        const diff = actual - annualBudget;
        const isIncome = !!recIncomeMap[r.key];
        const status = actual === 0
          ? `<span class="chip warn">未记录</span>`
          : Math.abs(diff) < annualBudget * 0.05
            ? `<span class="chip ok">持平</span>`
            : isIncome
              ? (diff > 0 ? `<span class="chip ok">多收</span>` : `<span class="chip warn">少收</span>`)
              : (diff > 0 ? `<span class="chip danger">超支</span>` : `<span class="chip ok">节省</span>`);
        rows.push(`
          <tr>
            <td><b>${r.name}</b><div style="color:var(--text-2);font-size:11px">${isIncome?'收入':'支出'}</div></td>
            <td class="r">${fmtK(annualBudget)}</td>
            <td class="r">${fmtK(actual)}</td>
            <td class="r" style="color:${diff===0?'var(--text-2)':(isIncome?(diff>0?'var(--ok)':'var(--warn)'):(diff>0?'var(--danger)':'var(--ok)'))}">${diff>=0?'+':''}${fmtK(diff)}</td>
            <td>${status}</td>
          </tr>
        `);
      });
      tbody.innerHTML = rows.join("");

      // ---- 大类明细 ----
      const allTx = [
        ...ins.map(t => ({...t, _dir:"in"})),
        ...exps.map(t => ({...t, _dir:"out"})),
      ].sort((a,b) => b.rmb - a.rmb);
      const txTbody = $("#tx-list tbody");
      txTbody.innerHTML = allTx.map(t => {
        const cfg = t._dir === "in" ? (cats.incomeCategories || []).find(c => c.key === t.category) : catCfg[t.category];
        const sign = t._dir === "in" ? "+" : "-";
        const color = t._dir === "in" ? "var(--ok)" : "var(--text-0)";
        const persona = personaCfg[t.by || "self"];
        return `
          <tr>
            <td><span class="num" style="font-size:12px;color:var(--text-2)">${data.year}</span></td>
            <td><span style="font-size:12px;color:${cfg?.color||'var(--text-1)'}">${cfg?.name || t.category || "—"}</span></td>
            <td>${t.name || "—"}<div style="color:var(--text-2);font-size:11px;margin-top:2px">${t.note || ""}</div></td>
            <td><span style="font-size:11px;color:${persona?.color||'var(--text-2)'}">${persona?.name || t.by || "—"}</span></td>
            <td class="r" style="color:${color}">${sign}${fmtK(t.rmb)}</td>
          </tr>
        `;
      }).join("");
    }

    render(years[years.length-1]);
    picker.value = years[years.length-1];
  }).catch(err => {
    $("#cash-kpis").innerHTML = `<div style="padding:24px;color:var(--text-1)">加载失败：${err.message}</div>`;
    console.error(err);
  });

  function aggregate(rows, keyFn, valFn) {
    const out = {};
    const getVal = valFn || (r => r.rmb);
    rows.forEach(r => {
      const k = keyFn(r);
      out[k] = (out[k] || 0) + getVal(r);
    });
    return out;
  }
  function getRigidRMB(rec, toRMB) {
    return (rec.expenses || []).reduce((a,e) => a + toRMB(e.amount, e.ccy) * (e.frequency === "annual" ? 1 : 12), 0);
  }
  function getRigidPct(rec, totalExpenseRMB, toRMB) {
    if (!totalExpenseRMB) return 0;
    return getRigidRMB(rec, toRMB) / totalExpenseRMB;
  }
})();
