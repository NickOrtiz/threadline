window.startThreadline = (initial) => {
  let D = initial;
  const app = document.getElementById('app');
  const nav = document.getElementById('primary-nav');
  const dialog = document.getElementById('command-dialog');
  const commandInput = document.getElementById('command-input');
  const commandResults = document.getElementById('command-results');
  let attentionFilter = 'all';
  let activeDetailTab = 'overview';

  const ws = document.querySelector('.workspace-button');
  const clock = d => d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});

  /** Live data older than two sync intervals is called out as stale. */
  function isStale() {
    const sync = window.THREADLINE_SYNC;
    if (D.meta.dataMode !== 'live' || !sync?.autoSync) return false;
    return Date.now() - Date.parse(D.meta.generatedAt) > sync.intervalMinutes * 2 * 60_000;
  }

  function renderChrome() {
    if (ws) {
      const synced = new Date(D.meta.generatedAt);
      const mode = D.meta.dataMode === 'live' ? `${isStale() ? 'Stale' : 'Live'} · ${isNaN(synced) ? '' : clock(synced)}` : 'Fixture data';
      const failed = (D.meta.sources || []).filter(s => !s.ok);
      ws.querySelector('.workspace-glyph').textContent = D.meta.workspace.name[0];
      ws.querySelector('strong').textContent = D.meta.workspace.name;
      ws.querySelector('small').textContent = window.THREADLINE_SYNC?.running ? 'Syncing…' : failed.length ? `${mode} · ${failed.length} source${failed.length===1?'':'s'} off` : mode;
      ws.title = (D.meta.sources || []).map(s => `${s.ok ? '✓' : '✗'} ${s.type}: ${s.message}`).join('\n') || 'Static fixture';
    }
    document.querySelector('.avatar').textContent = D.meta.user.initials;
  }
  renderChrome();
  document.querySelector('.avatar').addEventListener('click', () => { location.hash = '/settings'; });
  ws?.addEventListener('click', () => { location.hash = '/settings'; });

  const NAV = () => [
    ['/', '01', 'Home'],
    ['/attention', '02', 'Attention', D.attention.filter(x => x.level === 'now').length],
    ['/threads', '03', 'Threads'],
    ['/projects', '04', 'Projects'],
    ['/goals', '05', 'Goals'],
    ['/knowledge', '06', 'Knowledge'],
    ['/review', '07', 'Review'],
    ['/report', '08', 'Report']
  ];

  const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const project = id => D.projects.find(p => p.id === id);
  const thread = id => D.threads.find(t => t.id === id);
  const goal = id => D.goals.find(g => g.id === id);
  const hash = path => `#${path}`;
  const projectName = id => project(id)?.name || '';
  const initials = name => { const w = name.split(/\s+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0,2)).toUpperCase(); };
  const sourceLink = (url, label='Open in source') => url ? `<a class="subtle-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>` : '';
  const empty = text => `<div class="empty-state">${esc(text)}</div>`;

  function pill(text, type='') { return `<span class="pill ${type}">${esc(text)}</span>`; }
  function progress(n){ return `<div class="progress-track"><div class="progress-fill" style="width:${n}%"></div></div>`; }
  function pageHeader(kicker, title, subhead, meta='') {
    return `<header class="page-header"><div class="page-title-wrap"><span class="kicker">${esc(kicker)}</span><h1>${title}</h1><p>${subhead}</p></div>${meta ? `<div class="page-header-meta">${meta}</div>` : ''}</header>`;
  }
  function sectionBar(title, sub='') { return `<div class="section-bar"><div><h2>${title}</h2>${sub?`<p>${sub}</p>`:''}</div></div>`; }

  function renderNav(path) {
    document.getElementById('settings-link')?.classList.toggle('active', path === '/settings');
    nav.innerHTML = NAV().map(([href, icon, label, badge]) => {
      const active = href === '/' ? path === '/' : path.startsWith(href);
      return `<a class="nav-link ${active?'active':''}" href="${hash(href)}"><span class="nav-icon">${icon}</span><span>${label}</span>${badge?`<span class="nav-badge">${badge}</span>`:''}</a>`;
    }).join('');
  }

  const nowCount = () => D.attention.filter(x => x.level === 'now').length;

  /**
   * Live views compute the greeting and date from the current time, so they
   * stay right between syncs. Fixtures keep their authored text.
   */
  function greetingParts() {
    if (D.meta.dataMode !== 'live' || !D.daily.greetingName) return { date: D.daily.date, headline: D.daily.headline };
    const now = new Date();
    let zone = {};
    try { if (D.meta.timezone) { new Intl.DateTimeFormat('en-US', { timeZone: D.meta.timezone }); zone = { timeZone: D.meta.timezone }; } } catch {}
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', ...zone }).format(now));
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return {
      date: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...zone }),
      headline: `${greeting}, ${D.daily.greetingName}.`,
    };
  }

  function zenHero() {
    // Split on the first sentence end, not the first period ("E 5.1 Banner").
    const cut = D.daily.summary.search(/\.\s/);
    const lead = cut < 0 ? D.daily.summary : D.daily.summary.slice(0, cut + 1);
    const rest = cut < 0 ? '' : D.daily.summary.slice(cut + 1).trim();
    return `<section class="zen-hero">
      <div class="zen-copy">
        <span class="kicker">Daily briefing</span>
        <h2>${esc(lead)}</h2>
        <p>${esc(rest)}</p>
      </div>
      <div class="zen-scene" aria-hidden="true"><div class="sun"></div><div class="mountain m2"></div><div class="mountain"></div><div class="waterline"></div></div>
    </section>`;
  }

  /** PRD context for a piece of work: status, acceptance criteria, open questions, design. */
  function prdContext(prds) {
    if (!prds || !prds.length) return '';
    return prds.map(p => {
      const facts = [
        p.acceptanceTotal ? `${p.acceptanceDone}/${p.acceptanceTotal} acceptance criteria` : null,
        p.openQuestions.length ? `${p.openQuestions.length} open question${p.openQuestions.length === 1 ? '' : 's'}` : 'No open questions',
        p.neededDependencies.length ? `${p.neededDependencies.length} dependenc${p.neededDependencies.length === 1 ? 'y' : 'ies'} needed` : null,
      ].filter(Boolean).join(' · ');
      return `<div class="prd-context">
        <div class="prd-head"><span class="kicker" style="margin:0">${esc(p.code || 'PRD')}</span><strong>${esc(p.title)}</strong>${pill(p.status, p.status === 'approved' || p.status === 'implemented' ? 'good' : 'watch')}</div>
        <p>${esc(facts)}${p.designLinks[0] ? ` · <a href="${esc(p.designLinks[0])}" target="_blank" rel="noopener">Design ↗</a>` : ''}${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener">Open in Relay ↗</a>` : ''}</p>
        ${p.openQuestions.length ? `<details><summary>Open questions</summary><ul>${p.openQuestions.map(q => `<li>${esc(q)}</li>`).join('')}</ul></details>` : ''}
        ${p.neededDependencies.length ? `<details><summary>Needed dependencies</summary><ul>${p.neededDependencies.map(q => `<li>${esc(q)}</li>`).join('')}</ul></details>` : ''}
      </div>`;
    }).join('');
  }

  function focusCard() {
    const f = D.focus;
    if (!f) return `<article class="card focus-card"><div class="card-inner"><div class="card-header"><div class="card-title"><span class="glyph">◉</span>Current focus</div></div><h2>Nothing needs you right now.</h2><p class="lede">No open work is due soon. Use the time for something you chose.</p></div></article>`;
    const p = project(f.projectId) || { name: 'No project', description: '' };
    return `<article class="card focus-card"><div class="card-inner">
      <div class="card-header"><div class="card-title"><span class="glyph">◉</span>Current focus</div>${pill(f.status,'blue')}</div>
      <div class="focus-project"><span class="project-avatar">${esc(initials(p.name))}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.description)}</small></span></div>
      <h2>${esc(f.title)}</h2><p class="lede">${esc(f.description)} ${esc(f.reason)}</p>${prdContext(f.prds)}
      <div class="focus-metrics">
        <div class="metric"><span class="metric-label">Next action</span><span class="metric-value">${esc(f.nextAction)}</span></div>
        <div class="metric"><span class="metric-label">Estimate</span><span class="metric-value">${esc(f.effort)}</span></div>
        <div class="metric"><span class="metric-label">Why it matters</span><span class="metric-value">${esc(f.reason)}</span></div>
        <div class="metric"><span class="metric-label">Blockers</span><span class="metric-value">${esc(f.blockers.join(' · ') || 'None')}</span></div>
      </div>
      ${f.todoId && canEdit() ? `<button type="button" class="primary-button" data-todo-done="${esc(f.todoId)}">Mark done <span>✓</span></button>` : f.threadId ? `<a class="primary-button" href="#/threads/${f.threadId}">Open work context <span>→</span></a>` : f.sourceUrl ? `<a class="primary-button" href="${esc(f.sourceUrl)}" target="_blank" rel="noopener">Open task <span>↗</span></a>` : ''}
    </div></article>`;
  }

  function nextUpCard() {
    return `<article class="card"><div class="card-inner"><div class="card-header"><div class="card-title"><span class="glyph">↳</span>Next up</div><div class="card-links">${canEdit() ? `<button type="button" class="subtle-link link-button" data-toggle-add>+ Add to-do</button>` : ''}<a class="subtle-link" href="#/todos">To-dos →</a></div></div>${canEdit() ? todoForm(true) : ''}<ol class="next-list">
      ${D.nextUp.length ? (() => { let n = 0; return D.nextUp.map(x=>`<li class="next-item">${x.todoId && canEdit() ? `<button type="button" class="todo-check" data-todo-done="${esc(x.todoId)}" aria-label="Mark ${esc(x.title)} done"></button>` : `<span class="rank">${++n}</span>`}<div class="next-main"><strong>${x.sourceUrl?`<a href="${esc(x.sourceUrl)}" target="_blank" rel="noopener">${esc(x.title)}</a>`:esc(x.title)}</strong><div class="next-meta"><span>${esc(x.source)}</span>${x.prd ? `<span>·</span><span title="${esc(x.prd.title)}">${esc(x.prd.code || 'PRD')}${x.prd.openQuestions ? ` · ${x.prd.openQuestions} open Q` : ''}</span>` : ''}${projectName(x.projectId)?`<span>·</span><span>${esc(projectName(x.projectId))}</span>`:''}</div></div><span class="next-estimate">${esc(x.estimate)}</span></li>`).join(''); })() : empty('Nothing else is queued.')}
    </ol></div></article>`;
  }

  /** Claude plan usage: one row per window, with a bar and its reset time. */
  function claudeCard() {
    const c = D.daily.claude;
    if (!c) return '';
    const at = iso => {
      const d = new Date(iso), sameDay = d.toDateString() === new Date().toDateString();
      return d.toLocaleString([], sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    };
    const LABEL = { '5-hour window': '5-hour window', week: 'This week' };
    const rows = !c.windows.length ? '<p class="settings-hint">No active window. Claude Code reports a new one after your next request.</p>' : c.windows.map(w => `<div class="list-row usage-row">
        <div><strong>${esc(LABEL[w.label] || w.label)}</strong><p>${w.resetsAt ? `Resets ${esc(at(w.resetsAt))}` : 'Reset time unknown'}</p></div>
        <div class="usage-meter"><span class="usage-pct ${w.usedPercent >= 80 ? 'pulse-behind' : ''}">${Math.round(w.usedPercent)}%</span>${progress(Math.min(100, Math.round(w.usedPercent)))}</div>
      </div>`).join('');
    return `<article class="card"><div class="card-inner"><div class="card-header"><div class="card-title"><span class="glyph">◔</span>Claude usage</div><span class="subtle-link ${c.stale ? 'usage-stale' : ''}" title="Reported by Claude Code's status line">${c.stale ? 'Last reported' : 'As of'} ${esc(at(c.capturedAt))}</span></div>${rows}${c.stale ? '<p class="settings-hint">This reading is old. It updates when you use Claude Code in this folder.</p>' : ''}</div></article>`;
  }

  function todayCard() {
    return `<article class="card"><div class="card-inner"><div class="card-header"><div class="card-title"><span class="glyph">◫</span>Today</div><span class="subtle-link">${esc(D.daily.capacity.status)} capacity</span></div><ul class="timeline">
      ${D.schedule.length ? '' : empty(D.daily.capacity.status==='Unknown' ? 'No calendar connected.' : 'Nothing on the calendar today.')}${D.schedule.map(x=>`<li class="timeline-item ${x.kind}"><span class="timeline-dot"></span><span class="timeline-time">${esc(x.time)}</span><span class="timeline-copy"><strong>${esc(x.title)}</strong><small>${esc(x.meta)}</small></span></li>`).join('')}
    </ul><div class="capacity-strip"><div class="capacity-stat"><strong>${D.daily.capacity.focusHours}h</strong><small>Focus time</small></div><div class="capacity-stat"><strong>${D.daily.capacity.meetingsHours}h</strong><small>Meetings</small></div><div class="capacity-stat"><strong>${D.daily.capacity.allocation}%</strong><small>Allocated</small></div></div>${D.daily.week ? `<p class="week-line">This week: ${D.daily.week.logged} of ${D.daily.week.booked} h booked is logged · ${D.daily.week.available} h available</p>` : ''}</div></article>`;
  }

  function projectMiniCard(p){
    return `<a class="entity-card" href="#/projects/${p.id}"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center">${pill(p.status,p.status==='On track'?'good':p.status==='Watch'?'watch':'')}<span class="kicker" style="margin:0">${esc(p.due)}</span></div><h3>${esc(p.name)}</h3><p>${esc(p.nextMilestone)}</p>${progress(p.progress)}<div class="entity-footer"><span>${p.progress}% complete</span><span>Open →</span></div></a>`;
  }

  /** Booked projects first, by hours still to go; the rest by the projection's order. */
  function pulseProjects() {
    const booked = D.projects.filter(p => p.week).sort((a, b) => b.week.remaining - a.week.remaining);
    return [...booked, ...D.projects.filter(p => !p.week)].slice(0, 4);
  }

  /** Related tickets worth doing together, with a brief to paste into a worktree tool. */
  function batchesCard() {
    const batches = (D.batches || []).slice(0, 3);
    if (!batches.length) return '';
    const rows = batches.map((b, i) => {
      const est = b.estimateMinutes ? `${Math.round(b.estimateMinutes / 6) / 10} h` : 'not estimated';
      const saved = `saves about ${b.rampSavedMinutes[0]}–${b.rampSavedMinutes[1]} min`;
      return `<div class="batch-row">
        <div class="batch-head"><strong>${esc(b.title)}</strong>${pill(b.kind === 'parallel' ? `Parallel · ${b.slots} at a time` : 'Back to back', b.kind === 'parallel' ? 'good' : 'blue')}</div>
        <p>${esc(`${b.items.length} tickets · ${est}${b.unestimated ? ` (+${b.unestimated} unestimated)` : ''} · ${saved}`)}</p>
        ${b.notes.length ? `<p class="batch-note">${esc(b.notes.join(' '))}</p>` : ''}
        <details><summary>Tickets</summary><ul>${b.items.map(x => `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)} <span class="batch-ready">${esc(x.ready === true ? 'ready' : x.ready === false ? x.reason : 'readiness unknown')}</span></li>`).join('')}</ul></details>
        <button type="button" class="secondary-button" data-copy-batch="${i}">Copy brief</button>
      </div>`;
    }).join('');
    return `<article class="card"><div class="card-inner"><div class="card-header"><div class="card-title"><span class="glyph">⧉</span>Batches</div><span class="subtle-link">Do these together</span></div>${rows}</div></article>`;
  }

  /** Your PRs waiting on reviewers. Nothing to do until one goes stale. */
  function reviewQueueCard() {
    const q = D.reviewQueue || [];
    if (!q.length) return '';
    const stale = q.filter(r => r.tier === 'stale').length;
    const TIER = { stale: ['Needs a bump', 'accent'], aging: ['Aging', 'watch'], fresh: ['Fresh', 'good'] };
    const rows = q.slice(0, 5).map(r => `<div class="list-row"><div><strong>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">PR #${esc(r.number)}</a>` : `PR #${esc(r.number)}`} · ${esc(r.title)}</strong><p>${esc(`${r.waitingDays} working day${r.waitingDays === 1 ? '' : 's'} waiting${r.reviewers.length ? ` on ${r.reviewers.join(', ')}` : ''}`)}</p></div>${pill(...TIER[r.tier])}</div>`).join('');
    return `<article class="card"><div class="card-inner"><div class="card-header"><div class="card-title"><span class="glyph">⇄</span>In code review</div><span class="subtle-link">${stale ? `${stale} need a bump` : 'Waiting on reviewers'}</span></div>${rows}${q.length > 5 ? `<p class="settings-hint">+${q.length - 5} more on the Threads page.</p>` : ''}</div></article>`;
  }

  function homePage(){
    const g = greetingParts();
    return `<div class="page">${pageHeader(g.date,g.headline,D.daily.subhead,(nowCount()?pill(`${nowCount()} decision${nowCount()===1?'':'s'}`,'accent'):'')+pill(`${D.daily.capacity.focusHours}h focus`,'good'))}${continuityCard_home()}${zenHero()}<div class="home-grid"><div class="stack">${focusCard()}${nextUpCard()}${batchesCard()}</div><div class="stack">${todayCard()}${claudeCard()}${reviewQueueCard()}<article class="card"><div class="card-inner"><div class="card-header"><div class="card-title"><span class="glyph">□</span>Project pulse</div><a class="subtle-link" href="#/projects">All projects →</a></div>${pulseProjects().map(p=>p.week ? `<div class="list-row"><div><strong>${esc(p.name)}</strong><p>${esc(`${p.week.logged} of ${p.week.booked} h booked this week`)}${p.week.status==='behind'?` · <span class="pulse-behind">behind</span>`:p.week.status==='over'?` · <span class="pulse-behind">over</span>`:''}</p></div><span style="min-width:94px">${progress(Math.min(100, Math.round(p.week.logged / Math.max(p.week.booked, 0.1) * 100)))}</span></div>` : `<div class="list-row"><div><strong>${esc(p.name)}</strong><p>${esc(p.nextMilestone)}</p></div><span style="min-width:94px">${progress(p.progress)}</span></div>`).join('')}</div></article></div></div></div>`;
  }

  function attentionPage(){
    const levels = [['all','Everything'],['now','Now'],['next','Next'],['watch','Watch'],['later','Later']];
    const visible = attentionFilter==='all'?D.attention:D.attention.filter(x=>x.level===attentionFilter);
    return `<div class="page">${pageHeader('Attention firewall','Only what deserves a decision.','Threadline absorbs the source noise, keeps the underlying context, and surfaces only what should affect your plan.',pill(`${D.attention.filter(x=>x.level==='now').length} now`,'accent')+pill(`${D.attention.filter(x=>x.level==='watch').length} watch`,'watch'))}
      <div class="attention-controls">${levels.map(([id,l])=>`<button class="filter-chip ${attentionFilter===id?'active':''}" data-filter="${id}">${l}</button>`).join('')}</div>
      <div class="attention-list">${visible.length ? visible.map(a=>attentionCard(a)).join('') : empty('Nothing here. That is the goal.')}</div>
    </div>`;
  }

  function attentionCard(a){
    return `<article class="attention-card" data-level="${a.level}"><div class="attention-rail"></div><div class="attention-copy"><div class="attention-topline">${pill(a.level==='now'?'Needs you':a.level==='next'?'Next':a.level==='watch'?'Watch':'Later',a.level==='now'?'accent':a.level==='watch'?'watch':a.level==='next'?'blue':'')}<span class="kicker" style="margin:0">${esc(a.source)} · ${esc(a.sourceRef)}</span></div><h3>${esc(a.title)}</h3><p>${esc(a.detail)}</p><div class="attention-why">Why surfaced: ${esc(a.why)}</div></div><div class="attention-action"><div><strong>${esc(a.action)}</strong><small>${esc(a.due)} · ${esc(a.estimatedEffort)}</small></div>${a.projectId&&project(a.projectId)?`<a class="secondary-button" href="#/projects/${a.projectId}">Open context →</a>`:''}${sourceLink(a.sourceUrl, a.source)}</div></article>`;
  }

  function projectsPage(){
    return `<div class="page">${pageHeader('Projects','Work with a memory.','Each project holds its current state, goals, decisions, accomplishments, weekly reflection, and durable learnings.',pill(`${D.projects.length} active`,'good'))}<div class="entity-grid">${D.projects.map(projectMiniCard).join('')}</div></div>`;
  }

  // Code review gets its own group: waiting on a reviewer is not your action.
  const THREAD_GROUPS = [['Needs you', t => t.status === 'Active'], ['In code review', t => !!t.reviewState && t.status !== 'Active' && t.status !== 'Done'], ['Waiting on others', t => !t.reviewState && (t.status === 'Waiting' || t.status === 'Handed off')], ['Done', t => t.status === 'Done']];

  function threadCard(t) {
    const meta = [projectName(t.projectId), t.stage, t.updated].filter(Boolean).join(' · ');
    return `<a class="entity-card thread-card" href="#/threads/${encodeURIComponent(t.id)}">${pill(t.status, t.status === 'Active' ? 'good' : t.status === 'Done' ? '' : 'watch')}<h3>${esc(t.title)}</h3><p>${esc(t.nextAction)}</p><div class="entity-footer"><span>${esc(meta)}</span><span>Open →</span></div></a>`;
  }

  function threadsPage(){
    const head = pageHeader('Threads', 'Context that survives the gap.', 'Each piece of work you touched recently, followed across Teamwork, GitHub, and Relay. Where you left off, what changed, and what happens next.', pill(`${D.threads.filter(t => t.status === 'Active').length} need you`, 'blue'));
    if (!D.threads.length) return `<div class="page">${head}${empty('No threads yet. They appear once you work on tasks in Teamwork.')}</div>`;
    const groups = THREAD_GROUPS.map(([label, statuses]) => {
      const list = D.threads.filter(statuses);
      return list.length ? `<section class="thread-group"><h2>${esc(label)} <span class="kicker" style="margin:0">${list.length}</span></h2><div class="entity-grid">${list.map(threadCard).join('')}</div></section>` : '';
    }).join('');
    const other = D.threads.filter(t => !THREAD_GROUPS.some(([, test]) => test(t)));
    return `<div class="page">${head}${groups}${other.length ? `<div class="entity-grid">${other.map(threadCard).join('')}</div>` : ''}</div>`;
  }

  const TIMELINE_KIND = { comment: 'Commented', stage: 'Moved', completed: 'Completed', reopened: 'Reopened', merged: 'Merged', todo_done: 'To-do done' };

  function continuityCard(c){
    return `<div class="continuity-card"><span class="kicker">Continuity snapshot</span><h3>Pick up without reconstructing.</h3><p><strong>Where you were:</strong> ${esc(c.whereYouWere || c.lastAction || '')}</p>${c.changedSince?`<ul>${c.changedSince.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}<p style="margin-top:14px"><strong>Restart:</strong> ${esc(c.restart)}</p></div>`;
  }

  function threadDetailPage(t){
    const p = project(t.projectId) || { id: '', name: 'No project' };
    const editable = canEdit() && t.id.startsWith('thread-');
    const links = t.links || t.linked.map(label => ({ label, url: '', kind: 'other', state: null }));
    const notes = `<section class="content-section"><h2>Notes</h2><p>Your working notes. They stay in Threadline.</p>
      <div class="note-list">${t.notes.length ? t.notes.map(n => `<div class="note"><time>${esc(n.at)}</time><p>${esc(n.body)}</p>${editable ? `<button type="button" class="todo-delete" data-note-delete="${esc(n.id)}" aria-label="Delete note">×</button>` : ''}</div>`).join('') : '<p class="settings-hint">No notes yet.</p>'}</div>
      <form class="note-composer" data-note-form><input id="new-note" placeholder="What should future you know? e.g. Waiting on Dana before merging" autocomplete="off" /><button class="secondary-button" id="add-note">Add note</button></form></section>`;
    const overview = `<section class="content-section"><h2>Working state</h2><div class="info-grid">
        <div class="info-tile"><span>Next action</span><strong>${esc(t.nextAction)}</strong></div>
        <div class="info-tile"><span>Waiting on</span><strong>${esc(t.waitingOn.join(' · ') || 'Nothing')}</strong></div>
        <div class="info-tile"><span>Stage</span><strong>${esc(t.stage || t.status)}</strong></div>
        <div class="info-tile"><span>Time logged</span><strong>${t.hours != null ? `${t.hours} h this week` : '—'}</strong></div>
      </div>${t.prds && t.prds.length ? prdContext(t.prds) : t.openQuestions.length ? `<div class="info-tile" style="margin-top:12px"><span>Open questions</span><strong>${esc(t.openQuestions.join(' · '))}</strong></div>` : ''}</section>${notes}`;
    const timeline = t.timeline && t.timeline.length ? `<section class="content-section"><h2>Timeline</h2><ul class="record-list">${t.timeline.map(e => `<li><time>${esc(e.date.slice(5).replace('-', '/'))}</time><span class="record-kind">${esc(TIMELINE_KIND[e.kind] || e.kind)}</span><div>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.text)}</a>` : esc(e.text)}</div></li>`).join('')}</ul></section>` : '';
    const context = `<section class="content-section"><h2>Linked context</h2>${links.map(l => `<div class="list-row"><div><strong>${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>` : esc(l.label)}</strong></div>${l.state ? pill(l.state, /merged|approved|implemented/.test(l.state) ? 'good' : /changes|failing/.test(l.state) ? 'accent' : 'watch') : ''}</div>`).join('') || '<p>No linked records.</p>'}</section>${timeline}`;
    const hasLearning = t.candidateLearnings && t.candidateLearnings.length;
    const learn = `<section class="content-section"><h2>Candidate learnings</h2>${t.candidateLearnings.map(x => `<div class="list-row"><strong>${esc(x)}</strong></div>`).join('')}</section>`;
    if (activeDetailTab === 'learning' && !hasLearning) activeDetailTab = 'overview';
    const body = activeDetailTab === 'context' ? context : activeDetailTab === 'learning' ? learn : overview;
    const tab = (id, label) => `<button class="detail-tab ${activeDetailTab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`;
    const sourceLinks = links.filter(l => l.url).slice(0, 6);
    return `<div class="page"><a class="back-link" href="#/threads">← All threads</a><div class="detail-shell"><div class="detail-main">
      <header class="detail-hero"><span class="kicker">${esc(p.name)} · ${esc(t.status)}${t.stage ? ` · ${esc(t.stage)}` : ''}</span><h1>${esc(t.title)}</h1>${t.objective ? `<p>${esc(t.objective)}</p>` : ''}</header>
      <nav class="detail-tabs">${tab('overview', 'Work state')}${tab('context', 'Links + timeline')}${hasLearning ? tab('learning', 'Learnings') : ''}</nav>${body}</div>
      <aside class="detail-aside">${continuityCard(t.continuity)}
        ${sourceLinks.length ? `<div class="mini-card"><h3>Open</h3><ul class="mini-list">${sourceLinks.map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a></li>`).join('')}</ul></div>` : ''}
        ${p.id ? `<div class="mini-card"><h3>Project</h3><p><a href="#/projects/${p.id}">${esc(p.name)} →</a></p></div>` : ''}</aside></div></div>`;
  }


  const RECORD_KIND = { completed: 'Completed', reopened: 'Reopened', stage: 'Moved', comment: 'Commented', todo_done: 'To-do done' };

  function workRecord(p) {
    if (!p.record || !p.record.length) return '';
    return `<section class="content-section"><h2>Work record</h2><p>Your recent activity on this project, kept in the work journal.</p>
      <ul class="record-list">${p.record.map(r => `<li><time>${esc(r.date.slice(5).replace('-', '/'))}</time><span class="record-kind">${esc(RECORD_KIND[r.kind] || r.kind)}</span><div><strong>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title)}</strong>${r.detail ? `<p>${esc(r.detail)}</p>` : ''}</div></li>`).join('')}</ul></section>`;
  }

  function knowledgeBaseSection(p) {
    const kb = p.knowledgeBase;
    if (!kb) return '';
    const count = (k, label) => kb.counts[k] ? `${kb.counts[k]} ${label}${kb.counts[k] === 1 ? '' : 's'}` : null;
    const summary = [count('prd', 'PRD'), count('epic', 'epic'), count('notebook', 'notebook page')].filter(Boolean).join(' · ');
    const links = kb.spaces.map(s => `<a class="secondary-button" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>`).join('');
    return `<section class="content-section"><h2>Knowledge base</h2><p>${esc(summary)} in Relay Cloud. Read-only here.</p><div class="kb-links">${links}</div>
      ${kb.active.length ? `<h3 class="kb-heading">PRDs in play</h3>${kb.active.map(r => `<div class="list-row"><div><strong>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc([r.code, r.title].filter(Boolean).join(' · '))}</a>` : esc(r.title)}</strong><p>${esc([r.linked ? 'Linked to your work' : null, r.openQuestions ? `${r.openQuestions} open question${r.openQuestions === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || ' ')}</p></div>${pill(r.status, r.status === 'approved' || r.status === 'implemented' ? 'good' : 'watch')}</div>`).join('')}` : ''}
      ${kb.implemented ? `<p class="settings-hint">${kb.implemented} more PRD${kb.implemented === 1 ? ' is' : 's are'} implemented.</p>` : ''}
      ${kb.notebooks.length ? `<h3 class="kb-heading">Recent notebook pages</h3>${kb.notebooks.map(n => `<div class="list-row"><strong>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)}</strong><span class="kicker" style="margin:0">${esc(n.updatedAt)}</span></div>`).join('')}` : ''}
    </section>`;
  }

  function projectDetailPage(p){
    return `<div class="page"><a class="back-link" href="#/projects">← All projects</a><div class="detail-shell"><div class="detail-main"><header class="detail-hero"><span class="kicker">Project · ${esc(p.status)} · ${p.progress}%</span><h1>${esc(p.name)}</h1><p>${esc(p.objective)}</p></header>
      <section class="content-section"><h2>Current state</h2><div class="info-grid"><div class="info-tile"><span>Your role</span><strong>${esc(p.role)}</strong></div><div class="info-tile"><span>Next milestone</span><strong>${esc(p.nextMilestone)}</strong></div><div class="info-tile"><span>Due</span><strong>${esc(p.due)}</strong></div><div class="info-tile"><span>Progress</span><strong>${p.progress}% complete</strong></div></div></section>
      <section class="content-section"><h2>This week</h2>${weeklyCard(p.weekly)}</section>${workRecord(p)}${knowledgeBaseSection(p)}
      <section class="content-section"><h2>Accomplishments</h2>${p.accomplishments.length ? p.accomplishments.map(x=>`<div class="list-row"><strong>${esc(x)}</strong>${pill('Evidence','good')}</div>`).join('') : '<p>No accomplishments retained yet.</p>'}</section>
      <section class="content-section"><h2>Decisions</h2>${p.decisions.length?p.decisions.map(d=>`<div class="list-row"><div><strong>${esc(d.title)}</strong><p>${esc(d.rationale)}</p></div><span class="kicker" style="margin:0">${esc(d.date)}</span></div>`).join(''):'<p>No durable decisions recorded yet.</p>'}</section>
      <section class="content-section"><h2>Project learnings</h2>${p.learnings.length ? '' : '<p>No learnings retained yet.</p>'}${p.learnings.map(l=>`<div class="list-row"><div><strong>${esc(l.title)}</strong><p>${esc(l.detail)}</p></div>${pill(l.type,l.reusable?'good':'')}</div>`).join('')}</section>
    </div><aside class="detail-aside"><div class="mini-card"><h3>Health</h3>${Object.entries(p.health).map(([k,v])=>`<div class="list-row"><strong>${esc(k)}</strong>${pill(v,v==='Healthy'?'good':'watch')}</div>`).join('')}</div><div class="mini-card"><h3>Goals</h3><ul class="mini-list">${p.goals.filter(goal).map(id=>`<li><a href="#/goals/${id}">${esc(goal(id).title)} →</a></li>`).join('') || '<li>No linked goals.</li>'}</ul></div>${p.sourceUrl?`<div class="mini-card"><h3>Source</h3><p>${sourceLink(p.sourceUrl,'Open project')}</p></div>`:''}<div class="mini-card"><h3>Close project</h3><p>At completion, synthesize role, outcomes, problems solved, decisions, reusable patterns, metrics, and lessons.</p><button class="secondary-button" style="margin-top:12px">Preview retrospective</button></div></aside></div></div>`;
  }

  const listOrNone = xs => xs.length ? xs.map(x=>`<li>${esc(x)}</li>`).join('') : '<li>None</li>';
  function weeklyCard(w){
    return `<div class="weekly-card"><span class="kicker">${esc(w.period)}</span><p>${esc(w.summary)}</p><div class="triple-grid"><div><h4>Wins</h4><ul>${listOrNone(w.wins)}</ul></div><div><h4>Risks</h4><ul>${listOrNone(w.risks)}</ul></div><div><h4>Next</h4><ul>${listOrNone(w.next)}</ul></div></div></div>`;
  }

  function goalsPage(){
    return `<div class="page">${pageHeader('Goals','Daily work should prove the goal.','Threadline connects SMART goals to actual projects and evidence, then warns when a goal is technically alive but operationally unlikely.',pill('Evidence-linked','good'))}<article class="card"><div class="card-inner" style="padding:8px 24px">${D.goals.length ? '' : empty('No goals yet. Goals are added in memory/threadline-memory.json for now.')}${D.goals.map(g=>`<a class="goal-card" href="#/goals/${g.id}"><div>${pill(g.status,g.status==='On track'?'good':'blue')}<h3>${esc(g.title)}</h3><p>${esc(g.target)}</p><span class="kicker" style="margin:0">${esc(g.current)}</span></div><div class="goal-progress"><strong>${g.progress}%</strong><small>${esc(g.measure)}</small></div></a>`).join('')}</div></article></div>`;
  }

  function goalDetailPage(g){
    return `<div class="page"><a class="back-link" href="#/goals">← All goals</a><div class="detail-shell"><div class="detail-main"><header class="detail-hero"><span class="kicker">${esc(g.type)} goal · ${esc(g.status)}</span><h1>${esc(g.title)}</h1><p>${esc(g.target)}</p></header><section class="content-section"><h2>Measurement</h2><div class="info-grid"><div class="info-tile"><span>Measure</span><strong>${esc(g.measure)}</strong></div><div class="info-tile"><span>Current</span><strong>${esc(g.current)}</strong></div><div class="info-tile"><span>Due</span><strong>${esc(g.due)}</strong></div><div class="info-tile"><span>Progress</span><strong>${g.progress}%</strong></div></div></section><section class="content-section"><h2>${g.type && g.type.includes('Leapsome') ? 'Key results' : 'Evidence'}</h2>${g.evidence.map(e=>`<div class="list-row"><div><strong>${esc(e.title)}</strong><p>${esc(e.detail)}</p></div>${pill(e.strength,e.strength==='Strong'?'good':'watch')}</div>`).join('')}</section>${g.linkedProjects.filter(project).length ? `<section class="content-section"><h2>Linked projects</h2>${g.linkedProjects.filter(project).map(id=>`<div class="list-row"><strong>${esc(project(id).name)}</strong><a class="subtle-link" href="#/projects/${id}">Open project →</a></div>`).join('')}</section>` : ''}</div><aside class="detail-aside"><div class="mini-card"><h3>Goal risk</h3><p>${esc(g.risk)}</p></div>${g.sourceUrl ? `<div class="mini-card"><h3>Source</h3><p>${sourceLink(g.sourceUrl, 'Open in Leapsome')}</p></div>` : ''}<div class="mini-card"><h3>Threadline behavior</h3><p>Project accomplishments and retained evidence can advance this goal automatically after confirmation.</p></div></aside></div></div>`;
  }

  function knowledgePage(){
    return `<div class="page">${pageHeader('Knowledge','Finished work becomes leverage.','Retain the approaches, accomplishments, problems, decisions, and reusable patterns that should make future work easier.',pill(`${D.knowledge.filter(k=>k.reusable).length} reusable`,'good'))}<div class="knowledge-grid">${D.knowledge.length ? '' : empty('Nothing retained yet. Knowledge collects here as work closes.')}${D.knowledge.map(k=>`<article class="knowledge-card"><span class="knowledge-kind">${esc(k.kind)} · ${esc(k.created)}</span><h3>${esc(k.title)}</h3><p>${esc(k.body)}</p><div class="tag-row">${k.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}${project(k.projectId)?`<a class="tag" href="#/projects/${k.projectId}">${esc(projectName(k.projectId))} ↗</a>`:''}</div></article>`).join('')}</div></div>`;
  }

  function reviewPage(){
    return `<div class="page">${pageHeader('Evidence + review',D.review.period,'A continuously maintained record of what you contributed, what changed because of it, and the patterns that define your role.',pill('Evidence-backed','good'))}<section class="review-hero"><blockquote>“${esc(D.review.narrative)}”</blockquote><p>This page is intentionally downstream of execution. Threadline should be able to assemble this without asking you to remember six months of work from scratch.</p></section>${sectionBar('Contribution themes','Derived from retained accomplishments, decisions, project roles, and learnings.')}<div class="theme-grid">${D.review.themes.map(t=>`<article class="theme-card"><strong>${t.count}</strong><span>${esc(t.label)}</span><p>${esc(t.note)}</p></article>`).join('')}</div>${sectionBar('Project evidence')}<div class="entity-grid">${D.projects.map(p=>`<a class="entity-card" href="#/projects/${p.id}">${pill(p.status,p.status==='On track'?'good':p.status==='Watch'?'watch':'')}<h3>${esc(p.name)}</h3><p>${esc(p.role)}</p><div class="entity-footer"><span>${p.accomplishments.length} accomplishments · ${p.learnings.length} learnings</span><span>Inspect →</span></div></a>`).join('')}</div></div>`;
  }

  const SOURCE_NAMES = { teamwork: 'Teamwork', 'google-calendar': 'Google Calendar', github: 'GitHub', gitlab: 'GitLab' };

  function segmented(name, options, current) {
    return `<div class="segmented" role="radiogroup" aria-label="${esc(name)}">${options.map(([value, label]) =>
      `<button type="button" role="radio" aria-checked="${value===current}" class="${value===current?'active':''}" data-${name}="${esc(value)}">${esc(label)}</button>`).join('')}</div>`;
  }

  function syncRow(){
    const sync = window.THREADLINE_SYNC;
    if (!sync) return `<div class="settings-row"><div><strong>Automatic sync</strong><p>Off. Start Threadline with <code>npm start</code> to sync every few minutes.</p></div></div>`;
    const last = sync.lastRun ? `Last sync ${clock(new Date(sync.lastRun.finishedAt))}${sync.lastRun.ok ? '' : ' failed'}.` : 'No sync yet.';
    const next = sync.autoSync && sync.nextRunAt ? ` Next at ${clock(new Date(sync.nextRunAt))}.` : '';
    const what = sync.autoSync ? `Every ${sync.intervalMinutes} minutes while <code>npm start</code> is running.` : 'Off. This server was started without automatic sync.';
    return `<div class="settings-row"><div><strong>Automatic sync</strong><p>${what} ${esc(last + next)}</p>${sync.lastRun && !sync.lastRun.ok ? `<p class="settings-error">${esc(sync.lastRun.summary)}</p>` : ''}</div>
      <button type="button" class="secondary-button" id="sync-now" ${sync.running ? 'disabled' : ''}>${sync.running ? 'Syncing…' : 'Sync now'}</button></div>`;
  }

  function settingsPage(){
    const src = window.THREADLINE_SOURCE || { mode: D.meta.dataMode || 'fixture', origin: 'default', fixtures: [] };
    const saved = window.ThreadlinePrefs.read('threadline.dataSource', 'live');
    const synced = new Date(D.meta.generatedAt);
    const syncedLabel = isNaN(synced) ? '' : synced.toLocaleString([], { weekday:'short', hour:'numeric', minute:'2-digit' });
    const showing = src.mode === 'live' ? `Live data, synced ${syncedLabel}.` : `The ${src.name} fixture. This is demo data, not your work.`;

    let notice = '';
    if (src.origin === 'url') notice = `<div class="settings-notice"><p>The page address ends in <code>?fixture=${esc(src.name)}</code>. That overrides the setting below.</p><a class="secondary-button" href="${esc(location.pathname)}#/settings">Remove it</a></div>`;
    else if (src.origin === 'fallback') notice = `<div class="settings-notice"><p>No live data yet, so Threadline is showing the fixture. Run <code>npm run sync</code> in the project folder, then reload.</p></div>`;

    const sources = (D.meta.sources || []).map(s => `<div class="list-row"><div><strong>${esc(SOURCE_NAMES[s.type] || s.type)}</strong><p>${esc(s.message)}</p></div>${pill(s.ok ? 'Connected' : 'Off', s.ok ? 'good' : 'watch')}</div>`).join('');

    return `<div class="page settings-page">${pageHeader('Settings','Settings.','These preferences are saved in this browser only.')}
      <section class="content-section"><h2>Appearance</h2>
        <div class="settings-row"><div><strong>Theme</strong><p>System follows your operating system's light or dark setting.</p></div>
        ${segmented('theme-choice', [['system','System'],['light','Light'],['dark','Dark']], window.ThreadlinePrefs.getTheme())}</div>
      </section>
      <section class="content-section"><h2>Data</h2>
        <div class="settings-row"><div><strong>Data source</strong><p>Now showing: ${esc(showing)}</p></div>
        ${segmented('source-choice', [['live','Live'], ...(src.fixtures || []).map(f => [f, `Fixture · ${f}`])], saved)}</div>
        ${notice}
        ${syncRow()}
      </section>
      <section class="content-section"><h2>Sources</h2>
        ${sources || '<p>Fixture data has no connected sources.</p>'}
        ${D.daily.claude ? `<div class="list-row"><div><strong>Claude usage</strong><p>${esc(D.daily.claude.windows.map(w => `${Math.round(w.usedPercent)}% of ${w.label}`).join(' · '))}. Reported by Claude Code's status line at ${esc(new Date(D.daily.claude.capturedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}.</p></div>${pill('Connected', 'good')}</div>` : ''}
        <p class="settings-hint">To refresh, run <code>npm run sync</code> in the project folder, then reload this page. Setup steps for each source are in the README.</p>
      </section>
    </div>`;
  }

  /** Editing needs `npm start` (the local server) and live data. */
  const canEdit = () => !!window.THREADLINE_SYNC && D.meta.dataMode === 'live' && window.THREADLINE_SOURCE?.mode === 'live';
  let addOpen = false;
  let showAllChanges = false;

  function todoForm(collapsible) {
    if (collapsible && !addOpen) return '';
    const projects = D.projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    return `<form class="todo-form" data-todo-form>
      <input name="title" required maxlength="200" placeholder="What needs doing? e.g. Update local Node version" aria-label="To-do" autocomplete="off" />
      <div class="todo-form-row">
        <label><span>Project</span><select name="projectId"><option value="">None</option>${projects}</select></label>
        <label><span>Due</span><input type="date" name="dueAt" /></label>
        <label><span>Estimate</span><select name="estimatedMinutes"><option value="">—</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 h</option><option value="120">2 h</option><option value="240">4 h</option></select></label>
        <button type="submit" class="secondary-button">Add</button>
      </div>
      <p class="todo-error" data-todo-error hidden></p>
    </form>`;
  }

  function todoRow(t) {
    const meta = [projectName(t.projectId), t.dueAt ? t.due : null, t.estimatedMinutes ? (t.estimatedMinutes < 60 ? `${t.estimatedMinutes} min` : `${t.estimatedMinutes / 60} h`) : null].filter(Boolean);
    const done = t.status === 'done';
    const edit = canEdit();
    return `<li class="todo-row ${done ? 'done' : ''}">
      ${edit ? `<button type="button" class="todo-check ${done ? 'checked' : ''}" ${done ? `data-todo-reopen="${esc(t.id)}" aria-label="Reopen ${esc(t.title)}"` : `data-todo-done="${esc(t.id)}" aria-label="Mark ${esc(t.title)} done"`}></button>` : `<span class="todo-check ${done ? 'checked' : ''}" aria-hidden="true"></span>`}
      <div class="todo-main"><strong>${esc(t.title)}</strong>${meta.length ? `<small>${esc(meta.join(' · '))}</small>` : ''}</div>
      ${edit ? `<button type="button" class="todo-delete" data-todo-delete="${esc(t.id)}" aria-label="Delete ${esc(t.title)}">×</button>` : ''}
    </li>`;
  }

  function todosPage() {
    const todos = D.todos || [];
    const open = todos.filter(t => t.status === 'open');
    const done = todos.filter(t => t.status === 'done');
    const note = canEdit() ? '' : `<p class="settings-hint">${window.THREADLINE_SYNC ? 'To-dos can be edited with live data only.' : 'Start Threadline with <code>npm start</code> to add and edit to-dos.'}</p>`;
    return `<div class="page todos-page">${pageHeader('To-dos','Work without a ticket.','Local setup, updates, follow-ups. They rank with your Teamwork and GitHub work and get the same due-date rules.',pill(`${open.length} open`,'blue'))}
      ${canEdit() ? todoForm(false) : note}
      <section class="content-section"><h2>Open</h2>${open.length ? `<ul class="todo-list">${open.map(todoRow).join('')}</ul>` : '<p>Nothing open.</p>'}</section>
      ${done.length ? `<section class="content-section"><h2>Done this week</h2><ul class="todo-list">${done.map(todoRow).join('')}</ul></section>` : ''}
    </div>`;
  }

  function continuityCard_home() {
    const c = D.continuity;
    if (!c) return '';
    const byProject = new Map();
    for (const ch of c.changes) {
      const key = ch.projectId || '';
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key).push(ch);
    }
    const LIMIT = 8;
    let shown = 0;
    const groups = [...byProject.entries()].map(([pid, list]) => {
      const items = showAllChanges ? list : list.slice(0, Math.max(0, LIMIT - shown));
      shown += items.length;
      if (!items.length) return '';
      const label = pid ? projectName(pid) || pid : 'Calendar and other';
      return `<div class="away-group"><h4>${esc(label)}</h4><ul>${items.map(ch => `<li>${ch.url ? `<a href="${esc(ch.url)}" target="_blank" rel="noopener">${esc(ch.text)}</a>` : esc(ch.text)}</li>`).join('')}</ul></div>`;
    }).join('');
    const hidden = c.changes.length - shown;
    return `<section class="away-card" aria-label="While you were away">
      <div class="away-head"><div><span class="kicker">While you were away · ${esc(c.awayLabel)}</span><h3>Since ${esc(c.sinceLabel)}</h3></div>
      ${canEdit() ? `<button type="button" class="secondary-button" data-ack-away>Got it</button>` : ''}</div>
      ${c.changes.length ? `<div class="away-groups">${groups}</div>${hidden > 0 ? `<button type="button" class="subtle-link link-button" data-show-all-changes>Show ${hidden} more</button>` : ''}` : '<p>Nothing changed in your sources while you were away.</p>'}
    </section>`;
  }

  let reportDate = null;

  /** Rich text for Slack: pasting HTML keeps bold and bullets. */
  function reportHtml(projects, heading) {
    const block = (p, h) => `<p><b>${esc(h || p.name)}</b></p><ul>${p.lines.map(l => `<li><b>${esc(l.title)}</b>${l.detail ? ` — ${esc(l.detail)}` : ''}</li>`).join('')}</ul>`
      + (p.next.length ? `<p><i>Next:</i> ${esc(p.next.join(' · '))}</p>` : '')
      + (p.waiting.length ? `<p><i>Waiting on others:</i> ${esc(p.waiting.join(' · '))}</p>` : '');
    return (heading ? `<p><b>${esc(heading)}</b></p>` : '') + projects.map(p => block(p)).join('');
  }

  async function copyReport(text, html) {
    try {
      if (window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      return true;
    } catch {
      // Fallback for browsers that block the clipboard API.
      const area = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(area); area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    }
  }

  function reportPage() {
    const reports = D.reports || [];
    if (!reports.length) return `<div class="page">${pageHeader('Report','What you moved.','Your status report builds itself from your activity in Teamwork and your current board stages.')}${empty('No activity to report yet.')}</div>`;
    const day = reports.find(r => r.date === reportDate) || reports[0];
    const chips = reports.map(r => `<button type="button" class="filter-chip ${r === day ? 'active' : ''}" data-report-date="${esc(r.date)}">${esc(r.label)}</button>`).join('');
    const cards = day.projects.map((p, i) => `<article class="report-card">
        <div class="report-card-head"><h3>${esc(p.name)}</h3><button type="button" class="secondary-button" data-copy-project="${i}">Copy</button></div>
        <ul class="report-lines">${p.lines.map(l => `<li><strong>${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>` : esc(l.title)}</strong>${l.detail ? `<span> — ${esc(l.detail)}</span>` : ''}</li>`).join('')}</ul>
        ${p.next.length ? `<p class="report-meta"><em>Next:</em> ${esc(p.next.join(' · '))}</p>` : ''}
        ${p.waiting.length ? `<p class="report-meta"><em>Waiting on others:</em> ${esc(p.waiting.join(' · '))}</p>` : ''}
      </article>`).join('');
    return `<div class="page report-page">${pageHeader('Report','What you moved.','Built from your Teamwork activity and current board stages. Copy it into Slack as is, or edit it there.',
      day.projects.length ? `<button type="button" class="primary-button" data-copy-all>Copy all for Slack</button>` : '')}
      <div class="attention-controls">${chips}</div>
      ${day.projects.length ? `<div class="report-cards">${cards}</div>` : empty(day.label === 'Today' ? 'Nothing logged in Teamwork yet today.' : 'Nothing logged that day.')}
      <p class="settings-hint">Includes your comments, updates, and completions in Teamwork, and your finished to-dos. Board stages show where each task is now${day.label === 'Today' ? '' : ' or was at the end of that day, when Threadline has a snapshot'}.</p>
    </div>`;
  }

  function notFound(){ return `<div class="page">${pageHeader('404','Nothing here.','The route exists outside the current prototype.')}</div>`; }

  function route(keepScroll=false){
    const path=(location.hash.replace(/^#/,'')||'/').split('?')[0];
    renderNav(path);
    const parts=path.split('/').filter(Boolean);
    if(path==='/') app.innerHTML=homePage();
    else if(path==='/attention') app.innerHTML=attentionPage();
    else if(path==='/threads') app.innerHTML=threadsPage();
    else if(parts[0]==='threads'&&parts[1]) { const t=thread(decodeURIComponent(parts[1])); app.innerHTML=t?threadDetailPage(t):notFound(); }
    else if(path==='/projects') app.innerHTML=projectsPage();
    else if(parts[0]==='projects'&&parts[1]) { const p=project(parts[1]); app.innerHTML=p?projectDetailPage(p):notFound(); }
    else if(path==='/goals') app.innerHTML=goalsPage();
    else if(parts[0]==='goals'&&parts[1]) { const g=goal(parts[1]); app.innerHTML=g?goalDetailPage(g):notFound(); }
    else if(path==='/knowledge') app.innerHTML=knowledgePage();
    else if(path==='/review') app.innerHTML=reviewPage();
    else if(path==='/settings') app.innerHTML=settingsPage();
    else if(path==='/todos') app.innerHTML=todosPage();
    else if(path==='/report') app.innerHTML=reportPage();
    else app.innerHTML=notFound();
    bindPageEvents();
    if(!keepScroll) window.scrollTo({top:0,behavior:'instant'});
    // In-place updates (new data, a saved note) should not replay the page's entrance animation.
    else if (app.firstElementChild) app.firstElementChild.style.animation = 'none';
  }

  function bindPageEvents(){
    document.querySelectorAll('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{attentionFilter=btn.dataset.filter;route();}));
    document.querySelectorAll('[data-theme-choice]').forEach(btn=>btn.addEventListener('click',()=>{window.ThreadlinePrefs.setTheme(btn.dataset.themeChoice);route(true);}));
    document.querySelectorAll('[data-source-choice]').forEach(btn=>btn.addEventListener('click',()=>{
      window.ThreadlinePrefs.write('threadline.dataSource', btn.dataset.sourceChoice==='live' ? null : btn.dataset.sourceChoice);
      // Drop any ?fixture= override so the new choice takes effect.
      location.replace(`${location.pathname}#/settings`); location.reload();
    }));
    document.getElementById('sync-now')?.addEventListener('click', async e => {
      e.currentTarget.disabled = true; e.currentTarget.textContent = 'Syncing…';
      try { await fetch('/api/sync', { method: 'POST' }); } catch {}
    });
    const act = async (fn, el) => {
      if (el) el.disabled = true;
      try { await fn(); } catch (err) { if (el) el.disabled = false; alert(`Threadline: ${err.message}`); }
    };
    document.querySelectorAll('[data-todo-done]').forEach(b => b.addEventListener('click', () => act(() => window.threadlineApi(`/api/todos/${b.dataset.todoDone}`, 'PATCH', { status: 'done' }), b)));
    document.querySelectorAll('[data-todo-reopen]').forEach(b => b.addEventListener('click', () => act(() => window.threadlineApi(`/api/todos/${b.dataset.todoReopen}`, 'PATCH', { status: 'open' }), b)));
    document.querySelectorAll('[data-todo-delete]').forEach(b => b.addEventListener('click', () => {
      if (confirm('Delete this to-do?')) act(() => window.threadlineApi(`/api/todos/${b.dataset.todoDelete}`, 'DELETE', {}), b);
    }));
    document.querySelector('[data-toggle-add]')?.addEventListener('click', () => { addOpen = !addOpen; route(true); if (addOpen) document.querySelector('[data-todo-form] input[name=title]')?.focus(); });
    document.querySelector('[data-show-all-changes]')?.addEventListener('click', () => { showAllChanges = true; route(true); });
    document.querySelector('[data-ack-away]')?.addEventListener('click', e => act(() => window.threadlineApi('/api/seen', 'POST', { acknowledge: true }), e.currentTarget));
    document.querySelector('[data-todo-form]')?.addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.currentTarget, data = new FormData(form), error = form.querySelector('[data-todo-error]');
      const body = {
        title: String(data.get('title') || '').trim(),
        projectId: data.get('projectId') || null,
        dueAt: data.get('dueAt') || null,
        estimatedMinutes: data.get('estimatedMinutes') ? Number(data.get('estimatedMinutes')) : null,
      };
      if (!body.title) return;
      form.querySelector('button[type=submit]').disabled = true;
      try {
        await window.threadlineApi('/api/todos', 'POST', body);
        form.reset();
        addOpen = false;
        document.activeElement?.blur(); // let the update apply now
      } catch (err) {
        error.hidden = false; error.textContent = err.message;
      } finally {
        form.querySelector('button[type=submit]').disabled = false;
      }
    });
    document.querySelectorAll('[data-report-date]').forEach(b => b.addEventListener('click', () => { reportDate = b.dataset.reportDate; route(true); }));
    const flash = (btn, ok) => { const t = btn.textContent; btn.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { btn.textContent = t; }, 1600); };
    const currentDay = () => (D.reports || []).find(r => r.date === reportDate) || (D.reports || [])[0];
    document.querySelector('[data-copy-all]')?.addEventListener('click', async e => {
      const day = currentDay(), btn = e.currentTarget;
      const heading = day.text.split('\n')[0].replace(/\*/g, '');
      flash(btn, await copyReport(day.text, reportHtml(day.projects, heading)));
    });
    document.querySelectorAll('[data-copy-project]').forEach(b => b.addEventListener('click', async () => {
      const p = currentDay().projects[Number(b.dataset.copyProject)];
      const heading = p.text.split('\n')[0].replace(/\*/g, '');
      flash(b, await copyReport(p.text, reportHtml([p]).replace(`<b>${esc(p.name)}</b>`, `<b>${esc(heading)}</b>`)));
    }));
    document.querySelectorAll('[data-copy-batch]').forEach(b => b.addEventListener('click', async () => {
      const batch = (D.batches || [])[Number(b.dataset.copyBatch)];
      let ok = false;
      try { await navigator.clipboard.writeText(batch.brief); ok = true; } catch {}
      const t = b.textContent; b.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { b.textContent = t; }, 1600);
    }));
    document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{activeDetailTab=btn.dataset.tab;route();}));
    document.querySelector('[data-note-form]')?.addEventListener('submit', async e => {
      e.preventDefault();
      const input = document.getElementById('new-note');
      const body = input.value.trim();
      if (!body) return;
      const id = decodeURIComponent(location.hash.split('/').pop());
      const t = thread(id);
      if (canEdit() && id.startsWith('thread-')) {
        try { await window.threadlineApi(`/api/threads/${encodeURIComponent(id)}/notes`, 'POST', { body }); input.value = ''; input.blur(); }
        catch (err) { alert(`Threadline: ${err.message}`); }
      } else if (t) {
        t.notes.push({ id: `note-${Date.now()}`, at: 'Just now', body }); input.value = ''; route(true);
      }
    });
    document.querySelectorAll('[data-note-delete]').forEach(b => b.addEventListener('click', () => {
      const id = decodeURIComponent(location.hash.split('/').pop());
      if (confirm('Delete this note?')) window.threadlineApi(`/api/threads/${encodeURIComponent(id)}/notes/${b.dataset.noteDelete}`, 'DELETE', {}).catch(err => alert(`Threadline: ${err.message}`));
    }));
    document.querySelectorAll('.sidebar a').forEach(a=>a.addEventListener('click',()=>document.querySelector('.sidebar').classList.remove('open')));
  }

  function searchIndex(){
    const rows=[];
    D.projects.forEach(x=>rows.push({type:'Project',title:x.name,meta:x.description,url:`#/projects/${x.id}`}));
    D.threads.forEach(x=>rows.push({type:'Thread',title:x.title,meta:projectName(x.projectId),url:`#/threads/${x.id}`}));
    D.goals.forEach(x=>rows.push({type:'Goal',title:x.title,meta:x.status,url:`#/goals/${x.id}`}));
    D.knowledge.forEach(x=>rows.push({type:x.kind,title:x.title,meta:project(x.projectId)?.name||'Knowledge',url:'#/knowledge'}));
    D.attention.forEach(x=>rows.push({type:'Attention',title:x.title,meta:x.source,url:'#/attention'}));
    (D.todos||[]).filter(x=>x.status==='open').forEach(x=>rows.push({type:'To-do',title:x.title,meta:projectName(x.projectId)||'To-do',url:'#/todos'}));
    return rows;
  }
  let SEARCH=searchIndex();
  function renderSearch(q=''){
    const s=q.trim().toLowerCase();
    const rows=(s?SEARCH.filter(x=>(x.title+' '+x.meta+' '+x.type).toLowerCase().includes(s)):SEARCH).slice(0,10);
    commandResults.innerHTML=rows.length?rows.map(x=>`<button type="button" class="command-result" data-url="${x.url}"><span class="result-glyph">${esc(x.type.slice(0,2).toUpperCase())}</span><span><strong>${esc(x.title)}</strong><small>${esc(x.meta)}</small></span><em>${esc(x.type)}</em></button>`).join(''):'<div class="empty-state">No matching context.</div>';
    commandResults.querySelectorAll('[data-url]').forEach(b=>b.addEventListener('click',()=>{dialog.close();location.hash=b.dataset.url.replace(/^#/,'');}));
  }

  document.getElementById('search-trigger').addEventListener('click',()=>{renderSearch();dialog.showModal();setTimeout(()=>commandInput.focus(),0);});
  commandInput.addEventListener('input',e=>renderSearch(e.target.value));
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();renderSearch();dialog.showModal();setTimeout(()=>commandInput.focus(),0);} if(e.key==='Escape'&&dialog.open)dialog.close();});
  document.getElementById('mobile-nav-button').addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('open'));
  window.addEventListener('hashchange',()=>route());

  // New data from an automatic sync. Waits while you are typing or searching,
  // so an update never swallows a half-written note.
  let pending = null;
  const busy = () => dialog.open || ['INPUT','TEXTAREA'].includes(document.activeElement?.tagName);
  function applyUpdate() {
    if (!pending) return;
    if (busy()) { setTimeout(applyUpdate, 5000); return; }
    D = pending; pending = null;
    window.THREADLINE_DATA = D;
    SEARCH = searchIndex();
    renderChrome();
    route(true);
  }
  window.updateThreadline = data => { pending = data; applyUpdate(); };

  // Roll the greeting and date over at noon, 5 PM, and midnight in an open tab.
  let greetingKey = JSON.stringify(greetingParts());
  setInterval(() => {
    const key = JSON.stringify(greetingParts());
    if (key === greetingKey) return;
    greetingKey = key;
    if ((location.hash.replace(/^#/, '') || '/') === '/' && !busy()) route(true);
  }, 60_000);
  // Sync status changed (started, finished, failed): refresh the labels that show it.
  window.refreshThreadlineStatus = () => { renderChrome(); if (location.hash === '#/settings' && !busy()) route(true); };

  route();
};
