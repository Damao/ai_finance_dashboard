// =============================================================
// Tab 4: 💰 税务计算器
// 覆盖：港股通红利税、港股通资本利得、富途 HKD 交易税、美股股息预扣税
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

  // ========== 税务规则库 ==========
  const TaxRules = {
    // 港股通（中银证券/招商证券）
    hkex_connect: {
      name: "港股通",
      dividend: {
        h_shares: 0.10,      // H股红利税 10%
        non_h_shares: 0.20,  // 非H股红利税 20%
        description: "港股通红利税：H股 10%，非H股 20%"
      },
      capital_gain: {
        rate: 0,             // 港股通资本利得免税
        description: "港股通资本利得：免税"
      },
      stamp_duty: {
        rate: 0.0013,        // 印花税 0.13%（买卖双向）
        description: "港股通印花税：0.13% 双向"
      }
    },
    // 富途 HKD 账户（港股）
    futu_hk: {
      name: "富途港股",
      dividend: {
        rate: 0.10,          // 港股股息税 10%（香港居民税率）
        description: "富途港股股息税：10%"
      },
      capital_gain: {
        rate: 0,             // 香港不征资本利得税
        description: "香港资本利得：免税"
      },
      trading: {
        stamp_duty: 0.0013,  // 印花税 0.13%
        trading_fee: 0.00005,// 交易费 0.005%
        settlement: 0.00002, // 交收费 0.002%
        platform: 15,        // 平台费 15 HKD/笔
        description: "富途港股交易费：印花税0.13% + 交易费0.005% + 交收费0.002% + 平台费15HKD"
      }
    },
    // 富途 USD 账户（美股）
    futu_us: {
      name: "富途美股",
      dividend: {
        wht_standard: 0.30,  // 标准预扣税 30%
        wht_treaty: 0.10,    // 中美税收协定 10%
        description: "美股股息预扣税：无协定 30%，中美协定 10%"
      },
      capital_gain: {
        rate: 0,             // 非美国税务居民资本利得免税
        description: "美股资本利得（非美税务居民）：免税"
      },
      trading: {
        sec_fee: 0.000008,   // SEC费 0.0008%
        ad_fee: 0.00003,     // 活动费 0.003%
        settlement: 0.003,   // 结算费 0.3%
        platform: 1,         // 平台费 1 USD/笔
        description: "富途美股交易费：SEC费0.0008% + 活动费0.003% + 结算费0.3% + 平台费1USD"
      }
    },
    // 美国国债利息税
    us_treasury: {
      name: "美国国债",
      interest: {
        rate: 0.30,          // 非居民预扣税 30%
        description: "美国国债利息预扣税：30%"
      }
    }
  };

  // ========== 税务计算器 ==========
  function calculateTaxEstimate(holdings, rates) {
    const toRMB = (amt, ccy) => amt * (ccy === "RMB" ? 1 : (rates[ccy] || 1));
    const results = [];

    // 港股通持仓（腾讯）
    const hkexPositions = holdings.filter(h => 
      h.venue?.includes('港股通') || h.venue?.includes('中银') || h.venue?.includes('招商')
    );
    
    if (hkexPositions.length > 0) {
      const hkexResult = {
        account: "港股通（中银/招商）",
        positions: [],
        dividendTax: 0,
        stampDutyEstimate: 0
      };
      
      hkexPositions.forEach(pos => {
        // 腾讯是红筹股，非H股，红利税20%
        const isHShare = false; // 腾讯不是H股
        const dividendRate = isHShare ? TaxRules.hkex_connect.dividend.h_shares : TaxRules.hkex_connect.dividend.non_h_shares;
        
        // 假设股息率 0.4%（腾讯近年股息率较低）
        const estimatedDividend = pos.rmb * 0.004;
        const dividendTax = estimatedDividend * dividendRate;
        
        // 卖出印花税估算（假设卖出）
        const stampDuty = pos.rmb * TaxRules.hkex_connect.stamp_duty.rate;
        
        hkexResult.positions.push({
          name: pos.name,
          shares: pos.shares,
          value: pos.rmb,
          estimatedDividend: estimatedDividend,
          dividendTax: dividendTax,
          stampDuty: stampDuty,
          dividendRate: dividendRate
        });
        
        hkexResult.dividendTax += dividendTax;
        hkexResult.stampDutyEstimate += stampDuty;
      });
      
      results.push(hkexResult);
    }

    // 富途港股持仓
    const futuHkPositions = holdings.filter(h => 
      h.venue?.includes('富途') && h.ccy === 'HKD'
    );
    
    if (futuHkPositions.length > 0) {
      const futuHkResult = {
        account: "富途港股",
        positions: [],
        dividendTax: 0,
        tradingFeeEstimate: 0
      };
      
      futuHkPositions.forEach(pos => {
        const dividendRate = TaxRules.futu_hk.dividend.rate;
        const estimatedDividend = pos.rmb * 0.004; // 假设4%股息率
        const dividendTax = estimatedDividend * dividendRate;
        
        // 交易费估算（假设卖出）
        const stampDuty = pos.rmb * TaxRules.futu_hk.trading.stamp_duty;
        const tradingFee = pos.rmb * TaxRules.futu_hk.trading.trading_fee;
        const settlementFee = pos.rmb * TaxRules.futu_hk.trading.settlement;
        const platformFee = toRMB(TaxRules.futu_hk.trading.platform, 'HKD');
        
        futuHkResult.positions.push({
          name: pos.name,
          shares: pos.shares,
          value: pos.rmb,
          estimatedDividend: estimatedDividend,
          dividendTax: dividendTax,
          tradingFees: {
            stampDuty: stampDuty,
            tradingFee: tradingFee,
            settlementFee: settlementFee,
            platformFee: platformFee,
            total: stampDuty + tradingFee + settlementFee + platformFee
          },
          dividendRate: dividendRate
        });
        
        futuHkResult.dividendTax += dividendTax;
        futuHkResult.tradingFeeEstimate += stampDuty + tradingFee + settlementFee + platformFee;
      });
      
      results.push(futuHkResult);
    }

    // 富途美股持仓
    const futuUsPositions = holdings.filter(h => 
      h.venue?.includes('富途') && h.ccy === 'USD'
    );
    
    if (futuUsPositions.length > 0) {
      const futuUsResult = {
        account: "富途美股",
        positions: [],
        dividendTax: 0,
        tradingFeeEstimate: 0
      };
      
      futuUsPositions.forEach(pos => {
        // 使用中美协定税率 10%
        const dividendRate = TaxRules.futu_us.dividend.wht_treaty;
        // ETF股息率假设 1.5%
        const estimatedDividend = pos.rmb * 0.015;
        const dividendTax = estimatedDividend * dividendRate;
        
        // 交易费估算
        const secFee = pos.rmb * TaxRules.futu_us.trading.sec_fee;
        const adFee = pos.rmb * TaxRules.futu_us.trading.ad_fee;
        const settlementFee = pos.rmb * TaxRules.futu_us.trading.settlement;
        const platformFee = toRMB(TaxRules.futu_us.trading.platform, 'USD');
        
        futuUsResult.positions.push({
          name: pos.name,
          shares: pos.shares,
          value: pos.rmb,
          estimatedDividend: estimatedDividend,
          dividendTax: dividendTax,
          tradingFees: {
            secFee: secFee,
            adFee: adFee,
            settlementFee: settlementFee,
            platformFee: platformFee,
            total: secFee + adFee + settlementFee + platformFee
          },
          dividendRate: dividendRate
        });
        
        futuUsResult.dividendTax += dividendTax;
        futuUsResult.tradingFeeEstimate += secFee + adFee + settlementFee + platformFee;
      });
      
      results.push(futuUsResult);
    }

    return results;
  }

  // ========== 主渲染函数 ==========
  function renderTaxTab() {
    Promise.all([
      fetch("./data/history.json", {cache:"no-store"}).then(r => r.json()),
      fetch("./data/target.json", {cache:"no-store"}).then(r => r.json())
    ]).then(([hist, target]) => {
      const snaps = (hist.snapshots || []).slice().sort((a,b) => a.date.localeCompare(b.date));
      if (snaps.length === 0) {
        $("#tax-content").innerHTML = `<div style="padding:24px;color:var(--text-1)">暂无持仓数据</div>`;
        return;
      }

      const cur = snaps[snaps.length - 1];
      const rates = cur.rates || { USD: 7.2, HKD: 0.92 };
      
      // 提取所有持仓
      const holdings = [];
      Object.entries(cur.holdings || {}).forEach(([key, h]) => {
        if (!h) return;
        const ccy = h.ccy || 'RMB';
        const rate = ccy === 'RMB' ? 1 : (rates[ccy] || 1);
        let rmb, shares, price;
        
        if (h.raw != null) {
          rmb = h.raw * rate;
        } else if (h.shares != null) {
          const px = (cur.prices && cur.prices[key] && cur.prices[key].price) || h.price || 0;
          shares = h.shares;
          price = px;
          rmb = h.shares * px * rate;
        } else {
          return;
        }
        
        holdings.push({
          key,
          name: h.name || key,
          ccy,
          rmb,
          shares,
          price,
          venue: h.venue || '—'
        });
      });

      const taxResults = calculateTaxEstimate(holdings, rates);
      
      // 计算汇总
      let totalDividendTax = 0;
      let totalTradingFees = 0;
      taxResults.forEach(r => {
        totalDividendTax += r.dividendTax || 0;
        totalTradingFees += r.tradingFeeEstimate || (r.stampDutyEstimate || 0);
      });

      // KPI 卡片
      const kpis = [
        {
          label: "预估年股息税",
          value: fmtK(totalDividendTax),
          sub: "基于假设股息率估算",
          help: "按持仓市值×假设股息率估算年度股息，并按账户类型税率估算股息税",
          tone: "warn"
        },
        {
          label: "预估交易税费",
          value: fmtK(totalTradingFees),
          sub: "假设全部卖出一次",
          help: "按账户类型的印花税/平台费等规则，假设所有仓位卖出一次的交易税费估算",
          tone: "info"
        },
        {
          label: "税务优化空间",
          value: "港股通→富途",
          sub: "港股通红利税20% vs 富途10%",
          help: "示例：相同标的在不同账户可能有不同股息税率，影响长期净收益",
          tone: "ok"
        },
        {
          label: "美股WHT税率",
          value: "10%",
          sub: "中美税收协定优惠",
          help: "示例：美股分红预扣税（WHT）常见税率；实际以券商与税务协议为准",
          tone: "ok"
        }
      ];

      $("#tax-kpis").innerHTML = kpis.map(k => `
        <div class="kpi ${k.tone}">
          <div class="stripe"></div>
          <div class="label" title="${k.help || ""}">${k.label}</div>
          <div class="value num" title="${k.help || ""}">${k.value}</div>
          <div class="sub" title="${k.help || ""}">${k.sub}</div>
        </div>
      `).join("");

      // 税务规则说明
      const rulesHTML = `
        <div class="lia-card" style="margin-bottom:14px">
          <h3 style="margin:0 0 12px;font-size:13px;color:var(--text-1)">📋 税务规则速查</h3>
          <table class="lia-table">
            <thead>
              <tr><th title="账户/通道类型（不同税率/费用规则）">账户类型</th><th title="股息分红相关税率">股息税</th><th title="卖出产生的资本利得税口径">资本利得</th><th title="印花税/平台费等交易成本">交易费用</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><b>港股通</b><div style="font-size:11px;color:var(--text-2)">中银/招商</div></td>
                <td>H股10%<br/>非H股20%</td>
                <td style="color:var(--ok)">免税</td>
                <td>印花税0.13%</td>
              </tr>
              <tr>
                <td><b>富途港股</b></td>
                <td style="color:var(--ok)">10%</td>
                <td style="color:var(--ok)">免税</td>
                <td>印花税0.13% + 平台费15HKD</td>
              </tr>
              <tr>
                <td><b>富途美股</b></td>
                <td style="color:var(--ok)">10% <span style="font-size:10px">(协定)</span></td>
                <td style="color:var(--ok)">免税 <span style="font-size:10px">(非居民)</span></td>
                <td>SEC费+结算费+平台费1USD</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;

      // 持仓税务明细
      let positionsHTML = '';
      taxResults.forEach(result => {
        positionsHTML += `
          <div class="lia-card" style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <h3 style="margin:0;font-size:13px;color:var(--text-1)">${result.account}</h3>
              <span style="font-size:11px;color:var(--text-2)">预估年股息税: <b style="color:var(--warn)">${fmtK(result.dividendTax)}</b></span>
            </div>
            <table class="lia-table">
              <thead>
                <tr>
                  <th title="标的名称与持仓股数（如有）">持仓</th>
                  <th class="r" title="市值按当前快照价格与汇率折算">市值</th>
                  <th class="r" title="按假设股息率估算的年度股息">预估股息</th>
                  <th class="r" title="预估股息税=预估股息×税率">股息税</th>
                  <th class="r" title="卖出一次的预估交易税费（印花税/平台费等）">卖出税费</th>
                </tr>
              </thead>
              <tbody>
                ${result.positions.map(pos => `
                  <tr>
                    <td>
                      <b>${pos.name}</b>
                      ${pos.shares ? `<div style="font-size:11px;color:var(--text-2)">${fmt(pos.shares)} 股</div>` : ''}
                    </td>
                    <td class="r">${fmtK(pos.value)}</td>
                    <td class="r">${fmtK(pos.estimatedDividend)}</td>
                    <td class="r" style="color:var(--warn)">${fmtK(pos.dividendTax)} <span style="font-size:10px;color:var(--text-2)">(${pct(pos.dividendRate,0)})</span></td>
                    <td class="r">${fmtK(pos.tradingFees?.total || pos.stampDuty || 0)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      });

      // 优化建议
      const suggestionsHTML = `
        <div class="lia-card" style="margin-bottom:14px;border-left:3px solid var(--ok)">
          <h3 style="margin:0 0 10px;font-size:13px;color:var(--ok)">💡 税务优化建议</h3>
          <ul style="margin:0;padding-left:18px;color:var(--text-1);font-size:12px;line-height:1.8">
            <li><b>港股通 vs 富途港股：</b>腾讯等非H股在港股通红利税20%，富途仅10%。长期持有可考虑转至富途（但需权衡通道费）</li>
            <li><b>美股股息：</b>确保填写W-8BEN表格，享受中美协定10%税率（否则30%）</li>
            <li><b>资本利得：</b>港股和美股对非税务居民均免资本利得税，可放心做再平衡</li>
            <li><b>美国国债：</b>利息预扣税30%，可考虑用IRA结构或换其他低税债券</li>
          </ul>
        </div>
      `;

      $("#tax-content").innerHTML = rulesHTML + positionsHTML + suggestionsHTML;

    }).catch(err => {
      $("#tax-kpis").innerHTML = `<div style="padding:24px;color:var(--text-1)">加载失败：${err.message}</div>`;
      console.error(err);
    });
  }

  // 暴露到全局，供 Tab 切换时调用
  window.renderTaxTab = renderTaxTab;
})();
