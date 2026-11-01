import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createDatabase } from './helpers.js';

let vite;
let database;
let Participant;
let DrawPanel;
let SeasonControls;
let ParticipantList;
const entries = new Map();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
before(async () => {
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key),
  } });
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Participant = (await vite.ssrLoadModule('/src/ParticipantApp.jsx')).SeasonParticipantApp;
  DrawPanel = (await vite.ssrLoadModule('/src/DrawPanel.jsx')).default;
  SeasonControls = (await vite.ssrLoadModule('/src/SeasonControls.jsx')).default;
  ParticipantList = (await vite.ssrLoadModule('/src/ParticipantList.jsx')).default;
  database = await createDatabase();
});
after(async () => {
  if (vite) await vite.close();
  if (database) await database.engine.close();
  if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
  else delete globalThis.sessionStorage;
});

test('new-year public form renders despite an old unversioned receipt from 2026', () => {
  entries.clear();
  entries.set('santa-receipt', JSON.stringify({ name: 'Starý Elf', elfTitle: 'Starý titul' }));
  const html = renderToStaticMarkup(React.createElement(Participant, { event: { year: 2027, registrationOpen: true }, onRefresh() {} }));
  assert.ok(html.includes('id="santa-name"'));
  assert.ok(html.includes('2027'));
  assert.ok(!html.includes('Starý Elf'));
});

test('closed year renders a closed-registration page rather than an editable form', () => {
  entries.clear();
  entries.set('santa-draft-2026', JSON.stringify({ year: 2026, name: 'Rozpracovaný Elf', named: true }));
  const html = renderToStaticMarkup(React.createElement(Participant, { event: { year: 2026, registrationOpen: false }, onRefresh() {} }));
  assert.ok(html.includes('Santa už rozdal úkoly.'));
  assert.ok(!html.includes('id="santa-name"'));
  assert.ok(!html.includes('id="phone"'));
  assert.ok(!html.includes('Upravit'));
});

test('existing personal confirmation remains visible after registration closes', () => {
  entries.clear();
  entries.set('santa-receipt-2026', JSON.stringify({ year: 2026, name: 'Potvrzený Elf', elfTitle: 'Testovací titul' }));
  const html = renderToStaticMarkup(React.createElement(Participant, { event: { year: 2026, registrationOpen: false }, onRefresh() {} }));
  assert.ok(html.includes('Potvrzený Elf'));
  assert.ok(html.includes('Testovací titul'));
  assert.ok(!html.includes('id="santa-name"'));
});

test('season controls and empty participants render without triggering activation or exposing results', async () => {
  const snapshot = { ...(await database.rpc('santa_snapshot', { input_year: 2026 })).data, messages: [] };
  const controls = renderToStaticMarkup(React.createElement(SeasonControls, { snapshot, busy: false, execute() {} }));
  const list = renderToStaticMarkup(React.createElement(ParticipantList, { snapshot, busy: false, execute() {} }));
  assert.ok(controls.includes('Prohlížet ročník'));
  assert.ok(controls.includes('Založit nový ročník'));
  assert.ok(list.includes('zatím nejsou žádné formuláře'));
});

test('manual historical draw renders read-only controls with hidden results and no regeneration form', async () => {
  const snapshot = { ...(await database.rpc('santa_snapshot', { input_year: 2025 })).data, messages: [] };
  const html = renderToStaticMarkup(React.createElement(DrawPanel, { snapshot, busy: false, execute() {}, onError() {} }));
  assert.ok(html.includes('Zobrazit tajné výsledky'));
  assert.ok(!html.includes('id="draw-confirm"'));
  assert.ok(!html.includes('id="lock-confirm"'));
  assert.ok(!html.includes('Testovací osoba'));
});
