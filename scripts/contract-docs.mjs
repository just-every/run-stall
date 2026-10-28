// Synchronize selected clause projections while preserving other writers' rows.
import { readFile, writeFile } from 'node:fs/promises'
import { parseContract } from '../src/base/seed-contract.mjs'

const [mode, ...requested] = process.argv.slice(2)
if (!['write', 'check'].includes(mode)) throw Error('Usage: contract-docs.mjs write|check [CLAUSE ...]')
const original = await readFile('CONTRACT.md', 'utf8')
const statuses = original.split('\n').filter(line => /^\| `[A-Z][A-Z0-9-]+` \|/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
const groups = { Published: ['published'], Target: ['target'], 'Push further': ['push-further'], 'Target and push further': ['target', 'push-further'], All: ['published', 'target', 'push-further'] }
const source = original.replace(/^\| (Published|Target|Push further|Target and push further|All) \| \d+ \| \d+ \| \d+ \| \d+ \|$/gm, (_line, group) => {
  const rows = statuses.filter(row => groups[group].includes(row[2]))
  return `| ${group} | ${['done', 'partial', 'missing'].map(status => rows.filter(row => row[3] === status).length).join(' | ')} | ${rows.length} |`
})
const contract = parseContract(source)
let acceptance = await readFile('ACCEPTANCE.md', 'utf8'), claims = await readFile('docs/CLAIMS.md', 'utf8')
const managed = [...acceptance.matchAll(/<!-- contract-docs:([A-Z][A-Z0-9-]+) -->/g)].map(match => match[1])
const ids = [...new Set(requested.length ? requested : managed)]
if (!ids.length) throw Error('Select the clauses to project on the first write.')
for (const id of ids) {
  const clause = contract.clauses.find(clause => clause.id === id)
  if (!clause) throw Error(`Unknown contract clause: ${id}`)
  const [, , , , evidence, gap] = source.split('\n')[clause.row - 1].split('|').slice(1, -1).map(cell => cell.trim())
  const journey = clause.text.split('**Acceptance evidence:**')[1]?.trim()
  if (!journey) throw Error(`${id} has no acceptance journey.`)
  const start = `<!-- contract-docs:${id} -->`, end = `<!-- /contract-docs:${id} -->`
  const project = (document, content, legacy) => {
    const first = document.indexOf(start), last = document.indexOf(end)
    const block = `${start}\n${content}\n${end}`
    if (first >= 0) {
      if (last < first) throw Error(`Incomplete projection for ${id}`)
      return document.slice(0, first) + block + document.slice(last + end.length)
    }
    const match = legacy.exec(document)
    return match ? document.slice(0, match.index) + block + '\n\n' + document.slice(match.index + match[0].length) : document.trimEnd() + '\n\n' + block + '\n'
  }
  acceptance = project(acceptance, `- **${id} — ${clause.title}.** **${clause.status}** — ${journey}\n\n  Current evidence: ${evidence || 'No implementation found.'}${gap ? `\n\n  Remaining: ${gap}` : ''}`, new RegExp(`^- \\*\\*${id} —[^]*?(?=^- \\*\\*|^#{1,3} |$(?![^]))`, 'm'))
  claims = project(claims, `| Capability | Implemented evidence | Remaining boundary |\n| --- | --- | --- |\n| ${clause.title} (${id}, ${clause.status}) | ${evidence} | ${gap} |`, new RegExp(`^\\| [^\\n]*\\(${id},[^\\n]*\\n`, 'm'))
}
const { done, partial, missing, total } = contract.counts
acceptance = acceptance.replace(/^All clause totals:.*$/m, `All clause totals: **${done} done, ${partial} partial, ${missing} missing** (${total} total).`)
const outputs = [['CONTRACT.md', source], ['ACCEPTANCE.md', acceptance], ['docs/CLAIMS.md', claims]]
for (const [path, contents] of outputs) {
  if (mode === 'write') await writeFile(path, contents)
  else if (await readFile(path, 'utf8') !== contents) throw Error(`${path} is stale; run node scripts/contract-docs.mjs write.`)
}
console.log(`Contract projections ${mode}: ${ids.join(', ')}; ${done} done, ${partial} partial, ${missing} missing.`)
