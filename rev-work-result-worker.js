/**
 * Rev425 rev-work-result worker replacement
 * Endpoint: /api/result
 * Purpose:
 * - Prefer explicit targetUrl / race_id / netkeibaRaceId from frontend.
 * - Do NOT rebuild short race_id like 2026050310 when a 12-digit race_id is supplied.
 * - Return ok:false for empty payout results.
 * - Emit diagnostics: htmlChars, tableFound, raceIdMatched, parseReason.
 */
const PLACE_CODE = {
  '札幌':'01','函館':'02','福島':'03','新潟':'04','東京':'05','中山':'06','中京':'07','京都':'08','阪神':'09','小倉':'10'
};
const KNOWN_NETKEIBA_RACE_ID = {
  '20260503_新潟_10R': '202604010210'
};
function json(data, status=200){
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type':'application/json; charset=utf-8',
      'access-control-allow-origin':'*',
      'access-control-allow-methods':'GET,OPTIONS',
      'access-control-allow-headers':'content-type'
    }
  });
}
function S(v){ return v == null ? '' : String(v).trim(); }
function z2(v){ const n=parseInt(S(v).replace(/\D/g,''),10)||0; return String(n).padStart(2,'0'); }
function normRaceNo(v){ return z2(v); }
function compactDate(v){ return S(v).replace(/\D/g,'').slice(0,8); }
function raceIdKey(p){
  const date=compactDate(p.get('date'));
  const place=S(p.get('place'));
  const raceNo=(S(p.get('raceNo'))||S(p.get('race'))).replace(/[^0-9]/g,'');
  return [date,place,(raceNo?parseInt(raceNo,10)+'R':'')].filter(Boolean).join('_');
}
function explicitRaceId(p){
  return S(p.get('race_id')) || S(p.get('netkeibaRaceId')) || S(p.get('netkeiba_race_id')) || KNOWN_NETKEIBA_RACE_ID[raceIdKey(p)] || '';
}
function targetUrlForNetkeiba(p){
  const explicitTarget=S(p.get('targetUrl'));
  if(explicitTarget && /race\.netkeiba\.com\/race\/result\.html/.test(explicitTarget)) return explicitTarget;
  const rid=explicitRaceId(p);
  if(rid) return `https://race.netkeiba.com/race/result.html?race_id=${encodeURIComponent(rid)}&rf=race_submenu`;
  return '';
}
function stripTags(html){
  return S(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&yen;/g,'円').replace(/\s+/g,' ');
}
function normalizeText(html){
  return stripTags(html).replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[－―ー−–]/g,'-');
}
function combo2(s){
  const nums=(S(s).match(/\b(?:[1-9]|1[0-8])\b/g)||[]).map(n=>String(parseInt(n,10)));
  if(nums.length<2) return '';
  return nums.slice(0,2).sort((a,b)=>parseInt(a)-parseInt(b)).join('-');
}
function combo3(s){
  const nums=(S(s).match(/\b(?:[1-9]|1[0-8])\b/g)||[]).map(n=>String(parseInt(n,10)));
  if(nums.length<3) return '';
  return nums.slice(0,3).sort((a,b)=>parseInt(a)-parseInt(b)).join('-');
}
function money(s){
  const m=S(s).replace(/,/g,'').match(/([1-9][0-9]{2,8})\s*円?/);
  if(!m) return '';
  const n=parseInt(m[1],10);
  if(n<100) return '';
  return n.toLocaleString('ja-JP')+'円';
}
function entry(combo, pay){ return combo && pay ? `${combo} ${pay}` : ''; }
function section(t, startRe, endRes){
  const m=t.search(startRe); if(m<0) return '';
  let end=t.length;
  for(const re of endRes){ const i=t.slice(m+1).search(re); if(i>=0) end=Math.min(end,m+1+i); }
  return t.slice(m,end);
}
function parsePayoutsFromText(text){
  const t=normalizeText(text);
  const out={wide:[]};
  const um=section(t,/馬\s*連|馬連|うまれん/i,[/ワイド|3\s*連\s*複|三連複|馬\s*単|3\s*連\s*単/i]);
  const wi=section(t,/ワイド/i,[/3\s*連\s*複|三連複|馬\s*単|3\s*連\s*単/i]);
  const tri=section(t,/3\s*連\s*複|三連複/i,[/3\s*連\s*単|馬\s*単/i]);
  const pairRe=/((?:[1-9]|1[0-8])\s*-\s*(?:[1-9]|1[0-8]))[^0-9円]{0,40}([1-9][0-9,]{2,8})\s*円?/g;
  const triRe=/((?:[1-9]|1[0-8])\s*-\s*(?:[1-9]|1[0-8])\s*-\s*(?:[1-9]|1[0-8]))[^0-9円]{0,40}([1-9][0-9,]{2,8})\s*円?/g;
  let m;
  if(um && (m=pairRe.exec(um))) out.umaren=entry(combo2(m[1]), money(m[2]+'円'));
  while(wi && (m=pairRe.exec(wi))){ const e=entry(combo2(m[1]), money(m[2]+'円')); if(e && !out.wide.some(x=>x.split(' ')[0]===e.split(' ')[0])) out.wide.push(e); }
  if(tri && (m=triRe.exec(tri))) out.sanrenpuku=entry(combo3(m[1]), money(m[2]+'円'));
  return out;
}

function decodeEscapes(s){
  s=S(s);
  try{ s=s.replace(/\\u([0-9a-fA-F]{4})/g,(_,h)=>String.fromCharCode(parseInt(h,16))); }catch(e){}
  return s
    .replace(/&nbsp;|&#160;/g,' ')
    .replace(/&amp;/g,'&')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&yen;/g,'円');
}
function rawNormalize(html){ return decodeEscapes(html).replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[－―ー−–]/g,'-'); }
function aroundLabel(raw, labelRe, span=900){
  const t=rawNormalize(raw);
  const m=t.search(labelRe);
  if(m<0) return '';
  return t.slice(Math.max(0,m-span), Math.min(t.length,m+span));
}
function collectLabelSnippets(raw){
  const t=rawNormalize(raw);
  const labels=[['harai','払戻|払い戻し|払戻金'],['umaren','馬\\s*連|馬連'],['wide','ワイド'],['tri','3\\s*連\\s*複|三連複'],['payback','Pay_Back|payback|Payout|Result_Pay_Back|Race_Harai']];
  const out={};
  for(const [k,pat] of labels){
    const re=new RegExp(pat,'i');
    const i=t.search(re);
    out[k]= i>=0 ? stripTags(t.slice(Math.max(0,i-250), Math.min(t.length,i+450))).slice(0,700) : '';
  }
  return out;
}
function findPaybackBlocks(raw){
  const h=rawNormalize(raw);
  const blocks=[];
  const pats=[
    /<[^>]*(?:Result[_-]?Pay[_-]?Back|Pay[_-]?Back|Race[_-]?Harai|払い戻し|払戻)[^>]*>[\s\S]{0,12000}/ig,
    /(?:払戻|払い戻し|払戻金)[\s\S]{0,12000}/ig,
    /(?:馬\s*連|馬連)[\s\S]{0,8000}/ig
  ];
  for(const re of pats){
    let m; let guard=0;
    while((m=re.exec(h)) && guard++<8){
      blocks.push(m[0]);
    }
  }
  return blocks;
}
function allPairEntries(s){
  const t=normalizeText(s);
  const out=[];
  const re=/((?:[1-9]|1[0-8])\s*[-－]\s*(?:[1-9]|1[0-8]))[\s\S]{0,80}?([1-9][0-9,]{2,8})\s*円?/g;
  let m;
  while((m=re.exec(t))){ const e=entry(combo2(m[1]), money(m[2]+'円')); if(e) out.push(e); }
  return out;
}
function allTriEntries(s){
  const t=normalizeText(s);
  const out=[];
  const re=/((?:[1-9]|1[0-8])\s*[-－]\s*(?:[1-9]|1[0-8])\s*[-－]\s*(?:[1-9]|1[0-8]))[\s\S]{0,100}?([1-9][0-9,]{2,8})\s*円?/g;
  let m;
  while((m=re.exec(t))){ const e=entry(combo3(m[1]), money(m[2]+'円')); if(e) out.push(e); }
  return out;
}

function firstMoneyIndex(sec){
  const m=S(sec).match(/([1-9][0-9,]{2,8})\s*円/);
  return m ? S(sec).indexOf(m[0]) : -1;
}
function numbersBeforeFirstMoney(sec){
  const t=S(sec);
  const idx=firstMoneyIndex(t);
  const head=idx>=0 ? t.slice(0, idx) : t;
  return (head.match(/\b(?:[1-9]|1[0-8])\b/g)||[]).map(n=>String(parseInt(n,10)));
}
function moneyList(sec){
  const out=[]; let m;
  const re=/([1-9][0-9,]{2,8})\s*円/g;
  while((m=re.exec(S(sec)))){
    const pay=money(m[1]+'円');
    if(pay) out.push(pay);
  }
  return out;
}
function afterLabelSection(text, labelRe, endRes){
  const t=normalizeText(text);
  labelRe.lastIndex=0;
  const m=labelRe.exec(t);
  if(!m) return '';
  let rest=t.slice(m.index + m[0].length);
  let end=rest.length;
  for(const re of endRes){
    re.lastIndex=0;
    const mm=re.exec(rest);
    if(mm) end=Math.min(end, mm.index);
  }
  return rest.slice(0,end);
}
function parseSequentialLabelPayouts(text){
  const t=normalizeText(text);
  const out={wide:[]};
  const umSec=afterLabelSection(t,/馬\s*連|馬連/i,[/ワイド|馬\s*単|3\s*連\s*複|三連複|3\s*連\s*単/i]);
  const umNums=numbersBeforeFirstMoney(umSec);
  const umPays=moneyList(umSec);
  if(umNums.length>=2 && umPays.length>=1){
    out.umaren=entry([umNums[0],umNums[1]].sort((a,b)=>parseInt(a)-parseInt(b)).join('-'), umPays[0]);
  }
  const wiSec=afterLabelSection(t,/ワイド/i,[/馬\s*単|3\s*連\s*複|三連複|3\s*連\s*単/i]);
  const wiNums=numbersBeforeFirstMoney(wiSec);
  const wiPays=moneyList(wiSec);
  const pairCount=Math.min(Math.floor(wiNums.length/2), wiPays.length, 4);
  for(let i=0;i<pairCount;i++){
    const combo=[wiNums[i*2],wiNums[i*2+1]].sort((a,b)=>parseInt(a)-parseInt(b)).join('-');
    const e=entry(combo, wiPays[i]);
    if(e && !out.wide.some(x=>x.split(' ')[0]===combo)) out.wide.push(e);
  }
  const triSec=afterLabelSection(t,/3\s*連\s*複|三連複/i,[/3\s*連\s*単|馬\s*単/i]);
  const triNums=numbersBeforeFirstMoney(triSec);
  const triPays=moneyList(triSec);
  if(triNums.length>=3 && triPays.length>=1){
    out.sanrenpuku=entry(triNums.slice(0,3).sort((a,b)=>parseInt(a)-parseInt(b)).join('-'), triPays[0]);
  }
  return out;
}


function orderEntry(no, name){
  no=S(no).replace(/\D/g,'');
  if(!no || parseInt(no,10)<1 || parseInt(no,10)>18) return null;
  return { no:String(parseInt(no,10)), name:S(name) };
}
function parseOrderFromSanrentan(text){
  const sec=afterLabelSection(text,/3\s*連\s*単|三連単/i,[]);
  const nums=numbersBeforeFirstMoney(sec);
  if(nums.length>=3){
    return [orderEntry(nums[0],''), orderEntry(nums[1],''), orderEntry(nums[2],'')].filter(Boolean);
  }
  return [];
}
function parseOrderFromResultTable(text){
  const t=normalizeText(text);
  const start=t.search(/着\s*順|着順|確定|入線|全着順/i);
  if(start<0) return [];
  const sec=t.slice(start, Math.min(t.length, start+5000));
  const out=[];
  // flat netkeiba-ish row fallback: "1 8 16 カウンターセブン ... 2 4 8 ハニーローリエ ..."
  const re=/(?:^|\s)([123])\s+(?:[1-8])\s+((?:1[0-8]|[1-9]))\s+([^\d\s<]{2,30})/g;
  let m; let guard=0;
  while((m=re.exec(sec)) && guard++<20){
    const rank=parseInt(m[1],10);
    if(rank>=1 && rank<=3 && !out[rank-1]) out[rank-1]=orderEntry(m[2], m[3]);
  }
  return out.filter(Boolean);
}
function parseOrderRobust(html){
  const raw=rawNormalize(html);
  let order=parseOrderFromSanrentan(raw);
  let source='sanrentan';
  if(order.length<3){ order=parseOrderFromResultTable(raw); source='resultTable'; }
  if(order.length>=3){
    return {order:order.slice(0,3), source};
  }
  return {order:[], source:'none'};
}

function mergePayout(a,b){
  const out={wide:[]};
  if(a){ if(a.umaren) out.umaren=a.umaren; if(a.sanrenpuku) out.sanrenpuku=a.sanrenpuku; if(Array.isArray(a.wide)) out.wide=a.wide.slice(); }
  if(b){
    if(!out.umaren && b.umaren) out.umaren=b.umaren;
    if(!out.sanrenpuku && b.sanrenpuku) out.sanrenpuku=b.sanrenpuku;
    if(Array.isArray(b.wide)) for(const x of b.wide){ if(x && !out.wide.some(y=>y.split(' ')[0]===x.split(' ')[0])) out.wide.push(x); }
  }
  return out;
}
function parsePayoutsRobust(html){
  let out=parsePayoutsFromText(html);
  // Rev419: partial payout, especially wide 2点, must not stop robust parsing.
  // Continue to sequential label parser until ワイド3点まで復元できる。
  if(hasCompleteCorePayout(out)) return out;
  const raw=rawNormalize(html);
  const blocks=findPaybackBlocks(raw);
  for(const b of blocks){
    out=mergePayout(out, parsePayoutsFromText(b));
    out=mergePayout(out, parseSequentialLabelPayouts(b));
    if(hasCompleteCorePayout(out)) return out;
  }
  // Rev418: netkeiba often renders labels as flat text, e.g.
  // 馬連 8 16 750円 / ワイド 8 16 7 16 7 8 370円 990円 1,460円 / 3連複 7 8 16 4,440円
  // Directly recover from this label-neighborhood format before using looser global fallbacks.
  out=mergePayout(out, parseSequentialLabelPayouts(raw));
  if(hasCompleteCorePayout(out)) return out;
  // Label-neighborhood fallback: parse combo+money within label-specific windows, without relying on table tags.
  const umBlock=aroundLabel(raw,/馬\s*連|馬連/i,1200);
  const wideBlock=aroundLabel(raw,/ワイド/i,1600);
  const triBlock=aroundLabel(raw,/3\s*連\s*複|三連複/i,1400);
  out=mergePayout(out, parseSequentialLabelPayouts([umBlock,wideBlock,triBlock].join(' ')));
  const u=allPairEntries(umBlock)[0]; if(u) out.umaren=u;
  const ws=allPairEntries(wideBlock);
  // Rev419: do not overwrite sequential 3-point wide with a looser 2-point extraction.
  if(ws.length && (!Array.isArray(out.wide) || ws.length > out.wide.length)) out.wide=ws.slice(0,4);
  const tr=allTriEntries(triBlock)[0]; if(tr) out.sanrenpuku=tr;
  if(hasCompleteCorePayout(out)) return out;
  // Last fallback: if labels are present but OCR-style spacing ruined sectioning, infer in order from global payback-ish snippets only.
  const payBlock=aroundLabel(raw,/払戻|払い戻し|払戻金|Pay_Back|payback|Result_Pay_Back/i,4000);
  if(payBlock){
    out=mergePayout(out, parseSequentialLabelPayouts(payBlock));
    const pairs=allPairEntries(payBlock);
    const tris=allTriEntries(payBlock);
    if(!out.umaren && pairs[0]) out.umaren=pairs[0];
    if((!out.wide || !out.wide.length) && pairs.length>1) out.wide=pairs.slice(1,5);
    if(!out.sanrenpuku && tris[0]) out.sanrenpuku=tris[0];
  }
  return out;
}
function htmlTitle(html){ const m=rawNormalize(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? stripTags(m[1]).slice(0,160) : ''; }

function hasPayout(result){
  return !!(result && (result.umaren || result.sanrenpuku || (Array.isArray(result.wide) && result.wide.length)));
}
function hasCompleteWide(result){
  return !!(result && Array.isArray(result.wide) && result.wide.length >= 3);
}
function hasCompleteCorePayout(result){
  return !!(result && result.umaren && result.sanrenpuku && hasCompleteWide(result));
}

function decodeHtmlBuffer(buf, contentType=''){
  const encs=[];
  const ct=S(contentType).toLowerCase();
  const m=ct.match(/charset=([^;\s]+)/i);
  if(m) encs.push(m[1]);
  // netkeiba/Japanese legacy pages may be euc-jp or shift_jis; try Japanese encodings before utf-8.
  encs.push('euc-jp','shift_jis','utf-8');
  const unique=[...new Set(encs.map(x=>S(x).toLowerCase()).filter(Boolean))];
  let best={html:'', encodingUsed:'', score:-1, candidates:[]};
  for(const enc of unique){
    try{
      const html=new TextDecoder(enc, {fatal:false}).decode(buf);
      const score=(/馬連|ワイド|3\s*連\s*複|三連複|払戻|払い戻し|払戻金/.test(html)?1000:0)
        + (/netkeiba|レース結果|払戻/.test(html)?100:0)
        - ((html.match(/�/g)||[]).length);
      best.candidates.push({enc, score, replacementChars:(html.match(/�/g)||[]).length, hasLabels:/馬連|ワイド|3\s*連\s*複|三連複|払戻|払い戻し|払戻金/.test(html)});
      if(score>best.score) best={html, encodingUsed:enc, score, candidates:best.candidates};
    }catch(e){}
  }
  return best;
}

async function handleResult(req){
  const url=new URL(req.url);
  const p=url.searchParams;
  const source=S(p.get('source')) || 'auto';
  const diagnose=p.get('diagnose')==='1';
  const expected=explicitRaceId(p);
  let target='';
  let parseReason='';
  if(source === 'jra'){
    // Rev415: Do not pretend JRA is netkeiba. If JRA URL generation is not implemented, return diagnostic failure.
    // The app will still try netkeiba/auto separately.
    parseReason='jra direct payout URL not implemented in this worker; use source=netkeiba or auto';
    return json({ok:false, source:'jra', result:{wide:[]}, diagnosis:{parseReason, expectedRaceId:expected, sourceBranch:'jra'}}, 200);
  }
  target=targetUrlForNetkeiba(p);
  if(!target){
    return json({ok:false, source:'', result:{wide:[]}, diagnosis:{parseReason:'missing explicit race_id/netkeibaRaceId/targetUrl', requestRaceId:S(p.get('raceId')), key:raceIdKey(p)}}, 200);
  }
  let res, html='';
  try{
    res=await fetch(target, {headers:{'user-agent':'Mozilla/5.0 Rev417RaceResultWorker/1.0','accept':'text/html,application/xhtml+xml'}});
    const buf=await res.arrayBuffer();
    var decoded=decodeHtmlBuffer(buf, res.headers.get('content-type')||'');
    html=decoded.html;
  }catch(e){
    return json({ok:false, source:target, result:{wide:[]}, diagnosis:{parseReason:'fetch failed', error:String(e&&e.message||e), targetUrl:target, expectedRaceId:expected}}, 200);
  }
  const result=parsePayoutsRobust(html);
  const orderInfo=parseOrderRobust(html);
  if(orderInfo.order && orderInfo.order.length>=3){ result.order=orderInfo.order; result.firstNo=orderInfo.order[0].no; result.secondNo=orderInfo.order[1].no; result.thirdNo=orderInfo.order[2].no; }
  const htmlText=normalizeText(html);
  const got=(target.match(/race_id=(\d{10,12})/)||[])[1]||'';
  const snippets=collectLabelSnippets(html);
  const tableFound=/馬\s*連|ワイド|3\s*連\s*複|三連複|払戻|払い戻し|Pay_Back|Result_Pay_Back/i.test(htmlText + ' ' + rawNormalize(html));
  const raceIdMatched=!!(expected && got && expected===got);
  const ok=hasPayout(result);
  if(!ok){
    parseReason=tableFound ? 'payout table labels found but complete combo+money not parsed' : 'payout table labels not found';
  }else{
    parseReason=hasCompleteCorePayout(result) ? 'payout parsed complete' : 'payout parsed partial';
  }
  const body={
    ok,
    source:target,
    result,
    diagnosis:{
      sourceBranch:source,
      expectedRaceId:expected,
      workerRaceId:got,
      raceIdMatched,
      htmlStatus:res.status,
      htmlChars:html.length,
      encodingUsed:(typeof decoded!=='undefined'&&decoded.encodingUsed)||'',
      encodingCandidates:(typeof decoded!=='undefined'&&decoded.candidates)||[],
      tableFound,
      parseReason,
      targetUrl:target,
      title: htmlTitle(html),
      labelSnippets: snippets,
      rev419WideDiag: {
        wideCount: Array.isArray(result.wide) ? result.wide.length : 0,
        wideValues: Array.isArray(result.wide) ? result.wide : [],
        completeCore: hasCompleteCorePayout(result)
      },
      rev425OrderDiag: {
        orderSource: orderInfo.source,
        orderCount: orderInfo.order ? orderInfo.order.length : 0,
        order: orderInfo.order || []
      }
    }
  };
  if(diagnose){ body.textPreview=htmlText.slice(0,700); body.rawLabelSnippets=snippets; }
  return json(body, 200);
}
export default {
  async fetch(req){
    if(req.method==='OPTIONS') return json({ok:true});
    const url=new URL(req.url);
    if(url.pathname === '/api/result' || url.pathname.endsWith('/api/result')) return handleResult(req);
    return json({ok:false,error:'not found',path:url.pathname},404);
  }
};
