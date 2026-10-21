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
  } finally { await receiving?.close(); await h.close(); }
});
