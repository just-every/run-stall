// Synchronize selected legacy-format derived rows from the contract without
// rewriting another builder's acceptance or evidence paragraphs.
import { readFile,writeFile } from 'node:fs/promises'
import { parseContract } from '../src/base/seed-contract.mjs'
const [mode,...ids]=process.argv.slice(2)
if(!['write','check'].includes(mode)||!ids.length)throw Error('Usage: contract-docs.mjs write|check CLAUSE-ID [CLAUSE-ID ...]')
let source=await readFile('CONTRACT.md','utf8')
const lines=source.split('\n'),cells=line=>line.trim().slice(1,-1).split(/(?<!\\)\|/).map(s=>s.trim())
const status=lines.filter(line=>/^\| `[^`]+` \|/.test(line)).map(cells).filter(row=>['published','target','push-further'].includes(row[2])&&['done','partial','missing'].includes(row[3])),count=rows=>['done','partial','missing'].map(state=>rows.filter(row=>row[3]===state).length)
for(const [label,rows] of [['Published',status.filter(row=>row[2]==='published')],['Target and push further',status.filter(row=>row[2]!=='published')],['All',status]]){
 const [done,partial,missing]=count(rows),index=lines.findIndex(line=>line.startsWith('| '+label+' |'))
 if(index<0)throw Error('Missing contract summary '+label)
 lines[index]=`| ${label} | ${done} | ${partial} | ${missing} | ${rows.length} |`
}
source=lines.join('\n')
const contract=parseContract(source),selected=ids.map(id=>{const clause=contract.clauses.find(c=>c.id===id);if(!clause)throw Error('Unknown clause '+id);return clause})
let acceptance=await readFile('ACCEPTANCE.md','utf8'),claims=await readFile('docs/CLAIMS.md','utf8')
for(const clause of selected){
 const row=cells(source.split('\n')[clause.row-1]),journey=clause.text.split('**Acceptance evidence:**')[1]?.trim()
 if(!journey)throw Error('No acceptance journey for '+clause.id)
 const body=`- **${clause.id} — ${clause.title}.** **${clause.status}** — ${journey}\n\n  Current evidence: ${row[4]}${row[5]?' Gap: '+row[5]:''}\n\n`
 const begin=acceptance.indexOf('- **'+clause.id+' — ')
 if(begin<0)throw Error('Missing acceptance row '+clause.id)
 const following=acceptance.indexOf('\n- **',begin+1),heading=acceptance.indexOf('\n##',begin+1),end=Math.min(...[following,heading,acceptance.length].filter(n=>n>=0))
 acceptance=acceptance.slice(0,begin)+body+acceptance.slice(end).replace(/^\n/,'')
 const claimLines=claims.split('\n'),index=claimLines.findIndex(line=>line.startsWith('|')&&line.includes('('+clause.id+','))
 if(index<0)throw Error('Missing claim row '+clause.id)
 claimLines[index]=`| ${clause.title} (${clause.id}, ${clause.status}) | ${row[4]} | ${row[5]} |`;claims=claimLines.join('\n')
}
for(const [path,value] of [['CONTRACT.md',source],['ACCEPTANCE.md',acceptance],['docs/CLAIMS.md',claims]]){
 const old=await readFile(path,'utf8');if(old===value)continue
 if(mode==='check')throw Error(path+' is stale; regenerate the selected clause rows')
 await writeFile(path,value)
}
console.log('Contract documents '+mode+' passed for '+ids.join(', '))
