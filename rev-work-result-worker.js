/**
 * Rev415 rev-work-result worker replacement
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
function hasPayout(result){
  return !!(result && (result.umaren || result.sanrenpuku || (Array.isArray(result.wide) && result.wide.length)));
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
    res=await fetch(target, {headers:{'user-agent':'Mozilla/5.0 Rev415RaceResultWorker/1.0','accept':'text/html,application/xhtml+xml'}});
    html=await res.text();
  }catch(e){
    return json({ok:false, source:target, result:{wide:[]}, diagnosis:{parseReason:'fetch failed', error:String(e&&e.message||e), targetUrl:target, expectedRaceId:expected}}, 200);
  }
  const result=parsePayoutsFromText(html);
  const htmlText=normalizeText(html);
  const got=(target.match(/race_id=(\d{10,12})/)||[])[1]||'';
  const tableFound=/馬\s*連|ワイド|3\s*連\s*複|三連複/.test(htmlText);
  const raceIdMatched=!!(expected && got && expected===got);
  const ok=hasPayout(result);
  if(!ok){
    parseReason=tableFound ? 'payout table labels found but complete combo+money not parsed' : 'payout table labels not found';
  }else{
    parseReason='payout parsed';
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
      tableFound,
      parseReason,
      targetUrl:target
    }
  };
  if(diagnose){ body.textPreview=htmlText.slice(0,500); }
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
