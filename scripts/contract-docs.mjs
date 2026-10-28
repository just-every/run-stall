// Derive acceptance and status summaries from the seed's single contract source.
import { readFile, writeFile } from 'node:fs/promises'
import { parseContract } from '../src/base/seed-contract.mjs'

const mode = process.argv[2]
if (!['write', 'check'].includes(mode)) throw new Error('Use contract-docs.mjs write or check.')
const original = await readFile('CONTRACT.md', 'utf8')
const lines = original.split('\n')
const rows = lines.filter(line => /^\| `[A-Z][A-Z0-9-]*\d` \|/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
const count = selected => ['done', 'partial', 'missing'].map(status => selected.filter(row => row[3] === status).length)
let contract = original
for (const [label, selected] of [['Published', rows.filter(row => row[2] === 'published')], ['Target and push further', rows.filter(row => row[2] !== 'published')], ['All', rows]]) {
 const summary = `| ${label} | ${count(selected).join(' | ')} | ${selected.length} |`
 contract = contract.replace(new RegExp('^\\| ' + label + ' \\|.*$', 'm'), summary)
}
const parsed = parseContract(contract)
const note = '<!-- Generated from CONTRACT.md by scripts/contract-docs.mjs. -->'
let acceptance = `# Target acceptance\n\n${note}\n\nCONTRACT.md is the acceptance and status source. The journeys, evidence and gaps below are generated from it.\n\n`
let area = ''
for (const clause of parsed.clauses) {
 if (clause.area !== area) { area = clause.area; acceptance += `## ${area}\n\n` }
 const start = clause.line - 1
 let end = start + 1
 while (end < lines.length && !/^(?:- \*\*[A-Z][A-Z0-9-]*\d|#{1,3} )/.test(lines[end])) end++
 const definition = lines.slice(start, end).join('\n').trim()
 const row = rows.find(row => row[0] === '`' + clause.id + '`')
 acceptance += `${definition}\n\n  **Status:** ${clause.status}.\n\n  **Current evidence:** ${row[4] || 'None recorded.'}\n\n  **Remaining gap:** ${row[5] || 'None.'}\n\n`
}
acceptance += `Total: ${parsed.counts.total} clauses; ${parsed.counts.done} done, ${parsed.counts.partial} partial, ${parsed.counts.missing} missing.\n`
const claims = `# Current contract claims\n\n${note}\n\n| Clause | Capability | Status | Implemented evidence | Remaining boundary |\n| --- | --- | --- | --- | --- |\n` +
 rows.map(row => `| ${row[0]} | ${row[1]} | ${row[3]} | ${row[4]} | ${row[5]} |`).join('\n') + '\n'
let stale = false
for (const [path, content] of [['CONTRACT.md', contract], ['ACCEPTANCE.md', acceptance], ['docs/CLAIMS.md', claims]]) {
 if (await readFile(path, 'utf8') === content) continue
 if (mode === 'write') await writeFile(path, content)
 else { console.error(`Stale generated contract document: ${path}`); stale = true }
}
if (stale) process.exitCode = 1
else console.log(`Contract documents ${mode === 'write' ? 'generated' : 'fresh'}; ${parsed.counts.total} clauses.`)
