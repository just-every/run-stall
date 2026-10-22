// Runner isolation must not point Chromium at a scratch HOME/keychain. RER's
// own scratch HOME remains private to startOwnedDev inside each journey.
import { userInfo } from 'node:os'
import { spawn } from 'node:child_process'
const script=process.argv[2]
if(!script)throw new Error('Supply a browser journey script.')
const child=spawn(process.execPath,[script,...process.argv.slice(3)],{stdio:'inherit',env:{...process.env,HOME:userInfo().homedir}})
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal))
child.once('error',error=>{console.error(error.message);process.exitCode=1})
child.once('exit',code=>{process.exitCode=code??1})
