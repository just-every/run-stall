import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { build } from 'esbuild';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,readFile,readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import assert from 'node:assert/strict';
export async function installation({bindings={},outboundService,source=resolve('.'),entry,base='/api/stall'}={}) {
 const root=source;
 const directory=await mkdtemp(join(tmpdir(),'stall-api-'));
 const bundled=await build({entryPoints:[entry??join(root,'tests/api/worker.ts')],nodePaths:[resolve('node_modules')],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['node:*','cloudflare:*'],loader:{'.css':'text','.svg':'text'}});
 const setup=randomBytes(32).toString('hex'),key=randomBytes(32).toString('hex'),secret=randomBytes(32).toString('hex');
 const messages=[];
 // Fake only the external mail boundary; Pier remains the real pinned Worker.
 const mailEdge=async request=>{
  if(new URL(request.url).hostname==='api.resend.com') {
   messages.push(await request.json());return Response.json({id:randomUUID()});
  }
  // Node fetch supplies its own framing when forwarding the workerd request.
  const headers=Object.fromEntries([...request.headers].filter(([name])=>!['connection','transfer-encoding','content-length','host','expect'].includes(name)));
  const response=await fetch(request.url,{method:request.method,headers,...(['GET','HEAD'].includes(request.method)?{}:{body:await request.arrayBuffer()})});
  return new Response(await response.arrayBuffer(),{status:response.status,headers:Object.fromEntries(response.headers)});
 };
 const origin='https://stall-'+randomUUID()+'.test';
 const options=port=>({...convertV4MiniflareOptions({host:'127.0.0.1',port,upstream:origin,modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{AUTH_LOCAL:'false',AUTH_ORIGIN:origin,OWNER_EMAIL:'owner@example.test',SESSION_SECRET:secret,SETUP_TOKEN:setup,MAIL_PROVIDER:'resend',MAIL_API_KEY:'test-network-edge',MAIL_FROM:'auth@example.test',RER_DEV_KEY:key,...bindings},outboundService:async request=>{if(new URL(request.url).hostname==='api.resend.com')return mailEdge(request);return outboundService?outboundService(request):mailEdge(request)}}),resourcePersistencePath:directory});
 
 const mf=new Miniflare(options(0));
 try {
  await mf.ready;
  const db=await mf.getD1Database('DB');
  for(const file of (await readdir(join(root,'migrations/core'))).filter(f=>f.endsWith('.sql')).sort()) await db.batch(unstable_splitSqlQuery(await readFile(join(root,'migrations/core',file),'utf8')).map(sql=>db.prepare(sql)));
  let cookie='';
  const request=(path,{method='GET',body,as=cookie,headers={}}={})=>mf.dispatchFetch(origin+path,{method,redirect:'manual',headers:{origin,host:new URL(origin).host,'content-type':'application/json',...(as?{cookie:as}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const boot=await request('/auth/bootstrap',{method:'POST',body:{token:setup,displayName:'Supplier'}});assert.equal(boot.status,303,boot.status===303?'':await boot.text());
  cookie=boot.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const api=async(path,body,opts={})=>{
   const response=await request(path,{...(body===undefined?{}:{method:'POST',body}),...opts});const value=await response.json();
   if(opts.status!==undefined) assert.equal(response.status,opts.status,JSON.stringify(value)); else assert.ok(response.ok,JSON.stringify(value));
   return value;
  };
  const command=async(type,payload,opts={})=>{
   const value=await api(base+'/commands',{type,payload,...(base==='/api/pier'?{commandId:opts.commandId??randomUUID()}:{})},opts);return opts.status&&opts.status>=400?value:value.result;
  };
  const signIn=async(email,role='member')=>{
   await api('/auth/invite',{email,displayName:'Trade buyer',role,returnTo:'/app'},{status:202});
   {
    const message=messages.findLast(message=>JSON.stringify(message.to).includes(email));
    const link=new URL(message?.text?.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)?.[0] ?? message?.html?.match(/href="([^"]*\/auth\/confirm\?token=[^"]+)"/)?.[1]?.replaceAll('&amp;','&'));
    const confirmed=await request('/auth/confirm',{method:'POST',as:'',body:{token:link.searchParams.get('token')}});
    assert.equal(confirmed.status,303);
    return confirmed.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
   }
   throw Error('Invitation did not produce a usable sign-in link');
  };
  const forward=async incoming=>{const url=new URL(incoming.url);return request(url.pathname+url.search,{method:incoming.method,as:incoming.headers.get('cookie')??'',headers:Object.fromEntries(incoming.headers),...(!['GET','HEAD'].includes(incoming.method)?{body:await incoming.json()}:{})})};
  return {mf,db,origin,cookie,request,api,command,signIn,forward,async close(){await mf.dispose();await rm(directory,{recursive:true,force:true})}};
 }catch(error){await mf.dispose();await rm(directory,{recursive:true,force:true});throw error}
}
export async function archive(h) {
 const {id}=await h.api('/api/stall/portability/exports',{});
 let status;do{status=await h.api(`/api/stall/portability/exports/${id}/advance`,{})}while(status.phase!=='complete');
 const response=await h.request(`/api/stall/portability/exports/${id}/download`);assert.equal(response.status,200);
 return (await response.text()).trim().split('\n').map(line=>JSON.parse(line));
}
export async function restore(h,lines,{status=200,laterJournal}={}) {
 const {id}=await h.api('/api/stall/portability/imports',{manifest:lines[0],confirmed:true});
 for(const part of lines.filter(x=>x.kind==='part')) await h.api(`/api/stall/portability/imports/${id}/parts/${part.index}`,part,{method:'PUT'});
 return h.api(`/api/stall/portability/imports/${id}/finalize`,{contentHash:lines.at(-1).contentHash,archiveHash:lines.at(-1).archiveHash,...(laterJournal?{laterJournal}:{})},{status});
}
