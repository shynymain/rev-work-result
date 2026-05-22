// Rev748 result Worker: Japanese result page + en.netkeiba payback-list fallback
// Purpose: avoid HTTP 200 EMPTY loops when race.netkeiba result HTML is blocked/short.
// Contract: keep EMPTY diagnostics, but try en.netkeiba by kaisai_date when Japanese HTML is empty or unparsable.

const REV = 'rev749-result-worker-html-dump-diagnostic';
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
function yenToNum(v) { const m = digits(v).match(/(?:￥|¥)?\s*([0-9][0-9,]*)\s*(?:円)?/); return m ? m[1].replace(/,/g, '') : ''; }
function isIntLine(v, min, max) { const m = digits(v).match(/^\d{1,2}$/); if (!m) return false; const n = parseInt(m[0], 10); return n >= min && n <= max; }
function htmlTitle(html){ const m=s(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? stripTags(m[1]).slice(0,120) : ''; }
function htmlDiag(text, res, tag, url){
  const plain=stripTags(text);
  return {
    tag,
    url,
    finalUrl: res && res.url || url,
    status: res && res.status || 0,
    bytes: text ? text.length : 0,
    title: htmlTitle(text),
    containsRaceTable: /(ResultTable|RaceTable|着順|馬番|Horse|Full Result|FP\s*BK\s*PP)/i.test(text||plain),
    containsPayback: /(払戻|配当|Starting Prices|Payback|Payout|Dividend)/i.test(text||plain),
    containsUmaRen: /(馬連|Quinella)(?! Place)/i.test(text||plain),
    containsWide: /(ワイド|Quinella Place)/i.test(text||plain),
    containsSanrenpuku: /(三連複|3連複|Trio)/i.test(text||plain),
    head: plain.slice(0,180)
  };
}
function stripTags(html) {
  return s(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&yen;|&#165;/g, '￥')
    .replace(/&#44;/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}
function htmlLines(html) {
  return s(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:br|\/tr|\/td|\/th|\/li|\/p|\/div|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&yen;|&#165;/g, '￥')
    .replace(/&#44;/g, ',')
    .split(/\n+/)
    .map(x => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
function normalizeCombo(v) {
  const nums = digits(v).match(/\d{1,2}/g) || [];
  return nums.slice(0, 3).map(n => String(parseInt(n, 10))).filter(Boolean).join('-');
}
function uniq(arr) { return [...new Set((arr || []).filter(Boolean))]; }

function raceIdFromPayload(p, url) {
  const direct = s(p.race_id || p.netkeibaRaceId || p.netkeiba_race_id || p.nk || p.id || url.searchParams.get('race_id') || url.searchParams.get('nk'));
  if (/^\d{12}$/.test(direct)) return direct;
  const rid = s(p.raceId || url.searchParams.get('raceId'));
  const dateRaw = s(p.date || url.searchParams.get('date'));
  const place = s(p.place || url.searchParams.get('place'));
  const raceNoRaw = s(p.raceNo || p.race || url.searchParams.get('raceNo') || url.searchParams.get('race'));
  const m = rid.match(/^(\d{8})_(.+?)_(\d{1,2})R?$/) || [];
  const ymd = (m[1] || dateRaw).replace(/\D/g, '');
  const plc = m[2] || place;
  const rn = String(parseInt((m[3] || raceNoRaw || '').replace(/\D/g, ''), 10)).padStart(2, '0');
  const placeCode = {札幌:'01',函館:'02',福島:'03',新潟:'04',東京:'05',中山:'06',中京:'07',京都:'08',阪神:'09',小倉:'10'}[plc];
  if (!/^\d{8}$/.test(ymd) || !placeCode || !/^\d{2}$/.test(rn)) return direct;
  return direct; // meet/day cannot be safely derived here; frontend should send full nk.
}

async function readBody(request) {
  if (request.method === 'GET') return {};
  const text = await request.text();
  if (!s(text)) return {};
  try { return JSON.parse(text); } catch (_) { return Object.fromEntries(new URLSearchParams(text)); }
}

async function fetchText(url, attempts, tag, opt = {}) {
  const uaDesktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36';
  const uaMobile = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
  const headers = {
    'user-agent': opt.mobile ? uaMobile : uaDesktop,
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': opt.lang || 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
    'referer': opt.referer || 'https://race.netkeiba.com/',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'upgrade-insecure-requests': '1'
  };
  try {
    const sep = url.includes('?') ? '&' : '?';
    const bustUrl = `${url}${sep}revdiag=749&t=${Date.now()}`;
    const r = await fetch(bustUrl, { headers, redirect:'follow', cf: { cacheTtl: 0, cacheEverything: false } });
    const text = await r.text();
    attempts.push(htmlDiag(text, r, tag + (opt.mobile ? '-mobile' : ''), bustUrl));
    return { ok: r.ok, text, status: r.status, url: r.url };
  } catch (e) {
    attempts.push({ tag, url, error: s(e && e.message) || String(e) });
    return { ok: false, text: '', status: 0, url };
  }
}

async function fetchJapaneseHtml(raceId, attempts) {
  const urls = [
    `https://race.netkeiba.com/race/result.html?race_id=${encodeURIComponent(raceId)}&rf=race_submenu`,
    `https://race.netkeiba.com/race/payback.html?race_id=${encodeURIComponent(raceId)}`,
    `https://db.netkeiba.com/race/${encodeURIComponent(raceId)}/`,
    `https://sp.netkeiba.com/race/result.html?race_id=${encodeURIComponent(raceId)}`
  ];
  for (const u of urls) {
    const r = await fetchText(u, attempts, 'jp-result', { mobile: /sp\.netkeiba/.test(u), referer:'https://race.netkeiba.com/' });
    if (r.ok && r.text.length > 3000 && /(払戻|着順|馬連|ワイド|三連複|3連複|Result|Quinella)/.test(r.text)) return r.text;
  }
  return '';
}

async function fetchEnglishPaybackHtml(raceId, attempts) {
  const ymd = raceId.slice(0, 8);
  const urls = [
    `https://en.netkeiba.com/race/payback_list.html?kaisai_date=${ymd}`,
    `https://en.netkeiba.com/race/result.html?race_id=${encodeURIComponent(raceId)}`
  ];
  for (const u of urls) {
    const r = await fetchText(u, attempts, 'en-payback', { lang:'en-US,en;q=0.9,ja;q=0.6', referer:'https://en.netkeiba.com/' });
    if (r.ok && r.text.length > 3000 && /(Starting Prices|Quinella|Trio|Trifecta|Full Result)/i.test(r.text)) return r.text;
  }
  return '';
}

function parseOrderJapanese(html) {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const nums = [];
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
  return [];
}

function parsePayoutsJapanese(html) {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const out = { wide: [] };
  for (const row of rows) {
    const t = stripTags(row);
    if (!/(馬連|ワイド|三連複|3連複|三連単|3連単)/.test(t)) continue;
    const label = (t.match(/(馬連|ワイド|三連複|3連複|三連単|3連単)/) || [])[1];
    const combos = uniq((t.match(/\d{1,2}\s*[-－―–]\s*\d{1,2}(?:\s*[-－―–]\s*\d{1,2})?/g) || []).map(normalizeCombo));
    const amounts = (digits(t).match(/[0-9][0-9,]*\s*円/g) || []).map(yenToNum).filter(Boolean);
    if (label === '馬連' && combos[0]) out.umaren = { combo: combos[0], amount: amounts[0] || '' };
    if (/三連複|3連複/.test(label) && combos[0]) out.sanrenpuku = { combo: combos[0], amount: amounts[0] || '' };
    if (/三連単|3連単/.test(label) && combos[0]) out.sanrentan = { combo: combos[0], amount: amounts[0] || '' };
    if (label === 'ワイド') combos.slice(0, 3).forEach((c, i) => out.wide.push({ combo: c, amount: amounts[i] || '' }));
  }
  return out;
}

function englishSectionForRace(html, raceId) {
  let idx = html.indexOf(raceId);
  if (idx < 0) {
    // Some English pages may omit race_id in visible href after rendering. Keep a large safe chunk for single-race pages.
    if (/Starting Prices|Quinella|Trio/i.test(html) && !/payback_list\.html/i.test(html)) return html;
    return '';
  }
  const before = html.slice(0, idx);
  const after = html.slice(idx);
  const startCandidates = [before.lastIndexOf('FP'), before.lastIndexOf('Horse Fin'), before.lastIndexOf('<table'), before.lastIndexOf('RaceTable')].filter(n => n >= 0);
  const start = startCandidates.length ? Math.max(...startCandidates) : Math.max(0, idx - 12000);
  const nextIdRel = after.slice(20).search(/race_id=\d{12}|race_id&quot;:\s*&quot;\d{12}/);
  const nextFpRel = after.slice(20).search(/FP\s*BK\s*PP|Horse\s*Fin/i);
  let end = html.length;
  const rels = [nextIdRel, nextFpRel].filter(n => n >= 0);
  if (rels.length) end = idx + 20 + Math.min(...rels);
  return html.slice(start, Math.min(end, idx + 18000));
}

function parseOrderEnglish(section) {
  const lines = htmlLines(section);
  let pos = lines.findIndex(x => /^Mrg\.?$/i.test(x) || /FP\s*BK\s*PP/i.test(x));
  if (pos < 0) pos = 0;
  const order = [];
  for (const rank of ['1','2','3']) {
    let found = -1;
    for (let i = pos; i < Math.min(lines.length - 3, pos + 80); i++) {
      if (digits(lines[i]) === rank && isIntLine(lines[i+1], 1, 8) && isIntLine(lines[i+2], 1, 18) && !isIntLine(lines[i+3], 1, 18)) { found = i; break; }
    }
    if (found >= 0) {
      order.push(String(parseInt(digits(lines[found + 2]), 10)));
      pos = found + 3;
    }
  }
  return order.length >= 3 ? order.slice(0, 3) : [];
}

function takeBetweenText(text, label, nextLabels) {
  const re = new RegExp(label, 'i');
  const m = re.exec(text);
  if (!m) return '';
  let part = text.slice(m.index + m[0].length);
  let cut = part.length;
  for (const n of nextLabels) {
    const mm = new RegExp(n, 'i').exec(part);
    if (mm && mm.index >= 0) cut = Math.min(cut, mm.index);
  }
  return part.slice(0, cut);
}
function numsBeforeYen(block, need) {
  const yenMatches = [...block.matchAll(/(?:￥|¥)\s*[0-9][0-9,]*/g)];
  const amounts = yenMatches.map(m => yenToNum(m[0]));
  const beforeFirstYen = yenMatches[0] ? block.slice(0, yenMatches[0].index) : block;
  const nums = (beforeFirstYen.match(/\b\d{1,2}\b/g) || []).map(n => String(parseInt(n, 10))).filter(n => parseInt(n,10) >= 1 && parseInt(n,10) <= 18);
  return { nums: nums.slice(0, need), amounts };
}
function parsePayoutsEnglish(section) {
  const text = stripTags(section);
  const next = ['Win','Place','Bracket Quinella','Quinella Place','Quinella','Exacta','Trio','Trifecta','Starting Prices','Replay','Full Result'];
  const out = { wide: [] };

  const quinella = takeBetweenText(text, '\\bQuinella\\b(?! Place)', next.filter(x => x !== 'Quinella'));
  let q = numsBeforeYen(quinella, 2);
  if (q.nums.length >= 2) out.umaren = { combo: `${q.nums[0]}-${q.nums[1]}`, amount: q.amounts[0] || '' };

  const wide = takeBetweenText(text, 'Quinella Place', next.filter(x => x !== 'Quinella Place'));
  let w = numsBeforeYen(wide, 6);
  for (let i = 0; i + 1 < w.nums.length && out.wide.length < 3; i += 2) out.wide.push({ combo: `${w.nums[i]}-${w.nums[i+1]}`, amount: w.amounts[out.wide.length] || '' });

  const trio = takeBetweenText(text, '\\bTrio\\b', next.filter(x => x !== 'Trio'));
  let tr = numsBeforeYen(trio, 3);
  if (tr.nums.length >= 3) out.sanrenpuku = { combo: `${tr.nums[0]}-${tr.nums[1]}-${tr.nums[2]}`, amount: tr.amounts[0] || '' };

  const trifecta = takeBetweenText(text, '\\bTrifecta\\b', next.filter(x => x !== 'Trifecta'));
  let tf = numsBeforeYen(trifecta, 3);
  if (tf.nums.length >= 3) out.sanrentan = { combo: `${tf.nums[0]}-${tf.nums[1]}-${tf.nums[2]}`, amount: tf.amounts[0] || '' };
  return out;
}

function buildResult(raceId, order, p, source, bytes, attempts) {
  const firstNo = order[0] || '';
  const secondNo = order[1] || '';
  const thirdNo = order[2] || '';
  const result = {
    ok: !!(firstNo || p.umaren || p.sanrenpuku || (p.wide && p.wide.length)),
    empty: false,
    rev: REV,
    source,
    race_id: raceId,
    netkeibaRaceId: raceId,
    firstNo, secondNo, thirdNo,
    first: firstNo, second: secondNo, third: thirdNo,
    order: [firstNo, secondNo, thirdNo].filter(Boolean).join('-'),
    payouts: {},
    wide: p.wide || [],
    __httpStatus: 200,
    __bytes: bytes,
    __attempts: attempts
  };
  if (p.umaren) { result.umaren = p.umaren.combo; result.umarenAmount = p.umaren.amount; result.payouts.umaren = p.umaren; }
  if (p.sanrenpuku) { result.sanrenpuku = p.sanrenpuku.combo; result.sanrenpukuAmount = p.sanrenpuku.amount; result.payouts.sanrenpuku = p.sanrenpuku; }
  if (p.sanrentan) { result.sanrentan = p.sanrentan.combo; result.sanrentanAmount = p.sanrentan.amount; result.payouts.sanrentan = p.sanrentan; }
  if (result.wide.length) result.payouts.wide = result.wide;
  return result;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (!/^\/api\/(result|results|payout|payouts|payoff|refund|dividend)/.test(url.pathname)) {
      return json({ ok: true, rev: REV, endpoints: ['/api/result'], message: 'Rev749 result worker alive / root index.js / html diagnostic'  });
    }

    let body = {};
    try { body = await readBody(request); } catch (e) { return json({ ok:false, empty:true, rev:REV, reason:'BAD_BODY', error:s(e.message) }, 400); }
    const raceId = raceIdFromPayload(body, url);
    if (!/^\d{12}$/.test(raceId)) {
      return json({ ok:false, empty:true, rev:REV, reason:'MISSING_12_DIGIT_RACE_ID', received: body, query:Object.fromEntries(url.searchParams) }, 200);
    }

    const attempts = [];
    const jp = await fetchJapaneseHtml(raceId, attempts);
    if (jp) {
      const order = parseOrderJapanese(jp);
      const payouts = parsePayoutsJapanese(jp);
      const parsed = buildResult(raceId, order, payouts, 'jp-result', jp.length, attempts);
      if (parsed.firstNo || parsed.umaren || parsed.sanrenpuku || (parsed.wide && parsed.wide.length)) return json(parsed, 200);
      attempts.push({ tag:'jp-parse', status:'PARSE_EMPTY', bytes:jp.length });
    }

    const en = await fetchEnglishPaybackHtml(raceId, attempts);
    if (en) {
      const section = englishSectionForRace(en, raceId);
      if (section) {
        const order = parseOrderEnglish(section);
        const payouts = parsePayoutsEnglish(section);
        const parsed = buildResult(raceId, order, payouts, 'en-payback-list', section.length, attempts);
        parsed.__sectionBytes = section.length;
        parsed.__sectionHead = stripTags(section).slice(0, 160);
        if (parsed.firstNo || parsed.umaren || parsed.sanrenpuku || (parsed.wide && parsed.wide.length)) return json(parsed, 200);
        attempts.push({ tag:'en-parse', status:'PARSE_EMPTY', sectionBytes:section.length, sectionHead:stripTags(section).slice(0, 120) });
      } else {
        attempts.push({ tag:'en-section', status:'RACE_ID_NOT_FOUND', bytes:en.length });
      }
    }

    return json({
      ok:false,
      empty:true,
      rev:REV,
      race_id:raceId,
      reason:'ALL_SOURCES_EMPTY_OR_PARSE_EMPTY',
      received: body,
      query:Object.fromEntries(url.searchParams),
      __attempts:attempts,
      __htmlDiagnostics: attempts.map(a => ({tag:a.tag,status:a.status,bytes:a.bytes,finalUrl:a.finalUrl,title:a.title,containsRaceTable:a.containsRaceTable,containsPayback:a.containsPayback,containsUmaRen:a.containsUmaRen,containsWide:a.containsWide,containsSanrenpuku:a.containsSanrenpuku,head:a.head,error:a.error})),
      __diagnosticHint:'Rev749: HTML取得/redirect/block/parser判定用。bytesが短い場合はnetkeiba側block/redirect、bytesが大きくcontains=trueならparser側修正。',
      __bytes:0
    }, 200);
  }
};
