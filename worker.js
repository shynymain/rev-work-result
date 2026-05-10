const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function normalizeText(s = '') {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\t\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normRaceId(raceId = '') { return String(raceId).replace(/[^0-9]/g, ''); }
function buildNetkeibaUrl(raceId) {
  const id = normRaceId(raceId);
  return id ? `https://race.netkeiba.com/race/result.html?race_id=${id}&rf=race_submenu` : '';
}
function yen(s = '') { return String(s).replace(/[円,，\s]/g, '').replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/[^0-9]/g, ''); }
function combo(s = '') { return String(s).replace(/[－―—ー−]/g, '-').replace(/[→つ一]/g, '-').replace(/\s+/g, '').replace(/^-|-$/g, ''); }
function normalizeCombo(c) {
  const nums = String(c).match(/\d{1,2}/g) || [];
  return nums.join('-');
}
function parsePairsNear(label, text, max = 6) {
  const idx = text.indexOf(label);
  if (idx < 0) return [];
  const endLabels = ['単勝','複勝','枠連','馬連','馬単','ワイド','3連複','三連複','3連単','三連単'].filter(x => x !== label);
  let end = text.length;
  for (const l of endLabels) {
    const p = text.indexOf(l, idx + label.length);
    if (p > idx && p < end) end = p;
  }
  const sec = text.slice(idx, end);
  const out = [];
  const re = /(\d{1,2})\s*[-－―—ー−一]\s*(\d{1,2})(?:\s*[-－―—ー−一]\s*(\d{1,2}))?\s*([0-9,，\.]{2,})\s*円?/g;
  let m;
  while ((m = re.exec(sec)) && out.length < max) {
    const c = [m[1], m[2], m[3]].filter(Boolean).join('-');
    const amount = yen(m[4]);
    if (c && amount) out.push({ combination: c, amount });
  }
  return out;
}
function parseResult(html) {
  const text = normalizeText(html);
  const result = { wide: [] };

  // 着順: HTML構造が取れない場合は払戻から推定
  const sanrentan = parsePairsNear('3連単', text, 1)[0] || parsePairsNear('三連単', text, 1)[0];
  const sanrenpuku = parsePairsNear('3連複', text, 1)[0] || parsePairsNear('三連複', text, 1)[0];
  const umaren = parsePairsNear('馬連', text, 1)[0];
  const umatan = parsePairsNear('馬単', text, 1)[0];
  const wide = parsePairsNear('ワイド', text, 6);

  if (sanrentan) {
    const ns = sanrentan.combination.split('-');
    result.firstNo = ns[0] || '';
    result.secondNo = ns[1] || '';
    result.thirdNo = ns[2] || '';
    result.sanrentan = sanrentan.combination;
    result.sanrentanPay = sanrentan.amount;
  } else if (umatan) {
    const ns = umatan.combination.split('-');
    result.firstNo = ns[0] || '';
    result.secondNo = ns[1] || '';
  }

  if (umaren) { result.umaren = umaren.combination; result.umarenPay = umaren.amount; }
  if (sanrenpuku) { result.sanrenpuku = sanrenpuku.combination; result.sanrenpukuPay = sanrenpuku.amount; }
  if (wide.length) {
    result.wide = wide;
    result.widePay = wide.map(w => w.amount).join(' / ');
  }
  const tansho = text.match(/単勝\s*(\d{1,2})\s*([0-9,，]+)\s*円/);
  if (tansho) { result.firstNo = result.firstNo || tansho[1]; result.tanshoPay = yen(tansho[2]); }
  return result;
}

async function handle(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const u = new URL(req.url);
  if (u.pathname === '/' || u.pathname === '/api/health') return json({ ok: true, service: 'rev-work-result', routes: ['/api/result'] });
  if (u.pathname !== '/api/result' && u.pathname !== '/api/fetchResult') return json({ ok: false, error: 'not_found' }, 404);
  let body = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch {} }
  const raceId = body.raceId || u.searchParams.get('raceId') || '';
  const targetUrl = body.url || u.searchParams.get('url') || buildNetkeibaUrl(raceId);
  if (!targetUrl) return json({ ok: false, error: 'url_or_raceId_required', usage: { get: '/api/result?raceId=2026050305020409', post: { raceId: '2026050305020409' } } }, 400);
  const res = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0 Rev-VAN result worker' } });
  const html = await res.text();
  const result = parseResult(html);
  return json({ ok: true, source: targetUrl, result });
}

export default { fetch: handle };
