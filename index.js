// Rev610 result Worker full replacement for Cloudflare Workers
// Endpoint: /api/result
// Fixes: 16-digit race_id priority, no 12-digit truncation, CORS, parser diagnostics.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8'
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response('', { headers: CORS_HEADERS });
    try {
      const reqUrl = new URL(request.url);
      let body = {};
      if (request.method === 'POST') {
        try { body = await request.json(); } catch (_) { body = {}; }
      }
      const targetUrl = pickTargetUrl(reqUrl, body, 'result.html');
      const expectedRaceId = pickRaceId(reqUrl, body, targetUrl);
      if (!targetUrl && !expectedRaceId) {
        return json({ ok:false, source:'', result:{wide:[]}, diagnosis:{ parseReason:'missing explicit race_id/netkeibaRaceId/targetUrl', requestRaceId:'', key:'' } });
      }
      const source = targetUrl || `https://race.netkeiba.com/race/result.html?race_id=${expectedRaceId}&rf=race_submenu`;
      const fetched = await fetchNetkeibaHtml(source);
      const html = fetched.html || '';
      const htmlRaceId = pickRaceIdFromText(html) || expectedRaceId;
      const raceIdMatched = matchRaceId(expectedRaceId, htmlRaceId);
      const parsed = parseResultHtml(html);
      return json({
        ok: parsed.ok,
        source,
        result: parsed.result,
        diagnosis: {
          rev606:true, rev607:true, rev608:true, rev609:true, rev610:true,
          sourceBranch: targetUrl ? 'targetUrl' : 'race_id',
          expectedRaceId,
          workerRaceId: htmlRaceId,
          raceIdMatched,
          htmlStatus: fetched.status,
          htmlChars: html.length,
          encodingUsed: fetched.encodingUsed,
          parseReason: parsed.reason,
          sectionHits: parsed.sectionHits,
          parser: 'rev610_table_label_probe', htmlProbe: resultHtmlProbe(html)
        }
      });
    } catch (e) {
      return json({ ok:false, source:'', result:{wide:[]}, diagnosis:{rev606:true, rev607:true, rev608:true, rev609:true, rev610:true, error:String(e && e.message || e)} }, 200);
    }
  }
};

function json(obj, status=200){ return new Response(JSON.stringify(obj, null, 2), { status, headers:CORS_HEADERS }); }
function digits(v){ return String(v || '').replace(/\D/g, ''); }
function dec(v){ try { return decodeURIComponent(String(v || '')); } catch(e){ return String(v || ''); } }
function first(...vals){ for (const v of vals){ if (v !== undefined && v !== null && String(v).trim() !== '') return String(v); } return ''; }
function getParam(u, k){ return u.searchParams.get(k) || ''; }
function pickTargetUrl(u, body, page){
  const keys = ['targetUrl','url','sourceUrl','fetchUrl','netkeibaUrl','pageUrl'];
  for (const k of keys) {
    const v = dec(first(getParam(u,k), body && body[k]));
    if (/^https?:\/\//i.test(v)) return normalizePage(v, page);
  }
  const rid = pickRaceId(u, body, '');
  return rid ? `https://race.netkeiba.com/race/${page}?race_id=${rid}&rf=race_submenu` : '';
}
function normalizePage(url, page){ return String(url).replace(/\/(shutuba|odds|result)\.html/i, `/${page}`); }
function pickRaceId(u, body, targetUrl){
  const fromUrl = pickRaceIdFromText(targetUrl);
  if (fromUrl.length === 16) return fromUrl;
  const keys = ['race_id','netkeibaRaceId','raceId','race_id16','raceId16','netkeibaRaceId16','nkRaceId16','race_id_full','netkeibaRaceIdFull','fullRaceId','expectedRaceId','requestRaceId','forceRaceId','strictRaceId','nkRaceId'];
  for (const k of keys) {
    const d = digits(first(getParam(u,k), body && body[k]));
    if (d.length >= 16) return d.slice(0,16);
  }
  if (fromUrl) return fromUrl;
  for (const k of keys) {
    const d = digits(first(getParam(u,k), body && body[k]));
    if (d.length >= 12) return d;
  }
  return '';
}
function pickRaceIdFromText(text){
  const s = dec(text || '');
  let m = s.match(/race_id[=:%22'"&]+(\d{16})/i) || s.match(/RaceId[=:%22'"&]+(\d{16})/i);
  if (m) return m[1];
  m = s.match(/race_id[=:%22'"&]+(\d{12,16})/i) || s.match(/RaceId[=:%22'"&]+(\d{12,16})/i);
  return m ? m[1] : '';
}
function matchRaceId(a,b){
  a=digits(a); b=digits(b);
  if (!a || !b) return false;
  if (a===b) return true;
  if (a.length===16 && b.length===12 && a.startsWith(b)) return true;
  if (b.length===16 && a.length===12 && b.startsWith(a)) return true;
  return false;
}
async function fetchNetkeibaHtml(url){
  const res = await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0 Rev608Worker', 'Accept':'text/html,*/*' } });
  const buf = await res.arrayBuffer();
  let html = '';
  let encodingUsed = 'utf-8';
  try { html = new TextDecoder('euc-jp').decode(buf); encodingUsed='euc-jp'; }
  catch(e){ html = new TextDecoder('utf-8').decode(buf); encodingUsed='utf-8'; }
  if (!/払戻|着順|馬連|ワイド|単勝|複勝/.test(html)) {
    try { html = new TextDecoder('utf-8').decode(buf); encodingUsed='utf-8'; } catch(e) {}
  }
  return { status:res.status, html, encodingUsed };
}
function strip(s){ return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#039;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim(); }
function money(s){ const m=String(s||'').replace(/,/g,'').match(/(\d{2,9})\s*円?/); return m?Number(m[1]):''; }
function combo(s, n){ const nums=(String(s||'').match(/\b([1-9]|1[0-8])\b/g)||[]).map(Number); return nums.length>=n ? nums.slice(0,n).join('-') : ''; }

function resultHtmlProbe(html){
  const h=String(html||'');
  const around=(pat)=>{const i=h.search(pat); if(i<0)return ''; return strip(h.slice(Math.max(0,i-500),i+1500)).slice(0,1600);};
  return {
    hasResultTable:/ResultTable|RaceTable|払戻|着順|確定/.test(h),
    horseLinkCount:(h.match(/\/horse\/\d+/g)||[]).length,
    moneyLikeCount:(h.match(/\d{2,9}\s*円/g)||[]).length,
    comboLikeCount:(h.match(/(?:[1-9]|1[0-8])[-ー](?:[1-9]|1[0-8])(?:[-ー](?:[1-9]|1[0-8]))?/g)||[]).length,
    sampleResult:around(/着順|確定|ResultTable|RaceTable/),
    samplePayout:around(/払戻|馬連|ワイド|三連複|3連複|三連単|3連単/)
  };
}

function parseResultHtml(html){
  const result = { first:null, second:null, third:null, umaren:null, wide:[], sanrenpuku:null, payouts:{} };
  const text = strip(html);
  const sectionHits = {
    umaren:/馬\s*連|馬連/.test(text),
    wide:/ワイド/.test(text),
    sanrenpuku:/3\s*連\s*複|三連複|3連複/.test(text),
    order:/着順|確定|Result_Table/.test(html)
  };

  const tableParsed = parseResultTables(html);
  Object.assign(result, tableParsed);

  if (!result.umaren) result.umaren = parseLabeledBet(text, /馬\s*連|馬連/, 2);
  if (!result.wide.length) {
    const wideArea = sliceBetween(text, /ワイド/, /馬\s*単|3\s*連\s*複|三連複|3連複|3\s*連\s*単|三連単|3連単/);
    if (wideArea) {
      const pairs = [...wideArea.matchAll(/((?:\b(?:[1-9]|1[0-8])\b\s*){2}).{0,50}?(\d{2,9})\s*円?/g)].slice(0,3);
      result.wide = pairs.map(m => ({ combo: combo(m[1],2), amount: Number(m[2]) })).filter(x=>x.combo&&x.amount);
    }
  }
  if (!result.sanrenpuku) result.sanrenpuku = parseLabeledBet(text, /3\s*連\s*複|三連複|3連複/, 3);
  if (!result.first) {
    const orderArea = sliceBetween(text, /着順|確定|Result_Table/, /払戻|配当|単勝/);
    const orderNums = (orderArea.match(/\b([1-9]|1[0-8])\b/g)||[]).map(Number);
    if (orderNums.length >= 3) { result.first=orderNums[0]; result.second=orderNums[1]; result.third=orderNums[2]; }
  }
  const ok = !!(result.umaren || result.wide.length || result.sanrenpuku || result.first);
  return { ok, result, reason: ok ? 'parsed_by_rev608_table_label_fallback' : 'html_fetched_but_result_labels_not_parsed', sectionHits };
}
function parseResultTables(html){
  const out = { first:null, second:null, third:null, umaren:null, wide:[], sanrenpuku:null, payouts:{} };
  const trs = String(html||'').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trs) {
    const cells = [...tr.matchAll(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi)].map(m=>strip(m[0]));
    const line = cells.join(' ');
    if (!line) continue;
    if (/^(1|１)\s*着|\b1\b/.test(line) && /\b([1-9]|1[0-8])\b/.test(line) && !out.first) {
      const n = line.match(/\b([1-9]|1[0-8])\b/); if (n) out.first=Number(n[1]);
    }
    if (/^(2|２)\s*着|\b2\b/.test(line) && /\b([1-9]|1[0-8])\b/.test(line) && !out.second) {
      const n = line.match(/\b([1-9]|1[0-8])\b/); if (n) out.second=Number(n[1]);
    }
    if (/^(3|３)\s*着|\b3\b/.test(line) && /\b([1-9]|1[0-8])\b/.test(line) && !out.third) {
      const n = line.match(/\b([1-9]|1[0-8])\b/); if (n) out.third=Number(n[1]);
    }
    if (/馬\s*連|馬連/.test(line) && !out.umaren) out.umaren = parseBetLine(line,2);
    if (/ワイド/.test(line) && out.wide.length < 3) {
      const w = parseBetLine(line,2); if (w) out.wide.push(w);
    }
    if (/3\s*連\s*複|三連複|3連複/.test(line) && !out.sanrenpuku) out.sanrenpuku = parseBetLine(line,3);
  }
  // payout table sometimes has label row then following cells; use compressed text fallback.
  return out;
}
function parseBetLine(line,n){ const c=combo(line,n); const a=money(line); return c&&a ? { combo:c, amount:a } : null; }
function sliceBetween(text, startRe, endRe){
  const m = text.search(startRe); if (m < 0) return '';
  const rest = text.slice(m, m+1200);
  const e = rest.slice(10).search(endRe);
  return e >= 0 ? rest.slice(0, e+10) : rest;
}
function parseLabeledBet(text, labelRe, n){
  const area = sliceBetween(text, labelRe, /ワイド|馬\s*単|3\s*連\s*複|三連複|3連複|3\s*連\s*単|三連単|3連単|単勝|複勝/);
  if (!area) return null;
  const c = combo(area, n); const a = money(area);
  return c && a ? { combo:c, amount:a } : null;
}
