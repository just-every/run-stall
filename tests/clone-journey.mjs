import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
const exec=promisify(execFile),directory=await mkdtemp(join(tmpdir(),'stall-readme-'))
const checkout=join(directory,'run-stall'),launcher=resolve('node_modules/@runeditrun/rer/global/rer.mjs')
const run=(args)=>exec(process.execPath,[launcher,...args,'--cwd',checkout],{maxBuffer:4*1024*1024,timeout:600000,env:{...process.env,RER_SERVER_JOURNEY:'1',RER_LOCAL_OPERATION:''}})
try {
 await exec('git',['clone',process.env.STALL_CLONE_SOURCE??'https://github.com/just-every/run-stall.git',checkout])
 if(process.env.GITHUB_SHA)await exec('git',['checkout','--detach',process.env.GITHUB_SHA],{cwd:checkout})
 let result
 try {result=await run(['dev','--detach'])}catch(error){throw Error(`Fresh-clone rer dev failed (${error.code}). Run rer dev in the clone for the private diagnostic.`)}
 const ready=result.stdout.match(/^RER_READY (\S+)/m)?.[1],site=result.stdout.match(/^RER_SITE (\S+)/m)?.[1]
 assert.ok(ready&&site,'Fresh README launch must produce app and local run-site origins')
 assert.equal((await fetch(ready+'/health')).status,200)
 assert.equal((await fetch(site+'/run')).status,200)
 const plan=await run(['deploy','--help'])
 assert.ok(plan.stdout.includes('deploy'))
 console.log('README fresh clone: pinned installation, local D1 setup, rer dev, health, /run and deploy help passed.')
}finally{
 await run(['dev','--stop']).catch(()=>{})
 await rm(directory,{recursive:true,force:true})
}
