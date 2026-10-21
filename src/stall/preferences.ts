import type { Bindings } from '../auth.server'
import { audit,commit } from './access'
import { fail,requirePerson,text,type Actor } from './model'

export const defaultTimeZone='America/Chicago'
export function canonicalTimeZone(value:unknown):string {
 const zone=text(value,'Business time zone',100)
 if(!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(zone)) fail('TIME_ZONE','Choose a named IANA time zone, such as America/Chicago.',400)
 try { return new Intl.DateTimeFormat('en-US',{timeZone:zone}).resolvedOptions().timeZone }
 catch { return fail('TIME_ZONE','Choose a supported IANA time zone, such as America/Chicago.',400) }
}
export async function businessTimeZone(db:D1Database):Promise<string> {
 const row=await db.prepare('SELECT time_zone FROM st_preferences WHERE id=1').first<{time_zone:string}>()
 return row?canonicalTimeZone(row.time_zone):defaultTimeZone
}
export async function configureShop(env:Bindings,actor:Actor,p:any) {
 requirePerson(actor)
 const timeZone=canonicalTimeZone(p.timeZone)
 await commit(env.DB,actor,[env.DB.prepare('INSERT INTO st_preferences(id,time_zone) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET time_zone=excluded.time_zone').bind(timeZone),audit(env.DB,actor,'shop','shop.configured')])
 return {timeZone}
}
