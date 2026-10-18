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
