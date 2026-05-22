// Rev714 Result Worker: payout-only safe mode + disabled unsafe order parser
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
  function amountsFromText(x) {
    const amounts = [];
    let m; const re = /(\d[\d,]*)\s*円/g;
    while ((m = re.exec(zenkakuToHankaku(cleanText(x))))) amounts.push(m[1].replace(/,/g, ''));
    return amounts;
  }
  function pairsFromText(x) {
    const t = zenkakuToHankaku(cleanText(x));
    const pairs = [];
    let m;
    const re = /(\d{1,2})\s*[-－―ー–]\s*(\d{1,2})/g;
    while ((m = re.exec(t))) {
      const p = normalizeCombo(m[1] + '-' + m[2], 2);
      if (p) pairs.push(p);
    }
    if (!pairs.length) {
      const nums = (t.match(/\d{1,2}/g) || []).map(cleanNo).filter(Boolean);
      for (let i = 0; i + 1 < nums.length && pairs.length < 3; i += 2) {
        const p = normalizeCombo(nums[i] + '-' + nums[i+1], 2);
        if (p) pairs.push(p);
      }
    }
    return pairs;
  }
  function tripleFromText(x) {
    const t = zenkakuToHankaku(cleanText(x));
    const m = t.match(/(\d{1,2})\s*[-－―ー–]\s*(\d{1,2})\s*[-－―ー–]\s*(\d{1,2})/);
    if (m) return normalizeCombo(`${m[1]}-${m[2]}-${m[3]}`, 3);
    return comboFrom(t, 3);
  }
  for (const table of tableBlocks(html)) {
    const tableText = cleanText(table);
    if (!labels.some(x => tableText.includes(x))) continue;
    for (const row of rowsFromTable(table)) {
      const rowText = cleanText(row);
      if (!labels.some(x => rowText.includes(x))) continue;
      const cells = cellsFromRow(row).map(cleanText).filter(Boolean);
      let label = '';
      let labelIdx = -1;
      for (let i = 0; i < cells.length; i++) {
        label = labels.find(x => cells[i].includes(x)) || '';
        if (label) { labelIdx = i; break; }
      }
      if (!label) { label = labels.find(x => rowText.includes(x)) || ''; labelIdx = 0; }
      if (!label) continue;
      const after = cells.slice(labelIdx + 1);
      const comboText = after[0] || rowText.replace(label, ' ');
      const amountText = after.slice(1).join(' ') || rowText;
      const amounts = amountsFromText(amountText).length ? amountsFromText(amountText) : amountsFromText(rowText);
      if (/馬連/.test(label) && !/馬単/.test(label)) {
        const pair = pairsFromText(comboText)[0] || comboFrom(rowText.replace(label, ' '), 2);
        const t = makeTicket(pair, amounts[0] || '');
        if (t && t.amount) { out.umaren = t; out.payouts.push({ type: '馬連', ...t }); }
      } else if (/ワイド/.test(label)) {
        const pairs = pairsFromText(comboText);
        pairs.slice(0,3).forEach((pair, i) => {
          const t = makeTicket(pair, amounts[i] || amounts[0] || '');
          if (t && t.amount) out.wide.push(t);
        });
      } else if (/3連複|３連複|三連複/.test(label)) {
        const tri = tripleFromText(comboText) || tripleFromText(rowText.replace(label, ' '));
        const t = makeTicket(tri, amounts[0] || '');
        if (t && t.amount) { out.sanrenpuku = t; out.payouts.push({ type: '3連複', ...t }); }
      } else if (/3連単|３連単|三連単/.test(label)) {
        const tri = tripleFromText(comboText) || tripleFromText(rowText.replace(label, ' '));
        const t = makeTicket(tri, amounts[0] || '');
        if (t && t.amount) { out.sanrentan = t; out.payouts.push({ type: '3連単', ...t }); }
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
  // Rev714: order parser disabled.
  // Reason: db.netkeiba fallback returns payout correctly, but result table layout caused horse-number
  // extraction to read frame/rank cells, producing duplicate orders such as 8-3-3 or 4-4-4.
  // Returning no order lets the app preserve existing verified order while still applying payouts.
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
  const raceBase = 'https://race.netkeiba.com/race/';
  const dbBase = 'https://db.netkeiba.com/race/';
  const arr = [];
  // 16桁はnetkeiba標準IDとして維持。dbページは着順・払戻が同一HTMLに入ることが多い。
  if (/^20\d{14}$/.test(String(id))) {
    arr.push(`${dbBase}${id}/`);
    arr.push(`${raceBase}result.html?race_id=${id}&rf=race_submenu`);
    arr.push(`${raceBase}result.html?race_id=${id}`);
    arr.push(`${raceBase}payback.html?race_id=${id}`);
    arr.push(`${raceBase}payout.html?race_id=${id}`);
    arr.push(`${raceBase}refund.html?race_id=${id}`);
  } else {
    arr.push(`${raceBase}result.html?race_id=${id}&rf=race_submenu`);
    arr.push(`${raceBase}result.html?race_id=${id}`);
    arr.push(`${raceBase}payback.html?race_id=${id}`);
    arr.push(`${raceBase}payout.html?race_id=${id}`);
    arr.push(`${raceBase}refund.html?race_id=${id}`);
    arr.push(`${dbBase}${id}/`);
  }
  return arr;
}
function htmlHeadSample(html) {
  const t = cleanText(html);
  return t.slice(0, 260);
}
function hasRealRaceHtml(html) {
  const t = cleanText(html);
  if (!html || html.length < 500) return false;
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
function decodeArrayBuffer(buf, contentType) {
  const bytes = new Uint8Array(buf);
  const ascii = new TextDecoder('utf-8', { fatal:false }).decode(bytes.slice(0, Math.min(bytes.length, 4096)));
  const ct = String(contentType || '').toLowerCase();
  const head = ascii.toLowerCase();
  const declared = (ct.match(/charset=([^;\s]+)/) || head.match(/charset=["']?([^"'\s/>]+)/) || [])[1] || '';
  const candidates = [];
  const norm = declared.replace(/_/g,'-').toLowerCase();
  if (norm) candidates.push(norm);
  // netkeiba/db.netkeiba often returns Japanese HTML where Response.text() becomes mojibake.
  candidates.push('utf-8', 'euc-jp', 'shift_jis');
  const uniq = [...new Set(candidates)];
  let best = '';
  let bestScore = -1;
  for (const enc of uniq) {
    try {
      const txt = new TextDecoder(enc, { fatal:false }).decode(bytes);
      const t = txt.slice(0, 200000);
      let score = 0;
      score += (t.match(/着順|馬番|馬名|払戻|払い戻し|馬連|ワイド|3連複|３連複|単勝|複勝/g) || []).length * 20;
      score += (t.match(/netkeiba|NetDreamers|race_id|Result|Pay/g) || []).length;
      score -= (t.match(/�/g) || []).length * 5;
      // Prefer Japanese-decoded text over mojibake even if it is a login/premium page.
      score += (t.match(/ログイン|プレミアム|レース|ニュース/g) || []).length * 3;
      if (score > bestScore) { bestScore = score; best = txt; }
    } catch (_) {}
  }
  return best || new TextDecoder('utf-8', { fatal:false }).decode(bytes);
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
  const contentType = res.headers.get('content-type') || '';
  const buf = await res.arrayBuffer();
  const html = decodeArrayBuffer(buf, contentType);
  return { url, finalUrl: res.url || url, status: res.status, redirected: !!res.redirected, contentType, bytes: buf.byteLength, chars: html.length, html, head: htmlHeadSample(html), title: ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,160) };
}
async function handle(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  const started = Date.now();
  let body = {};
  if (request.method === 'POST') {
    try { body = await request.json(); } catch (_) { body = {}; }
  }
  const ids = requestIds(request.url, body);
  if (!ids.length) return jsonResponse({ ok:false, error:'missing race_id', __rev:'Rev714' }, 400);

  const probes = [];
  let best = null;
  for (const id of ids) {
    for (const url of candidateUrls(id)) {
      let got;
      try { got = await fetchHtml(url); }
      catch (e) { probes.push(`${url}:ERR:${String(e && e.message || e).slice(0,80)}`); continue; }
      const real = hasRealRaceHtml(got.html);
      probes.push(`${url}:HTTP${got.status}:bytes=${got.bytes}:chars=${got.chars||0}:${real?'REAL':'EMPTY'}:title=${(got.title||'').slice(0,80)}:head=${(got.head||'').slice(0,120)}`);
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
      __rev: 'Rev714-worker-payout-only-empty',
      __elapsedMs: Date.now()-started,
      race_id: ids[0],
      result: { payouts: [], wide: [] },
      order: [], orderNos: [], payouts: [], wide: [],
      diagnosis: { empty: true, reason: 'no real result/payback html after charset decode', probes, hint: 'If all probes show small bytes or login/block pages, Worker fetch is blocked or URL pattern is wrong.' }
    });
  }

  const result = { ...best.payout };
  // Rev714 payout-only: do not return first/second/third/order from Worker.
  // Frontend keeps existing verified order and applies only section-separated payouts.
  const order = [];
  delete result.first; delete result.second; delete result.third;
  delete result.firstNo; delete result.secondNo; delete result.thirdNo;
  delete result.order; delete result.orderNos; delete result.resultOrder;
  const payoutOk = !!(result.umaren && result.wide && result.wide.length && result.sanrenpuku);
  const orderOk = false;
  return jsonResponse({
    ok: true,
    __rev: 'Rev714-worker-payout-only-safe',
    __httpStatus: best.status,
    __bytes: best.bytes,
    __elapsedMs: Date.now()-started,
    race_id: best.id,
    targetUrl: best.url,
    idNormalize: 'preserve16-first-db-fallback',
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
      orderDisabled: true,
      umaren: !!result.umaren,
      wideCount: (result.wide||[]).length,
      sanrenpuku: !!result.sanrenpuku,
      orderCount: 0,
      probes
    }
  });
}
export default { fetch: handle };
