// =============================================================
// 资产配置看板 · 目标配置 Tab (V1.0)
// 独立展示 target.json 的战略配置、红线参数、假设与变更历史
// =============================================================
(function () {
  'use strict';

  const C = window.AssetCore;
  const fmt = C.fmt, fmtK = C.fmtK, pct = C.pct;
  const $ = (s, r = document) => r.querySelector(s);

  let targetData = null;
  let historyData = null;
  let hasRendered = false;

  // ---- 阶段标签渲染 ----
  function phaseBadgeHTML(phase) {
    if (!phase || phase === "active") return "";
    const map = {
      blocked: { txt: "⏳ 阻塞", color: "#a4adbf", bg: "rgba(164,173,191,.12)" },
      exit: { txt: "📉 清仓中", color: "#ff5c7a", bg: "rgba(255,92,122,.14)" },
      planned: { txt: "🛠 计划中", color: "#7aa2ff", bg: "rgba(122,162,255,.14)" },
    };
    const c = map[phase];
    if (!c) return "";
    return `<span style="font-size:10px;padding:1px 6px;border-radius:4px;color:${c.color};background:${c.bg};letter-spacing:.3px">${c.txt}</span>`;
  }

  // ---- 状态芯片 ----
  function statusChip(status, text) {
    const colors = {
      ok: { bg: 'rgba(61,220,151,.12)', color: 'var(--ok)' },
      warn: { bg: 'rgba(255,180,84,.12)', color: 'var(--warn)' },
      danger: { bg: 'rgba(255,92,122,.14)', color: 'var(--danger)' },
      info: { bg: 'rgba(122,162,255,.12)', color: 'var(--accent)' }
    };
    const c = colors[status] || colors.info;
    return `<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:${c.bg};color:${c.color};font-weight:500">${text}</span>`;
  }

  // ---- 加载数据 ----
  function loadData() {
    if (targetData && historyData) return Promise.resolve({ target: targetData, history: historyData });
    return Promise.all([
      fetch("./data/target.json", { cache: "no-store" }).then(r => r.json()),
      fetch("./data/history.json", { cache: "no-store" }).then(r => r.json()).catch(() => ({ snapshots: [] }))
    ]).then(([target, history]) => {
      targetData = target;
      historyData = history;
      return { target, history };
    });
  }

  // ---- 主渲染函数 ----
  function renderTargetTab() {
    if (hasRendered && $("#target-content").dataset.loaded === "true") return;

    loadData().then(({ target, history }) => {
      renderKPIs(target, history);
      renderTargetChart(target);
      renderRedLinesDashboard(target);
      renderPhilosophyCard(target);
      renderRebalanceRules(target);
      renderAssumptions(target);
      renderModulesMatrix(target);
      renderMilestones(target);
      renderChangelog(target);

      $("#target-content").dataset.loaded = "true";
      hasRendered = true;
    }).catch(err => {
      console.error("Target Tab 加载失败:", err);
      $("#target-content").innerHTML = `<div style="padding:40px;color:var(--danger)">加载失败: ${err.message}</div>`;
    });
  }

  // ---- KPI 卡片 ----
  function renderKPIs(target, history) {
    const snaps = (history.snapshots || []).sort((a, b) => a.date.localeCompare(b.date));
    const latest = snaps[snaps.length - 1];
    const prev = snaps[snaps.length - 2];

    const modules = target.modules || [];
    const totalTargetPct = modules.reduce((a, m) => a + (m.targetPct || 0), 0);
    const subCount = modules.reduce((a, m) => a + (m.subs || []).length, 0);

    const kpis = [
      {
        label: "配置版本",
        value: target.version || "—",
        sub: `更新于 ${target.updated || "—"}`,
        help: "target.json 的版本号与更新时间，用于追踪战略/假设变更",
        tone: "ok"
      },
      {
        label: "模块 / 子项数",
        value: `${modules.length} / ${subCount}`,
        sub: `目标占比合计 ${pct(totalTargetPct, 0)}`,
        help: "目标占比合计应接近100%；偏离表示target配置尚未闭合或有留白",
        tone: totalTargetPct >= 0.99 && totalTargetPct <= 1.01 ? "ok" : "warn"
      },
      {
        label: "最新快照",
        value: latest ? latest.date : "—",
        sub: latest ? `总盘 ${fmtK(latest.total || 0)}` : "无历史数据",
        help: "history.json 最新快照日期与当时总盘（折RMB）",
        tone: "ok"
      },
      {
        label: "里程碑进度",
        value: (() => {
          const ms = target.milestones || [];
          if (!ms.length) return "—";
          const done = ms.filter(m => m.done).length;
          return `${done}/${ms.length}`;
        })(),
        sub: "已完成 / 总计",
        help: "target.json 里的 milestones 完成数 / 总数",
        tone: "ok"
      }
    ];

    $("#target-kpis").innerHTML = kpis.map(k => `
      <div class="kpi ${k.tone}">
        <div class="stripe"></div>
        <div class="label" title="${k.help || ""}">${k.label}</div>
        <div class="value num" title="${k.help || ""}">${k.value}</div>
        <div class="sub" title="${k.help || ""}">${k.sub}</div>
      </div>
    `).join("");
  }

  // ---- 目标配置饼图 ----
  function renderTargetChart(target) {
    const modules = target.modules || [];
    const data = modules.map(m => ({
      name: m.name,
      value: Math.round((m.targetPct || 0) * 100),
      itemStyle: { color: getModuleColor(m.key) }
    })).filter(d => d.value > 0);

    const html = `
      <section>
        <h2>目标配置结构<span class="hint">各模块目标占比分布</span></h2>
        <div class="target-chart-container" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="lia-card">
            <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">模块目标占比</div>
            <div id="target-pie-chart" style="width:100%;height:280px"></div>
          </div>
          <div class="lia-card">
            <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">币种目标分布</div>
            <div id="target-ccy-chart" style="width:100%;height:280px"></div>
          </div>
        </div>
      </section>
    `;

    const container = document.createElement('div');
    container.innerHTML = html;
    $("#target-content").appendChild(container);

    // 渲染饼图
    setTimeout(() => {
      const pieChart = echarts.init($("#target-pie-chart"), 'dark');
      pieChart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          formatter: '{b}: {c}%'
        },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 4,
            borderColor: 'var(--bg-1)',
            borderWidth: 2
          },
          label: {
            show: true,
            formatter: '{b}\n{c}%',
            color: 'var(--text-1)',
            fontSize: 11
          },
          labelLine: {
            lineStyle: { color: 'var(--text-3)' }
          },
          data: data
        }]
      });

      // 计算币种分布
      const ccyData = calculateCurrencyDistribution(target);
      const ccyChart = echarts.init($("#target-ccy-chart"), 'dark');
      ccyChart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          formatter: '{b}: {c}%'
        },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          itemStyle: {
            borderRadius: 4,
            borderColor: 'var(--bg-1)',
            borderWidth: 2
          },
          label: {
            show: true,
            formatter: '{b}\n{c}%',
            color: 'var(--text-1)',
            fontSize: 11
          },
          data: ccyData
        }]
      });
    }, 0);
  }

  // ---- 计算币种分布 ----
  function calculateCurrencyDistribution(target) {
    const modules = target.modules || [];
    const ccyTotals = { RMB: 0, USD: 0, HKD: 0 };

    modules.forEach(m => {
      (m.subs || []).forEach(s => {
        const pct = s.subTargetPct || 0;
        ccyTotals[s.ccy || 'RMB'] = (ccyTotals[s.ccy || 'RMB'] || 0) + pct;
      });
    });

    const colors = { RMB: '#5b8bff', USD: '#3ddc97', HKD: '#c084fc' };
    return Object.entries(ccyTotals)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({
        name: k,
        value: Math.round(v * 100),
        itemStyle: { color: colors[k] }
      }));
  }

  // ---- 模块颜色映射 ----
  function getModuleColor(key) {
    const colors = {
      liquidity: '#7aa2ff',
      equity: '#3ddc97',
      bond: '#ffb454',
      commodity: '#d4a64a',
      real_estate: '#c084fc',
      pension: '#ff5c7a'
    };
    return colors[key] || '#7aa2ff';
  }

  // ---- 红线仪表盘 ----
  function renderRedLinesDashboard(target) {
    const rl = target.redLines || {};

    const html = `
      <section>
        <h2>🛑 红线参数仪表盘<span class="hint">关键风险控制阈值</span></h2>
        <div class="redlines-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
          ${renderRedLineCard('单一公司持仓', rl.singleStockMaxPct, 0.05, '%', '腾讯等单一股票占比上限')}
          ${renderRedLineCard('RMB 占比红线', rl.rmbMaxPct, 0.70, '%', '人民币资产占比上限')}
          ${renderRedLineCard('RMB 目标占比', rl.rmbTargetPct, 0.60, '%', '人民币资产目标比例')}
          ${renderRedLineCard('大类偏离阈值', rl.moduleDeviationDefault, 0.05, '%', '模块允许偏离范围')}
        </div>
      </section>
    `;

    const container = document.createElement('div');
    container.innerHTML = html;
    $("#target-content").appendChild(container);
  }

  function renderRedLineCard(label, value, defaultVal, unit, desc) {
    const val = value ?? defaultVal;
    const pctVal = Math.round(val * 100);
    return `
      <div class="lia-card" style="text-align:center">
        <div style="font-size:11px;color:var(--text-2);margin-bottom:8px">${label}</div>
        <div style="font-size:32px;font-weight:600;color:var(--text-0);font-family:'JetBrains Mono',monospace">${pctVal}${unit}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:4px">${desc}</div>
        <div style="margin-top:12px;height:4px;background:var(--bg-3);border-radius:2px;overflow:hidden">
          <div style="width:${pctVal}%;height:100%;background:var(--accent);border-radius:2px"></div>
        </div>
      </div>
    `;
  }

  // ---- 设计哲学卡片 ----
  function renderPhilosophyCard(target) {
    const philosophy = target.philosophy || [];
    const html = `
      <section>
        <h2>📐 设计哲学<span class="hint">资产配置的核心理念</span></h2>
        <div class="lia-card">
          <ul style="margin:0;padding-left:20px;color:var(--text-1);line-height:1.8">
            ${philosophy.length ? philosophy.map(p => `<li>${p}</li>`).join('') : '<li style="color:var(--text-3)">未填写设计哲学</li>'}
          </ul>
        </div>
      </section>
    `;

    const container = document.createElement('div');
    container.innerHTML = html;
    $("#target-content").appendChild(container);
  }

  // ---- 再平衡规则 ----
  function renderRebalanceRules(target) {
    const rb = target.rebalanceRules || {};

    const html = `
      <section>
        <h2>🔄 再平衡规则<span class="hint">调仓执行策略</span></h2>
        <div class="rebalance-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
          <div class="lia-card">
            <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">频率</div>
            <div style="font-size:16px;font-weight:500;color:var(--text-0)">${rb.frequency || '—'}</div>
          </div>
          <div class="lia-card">
            <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">资金来源</div>
            <div style="font-size:16px;font-weight:500;color:var(--text-0)">${rb.preferNewMoney || '—'}</div>
          </div>
          <div class="lia-card">
            <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">执行方式</div>
            <div style="font-size:16px;font-weight:500;color:var(--text-0)">${rb.method || '—'}</div>
          </div>
          <div class="lia-card">
            <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">池分离</div>
            <div style="font-size:16px;font-weight:500;color:var(--text-0)">${rb.poolSeparation || '—'}</div>
          </div>
        </div>
      </section>
    `;

    const container = document.createElement('div');
    container.innerHTML = html;
    $("#target-content").appendChild(container);
  }

  // ---- 关键假设 ----
  function renderAssumptions(target) {
    const ass = target.assumptions || {};
    const entries = Object.entries(ass);
    if (!entries.length) return;

    const html = `
      <section>
        <h2>🧭 关键假设<span class="hint">前提失效 = 重审 Target</span></h2>
        <div class="lia-card">
          <table class="assumptions-table" style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="border-bottom:1px solid var(--line)">
                <th style="text-align:left;padding:8px 12px;font-size:11px;color:var(--text-3);font-weight:500">前提</th>
                <th style="text-align:center;padding:8px 12px;font-size:11px;color:var(--text-3);font-weight:500;width:100px">状态</th>
                <th style="text-align:left;padding:8px 12px;font-size:11px;color:var(--text-3);font-weight:500">影响</th>
              </tr>
            </thead>
            <tbody>
              ${entries.map(([k, v]) => {
      const stateChip = v.value === true
        ? statusChip('ok', '已满足')
        : v.value === false
          ? statusChip('warn', '未满足')
          : statusChip('info', v.value);
      return `
                  <tr style="border-bottom:1px solid var(--line)">
                    <td style="padding:10px 12px">
                      <code style="background:var(--bg-2);padding:2px 8px;border-radius:4px;font-size:11px;color:var(--text-1)">${k}</code>
                      <div style="font-size:12px;color:var(--text-0);margin-top:4px">${v.label || ''}</div>
                    </td>
                    <td style="padding:10px 12px;text-align:center">${stateChip}</td>
                    <td style="padding:10px 12px;font-size:12px;color:var(--text-2)">${v.impact || ''}</td>
                  </tr>
                `;
    }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;

    const container = document.createElement('div');
    container.innerHTML = html;
    $("#target-content").appendChild(container);
  }

  // ---- 模块矩阵 ----
  function renderModulesMatrix(target) {
    const modules = target.modules || [];

    const html = `
      <section>
        <h2>模块配置矩阵<span class="hint">各模块目标与子项详情</span></h2>
        <div class="modules-matrix" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
          ${modules.map(m => renderModuleCard(m)).join('')}
        </div>
      </section>
    `;

    const container = document.createElement('div');
    container.innerHTML = html;
    $("#target-content").appendChild(container);
  }

  function renderModuleCard(m) {
    const subs = m.subs || [];
    const targetPct = Math.round((m.targetPct || 0) * 100);
    const thresholdPct = Math.round((m.thresholdPct || 0) * 100);

    return `
      <div class="lia-card" style="border-left:3px solid ${getModuleColor(m.key)}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <div style="font-size:16px;font-weight:600;color:var(--text-0)">
              <span style="color:var(--text-3);margin-right:6px;font-family:'Noto Serif SC',serif">${m.roman}</span>
              ${m.name}
            </div>
            ${m.purpose ? `<div style="font-size:12px;color:var(--text-2);margin-top:4px">📌 ${m.purpose}</div>` : ''}
          </div>
          <div style="text-align:right">
            <div style="font-size:24px;font-weight:600;color:var(--accent);font-family:'JetBrains Mono',monospace">${targetPct}%</div>
            <div style="font-size:11px;color:var(--text-3)">±${thresholdPct}%</div>
          </div>
        </div>
        ${m.rationale ? `<div style="font-size:12px;color:var(--text-2);margin-bottom:12px;padding:8px;background:var(--bg-2);border-radius:6px">${m.rationale}</div>` : ''}
        <table style="width:100%;font-size:12px;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid var(--line)">
              <th style="text-align:left;padding:6px 0;color:var(--text-3);font-weight:500">子项</th>
              <th style="text-align:right;padding:6px 0;color:var(--text-3);font-weight:500">目标</th>
              <th style="text-align:right;padding:6px 0;color:var(--text-3);font-weight:500">阈值</th>
              <th style="text-align:left;padding:6px 0;color:var(--text-3);font-weight:500;padding-left:12px">备注</th>
            </tr>
          </thead>
          <tbody>
            ${subs.map(s => `
              <tr style="border-bottom:1px dashed var(--line)">
                <td style="padding:8px 0">
                  <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(91,139,255,.12);color:var(--rmb);margin-right:6px">${s.ccy || 'RMB'}</span>
                  ${s.name}
                  ${phaseBadgeHTML(s.phase)}
                  ${s.venue ? `<div style="font-size:11px;color:var(--text-3);margin-top:2px">· ${s.venue}</div>` : ''}
                </td>
                <td style="padding:8px 0;text-align:right;font-family:'JetBrains Mono',monospace">${pct(s.subTargetPct || 0, 1)}</td>
                <td style="padding:8px 0;text-align:right;font-family:'JetBrains Mono',monospace">${s.subThresholdPct ? '±' + pct(s.subThresholdPct, 1) : '—'}</td>
                <td style="padding:8px 0;padding-left:12px;color:var(--text-2)">${s.note || ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ---- 里程碑 ----
  function renderMilestones(target) {
    const ms = target.milestones || [];
    if (!ms.length) return;

    const html = `
      <section>
        <h2>🏁 里程碑<span class="hint">FIRE 路径动作清单</span></h2>
        <div class="milestones-list">
          ${ms.map(m => `
            <div class="lia-card" style="display:flex;align-items:center;gap:16px;padding:12px 16px;margin-bottom:8px;opacity:${m.done ? 0.7 : 1}">
              <div style="font-size:24px">${m.done ? '✅' : '⬜'}</div>
              <div style="flex:1">
                <div style="font-size:14px;font-weight:500;color:var(--text-0);text-decoration:${m.done ? 'line-through' : 'none'}">${m.name}</div>
                <div style="font-size:12px;color:var(--text-2);margin-top:2px">${m.note || ''}</div>
              </div>
              <div style="text-align:right">
                ${m.targetDate ? `<div style="font-size:12px;color:var(--text-3);font-family:'JetBrains Mono',monospace">${m.targetDate}</div>` : ''}
                ${m.priority ? `<div style="font-size:11px;color:var(--accent);margin-top:4px">${m.priority}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </section>
    `;

    const container = document.createElement('div');
    container.innerHTML = html;
    $("#target-content").appendChild(container);
  }

  // ---- 变更日志 ----
  function renderChangelog(target) {
    const cl = target.changelog || [];
    if (!cl.length) return;

    const html = `
      <section>
        <h2>📜 变更历史<span class="hint">Target 版本演进记录</span></h2>
        <div class="changelog-list">
          ${cl.map(c => `
            <div class="lia-card" style="margin-bottom:8px">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
                <span style="font-size:14px;font-weight:600;color:var(--accent);font-family:'JetBrains Mono',monospace">${c.version}</span>
                <span style="font-size:12px;color:var(--text-3)">${c.date}</span>
              </div>
              <ul style="margin:0;padding-left:18px;color:var(--text-1);font-size:12px;line-height:1.6">
                ${(c.changes || []).map(chg => `<li>${chg}</li>`).join('')}
              </ul>
            </div>
          `).join('')}
        </div>
      </section>
    `;

    const container = document.createElement('div');
    container.innerHTML = html;
    $("#target-content").appendChild(container);
  }

  // ---- 暴露全局函数 ----
  window.renderTargetTab = renderTargetTab;

})();
