import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { installation } from './harness.mjs'

test('invited people use the keyed one-click dev entry and canceled invitations stay closed', async () => {
 const key='test-development-key-which-is-long-enough-for-the-gate'
 const h=await installation({entry:resolve('tests/api/dev-worker.ts'),origin:'http://localhost',bindings:{AUTH_LOCAL:'true',RER_DEV_KEY:key}})
 try {
  const invited='maker@example.test', canceled='canceled@example.test'
  await h.api('/auth/invite',{email:invited,displayName:'Harbour maker',role:'member',returnTo:'/app'})
  await h.api('/auth/invite',{email:canceled,displayName:'Canceled maker',role:'member',returnTo:'/app'})
  const target=await h.db.prepare('SELECT id FROM oa_operators WHERE email=?').bind(canceled).first()
  await h.api('/auth/invite/cancel',{operatorId:target.id})
  assert.equal((await h.request('/__dev/personas',{as:''})).status,404)
  const headers={'x-rer-dev-key':key}
  const people=await h.api('/__dev/personas',undefined,{headers})
  assert.ok(people.some(person=>person.as===invited&&person.displayName==='Harbour maker'))
  assert.ok(!people.some(person=>person.as===canceled))
  const page=await h.request('/signin',{headers})
  assert.ok((await page.text()).includes(encodeURIComponent(invited)))
  const response=await h.request('/auth/dev/enter?as='+encodeURIComponent(invited),{as:'',headers})
  assert.equal(response.status,303)
  const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  const session=await h.api('/auth/session',undefined,{as:cookie})
  assert.equal(session.operator.email,invited)
  assert.equal(session.operator.role,'member')
  const before=await h.db.prepare('SELECT COUNT(*) AS count FROM oa_sessions WHERE operator_id=?').bind(session.operator.id).first()
  assert.equal((await h.request('/auth/dev/enter?as='+encodeURIComponent(invited),{as:cookie,headers})).status,303)
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM oa_sessions WHERE operator_id=?').bind(session.operator.id).first()).count,before.count)
  assert.equal((await h.db.prepare('SELECT kind FROM oa_sessions WHERE operator_id=? ORDER BY created_at DESC LIMIT 1').bind(session.operator.id).first()).kind,'dev')
  assert.equal((await h.request('/auth/dev/enter?as='+encodeURIComponent(canceled),{as:'',headers})).status,404)
  assert.equal((await h.request('/auth/dev/enter?as=unknown%40example.test',{as:'',headers})).status,404)
 }finally{await h.close()}
})
