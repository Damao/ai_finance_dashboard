// =============================================================
// 资产配置看板 · 核心计算库（共享）
// 三本账（target/history/recurring/transactions）共用的工具
// =============================================================
window.AssetCore = (function () {
  'use strict';

  // ========== 格式化 ==========
  function fmt(n)  { return n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString("en-US"); }
  function fmtK(n) {
    if (n == null || isNaN(n)) return "—";
    if (Math.abs(n) >= 1e8) return (n/1e8).toFixed(2) + "亿";
    if (Math.abs(n) >= 1e4) return (n/1e4).toFixed(1) + "万";
    return Math.round(n).toLocaleString("en-US");
  }
  function pct(x, d) { d = d == null ? 1 : d; return isNaN(x) ? "—" : (x*100).toFixed(d) + "%"; }

  // ========== 日期 / 时间区间 ==========
  function parseDate(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (!m) return null;
    return new Date(parseInt(m[1]), (parseInt(m[2]||1)||1)-1, parseInt(m[3]||1)||1);
  }
  function activeMonthsInYear(item, year) {
    const yStart = new Date(year, 0, 1);
    const yEnd   = new Date(year, 11, 31);
    const start = parseDate(item.startDate) || new Date(1970,0,1);
    const end   = parseDate(item.endDate)   || new Date(9999,11,31);
    if (start > yEnd || end < yStart) return 0;
    const effStart = start > yStart ? start : yStart;
    const effEnd   = end < yEnd ? end : yEnd;
    const months = (effEnd.getFullYear() - effStart.getFullYear()) * 12 + (effEnd.getMonth() - effStart.getMonth()) + 1;
    return Math.max(0, Math.min(12, months));
  }
  function isActive(item, ref) {
    ref = ref || new Date();
    const start = parseDate(item.startDate);
    const end   = parseDate(item.endDate);
    if (start && start > ref) return false;
    if (end && end < ref) return false;
    return true;
  }

  // ========== 汇率 ==========
  function makeToRMB(rates) {
    return function (amt, ccy) {
      return amt * (ccy === "RMB" ? 1 : ((rates && rates[ccy]) || 1));
    };
  }

  // ========== 通胀 ==========
  // futureValue = present * (1 + r)^n
  function inflate(present, years, annualRate) { return present * Math.pow(1 + annualRate, years); }
  // todayValue = future / (1 + r)^n  （把未来购买力折回今天）
  function deflate(future, years, annualRate) { return future / Math.pow(1 + annualRate, years); }

  // ========== Snapshot enrichment（资产快照 → 模块/子项/币种聚合）==========
  function enrichSnapshot(snap, target) {
    const rates  = snap.rates  || { USD:1, HKD:1 };
    const prices = snap.prices || {};
    const toRMB  = makeToRMB(rates);

    let total = 0;
    let totalCost = 0;
    const ccyTotals = { RMB:0, USD:0, HKD:0 };
    const targetKeys = new Set(target.modules.flatMap(m => m.subs.map(s => s.key)));

    function valueOf(h, sub) {
      if (!h) return null;
      const ccy = h.ccy || (sub && sub.ccy) || "RMB";
      const rate = ccy === "RMB" ? 1 : (rates[ccy] || 1);
      if (h.raw != null) {
        const rmb = h.raw * rate;
        return { raw: h.raw, rmb, cost: h.raw, costRMB: rmb, marketValue: rmb, ccy };
      }
      if (h.shares != null) {
        const px = (prices[sub && sub.key] && prices[sub.key].price) != null
                   ? prices[sub.key].price : h.price;
        if (px == null) return null;
        const mv = h.shares * px;
        const costTotal = h.shares * (h.cost != null ? h.cost : px);
        return {
          raw: mv, rmb: mv * rate,
          cost: costTotal, costRMB: costTotal * rate, marketValue: mv * rate,
          shares: h.shares, price: px, costPerShare: h.cost, ccy,
        };
      }
      return null;
    }

    const modules = target.modules.map(m => {
      const subs = m.subs.map(sub => {
        const h = (snap.holdings || {})[sub.key];
        const v = valueOf(h, sub);
        if (!v) return Object.assign({}, sub, { raw:0, rmb:0, cost:0, costRMB:0, marketValue:0, missing:true });
        return Object.assign({}, sub, v);
      });
      const modTotal = subs.reduce(function(a,s){ return a + s.rmb; }, 0);
      total += modTotal;
      totalCost += subs.reduce(function(a,s){ return a + (s.costRMB != null ? s.costRMB : s.rmb); }, 0);
      subs.forEach(function(s){ ccyTotals[s.ccy] = (ccyTotals[s.ccy] || 0) + s.rmb; });
      return Object.assign({}, m, { subs:subs, total:modTotal });
    });

    // 游离持仓（target 未列出）
    const orphanSubs = [];
    Object.entries(snap.holdings || {}).forEach(function (entry) {
      const key = entry[0], h = entry[1];
      if (targetKeys.has(key)) return;
      const v = valueOf(h, { key:key });
      if (!v) return;
      orphanSubs.push(Object.assign({
        key: key, name: h.name || key, venue: h.venue || "—",
        subTargetPct: 0, subThresholdPct: 0,
        note: h.note || "Target 未列出 · 待消化或重分类",
      }, v));
      ccyTotals[v.ccy] = (ccyTotals[v.ccy] || 0) + v.rmb;
      total += v.rmb;
      totalCost += v.costRMB != null ? v.costRMB : v.rmb;
    });
    if (orphanSubs.length > 0) {
      const orphanTotal = orphanSubs.reduce(function(a,s){return a+s.rmb;}, 0);
      modules.push({
        key: "_orphan",
        name: "待变现 / 游离持仓",
        roman: "★",
        targetPct: 0,
        thresholdPct: 0,
        subs: orphanSubs,
        total: orphanTotal,
        purpose: "Target 中未列出的资产；通常是过渡持仓（如待售房产）或还没归类的新仓",
      });
    }

    // 模块/子项状态判定
    modules.forEach(function (m) {
      m.actualPct = total > 0 ? m.total / total : 0;
      m.delta     = m.actualPct - m.targetPct;
      if (m.key === "_orphan") {
        m.status = m.actualPct > 0.02 ? "pending" : "ok";
      } else {
        m.status = Math.abs(m.delta) > m.thresholdPct ? (m.delta > 0 ? "over" : "under") : "ok";
      }
      m.subs.forEach(function (s) {
        s.actualPct = total > 0 ? s.rmb / total : 0;
        s.delta     = s.actualPct - (s.subTargetPct || 0);
        if (s.phase === "blocked")      s.status = "blocked";
        else if (s.phase === "exit")    s.status = s.rmb > 0 ? "exit" : "ok";
        else if (s.phase === "planned") s.status = s.rmb === 0 ? "planned" : (s.delta > (s.subThresholdPct||0) ? "over" : "ok");
        else s.status = (s.subThresholdPct && Math.abs(s.delta) > s.subThresholdPct)
                        ? (s.delta > 0 ? "over" : "under") : "ok";
      });
    });

    // 金融盘 vs 整体盘（剔除房产 + 待变现）
    const realEstateKeys = new Set(["qianhai_property","dingtai_property"]);
    let financialTotal = 0;
    modules.forEach(function (m) {
      if (m.key === "_orphan") return;
      m.subs.forEach(function (s) {
        if (realEstateKeys.has(s.key)) return;
        financialTotal += s.rmb;
      });
    });

    return Object.assign({}, snap, { total:total, totalCost:totalCost, ccyTotals:ccyTotals, modules:modules, financialTotal:financialTotal });
  }

  // ========== 加权预期年化 ==========
  function weightedExpectedReturn(cur, scenario, opts) {
    opts = opts || {};
    const realEstateKeys = new Set(["qianhai_property","dingtai_property"]);
    let weighted = 0, totalW = 0;
    cur.modules.forEach(function (m) {
      if (m.key === "_orphan" && opts.excludeOrphan !== false) return;
      m.subs.forEach(function (s) {
        if (opts.excludeRealEstate && realEstateKeys.has(s.key)) return;
        const er = s.expectedReturn && s.expectedReturn[scenario];
        if (er != null && s.rmb > 0) {
          weighted += er * s.rmb;
          totalW += s.rmb;
        }
      });
    });
    return totalW > 0 ? weighted / totalW : 0;
  }

  // ========== 健康检查（红线/告警一眼看）==========
  function healthCheck(cur, target) {
    const issues = [];
    const total  = cur.total;
    const ccyTotals = cur.ccyTotals;
    const rmbPct = total > 0 ? ccyTotals.RMB / total : 0;
    const redLine = (target.redLines && target.redLines.singleStockMaxPct) || 0.05;

    // 1. 单一公司红线（腾讯合并）
    let tencentRMB = 0;
    cur.modules.forEach(function (m) {
      m.subs.forEach(function (s) {
        if (/^tencent_/.test(s.key) || s.key === "tencent") tencentRMB += s.rmb;
      });
    });
    const tencentPct = total > 0 ? tencentRMB / total : 0;
    if (tencentPct > redLine) {
      issues.push({
        level: "danger",
        category: "red_line",
        title: "腾讯单一敞口超红线",
        detail: `${(tencentPct*100).toFixed(1)}% > ${(redLine*100).toFixed(0)}%（机构标准）。当前 ${fmtK(tencentRMB)} RMB，需减到 ${fmtK(total*redLine)} 以下。`,
        action: "执行《腾讯减仓阶梯_2026-05-16》触发档位",
      });
    }

    // 2. RMB 占比
    if (rmbPct > ((target.redLines && target.redLines.rmbMaxPct) || 0.70)) {
      issues.push({
        level: "danger",
        category: "red_line",
        title: "RMB 占比超红线",
        detail: `${(rmbPct*100).toFixed(1)}% > ${((target.redLines.rmbMaxPct||0.70)*100).toFixed(0)}%。`,
        action: "卖房款到账后优先购汇/港股通腾讯转 USD 资产",
      });
    } else if (rmbPct > ((target.redLines && target.redLines.rmbTargetPct) || 0.60)) {
      issues.push({
        level: "warn",
        category: "deviation",
        title: "RMB 占比高于目标",
        detail: `${(rmbPct*100).toFixed(1)}% > 目标 ${((target.redLines.rmbTargetPct||0.60)*100).toFixed(0)}%。`,
        action: "中长期再平衡",
      });
    }

    // 3. 大类偏离
    cur.modules.forEach(function (m) {
      if (m.key === "_orphan") return;
      if (m.status === "over") {
        issues.push({
          level: "warn",
          category: "deviation",
          title: m.name + " 大类超标",
          detail: `实际 ${(m.actualPct*100).toFixed(1)}% vs 目标 ${(m.targetPct*100).toFixed(0)}%（+${(m.delta*100).toFixed(1)}%）`,
          action: "季度末再平衡",
        });
      } else if (m.status === "under") {
        issues.push({
          level: "warn",
          category: "deviation",
          title: m.name + " 大类偏低",
          detail: `实际 ${(m.actualPct*100).toFixed(1)}% vs 目标 ${(m.targetPct*100).toFixed(0)}%（${(m.delta*100).toFixed(1)}%）`,
          action: "用新资金 / 卖出超标大类补仓",
        });
      }
    });

    // 4. 待变现资产存在
    const orphan = cur.modules.find(function (m) { return m.key === "_orphan"; });
    if (orphan && orphan.actualPct > 0.05) {
      issues.push({
        level: "info",
        category: "pending",
        title: "存在待变现资产",
        detail: `${fmtK(orphan.total)} RMB（占 ${(orphan.actualPct*100).toFixed(1)}%）。`,
        action: "完成 P0 鼎太定价 + 售出后重分配",
      });
    }

    return issues;
  }

  // ========== 资产 vs 现金流对账 ==========
  // 返回上次到这次的总盘变化 = 注入 + 真实回报
  function reconcile(prevSnap, curSnap) {
    if (!prevSnap || !curSnap) return null;
    const dTotal = curSnap.total - prevSnap.total;
    const cf = curSnap.cashFlow || {};
    const deposits     = cf.deposits || 0;
    const withdrawals  = cf.withdrawals || 0;
    const netInjection = deposits - withdrawals;
    const marketReturn = dTotal - netInjection;
    const days = Math.max(1, (parseDate(curSnap.date) - parseDate(prevSnap.date)) / 86400000);
    const returnPct = prevSnap.total > 0 ? marketReturn / prevSnap.total : 0;
    const annualized = days > 0 ? Math.pow(1 + returnPct, 365 / days) - 1 : 0;
    return {
      days: Math.round(days),
      dTotal: dTotal,
      netInjection: netInjection,
      marketReturn: marketReturn,
      returnPct: returnPct,
      annualized: annualized,
    };
  }

  // ========== 启动断言（开发期发现错误）==========
  function runAssertions(cur, target) {
    const errors = [];
    const total = cur.total;
    if (!(total > 50e4 && total < 1e9)) {
      errors.push("总盘异常：" + fmtK(total) + "（预期 50 万 - 10 亿，超出说明数据填错）");
    }
    const targetSum = target.modules.reduce(function(a,m){ return a + m.targetPct; }, 0);
    if (Math.abs(targetSum - 1) > 0.01) {
      errors.push("target.json 模块权重和 = " + (targetSum*100).toFixed(1) + "%（应为 100%）");
    }
    cur.modules.forEach(function (m) {
      if (m.key === "_orphan") return;
      const subSum = m.subs.reduce(function(a,s){ return a + (s.subTargetPct||0); }, 0);
      if (Math.abs(subSum - m.targetPct) > 0.005) {
        errors.push(m.name + " 子项权重和 " + (subSum*100).toFixed(1) + "% ≠ 大类目标 " + (m.targetPct*100).toFixed(1) + "%");
      }
    });
    return errors;
  }

  // ========== 暴露 API ==========
  return {
    fmt: fmt, fmtK: fmtK, pct: pct,
    parseDate: parseDate, isActive: isActive, activeMonthsInYear: activeMonthsInYear,
    makeToRMB: makeToRMB,
    inflate: inflate, deflate: deflate,
    enrichSnapshot: enrichSnapshot,
    weightedExpectedReturn: weightedExpectedReturn,
    healthCheck: healthCheck,
    reconcile: reconcile,
    runAssertions: runAssertions,
  };
})();
