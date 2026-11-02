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
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent === text && !item.closest('[hidden]'));
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
    assert.equal(document.querySelectorAll('[role="tab"]').length, 4);
    assert.equal(document.querySelectorAll('[role="tabpanel"]:not([hidden])').length, 1);
    assert.ok(document.querySelector('.season-controls'));
    assert.ok(!document.querySelector('.season-controls').closest('[hidden]'));
  };
  const clickTab = async (id) => { await act(async () => { document.getElementById('admin-tab-' + id).click(); }); };
  const assertPanel = (id) => {
    assert.equal(document.getElementById('admin-panel-' + id).hidden, false);
    assert.equal(document.getElementById('admin-tab-' + id).getAttribute('aria-selected'), 'true');
    assert.equal(document.getElementById('admin-tab-' + id).tabIndex, 0);
  };
  const changeYear = async (year, result) => {
    await act(async () => {
      const select = document.getElementById('view-year');
      select.value = String(year);
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    const request = await respond('admin-list', result);
    assert.equal(request.year, year);
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
    assertPanel('participants');
    for (let index = 0; index < 3; index += 1) {
      await click('Obnovit seznam ↻');
      assertSections();
      await respond('admin-list', snapshot);
      assertSections();
    }
    await clickTab('draw');
    assertPanel('draw');
    await click('Zobrazit tajné výsledky');
    assert.equal(document.querySelectorAll('.history-table tbody tr').length, 3);
    assertSections();
    await clickTab('sms');
    assertPanel('sms');
    assert.equal(document.querySelectorAll('.history-table').length, 0, 'Leaving draw tab hides secret results');
    await click('Zobrazit SMS');
    assertSections(3, 3);
    assert.ok(document.querySelector('.sms-card a').getAttribute('href').includes(encodeURIComponent(snapshot.messages[0].text)));
    await click('Upravit pravidla');
    await type(document.getElementById('season-rules-text'), 'Rozepsaný text, který se neuloží.');
    await clickTab('participants');
    assertSections();
    await clickTab('sms');
    assert.equal(document.getElementById('season-rules-text').value, 'Rozepsaný text, který se neuloží.');
    await click('Zrušit úpravy');
    assert.equal(pending.length, 0);
    assert.ok(document.querySelector('.rules-preview').textContent.includes('3 000 Kč'));
    await click('Zobrazit SMS');
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
      assertPanel('sms');
      assertSections(3, 3);
      assert.equal(document.querySelectorAll('#season-rules-text').length, 0);
      assert.ok([...document.querySelectorAll('.sms-body')].every((item) => item.textContent.includes(rules)));
    }
    await click('Přejít k losování a uzamčení');
    assertPanel('draw');
    assertSections();
    assert.equal(document.querySelectorAll('.history-table').length, 0);
    await act(async () => {
      for (const checkbox of document.querySelectorAll('#admin-panel-draw .confirmation input')) checkbox.click();
    });
    await type(document.getElementById('draw-confirm'), 'PRELOSOVAT');
    await act(async () => {
      document.getElementById('draw-confirm').closest('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    snapshot.currentVersion = 3;
    snapshot.selectedVersion = 3;
    snapshot.revision += 1;
    snapshot.draws.unshift({ version: 3, source: 'generated', drawnAt: '2026-11-01T13:00:00Z', smsLockedAt: null });
    const reroll = await respond('admin-draw', snapshot);
    assert.equal(reroll.expectedVersion, 2);
    assert.equal(reroll.confirmUnsent, true);
    assert.equal(reroll.confirmation, 'PRELOSOVAT');
    assertPanel('draw');
    assertSections();
    await type(document.getElementById('lock-confirm'), 'UZAMKNOUT');
    await click('Uzamknout výsledek');
    snapshot.draws[0].smsLockedAt = '2026-11-01T13:01:00Z';
    snapshot.revision += 1;
    const locked = await respond('admin-lock', snapshot);
    assert.equal(locked.version, 3);
    assert.equal(document.getElementById('draw-confirm'), null);
    assertPanel('draw');
    // Arrow navigation also selects the panel and moves keyboard focus.
    await act(async () => {
      const tab = document.getElementById('admin-tab-draw');
      tab.focus();
      tab.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    assertPanel('sms');
    assert.equal(document.activeElement.id, 'admin-tab-sms');
    await act(async () => {
      document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    assertPanel('participants');
    await click('Obnovit seznam ↻');
    await respond('admin-list', { error: 'Testovací chyba načtení' }, 503);
    assertSections();
    assert.ok(document.querySelector('[role="alert"]').textContent.includes('Testovací chyba'));
    // Archive viewing stays on the draw tab; SMS tab reloads the current version.
    await clickTab('draw');
    snapshot.draws.push({ version: 1, source: 'generated', drawnAt: '2026-11-01T12:00:00Z', smsLockedAt: null });
    await clickTab('participants');
    await click('Obnovit seznam ↻');
    await respond('admin-list', snapshot);
    await clickTab('draw');
    await act(async () => {
      const select = document.getElementById('draw-version');
      select.value = '1';
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    const archived = { ...snapshot, selectedVersion: 1, messages: [] };
    const archiveRequest = await respond('admin-list', archived);
    assert.equal(archiveRequest.version, 1);
    assertPanel('draw');
    await clickTab('sms');
    assertSections();
    await respond('admin-list', snapshot);
    assertPanel('sms');
    await click('Zobrazit SMS');
    assertSections(3, 3);
    // Unsaved rules never follow the administrator into a different year.
    await click('Upravit pravidla');
    await type(document.getElementById('season-rules-text'), 'Rozepsané pouze pro 2026');
    const nextYear = { ...snapshot, year: 2027, revision: 0, rules: '', registrationOpen: true, currentVersion: null, selectedVersion: null,
      participants: [], assignments: [], messages: [], draws: [] };
    await changeYear(2027, nextYear);
    assertSections(0);
    assertPanel('participants');
    await clickTab('sms');
    assert.ok(document.querySelector('.sms-section').textContent.includes('po prvním losování'));
    await click('Upravit pravidla');
    assert.equal(document.getElementById('season-rules-text').value, '');
    await changeYear(2026, snapshot);
    assertSections();
    assertPanel('participants');
    await clickTab('sms');
    await click('Zobrazit SMS');
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
