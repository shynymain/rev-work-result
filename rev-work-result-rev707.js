// Rev707 Result Worker: order + strict payout parser
// Cloudflare Workers module syntax. Deploy this to rev-work-result.umeparis0317.workers.dev
// Endpoints: /api/result, /api/payout, /api/payouts, /api/payoff, /api/refund, /api/dividend

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type,authorization,x-requested-with',
  'Access-Control-Max-Age': '86400'
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' }
  });
}

function stripTags(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#165;|&yen;/g, '円')
    .replace(/&#x2d;|&minus;/gi, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
function zenkakuToHankaku(s) {
  return String(s || '').replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
}
function cleanText(s) { return zenkakuToHankaku(stripTags(s)); }
function cleanNo(s) {
  const m = zenkakuToHankaku(String(s || '')).match(/\d{1,2}/);
  if (!m) return '';
  const n = parseInt(m[0], 10);
  return n >= 1 && n <= 18 ? String(n) : '';
}
function amountFrom(s) {
  const text = zenkakuToHankaku(cleanText(s)).replace(/,/g, '');
  const m = text.match(/(\d{2,9})\s*円/);
  if (!m) return '';
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}
function formatAmount(a) {
  const n = parseInt(String(a || '').replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('ja-JP') + '円' : '';
}
function comboFrom(s, count) {
  const nums = zenkakuToHankaku(cleanText(s)).match(/\d{1,2}/g) || [];
  const cleaned = nums.map(x => cleanNo(x)).filter(Boolean);
  const uniq = [];
  for (const n of cleaned) { if (!uniq.includes(n)) uniq.push(n); }
  return uniq.length >= count ? uniq.slice(0, count).join('-') : '';
}
function normalizeCombo(c, count) {
  const arr = String(c || '').split(/[^0-9]+/).map(cleanNo).filter(Boolean);
  return arr.length >= count ? arr.slice(0, count).join('-') : '';
}
function makeTicket(combo, amount) {
  combo = normalizeCombo(combo, combo && combo.split('-').length || 2);
  const amt = String(amount || '').replace(/[^0-9]/g, '');
  return combo ? { combo, amount: amt, payout: amt, pay: amt, yen: formatAmount(amt) } : null;
}

function tableBlocks(html) {
  const blocks = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = re.exec(html))) blocks.push(m[0]);
  return blocks;
}
function rowsFromTable(table) {
  const rows = [];
  const re = /<tr[\s\S]*?<\/tr>/gi;
  let m;
  while ((m = re.exec(table))) rows.push(m[0]);
  return rows;
}
function cellsFromRow(row) {
  const cells = [];
  const re = /<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi;
  let m;
  while ((m = re.exec(row))) cells.push(m[0]);
  return cells;
}

function parsePayoutsFromTables(html) {
  const out = { payouts: [], wide: [] };
  const labels = ['単勝','複勝','枠連','馬連','ワイド','馬単','3連複','３連複','三連複','3連単','３連単','三連単'];
  for (const table of tableBlocks(html)) {
    const tableText = cleanText(table);
    if (!labels.some(x => tableText.includes(x))) continue;
    for (const row of rowsFromTable(table)) {
      const rowText = cleanText(row);
      if (!labels.some(x => rowText.includes(x))) continue;
      const cells = cellsFromRow(row).map(cleanText).filter(Boolean);
      const label = labels.find(x => rowText.includes(x));
      if (!label) continue;
      const amounts = [];
      const amtRe = /(\d[\d,]*)\s*円/g;
      let am;
      while ((am = amtRe.exec(zenkakuToHankaku(rowText)))) amounts.push(am[1].replace(/,/g, ''));
      const rowNoLabel = rowText.replace(label, ' ');
      const combo2 = comboFrom(rowNoLabel, 2);
      const combo3 = comboFrom(rowNoLabel, 3);
      const amount = amounts[0] || '';
      if (/馬連/.test(label)) {
        const t = makeTicket(combo2, amount);
        if (t) { out.umaren = t; out.payouts.push({ type: '馬連', ...t }); }
      } else if (/ワイド/.test(label)) {
        // Wide rows can contain three pairs and three amounts in one row.
        const nums = (zenkakuToHankaku(rowNoLabel).match(/\d{1,2}/g) || []).map(cleanNo).filter(Boolean);
        const pairs = [];
        for (let i = 0; i + 1 < nums.length && pairs.length < 3; i += 2) {
          const pair = normalizeCombo(nums[i] + '-' + nums[i + 1], 2);
          if (pair) pairs.push(pair);
        }
        if (pairs.length && amounts.length) {
          pairs.forEach((pair, i) => {
            const t = makeTicket(pair, amounts[i] || amounts[0]);
            if (t) out.wide.push(t);
          });
        } else {
          const t = makeTicket(combo2, amount);
          if (t) out.wide.push(t);
        }
      } else if (/3連複|３連複|三連複/.test(label)) {
        const t = makeTicket(combo3, amount);
        if (t) { out.sanrenpuku = t; out.payouts.push({ type: '3連複', ...t }); }
      } else if (/3連単|３連単|三連単/.test(label)) {
        const t = makeTicket(combo3, amount);
        if (t) { out.sanrentan = t; out.payouts.push({ type: '3連単', ...t }); }
      }
    }
  }
  if (out.wide.length) out.payouts.push(...out.wide.map(x => ({ type: 'ワイド', ...x })));
  return out;
}

function parsePayoutsByTextWindow(html) {
  const text = cleanText(html);
  const out = { payouts: [], wide: [] };
  function section(label, nextLabels) {
    const i = text.indexOf(label);
    if (i < 0) return '';
    let end = text.length;
    for (const n of nextLabels) {
      const j = text.indexOf(n, i + label.length);
      if (j > i && j < end) end = j;
    }
    return text.slice(i, Math.min(end, i + 600));
  }
  const nextAll = ['単勝','複勝','枠連','馬連','ワイド','馬単','3連複','3連単','３連複','３連単'];
  const um = section('馬連', nextAll.filter(x => x !== '馬連'));
  if (um) {
    const t = makeTicket(comboFrom(um, 2), amountFrom(um));
    if (t) { out.umaren = t; out.payouts.push({ type: '馬連', ...t }); }
  }
  const wd = section('ワイド', nextAll.filter(x => x !== 'ワイド'));
  if (wd) {
    const amounts = [];
    let m; const ar = /(\d[\d,]*)\s*円/g;
    while ((m = ar.exec(zenkakuToHankaku(wd)))) amounts.push(m[1].replace(/,/g, ''));
    const nums = (zenkakuToHankaku(wd).match(/\d{1,2}/g) || []).map(cleanNo).filter(Boolean);
    for (let i = 0, k = 0; i + 1 < nums.length && k < 3; i += 2, k++) {
      const t = makeTicket(nums[i] + '-' + nums[i + 1], amounts[k] || amounts[0]);
      if (t) out.wide.push(t);
    }
    if (out.wide.length) out.payouts.push(...out.wide.map(x => ({ type: 'ワイド', ...x })));
  }
  const sp = section(text.includes('3連複') ? '3連複' : (text.includes('３連複') ? '３連複' : '三連複'), nextAll.filter(x => !/3連複|３連複/.test(x)));
  if (sp) {
    const t = makeTicket(comboFrom(sp, 3), amountFrom(sp));
    if (t) { out.sanrenpuku = t; out.payouts.push({ type: '3連複', ...t }); }
  }
  return out;
}

function mergePayouts(a, b) {
  const out = { ...(a || {}) };
  if (!out.umaren && b.umaren) out.umaren = b.umaren;
  if ((!out.wide || !out.wide.length) && b.wide && b.wide.length) out.wide = b.wide;
  if (!out.sanrenpuku && b.sanrenpuku) out.sanrenpuku = b.sanrenpuku;
  if (!out.sanrentan && b.sanrentan) out.sanrentan = b.sanrentan;
  const payouts = [];
  if (out.umaren) payouts.push({ type: '馬連', ...out.umaren });
  if (out.wide) payouts.push(...out.wide.map(x => ({ type: 'ワイド', ...x })));
  if (out.sanrenpuku) payouts.push({ type: '3連複', ...out.sanrenpuku });
  if (out.sanrentan) payouts.push({ type: '3連単', ...out.sanrentan });
  out.payouts = payouts;
  return out;
}

function parseOrder(html) {
  const text = cleanText(html);
  const order = [];
  // Prefer result-table style: 着順 ... 馬番
  const table = tableBlocks(html).find(t => /着順|馬番|タイム|人気/.test(cleanText(t))) || html;
  for (const row of rowsFromTable(table)) {
    const rt = cleanText(row);
    const rank = (rt.match(/(?:^|\s)([123])\s*(?:着|\s)/) || [])[1];
    if (!rank) continue;
    const cells = cellsFromRow(row).map(cleanText).filter(Boolean);
    let no = '';
    for (const c of cells) {
      const n = cleanNo(c);
      if (n) { no = n; break; }
    }
    if (no) order[parseInt(rank, 10) - 1] = no;
  }
  if (order.filter(Boolean).length >= 3) return order.slice(0, 3);
  // fallback for compact strings like 1着 15 ... 2着 5 ... 3着 11
  const m = text.match(/1着\s*(\d{1,2})[\s\S]{0,120}?2着\s*(\d{1,2})[\s\S]{0,120}?3着\s*(\d{1,2})/);
  if (m) return [cleanNo(m[1]), cleanNo(m[2]), cleanNo(m[3])].filter(Boolean);
  return [];
}

function resultUrlFromRequest(url, body) {
  const q = new URL(url).searchParams;
  const raceId = body.race_id || body.netkeibaRaceId || q.get('race_id') || q.get('netkeibaRaceId') || q.get('raceId') || body.raceId;
  const targetUrl = body.targetUrl || body.url || body.payoutUrl || q.get('targetUrl') || q.get('url') || q.get('payoutUrl');
  if (/race\.netkeiba\.com/.test(String(targetUrl || ''))) return targetUrl;
  const id = String(raceId || '').match(/\d{12}/)?.[0];
  if (!id) return '';
  return `https://race.netkeiba.com/race/result.html?race_id=${id}&rf=race_submenu`;
}

async function handle(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  const started = Date.now();
  let body = {};
  if (request.method === 'POST') {
    try { body = await request.json(); } catch (_) { body = {}; }
  }
  const target = resultUrlFromRequest(request.url, body);
  if (!target) return jsonResponse({ ok: false, error: 'missing race_id', __rev: 'Rev707' }, 400);

  const res = await fetch(target, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ja,en-US;q=0.8,en;q=0.6',
      'referer': 'https://race.netkeiba.com/'
    },
    cf: { cacheTtl: 30, cacheEverything: false }
  });
  const html = await res.text();
  const order = parseOrder(html);
  const p1 = parsePayoutsFromTables(html);
  const p2 = parsePayoutsByTextWindow(html);
  const payout = mergePayouts(p1, p2);
  const result = { ...payout };
  if (order.length >= 3) {
    result.first = order[0]; result.second = order[1]; result.third = order[2];
    result.firstNo = order[0]; result.secondNo = order[1]; result.thirdNo = order[2];
    result.order = order; result.orderNos = order; result.resultOrder = order;
  }
  const payoutOk = !!(result.umaren && result.wide && result.wide.length && result.sanrenpuku);
  return jsonResponse({
    ok: true,
    __rev: 'Rev707-worker-payout-html-parser',
    __httpStatus: res.status,
    __bytes: html.length,
    __elapsedMs: Date.now() - started,
    race_id: String(target.match(/race_id=(\d{12})/)?.[1] || ''),
    targetUrl: target,
    result,
    first: result.first,
    second: result.second,
    third: result.third,
    firstNo: result.firstNo,
    secondNo: result.secondNo,
    thirdNo: result.thirdNo,
    order,
    orderNos: order,
    payouts: result.payouts || [],
    umaren: result.umaren || null,
    wide: result.wide || [],
    sanrenpuku: result.sanrenpuku || null,
    diagnosis: {
      payoutOk,
      umaren: !!result.umaren,
      wideCount: (result.wide || []).length,
      sanrenpuku: !!result.sanrenpuku,
      orderCount: order.length
    }
  });
}

export default { fetch: handle };
