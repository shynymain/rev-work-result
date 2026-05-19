// Rev613 result Worker full replacement for Cloudflare Workers
// Endpoint: /api/result
// Fixes: canonical 12-digit netkeiba race_id, strict finish/payout parser, no global number scan.

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
      const htmlRaceId = normalizeRaceId12(pickRaceIdFromText(html) || expectedRaceId);
      const raceIdMatched = matchRaceId(expectedRaceId, htmlRaceId);
      const parsed = parseResultHtml(html);
      return json({
        ok: parsed.ok,
        source,
        result: parsed.result,
        diagnosis: {
          rev606:true, rev607:true, rev608:true, rev609:true, rev610:true, rev611:true, rev612:true, rev613:true,
          sourceBranch: targetUrl ? 'targetUrl' : 'race_id',
          expectedRaceId,
          workerRaceId: htmlRaceId,
          raceIdMatched,
          htmlStatus: fetched.status,
          htmlChars: html.length,
          encodingUsed: fetched.encodingUsed,
          parseReason: parsed.reason,
          sectionHits: parsed.sectionHits,
          finishProbe: parsed.finishProbe,
          payoutProbe: parsed.payoutProbe,
          parser: 'rev613_strict_result_table_finish_payout_table_only',
          htmlProbe: resultHtmlProbe(html)
        }
      });
    } catch (e) {
      return json({ ok:false, source:'', result:{wide:[]}, diagnosis:{rev606:true, rev607:true, rev608:true, rev609:true, rev610:true, rev611:true, rev612:true, rev613:true, error:String(e && e.message || e)} }, 200);
    }
  }
};

function json(obj, status=200){ return new Response(JSON.stringify(obj, null, 2), { status, headers:CORS_HEADERS }); }
function digits(v){ return String(v || '').replace(/\D/g, ''); }
function normalizeRaceId12(v){ const d=digits(v); if(d.length===16) return d.slice(0,4)+d.slice(8,16); if(d.length>=12) return d.slice(0,12); return d; }
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
  if (fromUrl.length >= 12) return normalizeRaceId12(fromUrl);
  const keys = ['canonicalRaceId12','raceId12','race_id','netkeibaRaceId','raceId','race_id16','raceId16','netkeibaRaceId16','nkRaceId16','race_id_full','netkeibaRaceIdFull','fullRaceId','expectedRaceId','requestRaceId','forceRaceId','strictRaceId','nkRaceId'];
  for (const k of keys) {
    const d = digits(first(getParam(u,k), body && body[k]));
    if (d.length >= 12) return normalizeRaceId12(d);
  }
  if (fromUrl) return normalizeRaceId12(fromUrl);
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
  a=normalizeRaceId12(a); b=normalizeRaceId12(b);
  return !!a && !!b && a === b;
}
async function fetchNetkeibaHtml(url){
  const res = await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0 Rev613Worker', 'Accept':'text/html,*/*' } });
  const buf = await res.arrayBuffer();
  let html = '';
  let encodingUsed = 'utf-8';
  try { html = new TextDecoder('euc-jp').decode(buf); encodingUsed='euc-jp'; }
  catch(e){ html = new TextDecoder('utf-8').decode(buf); encodingUsed='utf-8'; }
  if (!/払戻|着順|馬連|ワイド|単勝|複勝|RaceTable|ResultTable/.test(html)) {
    try { html = new TextDecoder('utf-8').decode(buf); encodingUsed='utf-8'; } catch(e) {}
  }
  return { status:res.status, html, encodingUsed };
}
function strip(s){ return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#039;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim(); }
function normalizeText(s){ return strip(s).replace(/[－ー―–]/g,'-').replace(/[，]/g,',').replace(/\s+/g,' ').trim(); }
function cellText(cell){ return normalizeText(cell); }
function cellClass(cell){ const m=String(cell||'').match(/class=["']([^"']+)["']/i); return m ? m[1] : ''; }
function extractCells(tr){ return [...String(tr||'').matchAll(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi)].map(m=>({raw:m[0], text:cellText(m[0]), cls:cellClass(m[0])})); }
function toIntHorseNo(s){ const m=String(s||'').match(/^(?:枠)?\s*([1-9]|1[0-8])\s*$/); return m ? Number(m[1]) : null; }
function isRankText(s, rank){ return new RegExp(`^(?:${rank}|${['','１','２','３'][rank]})\\s*(?:着)?$`).test(String(s||'').trim()); }
function moneyStrict(s){
  const t=String(s||'').replace(/払戻|配当|人気|番人気/g,' ');
  // 金額は円/カンマ/3桁以上だけ。4-15の15などを金額にしない。
  let m = t.match(/([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{2,8})\s*円/);
  if (m) return Number(m[1].replace(/,/g,''));
  m = t.match(/([1-9]\d{0,2}(?:,\d{3})+)/);
  if (m) return Number(m[1].replace(/,/g,''));
  return null;
}
function numbersInText(s){ return (String(s||'').match(/\b([1-9]|1[0-8])\b/g)||[]).map(Number); }
function comboStrictFromCells(cells, n){
  const joined = cells.map(c=>c.text).join(' ');
  let m = joined.match(n===3 ? /\b([1-9]|1[0-8])\s*[-ー－]\s*([1-9]|1[0-8])\s*[-ー－]\s*([1-9]|1[0-8])\b/ : /\b([1-9]|1[0-8])\s*[-ー－]\s*([1-9]|1[0-8])\b/);
  if (m) return m.slice(1,1+n).map(Number).join('-');
  const nums=[];
  for (const c of cells) {
    const t=c.text.replace(/人気|円|払戻|配当/g,' ');
    const ns=numbersInText(t);
    for(const x of ns){ if(nums.length<n) nums.push(x); }
    if(nums.length>=n) break;
  }
  return nums.length>=n ? nums.slice(0,n).join('-') : '';
}


function extractTables(html){ return String(html||'').match(/<table\b[\s\S]*?<\/table>/gi) || []; }
function findHeaderIndexes(rows){
  for (let r=0; r<Math.min(rows.length, 6); r++) {
    const cells = extractCells(rows[r]);
    if (cells.length < 2) continue;
    const texts = cells.map(c=>c.text);
    const rankIdx = texts.findIndex(t=>/^(着順|順位|着)$/.test(t) || /着順/.test(t));
    let horseNoIdx = texts.findIndex(t=>/^(馬番|馬\s*番)$/.test(t) || /馬番/.test(t));
    const horseNameIdx = texts.findIndex(t=>/馬名|馬\s*名/.test(t));
    // netkeiba結果表は「着順 / 枠 / 馬番 / 馬名」の形が多い。枠列を馬番扱いしない。
    if (rankIdx >= 0 && horseNoIdx >= 0) return { row:r, rankIdx, horseNoIdx, horseNameIdx };
    if (rankIdx >= 0 && horseNameIdx >= 0 && horseNameIdx >= rankIdx + 2) {
      horseNoIdx = horseNameIdx - 1;
      return { row:r, rankIdx, horseNoIdx, horseNameIdx };
    }
  }
  return null;
}
function parseFinishStrict(html){
  const out = { first:null, second:null, third:null, probe:[] };
  const tables = extractTables(html);
  for (let ti=0; ti<tables.length; ti++) {
    const table = tables[ti];
    const tableText = normalizeText(table);
    if (/払戻|配当|単勝|複勝|馬連|ワイド|三連複|3連複|三連単|3連単/.test(tableText) && !/馬名/.test(tableText)) continue;
    if (!(/着順|順位|馬番|馬名/.test(tableText) || /Result|RaceTable|All_Result|ResultTable|Race_Result/i.test(table))) continue;
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const header = findHeaderIndexes(rows);
    if (header) {
      for (let r=header.row+1; r<rows.length; r++) {
        const cells = extractCells(rows[r]);
        if (cells.length <= Math.max(header.rankIdx, header.horseNoIdx)) continue;
        const rankRaw = cells[header.rankIdx]?.text || '';
        const rank = toRank(rankRaw);
        if (![1,2,3].includes(rank)) continue;
        const horseNo = toIntHorseNo(cells[header.horseNoIdx]?.text || '');
        if (horseNo === null) continue;
        if (rank===1 && !out.first) out.first = horseNo;
        if (rank===2 && !out.second) out.second = horseNo;
        if (rank===3 && !out.third) out.third = horseNo;
        out.probe.push({method:'header-index', table:ti, rank, horseNo, rankRaw, horseNoRaw:cells[header.horseNoIdx]?.text, row:cells.map(c=>c.text).slice(0,10)});
      }
    }
    // headerが取れない場合だけ、rank後の数値列から推定。ただし「枠→馬番」の順を考慮して2個目を優先。
    if (!out.first || !out.second || !out.third) {
      for (let r=0; r<rows.length; r++) {
        const cells = extractCells(rows[r]);
        if (cells.length < 4) continue;
        const rankIdx = cells.findIndex(c=>toRank(c.text) !== null && !/人気|斤量|年齢|性齢|タイム/.test(c.text));
        if (rankIdx < 0) continue;
        const rank = toRank(cells[rankIdx].text);
        if (![1,2,3].includes(rank)) continue;
        const nums=[];
        for (let i=rankIdx+1; i<Math.min(cells.length, rankIdx+6); i++) {
          if (/人気|着差|タイム|斤量|馬体重|通過/.test(cells[i].text)) continue;
          if (/Waku|Frame|枠/i.test(cells[i].cls)) continue;
          const n=toIntHorseNo(cells[i].text);
          if (n!==null) nums.push({n, idx:i, text:cells[i].text, cls:cells[i].cls});
        }
        const picked = nums.find(x=>/Uma|Umaban|Horse_Num|HorseNo|馬番/i.test(x.cls)) || nums[0];
        if (!picked) continue;
        const horseNo=picked.n;
        if (rank===1 && !out.first) out.first=horseNo;
        if (rank===2 && !out.second) out.second=horseNo;
        if (rank===3 && !out.third) out.third=horseNo;
        out.probe.push({method:'class-fallback', table:ti, rank, horseNo, picked, row:cells.map(c=>`${c.text}${c.cls?'('+c.cls+')':''}`).slice(0,10)});
      }
    }
    if (out.first && out.second && out.third) break;
  }
  // 1,2,3 がそのまま入っただけ等の低信頼パターンは破棄。
  const vals=[out.first,out.second,out.third].filter(Boolean);
  if (vals.length===3 && vals.join('-')==='1-2-3') {
    out.probe.push({method:'guard-drop', reason:'sequential-rank-like-finish', values:vals});
    out.first=out.second=out.third=null;
  }
  return out;
}
function toRank(s){
  const t=String(s||'').trim().replace(/[１]/g,'1').replace(/[２]/g,'2').replace(/[３]/g,'3');
  const m=t.match(/^([123])\s*(?:着|位)?$/);
  return m ? Number(m[1]) : null;
}
function resultHtmlProbe(html){
  const h=String(html||'');
  const around=(pat)=>{const i=h.search(pat); if(i<0)return ''; return strip(h.slice(Math.max(0,i-400),i+1200)).slice(0,1200);};
  return {
    hasResultTable:/ResultTable|RaceTable|払戻|着順|確定/.test(h),
    trCount:(h.match(/<tr\b/gi)||[]).length,
    moneyLikeCount:(h.match(/\d{2,9}\s*円/g)||[]).length,
    comboLikeCount:(h.match(/\b(?:[1-9]|1[0-8])[-ー](?:[1-9]|1[0-8])(?:[-ー](?:[1-9]|1[0-8]))?\b/g)||[]).length,
    sampleResult:around(/着順|確定|ResultTable|RaceTable/),
    samplePayout:around(/払戻|馬連|ワイド|三連複|3連複|三連単|3連単/)
  };
}

function parseResultHtml(html){
  const result = { first:null, second:null, third:null, umaren:null, wide:[], sanrenpuku:null, payouts:{} };
  const text = normalizeText(html);
  const trs = String(html||'').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const sectionHits = {
    umaren:/馬\s*連|馬連/.test(text),
    wide:/ワイド/.test(text),
    sanrenpuku:/3\s*連\s*複|三連複|3連複/.test(text),
    order:/着順|確定|Result_Table|ResultTable|RaceTable/.test(html)
  };
  const finishProbe=[];
  const payoutProbe=[];

  // 1) 着順は結果テーブルの「馬番」列だけを採用。枠/人気/通過順を馬番にしない。
  const strictFinish = parseFinishStrict(html);
  if (strictFinish.first) result.first = strictFinish.first;
  if (strictFinish.second) result.second = strictFinish.second;
  if (strictFinish.third) result.third = strictFinish.third;
  finishProbe.push(...strictFinish.probe);

  // 2) 払戻はラベル行/隣接行だけ。全体数字スキャン禁止。
  for (let i=0;i<trs.length;i++) {
    const cells=extractCells(trs[i]);
    if (!cells.length) continue;
    const line=cells.map(c=>c.text).join(' ');
    const nextCells = extractCells(trs[i+1]||'');
    const areaCells = cells.concat(nextCells.slice(0, Math.max(0, 8-cells.length)));
    const areaText=areaCells.map(c=>c.text).join(' ');
    if (/馬\s*連|馬連/.test(line) && !result.umaren) {
      const b=parseBetCells(areaCells,2); if (b) { result.umaren=b; payoutProbe.push({type:'umaren', bet:b, cells:areaCells.map(c=>c.text).slice(0,8)}); }
    }
    if (/ワイド/.test(line) && result.wide.length < 3) {
      const wides=parseWideCells(areaCells); for(const w of wides){ if(result.wide.length<3) result.wide.push(w); }
      if (wides.length) payoutProbe.push({type:'wide', bet:wides, cells:areaCells.map(c=>c.text).slice(0,12)});
    }
    if (/3\s*連\s*複|三連複|3連複/.test(line) && !result.sanrenpuku) {
      const b=parseBetCells(areaCells,3); if (b) { result.sanrenpuku=b; payoutProbe.push({type:'sanrenpuku', bet:b, cells:areaCells.map(c=>c.text).slice(0,8)}); }
    }
  }

  // 3) ラベル周辺テキストfallback。金額guardを満たすもののみ。
  if (!result.umaren) result.umaren = parseLabeledBet(text, /馬\s*連|馬連/, 2);
  if (!result.sanrenpuku) result.sanrenpuku = parseLabeledBet(text, /3\s*連\s*複|三連複|3連複/, 3);
  if (!result.wide.length) {
    const wideArea = sliceBetween(text, /ワイド/, /馬\s*単|3\s*連\s*複|三連複|3連複|3\s*連\s*単|三連単|3連単/);
    const chunks = wideArea ? wideArea.split(/(?=\b(?:[1-9]|1[0-8])\s*[-ー－]\s*(?:[1-9]|1[0-8])\b)/).slice(0,4) : [];
    for(const ch of chunks){ const w=parseBetText(ch,2); if(w && result.wide.length<3) result.wide.push(w); }
  }

  const ok = !!(result.umaren || result.wide.length || result.sanrenpuku || result.first || result.second || result.third);
  return { ok, result, reason: ok ? 'parsed_by_rev613_strict_finish_payout_table' : 'html_fetched_but_result_labels_not_parsed', sectionHits, finishProbe, payoutProbe };
}
function parseBetCells(cells,n){
  const c=comboStrictFromCells(cells,n);
  let amount=null;
  for (const cell of cells) { const a=moneyStrict(cell.text); if(a!==null){ amount=a; break; } }
  return c && amount!==null ? { combo:c, amount } : null;
}
function parseWideCells(cells){
  const text=cells.map(c=>c.text).join(' ');
  const out=[];
  const re=/\b([1-9]|1[0-8])\s*[-ー－]\s*([1-9]|1[0-8])\b[\s\S]{0,40}?([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{2,8})\s*円/g;
  let m; while((m=re.exec(text)) && out.length<3){ out.push({combo:`${Number(m[1])}-${Number(m[2])}`, amount:Number(m[3].replace(/,/g,''))}); }
  if (out.length) return out;
  const b=parseBetCells(cells,2); return b ? [b] : [];
}
function parseBetText(text,n){
  const c=comboStrictFromCells([{text:String(text||'')}],n);
  const a=moneyStrict(text);
  return c && a!==null ? {combo:c, amount:a} : null;
}
function sliceBetween(text, startRe, endRe){
  const m = text.search(startRe); if (m < 0) return '';
  const rest = text.slice(m, m+1500);
  const e = rest.slice(10).search(endRe);
  return e >= 0 ? rest.slice(0, e+10) : rest;
}
function parseLabeledBet(text, labelRe, n){
  const area = sliceBetween(text, labelRe, /ワイド|馬\s*単|3\s*連\s*複|三連複|3連複|3\s*連\s*単|三連単|3連単|単勝|複勝/);
  if (!area) return null;
  return parseBetText(area,n);
}
