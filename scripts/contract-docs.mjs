import { readFileSync,writeFileSync } from 'node:fs'
import { parseContract } from '../src/base/seed-contract.mjs'

// Scoped projections preserve every other clause's established document content.
// Extend this list when a later campaign adopts the same canonical projection.
const scope=['PROMO-001'],source=readFileSync('CONTRACT.md','utf8'),contract=parseContract(source)
const outputs=new Map(['ACCEPTANCE.md','docs/CLAIMS.md'].map(path=>[path,readFileSync(path,'utf8')]))
for(const id of scope) {
 const clause=contract.clauses.find(c=>c.id===id)
 if(!clause)throw Error('Missing canonical clause '+id)
 const cells=source.split('\n')[clause.row-1].split(/(?<!\\)\|/).slice(1,-1).map(c=>c.trim()),evidence=cells[4],gap=cells[5]
 const marker='**Acceptance evidence:**',journey=clause.text.slice(clause.text.indexOf(marker)+marker.length).trim()
 if(!clause.text.includes(marker)||!journey)throw Error('Missing canonical acceptance journey '+id)
 let acceptance=outputs.get('ACCEPTANCE.md'),start=acceptance.indexOf('- **'+id+' — ')
 if(start<0)throw Error('Missing acceptance projection '+id)
 const rest=acceptance.slice(start+1),offset=rest.search(/\n(?:- \*\*|#{1,3} )/),end=offset<0?acceptance.length:start+1+offset
 acceptance=acceptance.slice(0,start)+`- **${id} — ${clause.title}.** **${clause.status}** — ${journey}\n\n  Current evidence: ${evidence}${gap?' Gap: '+gap:''}\n`+acceptance.slice(end)
 outputs.set('ACCEPTANCE.md',acceptance)
 const claims=outputs.get('docs/CLAIMS.md').split('\n'),index=claims.findIndex(line=>line.startsWith('| Promotions ('+id+','))
 if(index<0)throw Error('Missing claims projection '+id)
 claims[index]=`| Promotions (${id}, ${clause.status}) | ${evidence} | ${gap} |`
 outputs.set('docs/CLAIMS.md',claims.join('\n'))
}
const mode=process.argv[2]
if(!['write','check'].includes(mode)||process.argv.length!==3)throw Error('Usage: node scripts/contract-docs.mjs write|check')
for(const [path,output] of outputs) {
 if(mode==='write')writeFileSync(path,output)
 else if(readFileSync(path,'utf8')!==output)throw Error('Stale contract projection: '+path)
}
console.log('Contract projections '+(mode==='write'?'written':'current')+': '+scope.join(', '))
