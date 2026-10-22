import type { Bindings } from '../auth.server'
import { audit,commit } from './access'
import { fail,integer,requirePerson,text,type Actor } from './model'
import { staffRoles } from './permissions'
export async function staffSnapshot(env:Bindings,actor:Actor) {
 requirePerson(actor)
 if(actor.role!=='owner') fail('FORBIDDEN','Only the owner manages staff permissions.',403)
 return {staff:(await env.DB.prepare(`SELECT o.id,o.email,o.display_name AS name,o.role,o.status,s.staff_role AS staffRole,s.refund_limit_cents AS refundLimitCents,s.separate_approval AS separateApproval,s.revision FROM oa_operators o LEFT JOIN st_staff s ON s.actor_id=o.id ORDER BY o.email`).all()).results}
}
export async function staffCommand(env:Bindings,actor:Actor,p:any) {
 requirePerson(actor)
 if(actor.role!=='owner') fail('FORBIDDEN','Only the owner manages staff permissions.',403)
 const id=text(p.actorId,'Staff member'),role=p.staffRole
 const person=await env.DB.prepare("SELECT role,status FROM oa_operators WHERE id=?").bind(id).first<any>()
 if(!person||person.status!=='active'||person.role==='owner') fail('INPUT','Choose an active staff account other than the owner.',400)
 if(role!==null&&!staffRoles.includes(role)) fail('INPUT','Choose a functional staff role or revoke the grant.',400)
 const limit=integer(p.refundLimitCents??0,'Refund limit'),separation=p.separateApproval!==false
 const statements=role===null?[env.DB.prepare('DELETE FROM st_staff WHERE actor_id=?').bind(id)]:[env.DB.prepare(`INSERT INTO st_staff VALUES(?,?,?,?,?) ON CONFLICT(actor_id) DO UPDATE SET staff_role=excluded.staff_role,refund_limit_cents=excluded.refund_limit_cents,separate_approval=excluded.separate_approval,revision=excluded.revision`).bind(id,role,limit,separation?1:0,crypto.randomUUID())]
 // An administrator grant is functional and never elevates Base identity/provider control.
 await commit(env.DB,actor,[...statements,audit(env.DB,actor,id,role?'staff.permissions.changed':'staff.permissions.revoked')])
 return staffSnapshot(env,actor)
}
