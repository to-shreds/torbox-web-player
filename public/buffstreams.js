export const DEFAULT_BUFFSTREAMS_BASE='https://mybuffstreams.plus';
const rootHost=/^(?:www\.)?[a-z0-9-]*buffstreams[a-z0-9-]*\.[a-z]{2,24}$/;

export function buffstreamsBase(value){
  const input=String(value??'').trim();
  if(!input||input.length>500)throw new Error('Enter the current Buffstreams website address.');
  let url;
  try{url=new URL(/^[a-z][a-z0-9+.-]*:/i.test(input)?input:'https://'+input);}catch{throw new Error('Enter a valid Buffstreams website address.');}
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||(!rootHost.test(url.hostname)||url.hostname.split('.').some(label=>label.startsWith('-')||label.endsWith('-')))){
    throw new Error('Use an HTTPS Buffstreams address without a password, query or custom port.');
  }
  return url.origin;
}

export function buffstreamsLinks(base=DEFAULT_BUFFSTREAMS_BASE){
  const origin=buffstreamsBase(base);
  return [
    {id:'all',title:'All live sports',path:'/'},
    {id:'nfl',title:'NFL',path:'/nflstreams2'},
    {id:'cfb',title:'College football',path:'/cfbstreams2'},
    {id:'nhl',title:'NHL hockey',path:'/nhlstreams2'},
  ].map(({id,title,path})=>({id,title,url:new URL(path,origin).href}));
}
