import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { installation, archive, restore } from './harness.mjs';
import { pierInstallation } from './pier.mjs';
import { stripeEdge, deliverWebhook, purchase } from './network.mjs';
const base = '/api/stall/imports';
const csvFor = (sku, title = 'A product', published = 'TRUE') => `Handle,Title,Body (HTML),Variant SKU,Variant Price,Published\n${sku.toLowerCase()},${title},<p>Product description</p>,${sku},12.34,${published}\n`;
const product = async (h, sku) => {
  const row = await h.db.prepare('SELECT value_json,revision FROM st_products WHERE id=?').bind(sku).first();
  return row ? { value: JSON.parse(row.value_json), revision: row.revision } : null;
};
async function apply(h, csv) {
  const preview = await h.api(`${base}/preview`, { csv });
  let job;
  do { job = await h.api(`${base}/apply`, { csv, fingerprint: preview.fingerprint }); } while (job.state === 'applying');
  assert.equal(job.state, 'completed');
  return { preview, job };
}
async function undo(h, job, { bounded = false } = {}) {
  let result;
  for (let request = 0; request <= job.total; request++) {
    result = await h.api(`${base}/${job.id}/undo`, {});
    if (request === 0 && bounded) assert.equal(result.state, 'undoing', 'bulk undo yields before processing the whole catalogue');
    if (result.state !== 'undoing') break;
  }
  assert.equal(result.state, 'undone');
  return (await h.api(`${base}/${job.id}`)).undoReport;
}
test('Shopify move-in through the authenticated Stall API', async t => {
  const h = await installation();
  try {
    await t.test('anonymous and members cannot preview, apply or undo', async () => {
      for (const suffix of ['preview', 'apply', 'not-a-job/undo']) {
        await h.api(`${base}/${suffix}`, { csv: csvFor('DENIED') }, { as: '', status: 401 });
      }
      const member = await h.signIn('buyer@example.test');
      await h.api(`${base}/preview`, { csv: csvFor('DENIED') }, { as: member, status: 403 });
      assert.equal(await product(h, 'DENIED'), null);
    });
    await t.test('preview is read-only, exact human apply stages drafts and journal retains source', async () => {
      const csv = await readFile(new URL('../../fixtures/shopify-products.csv', import.meta.url), 'utf8');
      const preview = await h.api(`${base}/preview`, { csv });
      assert.equal(preview.counts.mapped, 2);
      assert.equal((await h.api(base)).jobs.length, 0);
      assert.equal(await product(h, 'MUG-BLUE'), null);
      await h.api(`${base}/apply`, { csv }, { status: 409 });
      await h.api(`${base}/apply`, { csv: csv.replace('24.50', '26.50'), fingerprint: preview.fingerprint }, { status: 409 });
      assert.equal(await product(h, 'MUG-BLUE'), null);
      const body = { csv, fingerprint: preview.fingerprint };
      const job = await h.api(`${base}/apply`, body);
      assert.equal(job.state, 'completed');
      assert.equal((await h.api(`${base}/apply`, body)).id, job.id);
      const mug = await product(h, 'MUG-BLUE');
      assert.equal(mug.value.active, false);
      assert.equal(mug.value.unitCents, 2450);
      const journal = await h.api(`${base}/${job.id}`);
      const original = journal.originals.find(item => item.original.status === 'retained');
      assert.equal(Buffer.from(original.original.base64, 'base64').toString('utf8'), csv);
      assert.ok((await h.api(base)).jobs.some(item => item.id === job.id));
      assert.equal((await h.api(`${base}/${job.id}/undo`, {})).state, 'undone');
      assert.equal(await product(h, 'MUG-BLUE'), null);
      assert.equal(await product(h, 'TOWEL-NAT'), null);
      assert.equal((await h.api(`${base}/${job.id}`)).job.state, 'undone');
    });
    await t.test('agent can preview but cannot apply or undo; revoked grants cannot preview', async () => {
      const grant = await h.api('/api/stall/agent-token', {});
      const headers = { authorization: `Bearer ${grant.token}` };
      const csv = csvFor('AGENT');
      const preview = await h.api(`${base}/preview`, { csv }, { as: '', headers });
      await h.api(`${base}/apply`, { csv, fingerprint: preview.fingerprint }, { as: '', headers, status: 403 });
      const { job } = await apply(h, csv);
      await h.api(`${base}/${job.id}/undo`, {}, { as: '', headers, status: 403 });
      await h.api('/api/stall/agent-token/revoke', {});
      await h.api(`${base}/preview`, { csv }, { as: '', headers, status: 401 });
    });
    await t.test('BASE-001: hostile descriptions become plain text; malformed and unsupported source rows never write products', async () => {
      for (const csv of [
        csvFor('BAD').replace('Published\n', 'Published,Variant Inventory Qty\n'),
        csvFor('BAD') + 'bad,Another product,,BAD,9.99,FALSE\n',
        csvFor('BAD') + 'bad,Another variant,,OTHER-SKU,9.99,FALSE\n',
        csvFor('BAD').replace('<p>Product description</p>', '"Unclosed description'),
      ]) await h.api(`${base}/preview`, { csv }, { status: 409 });
      for (const csv of [
        csvFor('BAD').replace('12.34', '12.345'),
        csvFor('BAD').replace('12.34', '1e3'),
        csvFor('BAD', ''),
        csvFor('BAD').replace(',BAD,', ',BAD SKU,'),
        csvFor('BAD', 'A product', 'MAYBE'),
      ]) {
        const preview = await h.api(`${base}/preview`, { csv });
        assert.equal(preview.counts.rejected, 1);
        assert.equal(preview.counts.effects, 0);
        assert.ok(preview.plan.entries.every(entry => entry.effects.length === 0));
        const rejected = preview.diagnostics.filter(item => item.code === 'REJECTED');
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].location.row, 2);
        await h.api(`${base}/apply`, { csv, fingerprint: preview.fingerprint }, { status: 409 });
        await h.api(`${base}/apply`, { csv, fingerprint: preview.fingerprint, excludedRows: [2] }, { status: 409 });
        assert.equal(await product(h, 'BAD'), null, 'an entirely rejected source never writes products');
      }
      assert.equal(await product(h, 'BAD'), null);
      const hostile=csvFor('SAFE-TEXT').replace('<p>Product description</p>','<scr<b>ipt>globalThis.stallUnsafe=1</scr<b>ipt><p>Care &amp; use</p>&lt;img src=x onerror=alert(1)&gt;');
      await apply(h,hostile);
      const imported=(await h.api('/api/stall/state')).products.find(p=>p.id==='SAFE-TEXT');
      assert.equal(imported.value.description,'Care & use\n<img src=x onerror=alert(1)>');
      assert.equal(imported.value.active,false);
      assert.doesNotMatch(imported.value.description,/<script|stallUnsafe/i);
    });
    await t.test('CATALOG-002: exact rejected-row acknowledgement applies only valid rows with complete source custody', async () => {
      const namespace = 'stall-catalog-mixed';
      const csv = 'Handle,Title,Body (HTML),Variant SKU,Variant Price,Published\n'
        + 'mixed-first,First valid,<p>First description</p>,csv-row-4,10.01,FALSE\n\n'
        + 'mixed-price,Invalid price,<p>Rejected price</p>,MIXED-PRICE,12.345,FALSE\n'
        + 'mixed-second,Second valid,<p>Second description</p>,MIXED-SECOND,29.99,FALSE\n'
        + 'mixed-publication,Invalid publication,<p>Rejected publication</p>,MIXED-PUBLICATION,14.53,MAYBE\n';
      const before = (await h.api('/api/stall/state')).products;
      const jobsBefore = (await h.api(base)).jobs;
      const preview = await h.api(`${base}/preview`, { csv, namespace });
      assert.equal(preview.counts.input, 4);
      assert.equal(preview.counts.rejected, 2);
      assert.equal(preview.counts.mapped, 2);
      assert.equal(preview.counts.effects, 2);
      const rejected = preview.diagnostics.filter(item => item.code === 'REJECTED').sort((a, b) => a.location.row - b.location.row);
      assert.deepEqual(rejected.map(item => item.location.row), [4, 6], 'diagnostics name physical CSV rows, including blank lines');
      for (const row of [4, 6]) {
        const entry = preview.plan.entries.find(item => item.source.location.row === row);
        assert.ok(entry.rejection);
        assert.deepEqual(entry.effects, []);
        assert.ok(entry.source.sourceId);
        assert.equal(rejected.find(item => item.location.row === row).sourceId, entry.source.sourceId);
      }
      assert.deepEqual((await h.api('/api/stall/state')).products, before, 'mixed dry-run is read-only');
      assert.deepEqual((await h.api(base)).jobs, jobsBefore);
      const body = { csv, namespace, fingerprint: preview.fingerprint, excludedRows: [4, 6] };
      for (const excludedRows of [undefined, [], [4], [2, 6], [4, 6, 6], [4, 6, 7]]) {
        await h.api(`${base}/apply`, { ...body, excludedRows }, { status: 409 });
      }
      await h.api(`${base}/apply`, { ...body, csv: csv.replace('First valid,', 'Changed source,') }, { status: 409 });
      assert.deepEqual((await h.api('/api/stall/state')).products, before, 'refused acknowledgements and changed source write nothing');
      assert.deepEqual((await h.api(base)).jobs, jobsBefore);
      let job = await h.api(`${base}/apply`, body);
      const id = job.id;
      for (let request = 0; job.state === 'applying' && request < preview.counts.input; request++) {
        job = await h.api(`${base}/apply`, body);
        assert.equal(job.id, id);
      }
      assert.equal(job.state, 'completed');
      const expected = [
        { sku: 'csv-row-4', name: 'First valid', description: 'First description', unitCents: 1001, active: false },
        { sku: 'MIXED-SECOND', name: 'Second valid', description: 'Second description', unitCents: 2999, active: false },
      ];
      const exported = (await h.api('/api/stall/exports/records')).products.filter(item => (item.id.startsWith('MIXED-') || item.id === 'csv-row-4'));
      assert.deepEqual(exported.map(item => item.value).sort((a, b) => a.sku.localeCompare(b.sku)), expected);
      const journal = await h.api(`${base}/${id}`);
      assert.deepEqual(journal.rejectedRows.map(item => [item.row, item.sourceId]).sort((a, b) => a[0] - b[0]),
        rejected.map(item => [item.location.row, item.sourceId]));
      assert.match(journal.rejectedRows.find(item => item.row === 4).reason, /price|decimal/i);
      assert.match(journal.rejectedRows.find(item => item.row === 6).reason, /published/i);
      const originals = journal.originals.filter(item => item.original.status === 'retained');
      assert.equal(originals.length, 1);
      assert.equal(Buffer.from(originals[0].original.base64, 'base64').toString('utf8'), csv);
      const attribution = async () => (await h.db.prepare('SELECT id,target_id,record_json FROM ik_provenance WHERE job_id=? ORDER BY target_id').bind(id).all()).results;
      const attributed = await attribution();
      assert.deepEqual(attributed.map(item => item.target_id).sort((a, b) => a.localeCompare(b)), expected.map(item => item.sku));
      const applied = (await h.api('/api/stall/state')).products;
      assert.deepEqual(await h.api(`${base}/apply`, body), job, 'same source, fingerprint and exclusions resume without duplicate work');
      assert.deepEqual((await h.api('/api/stall/state')).products, applied);
      assert.deepEqual(await attribution(), attributed);
      assert.deepEqual((await h.api(`${base}/${id}`)).rejectedRows, journal.rejectedRows);
      const report = await undo(h, job);
      assert.deepEqual((await h.api('/api/stall/state')).products, before, 'undo removes both untouched valid effects and no other records');
      assert.deepEqual(report.dispositions.map(item => [item.targetId, item.disposition]).sort((a, b) => a[0].localeCompare(b[0])),
        expected.map(item => [item.sku, 'reversed']));
    });
    await t.test('native changes invalidate review and survive undo, including unchanged revision edits', async () => {
      const csv = csvFor('FENCED');
      const preview = await h.api(`${base}/preview`, { csv });
      await h.command('product.prepare', { sku: 'FENCED', name: 'Native product', description: '', unitCents: 1500, active: false });
      await h.api(`${base}/apply`, { csv, fingerprint: preview.fingerprint }, { status: 409 });
      const before = await product(h, 'FENCED');
      const { job } = await apply(h, csv);
      assert.equal((await h.api(`${base}/${job.id}/undo`, {})).state, 'undone');
      assert.deepEqual(await product(h, 'FENCED'), before);
      const edited = await apply(h, csvFor('EDITED'));
      await h.db.prepare("UPDATE st_products SET value_json=json_set(value_json,'$.name','Native edit') WHERE id=?").bind('EDITED').run();
      const protectedRow = await product(h, 'EDITED');
      const report = await undo(h, edited.job);
      assert.deepEqual(await product(h, 'EDITED'), protectedRow);
      const retained = report.dispositions.find(item => item.targetId === 'EDITED');
      assert.equal(retained.disposition, 'retained');
      assert.equal(retained.reason, 'edited');
      assert.equal(retained.observed.revision, protectedRow.revision);
      assert.notEqual(retained.expected.valueHash, retained.observed.valueHash);
      assert.ok(retained.evidence.rule);
      assert.deepEqual(retained.protectedBy, []);
      const staleCSV = csvFor('EDITED', 'Replacement');
      const stale = await h.api(`${base}/preview`, { csv: staleCSV });
      await h.db.prepare("UPDATE st_products SET value_json=json_set(value_json,'$.description','Another native edit') WHERE id=?").bind('EDITED').run();
      await h.api(`${base}/apply`, { csv: staleCSV, fingerprint: stale.fingerprint }, { status: 409 });
      assert.equal((await product(h, 'EDITED')).value.description, 'Another native edit');
    });
    await t.test('CATALOG-002: bulk catalogue review, bounded resume and undo preserve native edits and custody', async () => {
      const namespace = 'stall-catalog-bulk';
      const rows = Array.from({ length: 12 }, (_, index) => ({
        sku: `CATALOG-BULK-${index + 1}`, name: `Bulk title ${index + 1}`,
        description: `Updated description ${index + 1}`, unitCents: 2301 + index * 107,
      }));
      for (const [index, row] of rows.entries()) await h.command('product.prepare', {
        sku: row.sku, name: `Native title ${index + 1}`, description: `Native description ${index + 1}`,
        unitCents: 1101 + index * 103, active: false,
      });
      const catalogue = async () => (await h.api('/api/stall/state')).products
        .filter(item => rows.some(row => row.sku === item.id)).sort((a, b) => a.id.localeCompare(b.id));
      const provenance = async id => (await h.db.prepare('SELECT id,target_id,record_json,reversed FROM ik_provenance WHERE job_id=? ORDER BY target_id,id').bind(id).all()).results;
      const csv = 'Handle,Title,Body (HTML),Variant SKU,Variant Price,Published\n' + rows.map(row =>
        `${row.sku.toLowerCase()},${row.name},<p>${row.description}</p>,${row.sku},${Math.floor(row.unitCents / 100)}.${String(row.unitCents % 100).padStart(2, '0')},FALSE\n`).join('');
      const initial = await catalogue();
      const jobsBefore = (await h.api(base)).jobs;
      const review = await h.api(`${base}/preview`, { csv, namespace });
      assert.equal(review.counts.mapped, rows.length);
      assert.equal(review.counts.effects, rows.length);
      assert.deepEqual(await catalogue(), initial, 'dry-run preserves complete native records and revisions');
      assert.deepEqual((await h.api(base)).jobs, jobsBefore, 'dry-run creates no custody job');
      await h.api(`${base}/apply`, { csv: csv.replace('Bulk title 1,', 'Changed source title,'), namespace, fingerprint: review.fingerprint }, { status: 409 });
      assert.deepEqual(await catalogue(), initial);
      const native = initial.find(item => item.id === rows.at(-1).sku);
      await h.command('product.prepare', { sku: native.id, revision: native.revision,
        name: 'Native edit after review', description: 'Keep this native draft', unitCents: 1987, active: false });
      const before = await catalogue();
      await h.api(`${base}/apply`, { csv, namespace, fingerprint: review.fingerprint }, { status: 409 });
      assert.deepEqual(await catalogue(), before, 'stale before-images refuse all writes');
      assert.deepEqual((await h.api(base)).jobs, jobsBefore);

      const run = async source => {
        const fresh = await h.api(`${base}/preview`, { csv: source, namespace });
        const body = { csv: source, namespace, fingerprint: fresh.fingerprint };
        let job = await h.api(`${base}/apply`, body);
        const id = job.id;
        assert.equal(job.state, 'applying', 'bulk work yields before all rows are written');
        assert.ok(job.checkpoint > 0 && job.checkpoint < rows.length);
        for (let request = 0; job.state === 'applying' && request < rows.length; request++) {
          const previous = job.checkpoint;
          job = await h.api(`${base}/apply`, body);
          assert.equal(job.id, id, 'resume retains the same job');
          assert.ok(job.checkpoint > previous && job.checkpoint - previous < rows.length, 'each request makes bounded progress');
        }
        assert.equal(job.state, 'completed');
        assert.equal(job.checkpoint, rows.length);
        const applied = await catalogue(), attributed = await provenance(id);
        assert.equal(attributed.length, rows.length);
        assert.equal(new Set(attributed.map(item => item.target_id)).size, rows.length);
        assert.ok(attributed.every(item => item.reversed === 0));
        assert.deepEqual(await h.api(`${base}/apply`, body), job, 'replaying the exact source and approval is idempotent');
        assert.deepEqual(await catalogue(), applied, 'replay does not repeat product effects or revisions');
        assert.deepEqual(await provenance(id), attributed, 'replay does not duplicate provenance');
        const journal = await h.api(`${base}/${id}`);
        const retained = journal.originals.filter(item => item.original.status === 'retained');
        assert.equal(retained.length, 1);
        assert.equal(Buffer.from(retained[0].original.base64, 'base64').toString('utf8'), source);
        return job;
      };
      const job = await run(csv);
      const exported = (await h.api('/api/stall/exports/records')).products;
      for (const row of rows) {
        const matches = exported.filter(item => item.id === row.sku);
        assert.equal(matches.length, 1);
        assert.deepEqual(matches[0].value, { ...row, active: false });
      }
      let undone;
      for (let request = 0; request < rows.length; request++) {
        undone = await h.api(`${base}/${job.id}/undo`, {});
        if (undone.state !== 'undoing') break;
      }
      assert.equal(undone.state, 'undone');
      assert.deepEqual(await catalogue(), before, 'undo restores complete original drafts, prices and revisions');

      const protectedJob = await run(csv.replace('Bulk title 1,', 'Second bulk title,'));
      const target = (await catalogue()).find(item => item.id === rows.at(-1).sku);
      await h.command('product.prepare', { sku: target.id, revision: target.revision,
        name: 'Later native edit', description: 'Must survive bulk undo', unitCents: 4567, active: false });
      const protectedRow = (await catalogue()).find(item => item.id === target.id);
      const report = await undo(h, protectedJob, { bounded: true });
      assert.deepEqual((await catalogue()).find(item => item.id === target.id), protectedRow,
        'undo preserves the later native draft and its revision');
      assert.deepEqual((await catalogue()).filter(item => item.id !== target.id), before.filter(item => item.id !== target.id),
        'conflict-preserving undo still restores every untouched row');
      assert.equal(report.total, rows.length);
      for (const row of rows) {
        const disposition = report.dispositions.find(item => item.targetId === row.sku);
        assert.equal(disposition.disposition, row.sku === target.id ? 'retained' : 'reversed');
        assert.equal(disposition.reason, row.sku === target.id ? 'edited' : 'unchanged');
        assert.ok(disposition.evidence.rule);
        assert.deepEqual(disposition.protectedBy, []);
        if (row.sku === target.id) {
          assert.equal(disposition.observed.revision, protectedRow.revision);
          assert.deepEqual(disposition.observed.ownedValue.value, protectedRow.value);
          assert.notEqual(disposition.observed.valueHash, disposition.expected.valueHash);
        }
      }
    });
    await t.test('publication and order references preserve catalogue rows against imports and undo', async () => {
      const { job } = await apply(h, csvFor('ORDERED'));
      // Test data represents an existing order: the import route must honour all
      // catalogue references regardless of which checkout/payment path made it.
      await h.db.prepare('INSERT INTO st_orders(id,value_json,revision) VALUES(?,?,?)').bind('existing-order', JSON.stringify({ checkoutKey: 'existing-checkout', lines: [{ sku: 'ORDERED' }] }), 'order-revision').run();
      const orderedBefore = await product(h, 'ORDERED');
      const orderedReport = await undo(h, job);
      assert.deepEqual(await product(h, 'ORDERED'), orderedBefore);
      const ordered = orderedReport.dispositions.find(item => item.targetId === 'ORDERED');
      assert.equal(ordered.disposition, 'retained');
      assert.equal(ordered.reason, 'dependency');
      assert.equal(ordered.observed.valueHash, ordered.expected.valueHash);
      assert.ok(ordered.evidence.rule);
      assert.ok(ordered.protectedBy.some(edge => edge.cause.table === 'st_orders' && edge.cause.recordId === 'existing-order'
        && edge.cause.targetId === 'ORDERED' && edge.evidence.orderId === 'existing-order' && edge.evidence.sku === 'ORDERED'));
      await h.api(`${base}/preview`, { csv: csvFor('ORDERED', 'Replacement') }, { status: 409 });
      assert.ok(await product(h, 'ORDERED'));
      const published = await apply(h, csvFor('PUBLISHED'));
      await h.db.prepare("UPDATE st_products SET value_json=json_set(value_json,'$.active',json('true')) WHERE id=?").bind('PUBLISHED').run();
      await h.api(`${base}/preview`, { csv: csvFor('PUBLISHED', 'Replacement') }, { status: 409 });
      const publishedBefore = await product(h, 'PUBLISHED');
      const publishedReport = await undo(h, published.job);
      assert.deepEqual(await product(h, 'PUBLISHED'), publishedBefore);
      const retained = publishedReport.dispositions.find(item => item.targetId === 'PUBLISHED');
      assert.equal(retained.disposition, 'retained');
      assert.equal(retained.reason, 'edited');
      assert.notEqual(retained.observed.valueHash, retained.expected.valueHash);
      assert.ok(retained.protectedBy.some(edge => edge.cause.table === 'st_products' && edge.cause.recordId === 'PUBLISHED'
        && edge.cause.field === 'active' && edge.evidence.sku === 'PUBLISHED'));
    });
  } finally { await h.close(); }
});

test('CATALOG-002: undo preserves a real paid order and its published product while reversing unused imports', async () => {
  const pier = await pierInstallation();
  const edge = stripeEdge({ forward: pier.forward });
  const secret = randomBytes(32).toString('hex');
  let h;
  try {
    h = await installation({ bindings: { ...pier.bindings, STRIPE_SECRET_KEY: 'test-network-edge', STRIPE_WEBHOOK_SECRET: secret }, outboundService: edge.handle });
    const csv = await readFile(new URL('../../fixtures/shopify-products.csv', import.meta.url), 'utf8')
      + 'unused-piece,Unused piece,<p>Never published or ordered</p>,UNUSED-PIECE,19.37,FALSE\n';
    const { job } = await apply(h, csv);
    const imported = (await h.api('/api/stall/state')).products.find(item => item.id === 'MUG-BLUE');
    const draft = await h.command('product.prepare', { sku: imported.id, revision: imported.revision,
      name: imported.value.name, description: imported.value.description, unitCents: imported.value.unitCents, active: true });
    await h.command('product.approve', { sku: imported.id, revision: draft.revision });
    const bought = await purchase(h, edge, { skus: ['MUG-BLUE'], quantities: [1], expectedTotalCents: 2450 });
    const delivered = await deliverWebhook(h, secret, edge.pay(bought.session.id));
    assert.equal(delivered.response.status, 200, JSON.stringify(delivered.value));
    const before = await h.api('/api/stall/state');
    const ordered = before.orders.find(item => item.id === bought.orderId);
    assert.equal(ordered.status, 'reserved');
    assert.equal(ordered.lines.length, 1);
    assert.equal(ordered.lines[0].sku, 'MUG-BLUE');
    assert.ok(ordered.payment.intentId);
    assert.ok(ordered.reservation.id);
    const stockBefore = await pier.api('/api/pier/state');
    const stockOrder = stockBefore.orders.find(item => item.id === ordered.reservation.id);
    assert.ok(stockOrder, 'the paid checkout creates an actual Pier order');
    assert.equal(stockOrder.lines.length, 1);
    assert.equal(stockOrder.lines[0].itemId, pier.items.find(item => item.sku === 'MUG-BLUE').id);
    assert.equal(stockOrder.lines[0].reserved, '1');
    const publicBefore = await h.api('/api/stall/catalogue', undefined, { as: '' });
    assert.equal(publicBefore.items.find(item => item.sku === 'MUG-BLUE').available, '19');

    const report = await undo(h, job);
    const after = await h.api('/api/stall/state');
    assert.deepEqual(after.products, before.products.filter(item => item.id === 'MUG-BLUE'),
      'the published mug survives exactly; untouched towel and unused product are removed');
    assert.deepEqual(after.orders, before.orders, 'undo preserves every paid order field and stock reference');
    const stockAfter = await pier.api('/api/pier/state');
    assert.deepEqual(stockAfter.orders, stockBefore.orders);
    assert.deepEqual(stockAfter.reservations, stockBefore.reservations);
    assert.deepEqual(stockAfter.positions, stockBefore.positions);
    assert.deepEqual((await h.api('/api/stall/catalogue', undefined, { as: '' })).items, publicBefore.items);
    assert.equal(report.total, 3);
    const retained = report.dispositions.find(item => item.targetId === 'MUG-BLUE');
    assert.equal(retained.disposition, 'retained');
    assert.equal(retained.reason, 'edited');
    assert.equal(retained.observed.revision, before.products.find(item => item.id === 'MUG-BLUE').revision);
    assert.notEqual(retained.expected.valueHash, retained.observed.valueHash);
    assert.ok(retained.evidence.rule);
    assert.ok(retained.protectedBy.some(dependency => dependency.cause.table === 'st_orders'
      && dependency.cause.recordId === bought.orderId && dependency.cause.targetId === 'MUG-BLUE'
      && dependency.cause.field.includes('lines[') && dependency.evidence.orderId === bought.orderId
      && dependency.evidence.sku === 'MUG-BLUE' && dependency.evidence.rule));
    assert.ok(retained.protectedBy.some(dependency => dependency.cause.table === 'st_products'
      && dependency.cause.recordId === 'MUG-BLUE' && dependency.cause.field === 'active'));
    for (const sku of ['TOWEL-NAT', 'UNUSED-PIECE']) {
      const reversed = report.dispositions.find(item => item.targetId === sku);
      assert.equal(reversed.disposition, 'reversed');
      assert.equal(reversed.reason, 'unchanged');
      assert.deepEqual(reversed.protectedBy, []);
    }
    await h.api(`${base}/preview`, { csv: csvFor('MUG-BLUE', 'Replacement') }, { status: 409 });
  } finally {
    if (h) await h.close();
    await pier.close();
  }
});


test('CATALOG-002: reviewed metadata CSV survives resume and restore, exports exact facts, and protects later native work on undo', async () => {
  const h = await installation();
  let receiving;
  try {
    const facts = { costCents: 735, weightGrams: 350, dimensionsMm: { length: 120, width: 90, height: 100 },
      taxCategory: 'ceramics', hsCode: '691200', countryOfOrigin: 'US', customFields: [
        { key: 'care', label: 'Care', type: 'text', value: 'Hand wash. <img src=x onerror=alert(1)>' },
        { key: 'capacity', label: 'Capacity', type: 'number', value: 325 },
        { key: 'dishwasher', label: 'Dishwasher safe', type: 'boolean', value: false },
      ] };
    let native = await h.command('product.prepare', { sku: 'FACTS-1', name: 'Original', description: 'Keep on undo', unitCents: 100, active: false, details: facts });
    native = await h.command('product.approve', { sku: native.id, revision: native.revision });
    await h.command('product.prepare', { sku: native.id, revision: native.revision, name: 'Pending native', description: '', unitCents: 200, active: false, details: { ...facts, costCents: 950 } });
    const initial = (await h.api('/api/stall/state')).products;
    const quote = value => '"' + value.replaceAll('"', '""') + '"';
    const row = (sku, details) => [sku.toLowerCase(), `Imported ${sku}`, 'Reviewed plain description', sku, '12.34', 'FALSE', quote(typeof details === 'string' ? details : JSON.stringify(details))].join(',');
    const header = 'Handle,Title,Body (HTML),Variant SKU,Variant Price,Published,Stall Details\n';
    const invalid = [{ ...facts, costCents: 1.5 }, { ...facts, customFields: [{ key: 'care', label: 'Care', type: 'number', value: 'not a number' }] }, { ...facts, credentials: 'unsupported' }, '{not JSON'];
    const csv = header + Array.from({ length: 12 }, (_, index) => row(`FACTS-${index + 1}`, { ...facts, costCents: 700 + index })).concat(invalid.map((details, index) => row(`INVALID-${index + 1}`, details))).join('\n') + '\n';
    const preview = await h.api(`${base}/preview`, { csv });
    assert.equal(preview.counts.mapped, 12);
    assert.equal(preview.counts.rejected, invalid.length);
    assert.deepEqual((await h.api('/api/stall/state')).products, initial, 'metadata review changes neither native nor pending values');
    assert.deepEqual(preview.plan.entries[0].source.payload.previous.value, initial[0].value, 'review includes complete current and pending facts');
    assert.deepEqual(preview.plan.entries[0].effects[0].value.details, { ...facts, costCents: 700 });
    assert.equal((await h.api('/api/stall/catalogue', undefined, { as: '' })).items.length, 0);
    await h.api(`${base}/apply`, { csv, fingerprint: preview.fingerprint }, { status: 409 });
    const excludedRows = [14, 15, 16, 17];
    const body = { csv, fingerprint: preview.fingerprint, excludedRows };
    await h.api(`${base}/apply`, { ...body, csv: csv.replace('""costCents"":700', '""costCents"":701') }, { status: 409 });
    assert.deepEqual((await h.api('/api/stall/state')).products, initial);
    let job = await h.api(`${base}/apply`, body);
    assert.equal(job.state, 'applying');
    assert.ok(job.checkpoint > 0 && job.checkpoint < 12);
    receiving = await installation();
    await restore(receiving, await archive(h));
    let journal = await receiving.api(`${base}/${job.id}`);
    const retained = journal.originals.find(item => item.original.status === 'retained');
    assert.equal(Buffer.from(retained.original.base64, 'base64').toString('utf8'), csv);
    assert.deepEqual(journal.rejectedRows.map(item => item.row), excludedRows);
    for (let n = 0; job.state === 'applying' && n < 4; n++) job = await receiving.api(`${base}/apply`, body);
    assert.equal(job.state, 'completed');
    const complete = (await receiving.api('/api/stall/exports/records')).products;
    assert.equal(complete.length, 12);
    for (let index = 0; index < 12; index++) {
      const imported = complete.find(item => item.id === `FACTS-${index + 1}`);
      assert.deepEqual(imported.value.details, { ...facts, costCents: 700 + index });
      assert.equal(imported.value.active, false);
      assert.equal(imported.value.unitCents, 1234);
    }
    assert.deepEqual(await receiving.api(`${base}/apply`, body), job, 'restore and replay keep the original job and completed effects');
    assert.deepEqual((await receiving.api('/api/stall/exports/records')).products, complete);
    const { readCsv } = await import('./csv-reader.mjs');
    const exported = readCsv(await (await receiving.request('/api/stall/exports/products')).text());
    assert.equal(exported.length, 12);
    assert.deepEqual(JSON.parse(exported.find(item => item.id === 'FACTS-1').details), { ...facts, costCents: 700 });
    // Explicit {} clears details only after exact reviewed apply; undo restores them.
    const clearCSV = header + row('FACTS-1', {}) + '\n';
    const clearing = await apply(receiving, clearCSV);
    assert.equal((await receiving.api('/api/stall/exports/records')).products.find(item => item.id === 'FACTS-1').value.details, undefined);
    await undo(receiving, clearing.job);
    assert.deepEqual((await receiving.api('/api/stall/exports/records')).products, complete);
    const later = (await receiving.api('/api/stall/state')).products.find(item => item.id === 'FACTS-12');
    await receiving.command('product.prepare', { ...later.value, sku: later.id, revision: later.revision, name: 'Keep this native work', details: { ...facts, costCents: 999 } });
    const protectedRow = (await receiving.api('/api/stall/state')).products.find(item => item.id === later.id);
    const report = await undo(receiving, job, { bounded: true });
    const remaining = (await receiving.api('/api/stall/state')).products;
    assert.equal(remaining.length, 2);
    assert.deepEqual(remaining.find(item => item.id === 'FACTS-1'), initial[0], 'undo restores both original and pending native details');
    assert.deepEqual(remaining.find(item => item.id === later.id), protectedRow);
    assert.equal(report.dispositions.find(item => item.targetId === later.id).disposition, 'retained');
    assert.equal(report.dispositions.find(item => item.targetId === later.id).reason, 'edited');

    {
    // The native format uses the same public review, custody and protected undo doors
    // for complete records rather than the legacy draft-only Shopify mapping.
    const { volumeStock } = await import('./volume-stock.mjs');
    const ids = Array.from({ length: 12 }, (_, index) => `synthetic-stall-${1701 + index}`);
    const stock = volumeStock([ids[0] + '-S', ids[0] + '-M', ...ids.slice(1)]);
    const edge = stripeEdge(), secret = 'synthetic-stall-1700';
    const options = { bindings: { PIER_ORIGIN: 'https://stock.example.test', PIER_SESSION: 'synthetic-stall-1720', PIER_CUSTOMER_ID: 'shop', STRIPE_SECRET_KEY: 'synthetic-stall-1721', STRIPE_WEBHOOK_SECRET: secret },
      outboundService: request => new URL(request.url).hostname === 'stock.example.test' ? stock.forward(request) : edge.handle(request) };
    let native = await installation(options), restored;
    try {
      const variants = [{ sku: ids[0] + '-S', options: { Size: 'S' }, unitCents: 2137, weightGrams: 125, dimensionsMm: { length: 10, width: 20, height: 30 }, hsCode: '610910', countryOfOrigin: 'CA' },
        { sku: ids[0] + '-M', options: { Size: 'M' }, unitCents: 2359 }];
      const values = ids.map((sku, index) => ({ sku, name: `Native catalog ${index + 1}`, description: 'Complete reviewed record', unitCents: 1234 + index, stockMode: 'pier',
        publication: index < 2 ? 'published' : index === 2 ? 'archived' : index === 3 ? 'scheduled' : 'draft', ...(index === 3 ? { publishAt: '2099-01-01T12:00:00.000Z' } : {}),
        details: { ...facts, handle: sku, categories: ['Catalog proof'], ...(index === 0 ? { options: [{ name: 'Size', values: ['S', 'M'] }], variants } : {}) } }));
      const manual = { handle: 'synthetic-stall-1722', title: 'Hand-picked catalog', description: 'Reviewed membership', kind: 'manual', published: true, skus: [ids[0], ids[1]], sort: 'manual' };
      const automatic = { handle: 'synthetic-stall-1723', title: 'Matching catalog', description: 'Reviewed rule', kind: 'rule', published: true, match: 'all', rules: [{ field: 'category', value: 'Catalog proof' }] };
      const file = rows => 'Kind,ID,Value\n' + rows.map(([kind, id, value]) => [kind, id, JSON.stringify(value)].map(quote).join(',')).join('\n') + '\n';
      const nativeRows = [...values.map(value => ['product', value.sku, value]), ['collection', manual.handle, manual], ['collection', automatic.handle, automatic],
        ['product', 'synthetic-stall-1724', { ...values[1], sku: 'synthetic-stall-1724', stockMode: 'untracked' }]];
      const csv = file(nativeRows), preview = await native.api(`${base}/preview`, { csv });
      assert.equal(preview.counts.mapped, 14);
      assert.equal(preview.counts.rejected, 1);
      assert.equal((await native.api('/api/stall/exports/records')).products.length, 0, 'native dry run is read-only');
      assert.equal(preview.plan.entries[0].source.payload.previous, null);
      assert.deepEqual(preview.plan.entries[0].effects[0].value.details.variants, variants);
      assert.equal(preview.plan.entries[0].effects[0].value.active, true);
      const input = { csv, fingerprint: preview.fingerprint, reviewedAt: preview.reviewedAt, excludedRows: [16] };
      await native.api(`${base}/apply`, { ...input, csv: csv.replace('Complete reviewed record', 'Unreviewed') }, { status: 409 });
      await native.api(`${base}/apply`, { ...input, excludedRows: [] }, { status: 409 });
      await native.api(`${base}/apply`, input, { as: '', status: 401 });
      const member = await native.signIn(['synthetic-stall-1725', 'example.test'].join('@'));
      await native.api(`${base}/apply`, input, { as: member, status: 403 });
      const grant = await native.api('/api/stall/agent-token', {});
      const headers = { authorization: `Bearer ${grant.token}` };
      await native.api(`${base}/apply`, input, { as: '', headers, status: 403 });
      await native.api('/api/stall/agent-token/revoke', {});
      await native.api(`${base}/preview`, { csv }, { as: '', headers, status: 401 });
      let job = await native.api(`${base}/apply`, input);
      assert.equal(job.state, 'applying');
      assert.ok(job.checkpoint > 0 && job.checkpoint < job.total);
      restored = await installation(options);
      await restore(restored, await archive(native));
      await restored.api(`${base}/apply`, input, { as: native.cookie, status: 401 });
      for (let n = 0; job.state === 'applying' && n < 4; n++) job = await restored.api(`${base}/apply`, input);
      assert.equal(job.state, 'completed');
      const complete = await restored.api('/api/stall/exports/records');
      assert.equal(complete.products.length, 12);
      for (const value of values) {
        const actual = complete.products.find(row => row.id === value.sku).value;
        assert.equal(actual.name, value.name);
        assert.equal(actual.unitCents, value.unitCents);
        assert.deepEqual(actual.details, value.details);
        assert.equal(actual.active, ['published', 'scheduled'].includes(value.publication));
        assert.equal(actual.archived === true, value.publication === 'archived');
        assert.equal(actual.publishAt, value.publishAt);
      }
      assert.deepEqual(complete.collections.map(row => row.value), [manual, automatic]);
      const catalogue = await restored.api('/api/stall/catalogue', undefined, { as: '' });
      assert.deepEqual(catalogue.items.map(row => row.sku).sort(), [ids[0] + '-M', ids[0] + '-S', ids[1]].sort());
      const exportedResponse = await restored.request(`${base}/catalog.csv`);
      assert.equal(exportedResponse.status, 200);
      const exportedCSV = await exportedResponse.text(), { readCsv } = await import('./csv-reader.mjs');
      const exported = readCsv(exportedCSV);
      assert.equal(exported.length, 14);
      for (const value of values) assert.deepEqual(JSON.parse(exported.find(row => row.ID === value.sku).Value), value);
      assert.deepEqual(JSON.parse(exported.find(row => row.ID === manual.handle).Value), manual);
      assert.deepEqual(JSON.parse(exported.find(row => row.ID === automatic.handle).Value), automatic);
      const journal = await restored.api(`${base}/${job.id}`);
      assert.equal(Buffer.from(journal.originals.find(item => item.original.status === 'retained').original.base64, 'base64').toString(), csv);
      assert.deepEqual(journal.rejectedRows.map(row => row.row), [16]);
      assert.deepEqual(await restored.api(`${base}/apply`, input), job);
      assert.deepEqual((await restored.api('/api/stall/exports/records')).products, complete.products, 'native resume never repeats revisions');
      // Review binds complete current records, including prepared revisions.
      const changedFile = file([['product', ids[11], { ...values[11], unitCents: 4321 }]]);
      const stale = await restored.api(`${base}/preview`, { csv: changedFile });
      const current = (await restored.api('/api/stall/state')).products.find(row => row.id === ids[11]);
      await restored.command('product.prepare', { ...current.value, revision: current.revision, name: 'Keep the native revision', active: false });
      await restored.api(`${base}/apply`, { csv: changedFile, fingerprint: stale.fingerprint, reviewedAt: stale.reviewedAt }, { status: 409 });
      const protectedProduct = (await restored.api('/api/stall/state')).products.find(row => row.id === ids[11]);
      const bought = await purchase(restored, edge, { skus: [ids[0] + '-S'], quantities: [1], expectedTotalCents: 2137 });
      const delivered = await deliverWebhook(restored, secret, edge.pay(bought.session.id));
      assert.equal(delivered.response.status, 200);
      const purchasedBefore = (await restored.api('/api/stall/state')).orders;
      const paidProduct = (await restored.api('/api/stall/state')).products.find(row => row.id === ids[0]);
      const stockBefore = structuredClone([...stock.orders]);
      const outcomes = await undo(restored, job, { bounded: true });
      const after = await restored.api('/api/stall/state');
      assert.deepEqual(after.orders, purchasedBefore);
      assert.deepEqual([...stock.orders], stockBefore);
      assert.deepEqual(after.products.find(row => row.id === ids[0]), paidProduct, 'variant purchase protects the whole original product');
      assert.deepEqual(after.products.find(row => row.id === ids[11]), protectedProduct);
      assert.equal(outcomes.dispositions.find(row => row.targetId === ids[0]).disposition, 'retained');
      assert.equal(outcomes.dispositions.find(row => row.targetId === ids[11]).disposition, 'retained');
      assert.equal(outcomes.dispositions.find(row => row.targetId === ids[4]).disposition, 'reversed');
      assert.ok(!after.products.some(row => row.id === ids[4]));
      assert.deepEqual((await restored.api('/api/stall/exports/records')).collections, []);
      // Native validation also rejects unknown publication stock and conflicting listing identities.
      const unavailable = file([['product', 'synthetic-stall-1726', { ...values[1], sku: 'synthetic-stall-1726', details: {}, publication: 'published' }]]);
      await restored.api(`${base}/preview`, { csv: unavailable }, { status: 409 });
      const conflict = file([['product', 'synthetic-stall-1727', { ...values[1], sku: 'synthetic-stall-1727', publication: 'draft', details: { handle: ids[0] } }]]);
      await restored.api(`${base}/preview`, { csv: conflict }, { status: 409 });
    } finally { await restored?.close(); await native.close(); }
    }
  } finally { await receiving?.close(); await h.close(); }
});

test('Review move-in preserves source provenance, owned photos, exact mapping, replay and selective undo', async () => {
  const { volumeStock } = await import('./volume-stock.mjs');
  const { solidPng } = await import('./network.mjs');
  const stock = volumeStock(['synthetic-stall-1511', 'legacy-mug']);
  const photo = solidPng(40, 40, [135, 110, 90]);
  const video = Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypisom'), 0, 0, 0, 0, ...Buffer.from('isommp42'), 1, 2, 3, 4]);
  let retired = false, mediaReads = 0, receiving;
  const h = await installation({ bindings: { PIER_ORIGIN: 'https://stock.example.test', PIER_SESSION: 'synthetic-stall-1514', PIER_CUSTOMER_ID: 'shop' }, outboundService: async request => {
    const url = new URL(request.url);
    if (url.hostname === 'cloudflare-dns.com') return Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
    if (url.hostname === 'cdn.judge.me') { mediaReads++; return retired ? new Response('Retired', { status: 410 }) : new Response(url.pathname.endsWith('.mp4') ? video : photo, { headers: { 'content-type': url.pathname.endsWith('.mp4') ? 'video/mp4' : 'image/png' } }); }
    return stock.forward(request);
  } });
  try {
    await apply(h, 'Handle,Title,Body (HTML),Variant SKU,Variant Price,Published\nstudio-mug,Studio mug,Hand-thrown stoneware,synthetic-stall-1511,28.00,TRUE\nsecond-mug,Second mug,Hand-thrown stoneware,legacy-mug,28.00,TRUE\n');
    for (const [sku, handle, name] of [['synthetic-stall-1511', 'studio-mug', 'Studio mug'], ['legacy-mug', 'second-mug', 'Second mug']]) {
      const imported = (await h.api('/api/stall/state')).products.find(row => row.id === sku);
      const draft = await h.command('product.prepare', { sku, revision: imported.revision, name, description: 'Hand-thrown stoneware', unitCents: 2800, active: true, details: { handle } });
      await h.command('product.approve', { sku, revision: draft.revision });
    }
    const native = await h.api('/api/stall/reviews', { productId: 'synthetic-stall-1511', rating: 4, title: 'Native review', body: 'Already here', reviewerName: 'Native shopper', date: '2024-01-01T00:00:00Z' });
    const mailBefore = h.messages.length, jobs = [];
    for (const [source, filename] of [['judge-me', 'reviews-judge.csv'], ['yotpo', 'reviews-yotpo.csv']]) {
      const csv = (await readFile(new URL('../../fixtures/' + filename, import.meta.url), 'utf8')).replaceAll('https://reviews.example.test/photo.png', 'https://cdn.judge.me/synthetic-stall-1.png');
      const enrichedCSV = source === 'yotpo' ? csv.replace('synthetic-stall-1.png,,Thank', 'synthetic-stall-1.png,https://cdn.judge.me/synthetic-stall-2.mp4,Thank') : csv;
      const input = { source, csv: enrichedCSV };
      const preview = await h.api('/api/stall/review-imports/preview', input);
      assert.deepEqual(preview.counts, { total: 3, mapped: 2, orphans: 1, duplicates: 0 });
      assert.equal(mediaReads, jobs.length, 'Dry run does not fetch external media');
      assert.equal((await h.api('/api/stall/review-imports')).jobs.length, jobs.length * 2);
      assert.equal(preview.rows[0].productId, 'synthetic-stall-1511');
      assert.equal(preview.rows[1].productId, 'legacy-mug');
      const orphan = preview.rows.find(row => row.status === 'orphan');
      assert.equal(orphan.productId, null); assert.match(orphan.reason, /No matching product/);
      const remapped = await h.api('/api/stall/review-imports/preview', { ...input, mappings: { [orphan.row]: 'legacy-mug' } });
      assert.equal(remapped.counts.orphans, 0); assert.equal(remapped.rows.at(-1).productId, 'legacy-mug');
      const approved = { ...input, fingerprint: preview.fingerprint, excludedRows: [orphan.row] };
      await h.api('/api/stall/review-imports/apply', { ...approved, excludedRows: [] }, { status: 409 });
      const job = await h.api('/api/stall/review-imports/apply', approved); jobs.push(job);
      assert.equal(job.count, 2); assert.equal(job.state, 'completed');
      assert.deepEqual(await h.api('/api/stall/review-imports/apply', approved), job);
      const again = await h.api('/api/stall/review-imports/preview', input);
      assert.deepEqual(again.counts, { total: 3, mapped: 0, orphans: 1, duplicates: 2 });
      const repeat = await h.api('/api/stall/review-imports/apply', { ...input, fingerprint: again.fingerprint, excludedRows: [orphan.row] });
      assert.equal(repeat.count, 0);
      assert.equal((await h.api('/api/stall/reviews?handle=studio-mug', undefined, { as: '' })).reviews.length, jobs.length + 1);
      retired = false;
    }
    retired = true;
    const publicReviews = await h.api('/api/stall/reviews?handle=studio-mug', undefined, { as: '' });
    assert.equal(publicReviews.reviews.length, 3);
    assert.equal(publicReviews.aggregate.ratingValue, 14 / 3); assert.equal(publicReviews.aggregate.reviewCount, 3);
    const judge = publicReviews.reviews.find(row => row.source === 'judge-me'), yotpo = publicReviews.reviews.find(row => row.source === 'yotpo');
    assert.equal(judge.date, '2026-09-17'); assert.equal(yotpo.date, '2026-09-20T09:30:00Z');
    assert.equal(judge.title, 'Morning favourite'); assert.equal(judge.reviewerName, 'Alex Example');
    assert.equal(judge.reply, 'Thank you for sharing.'); assert.equal(yotpo.reply, 'Thank you for the photo.');
    assert.equal(judge.sourceVerified, true); assert.equal(yotpo.sourceVerified, true);
    assert.equal(yotpo.reviewerName, 'Jordan Example');
    assert.equal(yotpo.title, 'Excellent glaze'); assert.equal(yotpo.body, 'Looks beautiful, feels sturdy.');
    assert.equal(yotpo.rating, 5); assert.equal(judge.rating, 5);
    assert.deepEqual(yotpo.media.map(file => file.kind), ['image', 'video']);
    const copiedVideo = await h.request(yotpo.media[1].url, { as: '' });
    assert.equal(copiedVideo.status, 200); assert.equal(copiedVideo.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await copiedVideo.arrayBuffer()), video);
    for (const review of [judge, yotpo]) {
      assert.equal(review.imported, true); assert.equal(review.verifiedPurchase, false);
      assert.ok(!JSON.stringify(review).includes('@')); assert.ok(!JSON.stringify(review).includes('cdn.judge.me'));
      const copied = await h.request(review.media[0].url, { as: '' });
      assert.equal(copied.status, 200); assert.equal(copied.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await copied.arrayBuffer()), photo);
    }
    const other = await h.api('/api/stall/reviews?handle=second-mug', undefined, { as: '' });
    assert.equal(other.reviews.length, 2);
    assert.equal(other.reviews.find(row => row.source === 'judge-me').date, '2026-09-18');
    assert.equal(other.reviews.find(row => row.source === 'yotpo').date, '2026-09-21');
    assert.ok(other.reviews.every(row => row.rating === 4 && row.sourceVerified === false && row.verifiedPurchase === false));
    assert.equal(other.reviews.find(row => row.source === 'judge-me').body, 'A useful size.\nThe colour matches our kitchen.');
    assert.equal(other.reviews.find(row => row.source === 'yotpo').sourceVerified, false, 'Verified Reviewer is not a source purchase claim');
    const exported = await h.api('/api/stall/exports/records');
    assert.equal(exported.productReviews.reviews.length, 5);
    for (const review of publicReviews.reviews) {
      const stored = exported.productReviews.reviews.find(row => row.id === review.id);
      assert.equal(stored.product_id, 'synthetic-stall-1511'); assert.equal(stored.source, review.source);
      const { id, source, imported, ...facts } = review;
      assert.deepEqual(stored.value, facts);
      assert.equal(Boolean(stored.import_id), imported); assert.ok(stored.source_id);
    }
    assert.equal(exported.productReviews.reviews.find(row => row.id === yotpo.id).source_id, 'synthetic-stall-1');
    assert.equal(exported.productReviews.reviews.find(row => row.source === 'judge-me' && row.product_id === 'synthetic-stall-1511').reviewer_email, 'alex@example.test');
    assert.equal(h.messages.length, mailBefore, 'No review request or marketing mail');
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM st_customer_consents').first()).n, 0, 'Reviews grant no marketing consent');
    assert.equal(mediaReads, 3, 'Replays do not re-fetch retired source files');
    receiving = await installation();
    await restore(receiving, await archive(h));
    assert.deepEqual((await receiving.api('/api/stall/exports/records')).productReviews, exported.productReviews, 'Every review fact, source identity, import and source map survives independent restore');
    assert.deepEqual((await receiving.api('/api/stall/reviews?handle=studio-mug', undefined, { as: '' })).reviews, publicReviews.reviews);
    const restoredVideo = await receiving.request(yotpo.media[1].url, { as: '' });
    assert.equal(restoredVideo.status, 200); assert.equal(restoredVideo.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await restoredVideo.arrayBuffer()), video);
    const restoredPhoto = await receiving.request(yotpo.media[0].url, { as: '' });
    assert.equal(restoredPhoto.status, 200);
    assert.deepEqual(Buffer.from(await restoredPhoto.arrayBuffer()), photo, 'Owned review bytes travel without the source URL');
    const undone = await h.api(`/api/stall/review-imports/${jobs[0].id}/undo`, {});
    assert.equal(undone.state, 'undone');
    assert.deepEqual(await h.api(`/api/stall/review-imports/${jobs[0].id}/undo`, {}), undone);
    const remaining = await h.api('/api/stall/reviews?handle=studio-mug', undefined, { as: '' });
    assert.deepEqual(new Set(remaining.reviews.map(row => row.source)), new Set(['native', 'yotpo']));
    assert.ok(remaining.reviews.some(row => row.id === native.id));
    assert.equal(remaining.aggregate.ratingValue, 4.5);
    await h.api(judge.media[0].url, undefined, { as: '', status: 404 });
    const sourceState = await h.api('/api/stall/state');
    const activity = sourceState.audit.filter(event => ['reviews.imported', 'reviews.import-undone'].includes(event.action));
    assert.equal(activity.filter(event => event.action === 'reviews.imported').length, 4);
    assert.equal(activity.filter(event => event.action === 'reviews.import-undone').length, 1);
    for (const event of activity) {
      assert.equal(event.actor, sourceState.actor.id); assert.ok(Number.isFinite(Date.parse(event.at)));
    }
    assert.equal(activity.find(event => event.action === 'reviews.import-undone').subject, jobs[0].id);
    await receiving.close(); receiving = await installation();
    await restore(receiving, await archive(h));
    assert.deepEqual((await receiving.api('/api/stall/state')).audit.filter(event => ['reviews.imported', 'reviews.import-undone'].includes(event.action)).sort((a, b) => a.id.localeCompare(b.id)), [...activity].sort((a, b) => a.id.localeCompare(b.id)), 'Attributable import and undo history travels unchanged');
    await receiving.api('/api/stall/review-imports/preview', { source: 'judge-me', csv: 'rating,body\n5,Test\n' }, { as: h.cookie, status: 401 });
  } finally { await receiving?.close(); await h.close(); }
});

test('Review import authority, stale approvals and failed media never leak or partially apply', async () => {
  let refused = false, revokeDuringCopy = false;
  const { solidPng } = await import('./network.mjs');
  const h = await installation({ outboundService: async request => {
    const url = new URL(request.url);
    if (url.hostname === 'cloudflare-dns.com') return Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] });
    if (revokeDuringCopy) {
      assert.equal((await h.request('/auth/signout', { method: 'POST', body: {} })).status, 204);
      return new Response(solidPng(32, 32, [50, 80, 90]), { headers: { 'content-type': 'image/png' } });
    }
    refused = true; return new Response('Source gone', { status: 410 });
  } });
  try {
    const draft = await h.command('product.prepare', { sku: 'synthetic-stall-1511', name: 'Studio mug', description: '', unitCents: 2800, active: false, details: { handle: 'studio-mug' } });
    await h.command('product.approve', { sku: draft.id, revision: draft.revision });
    const source = 'judge-me', csv = (await readFile(new URL('../../fixtures/reviews-judge.csv', import.meta.url), 'utf8')).replaceAll('https://reviews.example.test/photo.png', 'https://cdn.judge.me/synthetic-stall-1.png');
    const input = { source, csv, mappings: { 3: 'synthetic-stall-1511' } };
    const member = await h.signIn('synthetic-stall-1515@example.test');
    const agent = await h.api('/api/stall/agent-token', {});
    for (const path of ['/api/stall/review-imports/preview', '/api/stall/review-imports/apply', '/api/stall/review-imports/not-a-job/undo']) {
      await h.api(path, input, { as: '', status: 401 });
      await h.api(path, input, { as: member, status: 403 });
      await h.api(path, input, { as: '', headers: { authorization: `Bearer ${agent.token}` }, status: 403 });
      await h.api(path, input, { headers: { origin: 'https://other.example.test' }, status: 403 });
    }
    await h.api('/api/stall/reviews?handle=studio-mug', undefined, { as: '', status: 404 });
    const preview = await h.api('/api/stall/review-imports/preview', input), excludedRows = preview.rows.filter(row => row.status === 'orphan').map(row => row.row);
    assert.equal(preview.counts.mapped, 2);
    assert.ok(!JSON.stringify(preview).includes('alex@example.test'));
    const current = (await h.api('/api/stall/state')).products[0];
    await h.command('product.prepare', { ...current.value, sku: current.id, revision: current.revision, name: 'Changed after review' });
    await h.api('/api/stall/review-imports/apply', { ...input, fingerprint: preview.fingerprint, excludedRows }, { status: 409 });
    const fresh = await h.api('/api/stall/review-imports/preview', input);
    await h.api('/api/stall/review-imports/apply', { ...input, fingerprint: fresh.fingerprint, excludedRows }, { status: 409 });
    assert.equal(refused, true);
    assert.equal((await h.api('/api/stall/review-imports')).jobs.length, 0);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM st_reviews').first()).n, 0);
    const privateCSV = csv.replace('https://cdn.judge.me/synthetic-stall-1.png', 'http://127.0.0.1/private.png');
    const privatePreview = await h.api('/api/stall/review-imports/preview', { ...input, csv: privateCSV });
    await h.api('/api/stall/review-imports/apply', { ...input, csv: privateCSV, fingerprint: privatePreview.fingerprint, excludedRows }, { status: 400 });
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM st_review_media').first()).n, 0);
    const beforeRevocation = await h.api('/api/stall/review-imports/preview', input);
    revokeDuringCopy = true;
    await h.api('/api/stall/review-imports/apply', { ...input, fingerprint: beforeRevocation.fingerprint, excludedRows }, { status: 409 });
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM st_reviews').first()).n, 0);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM st_review_media').first()).n, 0);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM st_review_imports').first()).n, 0);
    await h.api('/api/stall/review-imports', undefined, { status: 401 });
  } finally { await h.close(); }
});

test('Review import source maps, owned data and erasure survive transfer without re-importing erased reviewers', async () => {
  const { solidPng } = await import('./network.mjs');
  const ownedPhoto = solidPng(32, 32, [50, 80, 90]);
  const h = await installation({ outboundService: async request => new URL(request.url).hostname === 'cloudflare-dns.com' ? Response.json({ Status: 0, Answer: [{ type: 1, data: '8.8.8.8' }] }) : new Response(ownedPhoto, { headers: { 'content-type': 'image/png' } }) }); let receiving, fenced;
  try {
    const product = await h.command('product.prepare', { sku: 'synthetic-stall-1511', name: 'Studio mug', description: '', unitCents: 2800, active: false, details: { handle: 'studio-mug' } });
    await h.command('product.approve', { sku: product.id, revision: product.revision });
    const header = 'id,product_id,rating,title,body,author,email,created_at,verified,image_urls\n';
    const csv = header + 'synthetic-stall-1516,legacy-mug,5,Original,Original content,Reviewer,synthetic-stall-1517@example.test,2024-02-03,TRUE,https://cdn.judge.me/synthetic-stall-3.png\n';
    const input = { source: 'shopify', csv, mappings: { 2: product.id } };
    const preview = await h.api('/api/stall/review-imports/preview', input);
    await h.api('/api/stall/review-imports/apply', { ...input, fingerprint: preview.fingerprint });
    const archiveLines = await archive(h);
    receiving = await installation(); await restore(receiving, archiveLines);
    const repeat = await receiving.api('/api/stall/review-imports/preview', { source: 'shopify', csv });
    assert.equal(repeat.rows[0].productId, product.id, 'The reviewed source product ID map travels with the catalog');
    assert.equal(repeat.counts.duplicates, 1);
    assert.equal((await receiving.api('/api/stall/exports/records')).productReviews.reviews[0].reviewer_email, 'synthetic-stall-1517@example.test');
    const beforeErasure = (await receiving.api('/api/stall/exports/records')).productReviews;
    const erasedMedia = beforeErasure.reviews[0].value.media[0];
    await receiving.command('customer.erase', { email: 'synthetic-stall-1517@example.test', confirm: 'ERASE' });
    const fresh = await receiving.api('/api/stall/review-imports/preview', { source: 'shopify', csv });
    assert.equal(fresh.counts.mapped, 0); assert.equal(fresh.counts.orphans, 1); assert.match(fresh.rows[0].reason, /erased/);
    assert.deepEqual((await receiving.api('/api/stall/exports/records')).productReviews.reviews, []);
    const erasedArchive = await archive(receiving);
    assert.ok(!JSON.stringify(erasedArchive).includes('synthetic-stall-1517@example.test'));
    assert.ok(!JSON.stringify(erasedArchive).includes(erasedMedia.id), 'Erased media bytes and ownership are removed from portable records');
    await receiving.api(erasedMedia.url, undefined, { as: '', status: 404 });
    fenced = await installation();
    await restore(fenced, archiveLines, { status: 400, laterJournal: { sourceIdentity: erasedArchive[0].sourceIdentity, epoch: erasedArchive[0].epoch, journal: erasedArchive[0].journal } });
    assert.deepEqual((await fenced.api('/api/stall/exports/records')).productReviews.reviews, []);
    // Other documented source CSV dialects go through the same reviewed public door.
    for (const [source, columns, row, expected] of [
      ['okendo', 'reviewId,product_id,rating,title,body,name,email,dateCreated,isVerifiedBuyer,reply,replyIsPublic,imageUrls,videoUrls', 'synthetic-stall-1518,synthetic-stall-1511,5,Okendo title,Okendo body,Okendo shopper,okendo@example.test,2024-02-03,true,Okendo reply,true,,', { rating: 5, title: 'Okendo title', body: 'Okendo body', reviewerName: 'Okendo shopper', date: '2024-02-03', sourceVerified: true, reply: 'Okendo reply', email: 'okendo@example.test', sourceId: 'synthetic-stall-1518' }],
      ['loox', 'id,handle,rating,title,review,nickname,email,date,verified_purchase,reply,img', 'synthetic-stall-1519,studio-mug,4,Loox title,Loox body,Loox shopper,loox@example.test,2024-03-04,true,Loox reply,', { rating: 4, title: 'Loox title', body: 'Loox body', reviewerName: 'Loox shopper', date: '2024-03-04', sourceVerified: true, reply: 'Loox reply', email: 'loox@example.test', sourceId: 'synthetic-stall-1519' }],
      ['stamped', 'id,sku,reviewRating,reviewTitle,reviewMessage,author,customerEmail,reviewDate,verifiedBuyer,reply,photoFilenames,videoFilenames', 'synthetic-stall-1520,synthetic-stall-1511,3,Stamped title,Stamped body,Stamped shopper,stamped@example.test,2024-04-05,false,Stamped reply,,', { rating: 3, title: 'Stamped title', body: 'Stamped body', reviewerName: 'Stamped shopper', date: '2024-04-05', sourceVerified: false, reply: 'Stamped reply', email: 'stamped@example.test', sourceId: 'synthetic-stall-1520' }],
    ]) {
      const input = { source, csv: columns + '\n' + row + '\n' }, checked = await receiving.api('/api/stall/review-imports/preview', input);
      assert.equal(checked.counts.mapped, 1);
      const job = await receiving.api('/api/stall/review-imports/apply', { ...input, fingerprint: checked.fingerprint });
      assert.equal(job.count, 1);
      const stored = (await receiving.api('/api/stall/exports/records')).productReviews.reviews.find(review => review.source === source);
      const { email, sourceId, ...facts } = expected;
      assert.equal(stored.product_id, product.id); assert.equal(stored.source_id, sourceId); assert.equal(stored.reviewer_email, email);
      assert.deepEqual(stored.value, { ...facts, verifiedPurchase: false, media: [] });
      assert.equal(stored.import_id, job.id);
    }
    const jobIds = (await receiving.api('/api/stall/review-imports')).jobs.map(job => job.id);
    for (let index = 0; index < 100; index++) {
      const input = { source: 'shopify', csv: 'id,product_id,rating,body,created_at\nsynthetic-stall-history-' + index + ',' + product.id + ',4,Historical review,2024-05-06\n' };
      const preview = await receiving.api('/api/stall/review-imports/preview', input);
      const job = await receiving.api('/api/stall/review-imports/apply', { ...input, fingerprint: preview.fingerprint });
      jobIds.unshift(job.id);
    }
    const first = await receiving.api('/api/stall/review-imports');
    assert.equal(first.total, 104); assert.equal(first.jobs.length, 100); assert.equal(first.nextOffset, 100);
    const last = await receiving.api('/api/stall/review-imports?offset=100');
    assert.equal(last.total, 104); assert.equal(last.jobs.length, 4); assert.equal(last.nextOffset, null);
    assert.deepEqual([...first.jobs, ...last.jobs].map(job => job.id), jobIds, 'Complete history includes each imported job once beyond the first window');
    await receiving.api('/api/stall/review-imports?offset=-1', undefined, { status: 400 });
    await receiving.api('/api/stall/review-imports?offset=not-a-number', undefined, { status: 400 });


  } finally { await fenced?.close(); await receiving?.close(); await h.close(); }
});
