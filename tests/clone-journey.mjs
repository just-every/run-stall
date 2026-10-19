import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { startOwnedDev, finishCleanup } from './owned-dev.mjs'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
const exec=promisify(execFile),directory=await mkdtemp(join(tmpdir(),'stall-readme-'))
const checkout=join(directory,'run-stall'),receiving=join(directory,'receiving-stall'),launcher=resolve('node_modules/@runeditrun/rer/global/rer.mjs')
const rerHome=join(directory,'rer-home')
await mkdir(rerHome)
const environment={...process.env,HOME:rerHome,RER_SERVER_JOURNEY:'1',RER_LOCAL_OPERATION:''}
async function run(args,target=checkout,allowed=[0]) {
 let result,code=0
 try { result=await exec(process.execPath,[launcher,...args,'--cwd',target],{maxBuffer:4*1024*1024,timeout:600000,env:environment}) }
 catch(error) { result=error;code=error.code }
 // Never expose captured CLI output: setup/sign-in output can carry authority.
 if(!allowed.includes(code)) throw Error(`OPS-001: rer ${args[0]} failed (exit ${Number.isInteger(code)?code:'unavailable'}); output withheld.`)
 return {...result,code}
}
function structured(output,event='result') {
 const records=output.stdout.trim().split('\n').flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}})
 const value=records.findLast(row=>row.event===event)
 assert.ok(value,'The real RER command must return a structured result')
 return value
}
async function signIn(event) {
 const origin=new URL(event.url).origin,cookies=new Map()
 let url=new URL(event.openUrl)
 try {
  // Perform the same public fragment-to-cookie exchange as the shipped gate page.
  const fragment=new URLSearchParams(url.hash.slice(1)),key=fragment.get('rer-dev')
  assert.ok(key,'Automatic owner entry must carry its private fragment')
  const exchanged=await fetch(origin+'/__dev/key',{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/json'},body:JSON.stringify({key})})
  assert.equal(exchanged.status,204,'The real local key exchange must succeed')
  for(const header of exchanged.headers.getSetCookie()) {const pair=header.split(';',1)[0],at=pair.indexOf('=');if(at>0)cookies.set(pair.slice(0,at),pair.slice(at+1))}
  await exchanged.body?.cancel()
  url=new URL(fragment.get('next')??('/auth/dev/enter?as='+encodeURIComponent(fragment.get('as')??'owner')),origin)

  for(let hop=0;hop<10;hop++) {
   assert.equal(url.origin,origin,'Automatic owner entry must remain on this installation')
   const response=await fetch(url,{redirect:'manual',headers:{cookie:[...cookies].map(([key,value])=>key+'='+value).join('; ')}})
   for(const header of response.headers.getSetCookie()) {
    const pair=header.split(';',1)[0],at=pair.indexOf('=')
    if(at>0) { const name=pair.slice(0,at),value=pair.slice(at+1);value?cookies.set(name,value):cookies.delete(name) }
   }
   await response.body?.cancel()
   if(response.status>=300&&response.status<400) {
    const location=response.headers.get('location')
    assert.ok(location,'Owner-entry redirects must name their destination')
    url=new URL(location,url);continue
   }
   assert.equal(response.status,200,'Automatic owner entry must reach a real page')
   assert.ok(cookies.size,'Automatic owner entry must establish a native session')
   return [...cookies].map(([key,value])=>key+'='+value).join('; ')
  }
 } catch { throw Error('OPS-001: automatic owner entry failed; private URL and cookies withheld.') }
 throw Error('OPS-001: automatic owner entry exceeded the redirect bound.')
}
async function state(origin,cookie) {
 const response=await fetch(origin+'/api/stall/state',{headers:{cookie}})
 assert.equal(response.status,200,'The retained native session must read the shop state')
 return response.json()
}
let dev,cleaning,journeyError
function cleanup() {return cleaning??=(async()=>{await dev?.stop();if(!journeyError?.preserveCheckout)await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100})})()}
const interrupted=()=>{void cleanup().then(()=>process.exit(1),()=>process.exit(1))}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,interrupted)
try {
 await exec('git',['clone',process.env.STALL_CLONE_SOURCE??'https://github.com/just-every/run-stall.git',checkout])
 if(process.env.GITHUB_SHA)await exec('git',['checkout','--detach',process.env.GITHUB_SHA],{cwd:checkout})
 dev=await startOwnedDev({launcher,checkout,env:environment})
 const event=await dev.ready,ready=event.url,site=event.siteUrl,open=event.openUrl
 assert.ok(ready&&site&&open,'Fresh README launch must produce app, automatic entry and local run-site origins')
 await dev.assertRunning()
 assert.equal((await fetch(ready+'/health')).status,200)
 assert.equal((await fetch(site+'/run')).status,200)
 const plan=await run(['deploy','--help'])
 assert.ok(plan.stdout.includes('deploy'))
 await dev.assertRunning()
 const cookie=await signIn(event),before=await state(ready,cookie)
 const response=await fetch(ready+'/api/stall/commands',{method:'POST',headers:{cookie,origin:ready,'content-type':'application/json'},body:JSON.stringify({type:'product.prepare',payload:{sku:'OPS-RESTORE-DRAFT',name:'Recovery drill product',description:'Unpublished real merchant draft retained through command lifecycle.',unitCents:1875,active:false}})})
 assert.equal(response.status,200,'The fresh owner must prepare a real draft without any stock provider')
 const draft=(await response.json()).result
 assert.ok(draft.id&&draft.revision&&draft.value.draft,'The command must persist a reviewable product draft')
 await dev.stop();dev=undefined
 const description=JSON.parse((await run(['describe','--json'])).stdout)
 assert.ok(description.local.prepared&&description.local.ownerSaved,'Bootstrap must durably save its owner and settings')
 const doctor=await run(['doctor','--json'],checkout,[0,3]),diagnosis=structured(doctor)
 assert.equal(diagnosis.ok,doctor.code===0,'Doctor exit status must agree with its actual diagnosis')
 assert.ok(diagnosis.diagnostics.state.safe,'Doctor must recognize the owned local state as safe')
 assert.equal(diagnosis.diagnostics.node.actual,diagnosis.diagnostics.node.expected,'Doctor must use the declared Node runtime')
 assert.equal(diagnosis.diagnostics.scope,'local-inputs-only','Doctor must not imply hosted or provider acceptance')
 await run(['setup','--non-interactive','--json'])
 const afterSetup=JSON.parse((await run(['describe','--json'])).stdout)
 assert.equal(afterSetup.local.origin,description.local.origin,'Setup must retain the saved local origin')
 dev=await startOwnedDev({launcher,checkout,env:environment})
 const restarted=await dev.ready
 assert.equal(restarted.url,ready,'Restart must use the saved local origin')
 const retained=await state(restarted.url,cookie)
 assert.equal(retained.actor.id,before.actor.id,'Setup/restart must preserve the original owner and session authority')
 assert.equal(retained.actor.email,before.actor.email,'Setup must retain the original owner identity')
 assert.deepEqual(retained.products.find(product=>product.id===draft.id),draft,'Setup/restart must preserve the exact unpublished draft and revision')
 await dev.assertRunning()
 await dev.stop();dev=undefined
 const archive=join(directory,'ops-backup.rer')
 await run(['export','--output',archive,'--json'])
 // A second real checkout gets its own owner/configuration after CLI import.
 await exec('git',['clone','--shared',checkout,receiving])
 await run(['install','--json'],receiving)
 await run(['import','--input',archive,'--yes','--json'],receiving)
 await run(['setup','--owner-email','ops-receiving@example.invalid','--non-interactive','--json'],receiving)
 dev=await startOwnedDev({launcher,checkout:receiving,env:environment})
 const restoredEvent=await dev.ready,restoredCookie=await signIn(restoredEvent),restored=await state(restoredEvent.url,restoredCookie)
 assert.notEqual(restored.actor.id,before.actor.id,'The receiving installation must establish its own owner')
 assert.equal(restored.actor.email,'ops-receiving@example.invalid','The receiving owner must come from its own setup')
 assert.deepEqual(restored.products.find(product=>product.id===draft.id),draft,'CLI export/import must retain the original draft and revision')
 const foreign=await fetch(restoredEvent.url+'/api/stall/state',{headers:{cookie}})
 assert.equal(foreign.status,401,'A source session must not grant access to the receiving installation')
 await foreign.body?.cancel()
 await dev.assertRunning()
 console.log('OPS-001 fresh clone: real RER bootstrap, doctor, saved setup/restart, retained owner/session/draft, CLI archive and independent receiving owner passed; no hosted acceptance inferred.')
}catch(error){journeyError=error;throw error}
finally{
 try{await finishCleanup(cleanup,journeyError)}finally{for(const signal of ['SIGINT','SIGTERM'])process.off(signal,interrupted)}
}
