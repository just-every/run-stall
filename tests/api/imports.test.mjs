import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installation } from './harness.mjs';
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
        csvFor('BAD').replace('12.34', '12.345'),
        csvFor('BAD').replace('12.34', '1e3'),
        csvFor('BAD').replace('Published\n', 'Published,Variant Inventory Qty\n'),
        csvFor('BAD') + 'bad,Another product,,BAD,9.99,FALSE\n',
        csvFor('BAD') + 'bad,Another variant,,OTHER-SKU,9.99,FALSE\n',
        csvFor('BAD').replace('<p>Product description</p>', '"Unclosed description'),
      ]) await h.api(`${base}/preview`, { csv }, { status: 409 });
      assert.equal(await product(h, 'BAD'), null);
      const hostile=csvFor('SAFE-TEXT').replace('<p>Product description</p>','<scr<b>ipt>globalThis.stallUnsafe=1</scr<b>ipt><p>Care &amp; use</p>&lt;img src=x onerror=alert(1)&gt;');
      await apply(h,hostile);
      const imported=(await h.api('/api/stall/state')).products.find(p=>p.id==='SAFE-TEXT');
      assert.equal(imported.value.description,'Care & use\n<img src=x onerror=alert(1)>');
      assert.equal(imported.value.active,false);
      assert.doesNotMatch(imported.value.description,/<script|stallUnsafe/i);
    });
    await t.test('native changes invalidate review and stop undo, including unchanged revision edits', async () => {
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
      await h.api(`${base}/${edited.job.id}/undo`, {}, { status: 409 });
      assert.equal((await product(h, 'EDITED')).value.name, 'Native edit');
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
      await h.api(`${base}/${protectedJob.id}/undo`, {}, { status: 409 });
      assert.deepEqual((await catalogue()).find(item => item.id === target.id), protectedRow,
        'strict undo refusal preserves the later native draft and its revision');
    });
    await t.test('publication and order references preserve catalogue rows against imports and undo', async () => {
      const { job } = await apply(h, csvFor('ORDERED'));
      // Test data represents an existing order: the import route must honour all
      // catalogue references regardless of which checkout/payment path made it.
      await h.db.prepare('INSERT INTO st_orders(id,value_json,revision) VALUES(?,?,?)').bind('existing-order', JSON.stringify({ checkoutKey: 'existing-checkout', lines: [{ sku: 'ORDERED' }] }), 'order-revision').run();
      await h.api(`${base}/${job.id}/undo`, {}, { status: 409 });
      await h.api(`${base}/preview`, { csv: csvFor('ORDERED', 'Replacement') }, { status: 409 });
      assert.ok(await product(h, 'ORDERED'));
      const published = await apply(h, csvFor('PUBLISHED'));
      await h.db.prepare("UPDATE st_products SET value_json=json_set(value_json,'$.active',json('true')) WHERE id=?").bind('PUBLISHED').run();
      await h.api(`${base}/preview`, { csv: csvFor('PUBLISHED', 'Replacement') }, { status: 409 });
      await h.api(`${base}/${published.job.id}/undo`, {}, { status: 409 });
      assert.equal((await product(h, 'PUBLISHED')).value.active, true);
    });
  } finally { await h.close(); }
});
