const $ = s => document.querySelector(s), app = $('#app');
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ST = { rascunho: 'Rascunho', pendente: 'Pendente', confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado' };
const TIPOS = ['Casamento', 'Corporativo', 'Show', 'Aniversário', 'Formatura', 'Outro'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pd = s => new Date(s + 'T00:00'), add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmt = s => s ? pd(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const mes = d => d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const toast = (m, err) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 3500); };
const api = async (m, u, b) => {
  const r = await fetch('/api' + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw j; return j;
};
const errMsg = x => x.fields ? Object.values(x.fields).join(' ') : x.error || 'Erro inesperado.';
const field = (l, n, v = '', t = 'text', x = '') => `<label>${l}<input name="${n}" type="${t}" value="${e(v)}" ${x}></label>`;
const sel = (l, n, o, v, x = '') => `<label>${l}<select name="${n}" ${x}>${o.map(([k, t]) => `<option value="${e(k)}" ${String(k) === String(v ?? '') ? 'selected' : ''}>${e(t)}</option>`).join('')}</select></label>`;
const badge = s => `<span class="badge s-${s}">${ST[s] || s}</span>`;
const statusOpts = [['', 'Todos os status'], ...Object.entries(ST)];
let me = null;
const V = { mode: 'month', cur: new Date(), q: '', status: '' }, E = { q: '', status: '', from: '', to: '' }, C = { q: '', sort: 'name' };
const O = { V, E, C };

const NAV = [['agenda', 'Agenda'], ['events', 'Eventos'], ['clients', 'Clientes']], SOON = ['Financeiro', 'Equipe', 'Repertório', 'Relatórios'];
const shell = (page, title, body, actions = '') => {
  app.innerHTML = `<aside class="side"><div class="logo">Harmonize</div><nav>${NAV.map(([k, l]) => `<a href="#/${k}" class="${k == page ? 'on' : ''}">${l}</a>`).join('')}${SOON.map(l => `<span class="soon" title="Módulo de outro integrante">${l}<small>em breve</small></span>`).join('')}</nav><div class="me"><span>${e(me.name || me.email)}</span><button data-act="logout" class="link">Sair</button></div></aside><main><header class="top"><h1>${title}</h1><div>${actions}</div></header>${body}</main>`;
};
const authCard = inner => { app.innerHTML = `<div class="auth"><div class="card"><div class="logo dark">Harmonize</div>${inner}</div></div>`; };

// ---------- Roteador ----------
async function route() {
  const [p, qs] = (location.hash.slice(2) || 'agenda').split('?'), q = new URLSearchParams(qs || ''), s = p.split('/');
  try { me = await api('GET', '/auth/me'); } catch { me = null; }
  if (!me) return s[0] == 'reset' ? resetView(q.get('token')) : loginView(s[0] == 'forgot');
  if (['login', 'forgot', 'reset'].includes(s[0])) return location.hash = '#/agenda';
  const f = { agenda: agendaView, events: eventsView, clients: clientsView, event: () => eventRoute(s, q) }[s[0]] || agendaView;
  try { await f(); } catch (x) { toast(errMsg(x), 1); }
}
addEventListener('hashchange', route); route();

// ---------- Autenticação ----------
function loginView(forgot) {
  if (forgot) return authCard(`<h2>Recuperar acesso</h2><p>Informe seu e-mail para receber o link de redefinição.</p><form data-form="forgot">${field('E-mail', 'email', '', 'email', 'required')}<button class="btn">Enviar link</button></form><p id="msg" class="note"></p><a href="#/login">Voltar ao login</a>`);
  authCard(`<h2>Bem-vindo de volta</h2><form data-form="login">${field('E-mail', 'email', '', 'email', 'required autocomplete="username"')}${field('Senha', 'password', '', 'password', 'required autocomplete="current-password"')}<label class="chk"><input type="checkbox" name="remember"> Permanecer conectado</label><div id="msg" class="errtxt"></div><button class="btn">Entrar</button></form><p><a href="#/forgot">Esqueci minha senha</a></p>`);
}
const resetView = t => authCard(`<h2>Nova senha</h2><form data-form="reset"><input type="hidden" name="token" value="${e(t)}">${field('Nova senha (mín. 8 caracteres)', 'password', '', 'password', 'required minlength=8')}<div id="msg" class="errtxt"></div><button class="btn">Redefinir</button></form>`);

// ---------- Agenda ----------
async function agendaView() {
  const { mode, cur } = V; let a, b;
  const f1 = new Date(cur.getFullYear(), cur.getMonth(), 1);
  if (mode == 'week') { a = add(cur, -((cur.getDay() + 6) % 7)); b = add(a, 6); }
  else if (mode == 'month') { a = add(f1, -((f1.getDay() + 6) % 7)); b = add(a, 41); }
  else { a = f1; b = new Date(cur.getFullYear(), cur.getMonth() + 1, 0); }
  const qs = new URLSearchParams({ from: iso(a), to: iso(b) }); if (V.q) qs.set('q', V.q); if (V.status) qs.set('status', V.status);
  const ev = await api('GET', '/events?' + qs), today = iso(new Date());
  const chip = x => `<button class="chip s-${x.status}" data-act="open" data-id="${x.id}" title="${e(x.name)}">${e(x.start_time || '')} ${e(x.name)}</button>`;
  const by = d => ev.filter(x => x.date == d);
  let grid = '';
  const dn = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  if (mode == 'month') {
    grid = `<div class="grid7">${dn.map(d => `<div class="dh">${d}</div>`).join('')}${Array.from({ length: 42 }, (_, i) => { const d = add(a, i), k = iso(d); return `<div class="day ${d.getMonth() != cur.getMonth() ? 'dim' : ''} ${k == today ? 'today' : ''}" data-act="newday" data-date="${k}"><b>${d.getDate()}</b>${by(k).map(chip).join('')}</div>`; }).join('')}</div>`;
  } else if (mode == 'week') {
    const days = Array.from({ length: 7 }, (_, i) => add(a, i)), rows = ['dia', ...Array.from({ length: 17 }, (_, i) => i + 7)];
    const hr = x => x.start_time ? Math.min(23, Math.max(7, +x.start_time.slice(0, 2))) : 'dia';
    grid = `<div class="scroll"><div class="grid7 wk"><div class="dh"></div>${days.map((d, i) => `<div class="dh">${dn[i]} ${d.getDate()}</div>`).join('')}${rows.map(h => `<div class="tl">${h == 'dia' ? 'Sem hora' : String(h).padStart(2, '0') + ':00'}</div>${days.map(d => { const k = iso(d); return `<div class="slot" data-act="newday" data-date="${k}" ${h == 'dia' ? '' : `data-time="${String(h).padStart(2, '0')}:00"`}>${by(k).filter(x => hr(x) == h).map(chip).join('')}</div>`; }).join('')}`).join('')}</div></div>`;
  } else {
    grid = ev.length ? `<div class="list">${ev.map(x => evRow(x)).join('')}</div>` : '<p class="note">Nenhum evento neste período.</p>';
  }
  const title = mode == 'week' ? `${fmt(iso(a))} – ${fmt(iso(b))}` : mes(cur);
  shell('agenda', title, `<div class="bar"><button class="btn ghost" data-act="nav" data-n="-1">‹</button><button class="btn ghost" data-act="today">Hoje</button><button class="btn ghost" data-act="nav" data-n="1">›</button>${sel('', 'mode', [['month', 'Mês'], ['week', 'Semana'], ['list', 'Lista']], mode, 'data-o="V" data-k="mode" style="width:auto"')}<input data-o="V" data-k="q" placeholder="Buscar evento, cliente ou local" value="${e(V.q)}">${sel('', 'status', statusOpts, V.status, 'data-o="V" data-k="status" style="width:auto"')}</div>${grid}`, `<a class="btn" href="#/event/new">+ Novo evento</a>`);
}
const evRow = x => `<div class="card item" data-act="open" data-id="${x.id}"><div><h3>${e(x.name)}</h3><small>${e(x.client_name || 'Sem cliente')} · ${fmt(x.date)} ${e(x.start_time || '')} · ${e(x.venue || 'Local a definir')}${x.city ? ', ' + e(x.city) : ''}${x.lineup ? ' · ' + e(x.lineup) : ''}</small></div>${badge(x.status)}</div>`;

// ---------- Eventos ----------
async function eventsView() {
  const qs = new URLSearchParams(Object.entries(E).filter(([, v]) => v)), ev = await api('GET', '/events?' + qs);
  shell('events', 'Eventos', `<div class="bar"><input data-o="E" data-k="q" placeholder="Buscar evento, cliente ou local" value="${e(E.q)}">${sel('', 's', statusOpts, E.status, 'data-o="E" data-k="status" style="width:auto"')}<input type="date" data-o="E" data-k="from" value="${e(E.from)}" title="De"><input type="date" data-o="E" data-k="to" value="${e(E.to)}" title="Até"></div><div class="list">${ev.map(x => evRow(x)).join('') || '<p class="note">Nenhum evento encontrado.</p>'}</div>`, `<a class="btn" href="#/event/new">+ Novo evento</a>`);
}
async function eventRoute(s, q) {
  if (s[1] == 'new') { W = { id: null, step: 1, d: { date: q.get('date') || '', start_time: q.get('time') || '', status: 'rascunho' } }; return wizard(); }
  const x = await api('GET', '/events/' + s[1]).catch(() => null);
  if (!x) { toast('Evento não encontrado.', 1); return location.hash = '#/events'; }
  if (s[2] == 'edit') { W = { id: x.id, step: 1, d: x }; return wizard(); }
  const row = (l, v) => `<dt>${l}</dt><dd>${e(v || '—')}</dd>`;
  shell('events', e(x.name), `<div class="card"><dl>${row('Tipo', x.type)}${row('Data', fmt(x.date))}${row('Horário', x.start_time)}${row('Cliente', x.client_name)}${row('Contato', x.contact)}${row('Local', x.venue)}${row('Cidade/UF', [x.city, x.uf].filter(Boolean).join(' / '))}${row('Formação musical', x.lineup)}${row('Observações', x.notes)}<dt>Status</dt><dd>${sel('', 'st', Object.entries(ST).filter(k => k[0] != 'rascunho' || x.status == 'rascunho'), x.status, `data-chg="status" data-id="${x.id}" style="width:auto"`)}</dd></dl></div>`, `<a class="btn ghost" href="#/agenda">Agenda</a> <a class="btn" href="#/event/${x.id}/edit">Editar</a> <button class="btn danger" data-act="delevent" data-id="${x.id}">Excluir</button>`);
}
let W = null;
async function wizard() {
  const d = W.d, cl = await api('GET', '/clients'), n = W.step;
  const cn = cl.find(c => c.id == d.client_id)?.name;
  const body = [
    `${field('Nome do evento *', 'name', d.name)}${sel('Tipo', 'type', [['', 'Selecione'], ...TIPOS.map(t => [t, t])], d.type)}<div class="row">${field('Data *', 'date', d.date, 'date')}${field('Horário inicial *', 'start_time', d.start_time, 'time')}</div>`,
    `${sel('Cliente *', 'client_id', [['', 'Selecione'], ...cl.map(c => [c.id, c.name])], d.client_id)}<p class="note"><a href="#/clients">Cadastrar novo cliente</a> (salve o rascunho antes)</p>${field('Contato no evento', 'contact', d.contact)}${field('Local *', 'venue', d.venue)}<div class="row">${field('Cidade', 'city', d.city)}${field('UF', 'uf', d.uf, 'text', 'maxlength=2')}</div>`,
    `<label>Formação musical<textarea name="lineup" rows="3" placeholder="Ex.: Voz, violão e teclado">${e(d.lineup)}</textarea></label><p class="note">A seleção de equipe e repertório fica nos módulos de outros integrantes (em breve).</p>`,
    `<label>Observações<textarea name="notes" rows="4">${e(d.notes)}</textarea></label>${W.id && d.status != 'rascunho' ? sel('Status', 'status', Object.entries(ST).filter(k => k[0] != 'rascunho'), d.status) : ''}<div class="review"><h3>Revisão</h3><p><b>${e(d.name)}</b> ${d.type ? '· ' + e(d.type) : ''}</p><p>${fmt(d.date)} às ${e(d.start_time || '—')}</p><p>Cliente: ${e(cn || '—')} ${d.contact ? '· ' + e(d.contact) : ''}</p><p>Local: ${e(d.venue || '—')} ${e([d.city, d.uf].filter(Boolean).join('/'))}</p><p>Formação: ${e(d.lineup || '—')}</p></div>`
  ][n - 1];
  shell('events', W.id ? 'Editar evento' : 'Novo evento', `<div class="steps">${['Dados gerais', 'Cliente e local', 'Música e equipe', 'Complementares'].map((t, i) => `<span class="${i + 1 == n ? 'on' : ''}">${i + 1}. ${t}</span>`).join('')}</div><form class="card" data-form="wizard" style="max-width:640px">${body}<div class="acts">${n > 1 ? '<button type="button" class="btn ghost" data-act="prev">Voltar</button>' : ''}${!W.id || d.status == 'rascunho' ? '<button type="button" class="btn ghost" data-act="draft">Salvar rascunho</button>' : ''}<button class="btn">${n < 4 ? 'Próximo' : 'Salvar evento'}</button></div></form>`);
}
const readForm = f => { Object.assign(W.d, Object.fromEntries(new FormData(f))); };
async function saveEvent(status) {
  const body = { ...W.d, status };
  try { const x = W.id ? await api('PUT', '/events/' + W.id, body) : await api('POST', '/events', body); toast(status == 'rascunho' ? 'Rascunho salvo.' : 'Evento salvo.'); location.hash = '#/event/' + x.id; }
  catch (x) { toast(errMsg(x), 1); }
}

// ---------- Clientes ----------
async function clientsView() {
  const cl = await api('GET', `/clients?q=${encodeURIComponent(C.q)}&sort=${C.sort}`);
  shell('clients', 'Clientes', `<div class="bar"><input data-o="C" data-k="q" placeholder="Buscar por nome, e-mail ou telefone" value="${e(C.q)}">${sel('', 'sort', [['name', 'Nome (A–Z)'], ['recent', 'Mais recentes'], ['events', 'Mais eventos']], C.sort, 'data-o="C" data-k="sort" style="width:auto"')}</div><div class="cards">${cl.map(c => `<div class="card"><h3>${e(c.name)}</h3><p class="note">${e(c.email || 'Sem e-mail')}<br>${e(c.phone || 'Sem telefone')}<br>${c.n} evento(s)</p>${c.notes ? `<p>${e(c.notes)}</p>` : ''}<div class="acts"><button class="btn ghost" data-act="editclient" data-c='${e(JSON.stringify(c))}'>Editar</button><button class="btn danger" data-act="delclient" data-id="${c.id}">Excluir</button></div></div>`).join('') || '<p class="note">Nenhum cliente encontrado.</p>'}</div><dialog id="dlg"></dialog>`, `<button class="btn" data-act="editclient" data-c="{}">+ Novo cliente</button>`);
}

// ---------- Eventos de UI ----------
const A = {
  logout: async () => { await api('POST', '/auth/logout'); location.hash = '#/login'; route(); },
  open: t => location.hash = '#/event/' + t.dataset.id,
  newday: t => location.hash = `#/event/new?date=${t.dataset.date}${t.dataset.time ? '&time=' + t.dataset.time : ''}`,
  nav: t => { const n = +t.dataset.n, c = V.cur; V.cur = V.mode == 'week' ? add(c, 7 * n) : new Date(c.getFullYear(), c.getMonth() + n, 1); route(); },
  today: () => { V.cur = new Date(); route(); },
  prev: t => { readForm(t.closest('form')); W.step--; wizard(); },
  draft: t => { readForm(t.closest('form')); saveEvent('rascunho'); },
  delevent: async t => { if (confirm('Excluir este evento? Esta ação não pode ser desfeita.')) { await api('DELETE', '/events/' + t.dataset.id); toast('Evento excluído.'); location.hash = '#/events'; } },
  delclient: async t => { if (!confirm('Excluir este cliente?')) return; try { await api('DELETE', '/clients/' + t.dataset.id); toast('Cliente excluído.'); route(); } catch (x) { toast(errMsg(x), 1); } },
  editclient: t => { const c = JSON.parse(t.dataset.c), d = $('#dlg'); d.innerHTML = `<h3>${c.id ? 'Editar' : 'Novo'} cliente</h3><form data-form="client"><input type="hidden" name="id" value="${c.id || ''}">${field('Nome *', 'name', c.name)}${field('E-mail', 'email', c.email, 'email')}${field('Telefone', 'phone', c.phone, 'tel')}<label>Observações<textarea name="notes" rows="3">${e(c.notes)}</textarea></label><div class="acts"><button type="button" class="btn ghost" onclick="this.closest('dialog').close()">Cancelar</button><button class="btn">Salvar</button></div></form>`; d.showModal(); },
};
const FORMS = {
  login: async f => { const d = Object.fromEntries(new FormData(f)); d.remember = !!d.remember; try { await api('POST', '/auth/login', d); location.hash = '#/agenda'; route(); } catch (x) { $('#msg').textContent = errMsg(x); } },
  forgot: async f => { const r = await api('POST', '/auth/forgot', Object.fromEntries(new FormData(f))); $('#msg').innerHTML = e(r.message) + (r.devLink ? `<br><a href="${e(r.devLink)}">Link (apenas em desenvolvimento)</a>` : ''); },
  reset: async f => { try { await api('POST', '/auth/reset', Object.fromEntries(new FormData(f))); toast('Senha redefinida. Faça login.'); location.hash = '#/login'; } catch (x) { $('#msg').textContent = errMsg(x); } },
  wizard: async f => {
    readForm(f); const need = { 1: [['name', 'o nome'], ['date', 'a data'], ['start_time', 'o horário']], 2: [['client_id', 'o cliente'], ['venue', 'o local']] }[W.step] || [];
    const miss = need.find(([k]) => !W.d[k]); if (miss) return toast(`Informe ${miss[1]}.`, 1);
    if (W.step < 4) { W.step++; return wizard(); }
    await saveEvent(W.d.status && W.d.status != 'rascunho' ? W.d.status : 'pendente');
  },
  client: async f => { const d = Object.fromEntries(new FormData(f)), id = d.id; try { await api(id ? 'PUT' : 'POST', '/clients' + (id ? '/' + id : ''), d); toast('Cliente salvo.'); route(); } catch (x) { toast(errMsg(x), 1); } },
};
document.addEventListener('click', ev => { const t = ev.target.closest('[data-act]'); if (t) A[t.dataset.act]?.(t, ev); });
document.addEventListener('submit', ev => { const f = ev.target.closest('[data-form]'); if (f) { ev.preventDefault(); FORMS[f.dataset.form]?.(f); } });
document.addEventListener('change', async ev => {
  const t = ev.target;
  if (t.dataset.o) { O[t.dataset.o][t.dataset.k] = t.value; route(); }
  if (t.dataset.chg == 'status') { try { await api('PATCH', `/events/${t.dataset.id}/status`, { status: t.value }); toast('Status atualizado.'); route(); } catch (x) { toast(errMsg(x), 1); route(); } }
});
