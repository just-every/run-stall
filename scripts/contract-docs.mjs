import { readFileSync, writeFileSync } from 'node:fs'
import { parseContract } from '../src/base/seed-contract.mjs'

// Scoped regeneration preserves unrelated campaign rows and established document sections.
const [mode, ...ids] = process.argv.slice(2)
if (!['write', 'check'].includes(mode) || !ids.length) throw new Error('Usage: contract-docs.mjs write|check CLAUSE-ID ...')
let contract = readFileSync('CONTRACT.md', 'utf8')
const rows = contract.split('\n').filter(line => /^\| `[^`]+` \|/.test(line)).map(line => {
 const [, id, title, kind, status, evidence, gap] = line.split('|').map(cell => cell.trim())
 return { id: id.replaceAll('`', ''), title, kind, status, evidence, gap }
})
const counts = selected => ['done', 'partial', 'missing'].map(status => selected.filter(row => row.status === status).length).concat(selected.length)
for (const [label, selected] of [['Published', rows.filter(row => row.kind === 'published')], ['Target and push further', rows.filter(row => row.kind !== 'published')], ['All', rows]]) {
 const before = contract.split('\n').find(line => line.startsWith(`| ${label} |`))
 if (!before) throw new Error(`Missing contract summary: ${label}`)
 contract = contract.replace(before, `| ${label} | ${counts(selected).join(' | ')} |`)
}
parseContract(contract)
let acceptance = readFileSync('ACCEPTANCE.md', 'utf8'), claims = readFileSync('docs/CLAIMS.md', 'utf8')
for (const id of ids) {
 const row = rows.find(row => row.id === id)
 if (!row) throw new Error(`Unknown clause: ${id}`)
 const start = acceptance.indexOf(`- **${id} — `), next = acceptance.indexOf('\n- **', start + 1)
 if (start < 0) throw new Error(`Missing acceptance clause: ${id}`)
 const end = next < 0 ? acceptance.length : next, before = acceptance.slice(start, end)
 const after = before.replace(/(\.\*\* \*\*)(done|partial|missing)(\*\* —)/, `$1${row.status}$3`).replace(/^  Current evidence:.*$/m, `  Current evidence: ${row.evidence || 'No implementation found.'}${row.gap ? ` Gap: ${row.gap}` : ''}`)
 if (!after.includes(`**${row.status}** —`)) throw new Error(`Unrecognized acceptance shape: ${id}`)
 acceptance = acceptance.slice(0, start) + after + acceptance.slice(end)
 const claim = claims.split('\n').find(line => line.startsWith('|') && line.split('|')[1].includes(`(${id},`))
 if (claim) {
  const label = claim.split('|')[1].trim().replace(new RegExp(`\\(${id}, (?:done|partial|missing)\\)`), `(${id}, ${row.status})`)
  claims = claims.replace(claim, `| ${label} | ${row.evidence} | ${row.gap} |`)
 }
}
const [done, partial, missing, total] = counts(rows)
acceptance = acceptance.replace(/All clause totals: \*\*\d+ done \/ \d+ partial \/ \d+ missing\*\* \(\d+ total\)\./, `All clause totals: **${done} done / ${partial} partial / ${missing} missing** (${total} total).`)
for (const [path, expected] of [['CONTRACT.md', contract], ['ACCEPTANCE.md', acceptance], ['docs/CLAIMS.md', claims]]) {
 if (mode === 'write') writeFileSync(path, expected)
 else if (readFileSync(path, 'utf8') !== expected) throw new Error(`Stale generated contract documentation: ${path}`)
}
console.log(`Contract documentation ${mode} passed: ${ids.join(', ')}; ${done} done, ${partial} partial, ${missing} missing.`)
