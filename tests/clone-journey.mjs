import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { startOwnedDev, finishCleanup } from './owned-dev.mjs'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
const exec=promisify(execFile),directory=await mkdtemp(join(tmpdir(),'stall-readme-'))
const checkout=join(directory,'run-stall'),launcher=resolve('node_modules/@runeditrun/rer/global/rer.mjs')
const rerHome=join(directory,'rer-home')
await mkdir(rerHome)
const run=(args)=>exec(process.execPath,[launcher,...args,'--cwd',checkout],{maxBuffer:4*1024*1024,timeout:600000,env:{...process.env,HOME:rerHome,RER_SERVER_JOURNEY:'1',RER_LOCAL_OPERATION:''}})
let dev,cleaning,journeyError
function cleanup() {return cleaning??=(async()=>{await dev?.stop();if(!journeyError?.preserveCheckout)await rm(directory,{recursive:true,force:true})})()}
const interrupted=()=>{void cleanup().then(()=>process.exit(1),()=>process.exit(1))}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,interrupted)
try {
 await exec('git',['clone',process.env.STALL_CLONE_SOURCE??'https://github.com/just-every/run-stall.git',checkout])
 if(process.env.GITHUB_SHA)await exec('git',['checkout','--detach',process.env.GITHUB_SHA],{cwd:checkout})
 dev=await startOwnedDev({launcher,checkout,env:{...process.env,HOME:rerHome,RER_SERVER_JOURNEY:'1',RER_LOCAL_OPERATION:''}})
 const event=await dev.ready,ready=event.url,site=event.siteUrl,open=event.openUrl
 assert.ok(ready&&site&&open,'Fresh README launch must produce app, automatic entry and local run-site origins')
 await dev.assertRunning()
 assert.equal((await fetch(ready+'/health')).status,200)
 assert.equal((await fetch(site+'/run')).status,200)
 const plan=await run(['deploy','--help'])
 assert.ok(plan.stdout.includes('deploy'))
 await dev.assertRunning()
 console.log('README fresh clone: pinned installation, local D1 setup, rer dev, health, /run and deploy help passed.')
}catch(error){journeyError=error;throw error}
finally{
 try{await finishCleanup(cleanup,journeyError)}finally{for(const signal of ['SIGINT','SIGTERM'])process.off(signal,interrupted)}
}
