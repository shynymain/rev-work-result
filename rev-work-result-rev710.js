// Rev709 Result Worker: normalize 16-digit nk id to 12-digit netkeiba race_id + payout parser
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



function extractIds(input) {
  const raw = String(input || '');
  const nums = raw.match(/20\d{10,14}/g) || [];
  const out = [];
  for (const n of nums) {
    if (!out.includes(n)) out.push(n);
    // 16桁アプリIDは netkeiba でそのまま使える場合を最優先。
    // 12桁化は最後のfallbackだけにする。Rev709の12桁優先はfake123化したため禁止。
    if (/^20\d{14}$/.test(n)) {
      const n12 = n.slice(0,4) + n.slice(8,16);
      if (!out.includes(n12)) out.push(n12);
    }
  }
  return out;
}
function requestIds(url, body) {
  const q = new URL(url).searchParams;
  const vals = [
    body.race_id, body.netkeibaRaceId, body.raceId,
    body.targetUrl, body.url, body.payoutUrl,
    q.get('race_id'), q.get('netkeibaRaceId'), q.get('raceId'), q.get('targetUrl'), q.get('url'), q.get('payoutUrl')
  ].filter(Boolean);
  const ids = [];
  for (const v of vals) for (const id of extractIds(v)) if (!ids.includes(id)) ids.push(id);
  return ids;
}
function candidateUrls(id) {
  const base = 'https://race.netkeiba.com/race/';
  return [
    `${base}result.html?race_id=${id}&rf=race_submenu`,
    `${base}result.html?race_id=${id}`,
    `${base}payback.html?race_id=${id}`,
    `${base}payout.html?race_id=${id}`,
    `${base}refund.html?race_id=${id}`
  ];
}
function hasRealRaceHtml(html) {
  const t = cleanText(html);
  if (!html || html.length < 1500) return false;
  if (/resultOrder\s+[123]/.test(t) && !/払戻|払い戻し|馬連|ワイド|3連複|着順/.test(t)) return false;
  return /着順|馬番|タイム|払戻|払い戻し|馬連|ワイド|3連複|３連複/.test(t);
}
function isFake123(order, html, payout) {
  const joined = (order || []).join('-');
  if (joined !== '1-2-3') return false;
  const t = cleanText(html);
  // 実際に「1着 1 / 2着 2 / 3着 3」の根拠があるときだけ許す。
  const explicit = /1着\s*1[\s\S]{0,120}2着\s*2[\s\S]{0,120}3着\s*3/.test(t);
  const hasPayout = !!(payout && ((payout.payouts||[]).length || payout.umaren || (payout.wide||[]).length || payout.sanrenpuku));
  return !explicit && !hasPayout;
}
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.5',
      'referer': 'https://race.netkeiba.com/'
    },
    cf: { cacheTtl: 10, cacheEverything: false }
  });
  const html = await res.text();
  return { url, status: res.status, bytes: html.length, html };
}
async function handle(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  const started = Date.now();
  let body = {};
  if (request.method === 'POST') {
    try { body = await request.json(); } catch (_) { body = {}; }
  }
  const ids = requestIds(request.url, body);
  if (!ids.length) return jsonResponse({ ok:false, error:'missing race_id', __rev:'Rev710' }, 400);

  const probes = [];
  let best = null;
  for (const id of ids) {
    for (const url of candidateUrls(id)) {
      let got;
      try { got = await fetchHtml(url); }
      catch (e) { probes.push(`${url}:ERR:${String(e && e.message || e).slice(0,80)}`); continue; }
      const real = hasRealRaceHtml(got.html);
      probes.push(`${url}:HTTP${got.status}:${got.bytes}:${real?'REAL':'EMPTY'}`);
      if (!real) continue;
      const order = parseOrder(got.html);
      const payout = mergePayouts(parsePayoutsFromTables(got.html), parsePayoutsByTextWindow(got.html));
      const score = (order.length>=3 ? 4 : 0) + ((payout.payouts||[]).length ? 10 : 0) + ((payout.wide||[]).length ? 3 : 0) + (payout.umaren ? 2 : 0) + (payout.sanrenpuku ? 2 : 0);
      if (!best || score > best.score) best = { ...got, order, payout, score, id };
      if (score >= 16) break;
    }
    if (best && best.score >= 16) break;
  }

  if (!best) {
    return jsonResponse({
      ok: true,
      __rev: 'Rev710-worker-no-fake123-preserve16',
      __elapsedMs: Date.now()-started,
      race_id: ids[0],
      result: { payouts: [], wide: [] },
      order: [], orderNos: [], payouts: [], wide: [],
      diagnosis: { empty: true, reason: 'no real result/payback html', probes }
    });
  }

  const result = { ...best.payout };
  const order = best.order || [];
  if (order.length >= 3 && !isFake123(order, best.html, best.payout)) {
    result.first = order[0]; result.second = order[1]; result.third = order[2];
    result.firstNo = order[0]; result.secondNo = order[1]; result.thirdNo = order[2];
    result.order = order; result.orderNos = order; result.resultOrder = order;
  }
  const payoutOk = !!(result.umaren && result.wide && result.wide.length && result.sanrenpuku);
  const orderOk = !!(result.firstNo && result.secondNo && result.thirdNo);
  return jsonResponse({
    ok: true,
    __rev: 'Rev710-worker-preserve16-payback-fallback-no-fake123',
    __httpStatus: best.status,
    __bytes: best.bytes,
    __elapsedMs: Date.now()-started,
    race_id: best.id,
    targetUrl: best.url,
    idNormalize: 'preserve16-first',
    result,
    first: result.first,
    second: result.second,
    third: result.third,
    firstNo: result.firstNo,
    secondNo: result.secondNo,
    thirdNo: result.thirdNo,
    order: result.order || [],
    orderNos: result.orderNos || [],
    payouts: result.payouts || [],
    umaren: result.umaren || null,
    wide: result.wide || [],
    sanrenpuku: result.sanrenpuku || null,
    diagnosis: {
      payoutOk,
      orderOk,
      fake123Blocked: (order||[]).join('-')==='1-2-3' && !orderOk,
      umaren: !!result.umaren,
      wideCount: (result.wide||[]).length,
      sanrenpuku: !!result.sanrenpuku,
      orderCount: (result.order||[]).length,
      probes
    }
  });
}
export default { fetch: handle };
