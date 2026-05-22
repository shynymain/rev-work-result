// Rev743 result Worker: netkeiba result HTML fetch + section based payout parser
// Contract: never return HTTP 200 with an empty JSON object for a valid race_id.
// On upstream/parse failure, return JSON with ok:false, empty:true, reason and diagnostics.

const REV = 'rev743-result-full-html-parser';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 0), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function s(v) { return v == null ? '' : String(v).trim(); }
function digits(v) { return s(v).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)); }
function stripTags(html) {
  return s(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&yen;/g, '円')
    .replace(/\s+/g, ' ')
    .trim();
}
function money(v) {
  const m = digits(v).match(/([0-9][0-9,]*)\s*円?/);
  return m ? m[1].replace(/,/g, '') : '';
}
function normalizeCombo(v) {
  const nums = digits(v).match(/\d{1,2}/g) || [];
  return nums.slice(0, 3).map(n => String(parseInt(n, 10))).filter(Boolean).join('-');
}
function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }

function raceIdFromPayload(p, url) {
  const direct = s(p.race_id || p.netkeibaRaceId || p.netkeiba_race_id || p.nk || p.id || url.searchParams.get('race_id') || url.searchParams.get('nk'));
  if (/^\d{12}$/.test(direct)) return direct;
  const rid = s(p.raceId || url.searchParams.get('raceId'));
  const dateRaw = s(p.date || url.searchParams.get('date'));
  const place = s(p.place || url.searchParams.get('place'));
  const raceNoRaw = s(p.raceNo || p.race || url.searchParams.get('raceNo') || url.searchParams.get('race'));
  if (!rid && !(dateRaw && place && raceNoRaw)) return '';
  const m = rid.match(/^(\d{8})_(.+?)_(\d{1,2})R?$/) || [];
  const ymd = (m[1] || dateRaw).replace(/\D/g, '');
  const plc = m[2] || place;
  const rn = String(parseInt((m[3] || raceNoRaw).replace(/\D/g, ''), 10)).padStart(2, '0');
  const placeCode = {札幌:'01',函館:'02',福島:'03',新潟:'04',東京:'05',中山:'06',中京:'07',京都:'08',阪神:'09',小倉:'10'}[plc];
  if (!/^\d{8}$/.test(ymd) || !placeCode || !/^\d{2}$/.test(rn)) return direct;
  // meet/day is not derivable safely on the worker without a schedule table.
  // Frontend normally sends the full nk ID. Keep this fallback explicit.
  return direct;
}

async function readBody(request) {
  if (request.method === 'GET') return {};
  const text = await request.text();
  if (!s(text)) return {};
  try { return JSON.parse(text); } catch (_) {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

async function fetchNetkeibaHtml(raceId) {
  const urls = [
    `https://race.netkeiba.com/race/result.html?race_id=${encodeURIComponent(raceId)}&rf=race_submenu`,
    `https://db.netkeiba.com/race/${encodeURIComponent(raceId)}/`
  ];
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
    'cache-control': 'no-cache'
  };
  const attempts = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers, cf: { cacheTtl: 0, cacheEverything: false } });
      const text = await r.text();
      attempts.push({ url: u, status: r.status, bytes: text.length });
      if (r.ok && text.length > 500) return { html: text, attempts };
    } catch (e) {
      attempts.push({ url: u, error: s(e && e.message) || String(e) });
    }
  }
  return { html: '', attempts };
}

function parseOrder(html) {
  const text = stripTags(html);
  const nums = [];
  // Modern result table often contains rank then horse number near horse name.
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  const rows = html.match(rowRe) || [];
  for (const row of rows) {
    const t = stripTags(row);
    const rank = digits(t).match(/^\s*(1|2|3)\s+/);
    if (!rank) continue;
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(stripTags);
    const allNums = cells.map(c => digits(c).match(/^\s*(\d{1,2})\s*$/)?.[1]).filter(Boolean);
    const horseNo = allNums.find(n => parseInt(n,10) >= 1 && parseInt(n,10) <= 18 && n !== rank[1]);
    if (horseNo) nums[parseInt(rank[1], 10) - 1] = String(parseInt(horseNo, 10));
  }
  if (nums[0] && nums[1] && nums[2]) return nums.slice(0, 3);
  const alt = text.match(/(?:着順|入線|確定).*?(\d{1,2})\s*[→\- ]\s*(\d{1,2})\s*[→\- ]\s*(\d{1,2})/);
  if (alt) return [alt[1], alt[2], alt[3]].map(n => String(parseInt(n,10)));
  return [];
}

function parsePayouts(html) {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const out = { wide: [] };
  for (const row of rows) {
    const t = stripTags(row);
    if (!/(単勝|複勝|枠連|馬連|ワイド|馬単|三連複|3連複|三連単|3連単)/.test(t)) continue;
    const label = (t.match(/(馬連|ワイド|三連複|3連複|三連単|3連単)/) || [])[1];
    if (!label) continue;
    const combos = uniq((t.match(/\d{1,2}\s*[-－―–]\s*\d{1,2}(?:\s*[-－―–]\s*\d{1,2})?/g) || []).map(normalizeCombo));
    const amounts = (digits(t).match(/[0-9][0-9,]*\s*円/g) || []).map(money).filter(Boolean);
    if (label === '馬連' && combos[0]) out.umaren = { combo: combos[0], amount: amounts[0] || '' };
    if (/三連複|3連複/.test(label) && combos[0]) out.sanrenpuku = { combo: combos[0], amount: amounts[0] || '' };
    if (/三連単|3連単/.test(label) && combos[0]) out.sanrentan = { combo: combos[0], amount: amounts[0] || '' };
    if (label === 'ワイド') {
      combos.slice(0, 3).forEach((c, i) => out.wide.push({ combo: c, amount: amounts[i] || '' }));
    }
  }
  // Text fallback when rows are hard to segment.
  const text = stripTags(html);
  if (!out.umaren) {
    const m = text.match(/馬連\s*(\d{1,2}\s*[-－―–]\s*\d{1,2})\s*([0-9][0-9,]*\s*円)/);
    if (m) out.umaren = { combo: normalizeCombo(m[1]), amount: money(m[2]) };
  }
  if (!out.sanrenpuku) {
    const m = text.match(/(?:三連複|3連複)\s*(\d{1,2}\s*[-－―–]\s*\d{1,2}\s*[-－―–]\s*\d{1,2})\s*([0-9][0-9,]*\s*円)/);
    if (m) out.sanrenpuku = { combo: normalizeCombo(m[1]), amount: money(m[2]) };
  }
  return out;
}

function toAppResult(raceId, html, attempts) {
  const order = parseOrder(html);
  const p = parsePayouts(html);
  const firstNo = order[0] || '';
  const secondNo = order[1] || '';
  const thirdNo = order[2] || '';
  const result = {
    ok: !!(firstNo && secondNo && thirdNo),
    empty: false,
    rev: REV,
    race_id: raceId,
    netkeibaRaceId: raceId,
    firstNo, secondNo, thirdNo,
    first: firstNo, second: secondNo, third: thirdNo,
    order: order.join('-'),
    payouts: {},
    wide: p.wide || []
  };
  if (p.umaren) {
    result.umaren = p.umaren.combo;
    result.umarenAmount = p.umaren.amount;
    result.payouts.umaren = p.umaren;
  }
  if (p.sanrenpuku) {
    result.sanrenpuku = p.sanrenpuku.combo;
    result.sanrenpukuAmount = p.sanrenpuku.amount;
    result.payouts.sanrenpuku = p.sanrenpuku;
  }
  if (p.sanrentan) {
    result.sanrentan = p.sanrentan.combo;
    result.sanrentanAmount = p.sanrentan.amount;
    result.payouts.sanrentan = p.sanrentan;
  }
  if (result.wide.length) result.payouts.wide = result.wide;
  result.__httpStatus = 200;
  result.__bytes = html.length;
  result.__attempts = attempts;
  return result;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (!/^\/api\/(result|results|payout|payouts|payoff|refund|dividend)/.test(url.pathname)) {
      return json({ ok: true, rev: REV, endpoints: ['/api/result'], message: 'Rev743 result worker alive' });
    }
    let body = {};
    try { body = await readBody(request); } catch (e) { return json({ ok:false, empty:true, rev:REV, reason:'BAD_BODY', error:s(e.message) }, 400); }
    const raceId = raceIdFromPayload(body, url);
    if (!/^\d{12}$/.test(raceId)) {
      return json({ ok:false, empty:true, rev:REV, reason:'MISSING_12_DIGIT_RACE_ID', received: body, query:Object.fromEntries(url.searchParams) }, 200);
    }
    const { html, attempts } = await fetchNetkeibaHtml(raceId);
    if (!html) return json({ ok:false, empty:true, rev:REV, race_id:raceId, reason:'UPSTREAM_EMPTY', __attempts:attempts, __bytes:0 }, 200);
    const parsed = toAppResult(raceId, html, attempts);
    if (!parsed.firstNo && !parsed.umaren && !parsed.sanrenpuku && (!parsed.wide || !parsed.wide.length)) {
      return json({ ok:false, empty:true, rev:REV, race_id:raceId, reason:'PARSE_EMPTY', __attempts:attempts, __bytes:html.length }, 200);
    }
    return json(parsed, 200);
  }
};
