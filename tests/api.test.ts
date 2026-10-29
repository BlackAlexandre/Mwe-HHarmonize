import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
const P = 3917, B = `http://localhost:${P}`, DB = '/tmp/h-test.db';
let srv: any, ck = '';
const call = async (m: string, u: string, b?: any, c = ck) => {
  const r = await fetch(B + u, { method: m, headers: { 'content-type': 'application/json', cookie: c }, body: b ? JSON.stringify(b) : undefined });
  const s = r.headers.get('set-cookie'); if (s && u.includes('login')) ck = s.split(';')[0];
  return { s: r.status, j: await r.json(), h: s };
};
before(async () => {
  rmSync(DB, { force: true });
  srv = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { env: { ...process.env, PORT: String(P), DB_FILE: DB, ADMIN_EMAIL: 'a@t.com', ADMIN_PASSWORD: 'senha-forte-1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/auth/me'); return; } catch { await new Promise(r => setTimeout(r, 200)); } }
});
after(() => srv.kill());

test('rotas privadas exigem login', async () => {
  for (const u of ['/api/events', '/api/clients', '/api/auth/me']) assert.equal((await call('GET', u, undefined, '')).s, 401);
});
test('login inválido e válido (sessão e "permanecer conectado")', async () => {
  assert.equal((await call('POST', '/api/auth/login', { email: 'a@t.com', password: 'errada' })).s, 401);
  const r = await call('POST', '/api/auth/login', { email: 'a@t.com', password: 'senha-forte-1', remember: true });
  assert.equal(r.s, 200); assert.match(r.h!, /HttpOnly/); assert.match(r.h!, /Max-Age=/);
  assert.equal((await call('GET', '/api/auth/me')).s, 200);
});
let cid: number, eid: number;
test('clientes: CRUD, validação e busca', async () => {
  assert.equal((await call('POST', '/api/clients', { name: '' })).s, 422);
  const c = await call('POST', '/api/clients', { name: 'Ana Souza', email: 'ana@x.com', phone: '41999990000' });
  assert.equal(c.s, 201); cid = c.j.id;
  assert.equal((await call('PUT', '/api/clients/' + cid, { name: 'Ana S.', email: 'ana@x.com', phone: '41999990000' })).j.name, 'Ana S.');
  for (const q of ['4199999', 'ana@x', 'Ana S']) assert.equal((await call('GET', '/api/clients?q=' + q)).j.length, 1);
  assert.equal((await call('GET', '/api/clients?q=zzz')).j.length, 0);
});
test('eventos: rascunho, validação, CRUD, filtros e status', async () => {
  assert.equal((await call('POST', '/api/events', { name: 'Só rascunho' })).s, 201);
  assert.equal((await call('POST', '/api/events', { name: 'X', status: 'pendente' })).s, 422);
  const r = await call('POST', '/api/events', { name: 'Casamento Ana', type: 'Casamento', date: '2026-11-15', start_time: '19:30', client_id: cid, venue: 'Espaço Verde', city: 'Curitiba', uf: 'pr', status: 'pendente' });
  assert.equal(r.s, 201); eid = r.j.id; assert.equal(r.j.uf, 'PR'); assert.equal(r.j.client_name, 'Ana S.');
  assert.equal((await call('GET', '/api/events?q=Ana&status=pendente&from=2026-11-01&to=2026-11-30')).j.length, 1);
  assert.equal((await call('GET', '/api/events?from=2027-01-01')).j.length, 0);
  assert.equal((await call('PUT', '/api/events/' + eid, { ...r.j, venue: 'Novo Local' })).j.venue, 'Novo Local');
  assert.equal((await call('PATCH', `/api/events/${eid}/status`, { status: 'confirmado' })).j.status, 'confirmado');
  assert.equal((await call('PATCH', `/api/events/${eid}/status`, { status: 'xx' })).s, 422);
});
test('integridade: cliente com evento não pode ser excluído', async () => {
  assert.equal((await call('DELETE', '/api/clients/' + cid)).s, 409);
  assert.equal((await call('DELETE', '/api/events/' + eid)).s, 200);
  assert.equal((await call('GET', '/api/events/' + eid)).s, 404);
  const rest = (await call('GET', '/api/events?q=rascunho')).j; for (const x of rest) await call('DELETE', '/api/events/' + x.id);
  assert.equal((await call('DELETE', '/api/clients/' + cid)).s, 200);
});
test('recuperação de acesso e logout', async () => {
  const f = await call('POST', '/api/auth/forgot', { email: 'a@t.com' }, ''); const token = new URL(f.j.devLink).hash.split('token=')[1];
  assert.equal((await call('POST', '/api/auth/reset', { token, password: 'curta' }, '')).s, 400);
  assert.equal((await call('POST', '/api/auth/reset', { token, password: 'nova-senha-2' }, '')).s, 200);
  assert.equal((await call('POST', '/api/auth/reset', { token, password: 'nova-senha-3' }, '')).s, 400);
  assert.equal((await call('GET', '/api/auth/me')).s, 401, 'sessões antigas são encerradas');
  assert.equal((await call('POST', '/api/auth/login', { email: 'a@t.com', password: 'senha-forte-1' })).s, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'a@t.com', password: 'nova-senha-2' })).s, 200);
  await call('POST', '/api/auth/logout'); assert.equal((await call('GET', '/api/auth/me')).s, 401);
});
