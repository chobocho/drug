import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';

const html = await readFile('index.html', 'utf8');
const wait = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('timeout'); };
const open = factory => new Promise((resolve, reject) => { const r = factory.open('drug-check', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const all = db => new Promise((resolve, reject) => { const r = db.transaction('days').objectStore('days').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

test('앱을 열면 3개월 경계보다 오래된 복약 기록만 삭제', async t => {
  const factory = new IDBFactory();
  const db = await new Promise((resolve, reject) => {
    const r = factory.open('drug-check', 1);
    r.onupgradeneeded = () => { const meds = r.result.createObjectStore('medications', { keyPath: 'id' }); r.result.createObjectStore('days', { keyPath: 'date' }); meds.put({ id: 'lunch', versions: [{ from: '0001-01-01', name: '점심약', weekdays: [1], active: false }] }); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  await new Promise((resolve, reject) => { const tx = db.transaction('days', 'readwrite'); for (const date of ['2025-02-27', '2025-02-28', '2025-05-31']) tx.objectStore('days').put({ date, checkedIds: [] }); tx.oncomplete = resolve; tx.onerror = reject; });
  db.close();
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test', beforeParse(w) {
    Object.defineProperty(w, 'indexedDB', { value: factory }); const D = w.Date;
    w.Date = class extends D { constructor(...args) { super(...(args.length ? args : ['2025-05-31T12:00:00'])); } static now() { return new D('2025-05-31T12:00:00').getTime(); } };
  }});
  t.after(() => dom.window.close());
  await wait(() => !dom.window.document.querySelector('#date').disabled && !!dom.window.document.querySelector('#date').min);
  const db2 = await open(factory); const records = await all(db2); db2.close();
  assert.deepEqual(records.map(d => d.date), ['2025-02-28', '2025-05-31']);
});
