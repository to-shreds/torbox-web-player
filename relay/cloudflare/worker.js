const PAGE_ORIGIN='https://to-shreds.github.io';
const PREFIX='/relay/torbox/';
const RULES={
  'user/me':{method:'GET',query:new Set(['settings'])},
  'torrents/checkcached':{method:'GET',query:new Set(['hash','format','list_files'])},
  'torrents/mylist':{method:'GET',query:new Set(['id','offset','limit','bypass_cache'])},
  'torrents/createtorrent':{method:'POST',query:new Set()},
  'torrents/requestdl':{method:'GET',query:new Set(['torrent_id','file_id','zip_link','redirect']),tokenInQuery:true}
};
const cors=origin=>({
  'Access-Control-Allow-Origin':origin,
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers':'Authorization,Content-Type',
  'Access-Control-Expose-Headers':'Content-Type,Retry-After,X-TorBox-Bridge',
  'Access-Control-Max-Age':'86400',
  'Vary':'Origin'
});
function json(status,data,origin,extra={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors(origin),...extra}})}
function keyOf(request){const m=/^Bearer ([^\u0000-\u001f\u007f]{8,512})$/.exec(request.headers.get('authorization')||'');return m?.[1]||''}
export default{
  async fetch(request){
    const origin=request.headers.get('origin')||'';
    if(origin!==PAGE_ORIGIN)return json(403,{error:'BAD_ORIGIN',message:'This frontend is not allowed to use the TorBox bridge.'},PAGE_ORIGIN);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(origin)});
    const url=new URL(request.url);
    if(url.pathname==='/relay/health')return json(200,{ok:true,bridge:'cloudflare',protocol:1},origin,{'X-TorBox-Bridge':'cloudflare'});
    if(!url.pathname.startsWith(PREFIX))return json(404,{error:'NOT_FOUND'},origin);
    const route=url.pathname.slice(PREFIX.length),rule=RULES[route];
    if(!rule)return json(404,{error:'RELAY_ROUTE_NOT_ALLOWED'},origin);
    if(request.method!==rule.method)return json(405,{error:'RELAY_METHOD_NOT_ALLOWED'},origin);
    const key=keyOf(request);if(!key)return json(401,{error:'RELAY_AUTH_REQUIRED'},origin);
    const upstream=new URL(route,'https://api.torbox.app/v1/api/');
    for(const [name,value] of url.searchParams){
      if(!rule.query.has(name)||value.length>512||/[\u0000-\u001f\u007f]/.test(value))return json(400,{error:'RELAY_QUERY_NOT_ALLOWED'},origin);
      upstream.searchParams.append(name,value);
    }
    const headers={Accept:'application/json'};
    let body;
    if(rule.tokenInQuery)upstream.searchParams.set('token',key);else headers.Authorization='Bearer '+key;
    if(route==='torrents/createtorrent'){
      let data;try{data=await request.json()}catch{return json(400,{error:'INVALID_JSON'},origin)}
      const hash=typeof data?.hash==='string'?data.hash.toLowerCase():'';
      if(!/^[a-f0-9]{40}$/.test(hash))return json(400,{error:'RELAY_HASH_INVALID'},origin);
      const form=new FormData();form.set('magnet','magnet:?xt=urn:btih:'+hash);form.set('allow_zip','false');form.set('add_only_if_cached',String(data.onlyCached===true));body=form;
    }
    let response;
    try{response=await fetch(upstream,{method:rule.method,headers,...(body?{body}:{}),redirect:'manual'});}catch{return json(502,{error:'RELAY_UPSTREAM_UNAVAILABLE'},origin,{'X-TorBox-Bridge':'cloudflare'});}
    const outHeaders={'Content-Type':response.headers.get('content-type')||'application/json; charset=utf-8','Cache-Control':'no-store','X-TorBox-Bridge':'cloudflare',...cors(origin)};
    const retry=response.headers.get('retry-after');if(retry)outHeaders['Retry-After']=retry;
    return new Response(response.body,{status:response.status,headers:outHeaders});
  }
};
