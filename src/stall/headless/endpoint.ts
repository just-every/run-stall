import { fail,text } from '../model'
/** Public, DNS-named HTTPS endpoints only. No IP literals, custom ports,
 * credentials, fragments, redirects, or special-use hostnames. */
export function endpoint(value:unknown) {
 const raw=text(value,'Event endpoint',1800);let u:URL
 try {u=new URL(raw)}catch{return fail('ENDPOINT','Use a public HTTPS endpoint.',400)}
 const h=u.hostname.toLowerCase()
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!publicName(h)) fail('ENDPOINT','Use a public DNS-named HTTPS endpoint on port 443.',400)
 return u
}
function publicName(h:string) {
 if(h.length>253||!h.includes('.')||!h.split('.').every(p=>/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(p))||/^[\d.]+$/.test(h)) return false
 return !['localhost','local','internal','lan','home','test','invalid','example','onion','arpa'].some(s=>h===s||h.endsWith('.'+s))&&!h.endsWith('.localhost')
}
export function publicAddress(value:string):boolean {
 if(/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
  const p=value.split('.').map(Number),[a,b,c]=p
  if(p.some(n=>!Number.isInteger(n)||n<0||n>255)) return false
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===88&&c===99))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113))
 }
 if(!/^[a-f\d:]+$/i.test(value)||!value.includes(':')) return false
 const halves=value.toLowerCase().split('::')
 if(halves.length>2) return false
 const left=halves[0]?halves[0].split(':'):[],right=halves.length===2&&halves[1]?halves[1].split(':'):[]
 if([...left,...right].some(p=>!p.length||p.length>4)) return false
 const missing=8-left.length-right.length
 if(halves.length===1?left.length!==8:missing<1) return false
 const words=(halves.length===1?left:[...left,...Array(missing).fill('0'),...right]).map(p=>parseInt(p,16))
 // Globally routable IPv6 only; exclude documentation, transition and special
 // protocol blocks (including mapped/translated IPv4 and 6to4 routes).
 return words[0]>=0x2000&&words[0]<=0x3fff&&words[0]!==0x2002&&!(words[0]===0x2001&&(words[1]<0x200||words[1]===0xdb8))&&!(words[0]===0x3fff&&words[1]<0x1000)
}
export async function checkedEndpoint(value:unknown) {
 const u=endpoint(value)
 const answers=await Promise.all(['A','AAAA'].map(async type=>{
  const query=new URL('https://cloudflare-dns.com/dns-query');query.searchParams.set('name',u.hostname);query.searchParams.set('type',type)
  const response=await fetch(query,{headers:{accept:'application/dns-json'},redirect:'manual',signal:AbortSignal.timeout(5000)})
  if(!response.ok) fail('ENDPOINT_DNS','Endpoint DNS verification is unavailable; nothing was sent.',503)
  const dns:any=await response.json()
  if(dns.Status!==0||!Array.isArray(dns.Answer??[])) fail('ENDPOINT_DNS','Endpoint DNS verification failed; nothing was sent.',400)
  const records=dns.Answer??[]
  for(const answer of records) {
   if((answer.type===1||answer.type===28)&&(!publicAddress(answer.data))) fail('ENDPOINT_PRIVATE','Endpoint resolves to a private or special-use address.',400)
   if(answer.type===5&&!publicName(String(answer.data).replace(/\.$/,''))) fail('ENDPOINT_PRIVATE','Endpoint aliases a private or special-use hostname.',400)
  }
  return records.filter((r:any)=>r.type===1||r.type===28)
 }))
 if(!answers.flat().length) fail('ENDPOINT_DNS','Endpoint has no verified public address; nothing was sent.',400)
 return u
}
