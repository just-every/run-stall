import type { ImportJob, RetainedOriginal } from '../../modules/import-kit/src/types'
import { humanLabel, shortId } from './presentation'
import { Badge, Empty, JsonDetail } from './primitives'

export interface Journal { job: ImportJob; originals: RetainedOriginal[]; undoReport: unknown }

export function ImportJournal({ jobs, journal, busy, onOpen, onUndo, onResume }: {
  jobs: ImportJob[]; journal: Journal | null; busy: boolean; onOpen: (id: string) => void; onUndo: (id: string) => void; onResume: () => void
}) {
  return <div className="st-stack">
    <h2>Import journal</h2>
    {jobs.length === 0 ? <Empty><h3>No imports recorded</h3>Applied imports will appear here with their progress and undo history.</Empty> :
      <div className="st-table-wrap"><table><caption className="st-sr-only">Product import jobs</caption><thead><tr><th scope="col">Job</th><th scope="col">Status</th><th scope="col">Progress</th><th scope="col">Journal</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><th scope="row">{`Import ${shortId(job.id)}`}<small>{job.namespace}</small></th><td>{humanLabel(job.state)}</td><td>{job.checkpoint} / {job.total}</td><td><button className="st-secondary" onClick={() => onOpen(job.id)} disabled={busy}>View</button></td></tr>)}</tbody></table></div>}
    {journal && <div className="st-panel st-stack">
      <div className="st-heading-row"><h3>Import {shortId(journal.job.id)}</h3><Badge value={journal.job.state} /></div>
      <p>{journal.job.checkpoint} / {journal.job.total} records processed · {journal.job.namespace}</p>
      {journal.job.error && <p role="alert">{journal.job.error}</p>}
      <JsonDetail value={journal.job} label="Job journal" />
      <JsonDetail value={journal.originals.map(original => ({ name: original.name, size: original.size, status: original.original.status, sha256: original.sha256 }))} label="Source custody" />
      <JsonDetail value={journal.undoReport} label="Undo report" />
      {['queued', 'applying', 'failed'].includes(journal.job.state) && <>
        <p>Resume the next batch from this job’s retained CSV and reviewed fingerprint.</p>
        <div className="st-actions"><button disabled={busy || !journal.originals.some(original => original.original.status === 'retained')} onClick={onResume}>Resume apply from retained source</button></div>
      </>}
      {!['undone', 'rolled_back'].includes(journal.job.state) && <>
        <p>Undo restores products only where later changes and commerce history permit it. Review the undo report for anything preserved.</p>
        <button className="st-danger" disabled={busy} onClick={() => onUndo(journal.job.id)}>{journal.job.state === 'undoing' ? 'Resume undo' : 'Review undo'}</button>
      </>}
    </div>}
  </div>
}
