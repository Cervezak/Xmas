import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('admin updates keep a single participant list, rules editor and SMS panel across refreshes, rules saves and year changes', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/admin' });
  const savedGlobals = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  savedGlobals.set('fetch', Object.getOwnPropertyDescriptor(globalThis, 'fetch'));
  const pending = [];
  globalThis.fetch = (url, options) => {
    assert.equal(url, '/api/santa');
    assert.equal(options.headers.Authorization, 'Bearer test-admin-password');
    return new Promise((resolve) => pending.push({ input: JSON.parse(options.body), resolve }));
  };
  const messages = [];
  const originalError = console.error;
  console.error = (...args) => messages.push(args.map(String).join(' '));
  let vite;
  let root;
  const document = dom.window.document;
  const findButton = (text) => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent === text);
    assert.ok(button, 'Button is missing: ' + text);
    return button;
  };
  const click = async (text) => { await act(async () => { findButton(text).click(); }); };
  const type = async (element, value) => {
    assert.ok(element);
    const prototype = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  const respond = async (action, snapshot, status = 200) => {
    const call = pending.shift();
    assert.ok(call, 'Expected an API request');
    assert.equal(call.input.action, action);
    await act(async () => { call.resolve({ ok: status === 200, status, json: async () => structuredClone(snapshot) }); });
    return call.input;
  };
  const snapshot = {
    year: 2026, activeYear: 2026, revision: 8, registrationOpen: false, identityEditable: false,
    currentVersion: 2, selectedVersion: 2, historyReferenced: false, previousDraw: null,
    rules: '2–3 dárky, celkem nejvýše 3 000 Kč.',
    years: [{ year: 2026 }, { year: 2027 }], people: [],
    participants: Array.from({ length: 3 }, (_, index) => ({
      id: 'elf-' + index, name: 'Testovací Elf ' + index, nameKey: 'elf ' + index,
      phone: '+42070000000' + index, statements: ['cozy'], timing: 'early',
      elfTitle: 'Testovací titul ' + index, personId: 'person-' + index, createdAt: '2026-11-01T12:00:00Z',
    })),
    draws: [{ version: 2, source: 'generated', drawnAt: '2026-11-01T12:30:00Z', smsLockedAt: null }],
    assignments: Array.from({ length: 3 }, (_, index) => ({
      giver_id: 'elf-' + index, receiver_id: 'elf-' + ((index + 1) % 3), giverName: 'Testovací Elf ' + index,
      receiverName: 'Testovací Elf ' + ((index + 1) % 3),
    })),
    messages: Array.from({ length: 3 }, (_, index) => ({ giverId: 'elf-' + index, phone: '+42070000000' + index, text: 'Testovací SMS ' + index })),
  };
  const assertSections = (participants = 3, sms = 0) => {
    assert.equal(document.querySelectorAll('.participant-list').length, 1, 'Participant list must not be duplicated');
    assert.equal(document.querySelectorAll('.participant-row').length, participants);
    assert.equal(document.querySelectorAll('#participant-filter').length, 1);
    assert.equal(document.querySelectorAll('.season-rules').length, 1, 'Rules box must not be duplicated');
    assert.equal(document.querySelectorAll('.sms-card').length, sms);
    assert.ok(document.querySelector('.season-controls'));
  };
  try {
    const { createRoot } = await import('react-dom/client');
    vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'custom' });
    const AdminApp = (await vite.ssrLoadModule('/src/AdminApp.jsx')).default;
    root = createRoot(document.getElementById('root'));
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(AdminApp))); });
    await type(document.getElementById('admin-password'), 'test-admin-password');
    await click('Odemknout dílnu →');
    await respond('admin-list', snapshot);
    assertSections();
    await click('Zobrazit tajné výsledky');
    assertSections(3, 3);
    for (let index = 0; index < 3; index += 1) {
      await click('Obnovit seznam ↻');
      assertSections(3, 3);
      await respond('admin-list', snapshot);
      assertSections(3, 3);
    }
    await click('Upravit pravidla');
    await type(document.getElementById('season-rules-text'), 'Rozepsaný text, který se neuloží.');
    await click('Zrušit úpravy');
    assert.equal(pending.length, 0);
    assert.ok(document.querySelector('.rules-preview').textContent.includes('3 000 Kč'));
    assertSections(3, 3);
    for (let index = 0; index < 2; index += 1) {
      const rules = 'Potvrzená pravidla ' + index;
      await click('Upravit pravidla');
      await type(document.getElementById('season-rules-text'), rules);
      await click('Potvrdit a vložit do SMS');
      assertSections(3, 3);
      snapshot.rules = rules;
      snapshot.revision += 1;
      snapshot.messages = snapshot.messages.map((message) => ({ ...message, text: 'Titul a příjemce. ' + rules + ' Rozloučení.' }));
      const request = await respond('admin-rules', snapshot);
      assert.equal(request.rules, rules);
      assertSections(3, 3);
      assert.equal(document.querySelectorAll('#season-rules-text').length, 0);
      assert.ok([...document.querySelectorAll('.sms-body')].every((item) => item.textContent.includes(rules)));
    }
    await click('Obnovit seznam ↻');
    await respond('admin-list', { error: 'Testovací chyba načtení' }, 503);
    assertSections(3, 3);
    assert.ok(document.querySelector('[role="alert"]').textContent.includes('Testovací chyba'));
    const nextYear = { ...snapshot, year: 2027, revision: 0, rules: '', registrationOpen: true, currentVersion: null, selectedVersion: null,
      participants: [], assignments: [], messages: [], draws: [] };
    const changeYear = async (year, result) => {
      await act(async () => {
        const select = document.getElementById('view-year');
        select.value = String(year);
        select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      });
      const request = await respond('admin-list', result);
      assert.equal(request.year, year);
    };
    await changeYear(2027, nextYear);
    assertSections(0);
    await changeYear(2026, snapshot);
    assertSections();
    await click('Zobrazit tajné výsledky');
    assertSections(3, 3);
    assert.equal(pending.length, 0);
    assert.deepEqual(messages, [], 'React must not report duplicate keys or other rendering errors');
  } finally {
    if (root) await act(async () => { root.unmount(); });
    if (vite) await vite.close();
    console.error = originalError;
    dom.window.close();
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
