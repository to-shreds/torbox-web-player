import test from 'node:test';
import assert from 'node:assert/strict';
import {Discovery, TorrentGateway} from '../lib/discovery.mjs';
import {AppError} from '../lib/torbox.mjs';

const HASH='a'.repeat(40), OTHER='b'.repeat(40);
const target={type:'series',id:'tt33043892',season:1,episode:2};
const source={hash:HASH,filename:'Fixture.S01E02.H264.AAC.mp4'};
const catalog={meta:async()=>({episodes:[{season:1,episode:2,released:'2020-01-01'}]})};
const item=(id,hash=HASH)=>({id,hash,download_finished:true,download_present:true,files:[{id:7,name:source.filename,mimetype:'video/mp4',size:12345}]});
const missing=()=>new AppError('PREPARED_ITEM_MISSING','Synthetic missing item',404);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const pause=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}){
  const calls={find:[],item:[],create:[]};
  const gateway={
    cached:async()=>({[HASH]:{cached:true,files:[{name:source.filename}]}}),
    find:async hash=>{calls.find.push(hash);return overrides.find?overrides.find(hash):item(42);},
    item:async id=>{calls.item.push(id);return overrides.item?overrides.item(id):item(id);},
    create:async(hash,onlyCached)=>{calls.create.push({hash,onlyCached});return overrides.create?overrides.create(hash,onlyCached):43;}
  };
  const discovery=new Discovery({catalog,gateway});
  return {discovery,gateway,calls,register:async()=> (await discovery.register({target,sources:[source]},'session')).sources[0].id};
}
const rejected=(promise,code)=>assert.rejects(promise,error=>error.code===code);

test('optional missing detail hash needs a fresh exact full-list hash and same-ID proof',async()=>{
  const f=fixture({item:async id=>item(id,null)}),id=await f.register();
  const ready=await f.discovery.prepare(id,'session',true);
  assert.equal(ready.state,'ready');assert.equal(ready.file.id,'torrents:42:7');
  assert.equal(f.calls.find.length,2);assert.deepEqual(f.calls.create,[]);
});

test('missing full-list proof and malformed detail identities fail clearly without writes',async()=>{
  for(const detail of [null,undefined,'not-a-hash']){
    let first=true;
    const f=fixture({find:async()=>{if(first){first=false;return item(42);}return null;},item:async id=>({...item(id),hash:detail})}),id=await f.register();
    for(let i=0;i<2;i++)await rejected(f.discovery.prepare(id,'session',true),'TORRENT_IDENTITY_UNVERIFIED');
    assert.deepEqual(f.calls.create,[]);assert.equal(f.discovery.operations.get(HASH).torrentId,42);
  }
});

test('omitted full-list hashes are unverified rather than a claim that a different torrent was returned',async()=>{
  let first=true;
  const f=fixture({find:async()=>{if(first){first=false;return item(42);}throw new AppError('LIBRARY_SCHEMA','Missing hashes');},item:async id=>item(id,null)}),id=await f.register();
  await assert.rejects(f.discovery.prepare(id,'session',true),error=>error.code==='TORRENT_IDENTITY_UNVERIFIED'&&!error.message.includes('different torrent'));
  assert.deepEqual(f.calls.create,[]);
});

test('a valid conflicting detail hash is never overridden by the same-ID list row',async()=>{
  const f=fixture({item:async id=>item(id,OTHER)}),id=await f.register();
  await rejected(f.discovery.prepare(id,'session',true),'TORRENT_IDENTITY_MISMATCH');
  assert.equal(f.calls.find.length,2);assert.deepEqual(f.calls.create,[]);
});

test('a stale conflicting ID can rebind once only to an independently verified exact hash under a different ID',async()=>{
  let finds=0;
  const f=fixture({find:async()=>item(++finds===1?42:77),item:async id=>item(id,id===42?OTHER:HASH)}),id=await f.register();
  assert.equal((await f.discovery.prepare(id,'session',true)).file.id,'torrents:77:7');
  assert.equal((await f.discovery.prepare(id,'session',true)).file.id,'torrents:77:7');
  assert.equal(f.calls.find.length,2);assert.deepEqual(f.calls.item,[42,77,77]);assert.deepEqual(f.calls.create,[]);
});

test('replacement detail may omit its hash only with its own fresh exact full-list binding',async()=>{
  let finds=0;
  const f=fixture({find:async()=>item(++finds===1?42:77),item:async id=>item(id,id===42?OTHER:null)}),id=await f.register();
  assert.equal((await f.discovery.prepare(id,'session',true)).file.id,'torrents:77:7');assert.deepEqual(f.calls.create,[]);
});

test('missing or conflicting replacement never commits a new ID or enters the create path',async()=>{
  for(const failure of ['missing','conflict']){
    let finds=0;
    const f=fixture({find:async()=>item(++finds===1?42:77),item:async id=>{if(id===77&&failure==='missing')throw missing();return item(id,OTHER);}}),id=await f.register();
    for(let i=0;i<2;i++)await rejected(f.discovery.prepare(id,'session',true),failure==='missing'?'TORRENT_IDENTITY_UNVERIFIED':'TORRENT_IDENTITY_MISMATCH');
    assert.equal(f.discovery.operations.get(HASH).torrentId,42);assert.deepEqual(f.calls.create,[]);
  }
});

test('same-ID missing and wrong detail reads retain independent checks in either concurrent order',async()=>{
  for(const order of [[null,OTHER],[OTHER,null]]){
    const proof=deferred();let finds=0,reads=0,checking=false;
    const f=fixture({find:async()=>++finds===1?item(42):proof.promise,item:async id=>item(id,checking?order[reads++]:HASH)}),id=await f.register();
    await f.discovery.prepare(id,'session',true);checking=true;
    const a=f.discovery.status(id,'session'),b=f.discovery.status(id,'session');
    const settled=Promise.allSettled([a,b]);await pause();proof.resolve(item(42));
    const results=await settled;
    for(let i=0;i<2;i++){
      if(order[i]===null){assert.equal(results[i].status,'fulfilled');assert.equal(results[i].value.state,'ready');}
      else{assert.equal(results[i].status,'rejected');assert.equal(results[i].reason.code,'TORRENT_IDENTITY_MISMATCH');}
    }
    assert.equal(f.calls.find.length,2);assert.deepEqual(f.calls.create,[]);
  }
});

test('concurrent different-ID repairs share one proof and replacement read without duplicate writes',async()=>{
  const proof=deferred();let finds=0;
  const f=fixture({find:async()=>++finds===1?item(42):proof.promise,item:async id=>item(id,id===42?OTHER:HASH)}),id=await f.register();
  const first=f.discovery.prepare(id,'session',true),second=f.discovery.status(id,'session');await pause();proof.resolve(item(77));
  const results=await Promise.all([first,second]);
  assert.ok(results.some(result=>result.state==='ready'&&result.file.id==='torrents:77:7'));
  assert.ok(results.every(result=>result.state==='ready'||result.state==='preparing'));
  assert.equal(f.calls.find.length,2);assert.equal(f.calls.item.filter(id=>id===77).length,1);assert.deepEqual(f.calls.create,[]);
});

test('revocation during detail, full-list proof or replacement reads exposes no file and commits no binding',async()=>{
  for(const stage of ['detail','proof','replacement']){
    const gate=deferred(),entered=deferred();let finds=0;
    const f=fixture({
      find:async()=>{if(++finds===1)return item(42);if(stage==='proof'){entered.resolve();return gate.promise;}return item(77);},
      item:async id=>{if((stage==='detail'&&id===42)||(stage==='replacement'&&id===77)){entered.resolve();return gate.promise;}return item(id,OTHER);}
    }),id=await f.register();
    const request=f.discovery.prepare(id,'session',true);await entered.promise;f.discovery.revoke('session');
    const check=rejected(request,'SOURCE_EXPIRED');gate.resolve(stage==='proof'?item(77):stage==='detail'?item(42):item(77));await check;
    assert.equal(f.discovery.operations.get(HASH).torrentId,42);assert.deepEqual(f.calls.create,[]);
  }
});

test('a late identity proof cannot overwrite a newer legitimate stale-ID recovery',async()=>{
  const proof=deferred(),entered=deferred();let finds=0,reads=0;
  const f=fixture({find:async()=>{if(++finds===1)return item(42);if(finds===2){entered.resolve();return proof.promise;}return item(77);},item:async id=>{if(id===42){if(++reads===1)return item(42,null);throw missing();}return item(id);}}),id=await f.register();
  // Establish the original account mapping without consuming the delayed read.
  f.discovery.operations.set(HASH,{torrentId:42,confirmed:true,uncertain:false,revision:1,promise:null,at:Date.now()});
  finds=1;
  const old=f.discovery.status(id,'session');await entered.promise;
  assert.equal((await f.discovery.prepare(id,'session',true)).file.id,'torrents:77:7');
  proof.resolve(item(42));assert.equal((await old).state,'preparing');assert.equal(f.discovery.operations.get(HASH).torrentId,77);assert.deepEqual(f.calls.create,[]);
});

test('a verified hash cannot bypass exact episode file selection',async()=>{
  const f=fixture({item:async id=>({...item(id,null),files:[{id:7,name:'Fixture.S01E03.H264.AAC.mp4',mimetype:'video/mp4',size:12345}]})}),id=await f.register();
  assert.equal((await f.discovery.prepare(id,'session',true)).state,'unavailable');assert.deepEqual(f.calls.create,[]);
});

function acknowledgedGateway(hash,{now=Date.now}={}){
  let writes=0;const provider={key:'synthetic-account-one'};
  const gateway=new TorrentGateway({provider,now,fetchFn:async()=>new Response(JSON.stringify({success:true,data:{torrent_id:42,hash}}),{headers:{'content-type':'application/json'}})});
  const create=gateway.create.bind(gateway);gateway.create=async(...args)=>{writes++;return create(...args);};
  gateway.cached=async()=>({[HASH]:true});gateway.find=async()=>null;gateway.item=async id=>item(id,null);
  const discovery=new Discovery({catalog,gateway});
  return {provider,gateway,discovery,writes:()=>writes,register:async()=> (await discovery.register({target,sources:[source]},'session')).sources[0].id};
}

test('recent exact creation ACK proves an omitted detail hash but expires and remains account-local',async()=>{
  let now=100;const f=acknowledgedGateway(HASH,{now:()=>now}),id=await f.register();
  assert.equal((await f.discovery.prepare(id,'session',true)).state,'ready');assert.equal(f.writes(),1);
  now+=30001;await rejected(f.discovery.status(id,'session'),'TORRENT_IDENTITY_UNVERIFIED');assert.equal(f.writes(),1);
  await f.gateway.create(HASH,true);assert.equal(f.gateway.verifiedCreation(42,HASH),true);
  f.provider.key='synthetic-account-two';assert.equal(f.gateway.verifiedCreation(42,HASH),false);
});

test('creation ACK never overrides a later explicit different detail hash',async()=>{
  const f=acknowledgedGateway(HASH),id=await f.register();f.gateway.item=async id=>item(id,OTHER);
  for(let i=0;i<2;i++)await rejected(f.discovery.prepare(id,'session',true),'TORRENT_IDENTITY_MISMATCH');assert.equal(f.writes(),1);
});

test('conflicting or malformed create ACK retains uncertain-write guard across retries and status',async()=>{
  for(const hash of [OTHER,'invalid-hash']){
    const f=acknowledgedGateway(hash),id=await f.register();
    for(let i=0;i<2;i++)await rejected(f.discovery.prepare(id,'session',true),'CREATE_UNCERTAIN');
    assert.equal((await f.discovery.status(id,'session')).state,'uncertain');assert.equal(f.writes(),1);
    const op=f.discovery.operations.get(HASH);assert.equal(op.uncertain,true);assert.equal(op.torrentId,null);
  }
});

test('creation proof cache is bounded and never returns an evicted numeric-ID binding',async()=>{
  let id=0;
  const gateway=new TorrentGateway({provider:{key:'synthetic'},fetchFn:async()=>Response.json({success:true,data:{torrent_id:++id,hash:HASH}})});
  for(let i=0;i<130;i++)assert.equal(await gateway.create(HASH,true),i+1);
  assert.equal(gateway.creationProofs.size,128);assert.equal(gateway.verifiedCreation(1,HASH),false);assert.equal(gateway.verifiedCreation(130,HASH),true);
});

test('a late creation ACK cannot bind its proof to a replacement account key',async()=>{
  const ack=deferred(),provider={key:'synthetic-account-one'};
  const gateway=new TorrentGateway({provider,fetchFn:async()=>ack.promise});
  const creating=gateway.create(HASH,true);provider.key='synthetic-account-two';
  ack.resolve(Response.json({success:true,data:{torrent_id:42,hash:HASH}}));assert.equal(await creating,42);
  assert.equal(gateway.verifiedCreation(42,HASH),false);
});
