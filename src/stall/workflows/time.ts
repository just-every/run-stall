import { fail } from '../model'

const partsFormat=(zone:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
export function localParts(at:number,zone:string) {
 const p=Object.fromEntries(partsFormat(zone).formatToParts(at).map(p=>[p.type,p.value]))
 return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)}
}
export function date(value:unknown) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value) fail('INPUT','Use a real calendar date as YYYY-MM-DD.',400)
 return value
}
export function minute(value:unknown) {
 if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('INPUT','Use a local time as HH:mm.',400)
 return Number(value.slice(0,2))*60+Number(value.slice(3))
}
export function shiftDate(day:string,days:number) {return new Date(Date.parse(day+'T00:00:00Z')+days*86400000).toISOString().slice(0,10)}
const wall=(at:number,zone:string)=>{const p=localParts(at,zone);return Date.parse(p.date+'T00:00:00Z')+p.minute*60000}
/** Offset candidates on both sides of a transition. A repeated time selects its
 * first occurrence; a skipped time selects the first minute after the gap. */
export function localInstant(day:string,minutes:number,zone:string):number {
 const target=Date.parse(day+'T00:00:00Z')+minutes*60000,offsets=new Set<number>()
 for(let h=-48;h<=48;h+=6) {const at=target+h*3600000;offsets.add(wall(at,zone)-at)}
 const candidates=[...offsets].map(offset=>target-offset).sort((a,b)=>a-b)
 const exact=candidates.filter(at=>wall(at,zone)===target)
 if(exact.length) return exact[0]
 for(let at=candidates[0];at<=candidates.at(-1)!;at+=60000) if(wall(at,zone)>=target) return at
 return fail('TIME_ZONE','The local schedule could not be resolved.',400)
}
export function quietRelease(at:number,zone:string,quiet?:{start:string;end:string}) {
 if(!quiet) return at
 const start=minute(quiet.start),end=minute(quiet.end),local=localParts(at,zone)
 const inside=start<end?local.minute>=start&&local.minute<end:local.minute>=start||local.minute<end
 if(!inside) return at
 const day=start>end&&local.minute>=start?shiftDate(local.date,1):local.date
 return Math.max(at,localInstant(day,end,zone))
}
