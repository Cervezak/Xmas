import { useState } from 'react';
import ParticipantList from './ParticipantList.jsx';
import SeasonRules from './SeasonRules.jsx';
import SmsPanel from './SmsPanel.jsx';
import DrawPanel from './DrawPanel.jsx';

export default function AdminTabs({ snapshot, busy, execute, onError }) {
  const [selected, setSelected] = useState('participants');
  const tabs = [
    { id: 'participants', label: 'Účastníci ' + snapshot.year },
    { id: 'sms', label: 'Pravidla a SMS' },
    { id: 'draw', label: 'Losování' },
  ];
  const selectTab = (id) => {
    setSelected(id);
    if (id === 'sms' && snapshot.selectedVersion !== snapshot.currentVersion) execute('admin-list');
  };
  const navigate = (event, index) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null || busy) return;
    event.preventDefault();
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
    selectTab(tabs[next].id);
  };
  return <div className="admin-workspace">
    <div className="admin-tabs" role="tablist" aria-label={'Administrace ročníku ' + snapshot.year}>
      {tabs.map((tab, index) => <button key={tab.id} id={'admin-tab-' + tab.id} type="button" role="tab"
        aria-selected={selected === tab.id} aria-controls={'admin-panel-' + tab.id}
        tabIndex={selected === tab.id ? 0 : -1} disabled={busy}
        onClick={() => selectTab(tab.id)} onKeyDown={(event) => navigate(event, index)}>{tab.label}</button>)}
    </div>
    <div className="admin-tab-panel" id="admin-panel-participants" role="tabpanel" aria-labelledby="admin-tab-participants" hidden={selected !== 'participants'}>
      <ParticipantList snapshot={snapshot} busy={busy} execute={execute} />
    </div>
    <div className="admin-tab-panel" id="admin-panel-sms" role="tabpanel" aria-labelledby="admin-tab-sms" hidden={selected !== 'sms'}>
      <SeasonRules snapshot={snapshot} busy={busy} execute={execute} />
      <SmsPanel key={'sms:' + snapshot.currentVersion} snapshot={snapshot} busy={busy} active={selected === 'sms'} execute={execute} onError={onError} onDraw={() => selectTab('draw')} />
    </div>
    <div className="admin-tab-panel" id="admin-panel-draw" role="tabpanel" aria-labelledby="admin-tab-draw" hidden={selected !== 'draw'}>
      <DrawPanel key={'draw:' + snapshot.selectedVersion} snapshot={snapshot} busy={busy} execute={execute} onError={onError} active={selected === 'draw'} />
    </div>
  </div>;
}
