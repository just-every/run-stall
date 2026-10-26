import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

async function within(promise,ms) {
 let timer
 try{return await Promise.race([promise.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms)})])}
 finally{clearTimeout(timer)}
}

/** Own both the launcher and the native Node server registered by rer. A Node
 * version change can give that server a different PID and process group. */
export async function startOwnedDev({launcher,checkout,env}) {
 const entry=pathToFileURL(launcher),root=await realpath(checkout)
 const [{serversDirectory},{alive},{processInfo,stopGroup},{recoverCommand}]=await Promise.all([
  import(new URL('../cli/server-registry.mjs',entry)),
  import(new URL('../modules/job-queue/identity.mjs',entry)),
  import(new URL('../modules/job-queue/processes.mjs',entry)),
  import(new URL('../onboarding/command-recovery.mjs',entry)),
 ])
 const registry=join(serversDirectory(env),'state.json'),owners=new Map()
 async function records() {
  let state
  try {
   const stat=await lstat(registry)
   if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(process.getuid&&stat.uid!==process.getuid()))throw Error('The rer registry is not an owned regular file.')
   state=JSON.parse(await readFile(registry,'utf8'))
  }catch(error){if(error.code==='ENOENT')return [];throw Error('The rer server registry could not be verified.')}
  if(!Array.isArray(state.running))throw Error('The rer server registry has no server records.')
  return state.running.filter(record=>record.checkout===root&&record.mode==='dev')
 }
 async function sameProcess(owner) {
  const current=await processInfo(owner.pid)
  return Boolean(current&&!current.zombie&&current.start===owner.start)
 }
 async function capture() {
  for(const record of await records()) {
   const owner=record.owner
   if(!Number.isSafeInteger(owner?.pid)||owner.pid<2||typeof owner.start!=='string'||typeof owner.token!=='string'||typeof owner.socket!=='string')throw Error('The test checkout has an unverifiable rer server identity.')
   if(await alive(owner))owners.set(`${owner.pid}:${owner.start}:${owner.token}`,record)
   else if(await sameProcess(owner))throw Error('The test checkout server is still present but its lifetime nonce could not be verified. Preserve the checkout for inspection.')
  }
 }
 // An existing server predates our launch and does not belong to this test.
 try {
  await capture()
  if(owners.size)throw Error('A live rer server already owns this test checkout; it was left running for inspection.')
 }catch(error){error.preserveCheckout=true;throw error}
 const grouped=process.platform!=='win32'
 const child=spawn(process.execPath,[launcher,'dev','--foreground','--json','--cwd',checkout],{env,detached:grouped,stdio:['ignore','pipe','ignore']})
 const output=createInterface({input:child.stdout})
 let resolveDone,resolveReady,rejectReady,timer,settled=false,problem='no structured code',stopping
 const done=new Promise(resolve=>{resolveDone=resolve})
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
 const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?rejectReady(error):resolveReady(value)}
 const failure=code=>new Error(`Foreground rer dev stopped (${code}; ${problem}). Captured launcher output was kept private.`)
 // Read automatic-entry credentials only into memory. Never forward raw output.
 output.on('line',line=>{
  let event;try{event=JSON.parse(line)}catch{return}
  if(!event||typeof event!=='object')return
  if(event.event==='error'&&typeof event.code==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(event.code))problem=event.code+(typeof event.message==='string'?'; '+event.message:'')
  if(event.event==='ready')finish(null,event)
 })
 child.once('error',error=>{finish(failure(error.code??'spawn'));resolveDone()})
 child.once('exit',(code,signal)=>{finish(failure(signal??code));resolveDone()})
 timer=setTimeout(()=>finish(new Error('Foreground rer dev did not become ready within ten minutes. Captured launcher output was kept private.')),600000)
 // Capture the birth of the directly spawned group before it can be recycled.
 const leader=child.pid?processInfo(child.pid).then(value=>({value}),error=>({error})):Promise.resolve({value:null})
 async function waitGone(owner,ms) {
  const until=Date.now()+ms
  while(await sameProcess(owner)){if(Date.now()>=until)return false;await delay(100)}
  return true
 }
 async function stopServer(record) {
  const {owner}=record
  if(await sameProcess(owner)) {
   if(!await alive(owner))throw Error('The recorded rer server is live but its nonce is unverified; it was not signalled.')
   try{process.kill(owner.pid,'SIGTERM')}catch(error){if(error.code!=='ESRCH')throw error}
   if(!await waitGone(owner,15000)) {
    // A closed nonce is not permission to kill a possibly recycled PID.
    if(!await alive(owner))throw Error('The rer server is still finishing shutdown without a verifiable nonce; its checkout was preserved.')
    try{process.kill(owner.pid,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error}
    if(!await waitGone(owner,5000))throw Error('The recorded rer server did not exit; its checkout was preserved.')
   }
  }
  // The registry's runtime capability identifies descendants even after a
  // native server was killed or reparented. Group membership alone does not.
  if(record.runtime)await recoverCommand(record.runtime)
 }
 function stop() {
  return stopping??=(async()=>{
   clearTimeout(timer)
   try {
    await capture()
    // Signal actual registered server owners first, allowing their native
    // cleanup to stop their detached runtime children and release the registry.
    for(const [key,record] of owners){await stopServer(record);owners.delete(key)}
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM')
    await within(done,10000)
    const birth=await leader
    if(birth.error)throw Error('The owned launcher birth could not be verified; its checkout was preserved.')
    if(grouped&&birth.value)await stopGroup({...birth.value,pgid:child.pid},1000)
    else if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
    if(!await within(done,5000))throw Error('The owned rer launcher did not exit; its checkout was preserved.')
    // A preparing launcher can register a native server during cancellation.
    await capture()
    for(const [key,record] of owners){await stopServer(record);owners.delete(key)}
   }finally{output.close();child.stdout.destroy()}
  })()
 }
 return {ready,stop,
  async assertRunning(){await capture();const live=await Promise.all([...owners.values()].map(record=>alive(record.owner)));assert.ok(live.some(Boolean),'The test checkout must retain its verified registered rer server during the journey')},
 }
}

/** Keep the original assertion/startup failure visible if teardown also fails. */
export async function finishCleanup(cleanup,originalError) {
 try{await cleanup()}
 catch(error){if(originalError)throw new AggregateError([originalError,error],'The journey failed and owned cleanup also failed.');throw error}
}
