import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const folder = await mkdtemp(path.join(tmpdir(), 'roadsos-smoke-'));
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});
const server = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), DATABASE_PATH: path.join(folder, 'smoke.db'), JWT_SECRET: 'smoke-test-secret-long-enough', ADMIN_EMAIL: 'admin@roadsos.test', ADMIN_PASSWORD: 'smoke-admin-password-123', ADMIN_NAME: 'Smoke Admin' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
server.stdout.on('data', chunk => output += chunk);
server.stderr.on('data', chunk => output += chunk);
const base = `http://127.0.0.1:${port}/api`;
async function request(route, { method = 'GET', token, body } = {}) {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
try {
  let health;
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited early. ${output}`);
    try { health = await request('/health'); break; } catch { await new Promise(resolve => setTimeout(resolve, 150)); }
  }
  if (!health) throw new Error(`API did not become ready. ${output}`);
  assert.equal(health?.status, 200, 'API health endpoint starts');
  const created = await request('/auth/register', { method: 'POST', body: { name: 'Smoke Driver', email: 'driver@roadsos.test', phone: '9876500000', password: 'driver-password-123', role: 'user', contacts: [{ name: 'Emergency One', phone: '9876500001', relationship: 'Friend' }] } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const token = created.data.token;
  assert.equal(created.data.user.password_hash, undefined, 'password hashes are never returned');
  assert.equal((await request('/contacts', { token })).data.contacts.length, 1, 'emergency contacts persist');
  const nearby = await request('/mechanics?lat=12.9&lng=77.6', { token });
  assert.equal(nearby.status, 200, 'driver can search nearby mechanics');
  assert.equal(nearby.data.mechanics.length, 0, 'search has no fabricated mechanic data');
  const wrongRole = await request('/auth/login', { method: 'POST', body: { email: 'driver@roadsos.test', password: 'driver-password-123', role: 'mechanic' } });
  assert.equal(wrongRole.status, 401, 'login rejects mismatched role');
  const login = await request('/auth/login', { method: 'POST', body: { email: 'driver@roadsos.test', password: 'driver-password-123', role: 'user' } });
  assert.equal(login.status, 200, 'registered driver can log in');
  const admin = await request('/auth/login', { method: 'POST', body: { email: 'admin@roadsos.test', password: 'smoke-admin-password-123', role: 'admin' } });
  assert.equal(admin.status, 200, 'optional first-run administrator is provisioned');
  assert.equal((await request('/admin/overview', { token: login.data.token })).status, 403, 'driver cannot access admin endpoints');
  assert.equal((await request('/admin/overview', { token: admin.data.token })).status, 200, 'admin can access admin endpoints');
  const mechanic = await request('/auth/register', { method: 'POST', body: { name: 'Smoke Mechanic', email: 'mechanic@roadsos.test', phone: '9876500002', password: 'mechanic-password-123', role: 'mechanic', garage: 'Smoke Garage', services: 'Tyres, Battery', radius: 20 } });
  assert.equal(mechanic.status, 201, 'mechanic can register');
  assert.equal((await request(`/admin/mechanics/${mechanic.data.user.id}/verify`, { method: 'PATCH', token: admin.data.token, body: { verified: true } })).status, 200, 'admin can verify mechanic');
  const mechanicLogin = await request('/auth/login', { method: 'POST', body: { email: 'mechanic@roadsos.test', password: 'mechanic-password-123', role: 'mechanic' } });
  assert.equal(mechanicLogin.status, 200, 'mechanic can log in');
  assert.equal((await request('/mechanic/availability', { method: 'POST', token: mechanicLogin.data.token, body: { available: true, lat: 12.9, lng: 77.6 } })).status, 200, 'mechanic can set availability with GPS coordinates');
  const createdRequest = await request('/requests', { method: 'POST', token: login.data.token, body: { mechanicId: mechanic.data.user.id, type: 'Flat tyre', description: 'Test request', lat: 12.91, lng: 77.61 } });
  assert.equal(createdRequest.status, 201, JSON.stringify(createdRequest.data));
  const requestId = createdRequest.data.request.id;
  for (const status of ['accepted', 'on_the_way', 'arrived', 'in_progress', 'completed']) {
    assert.equal((await request(`/requests/${requestId}/status`, { method: 'PATCH', token: mechanicLogin.data.token, body: { status } })).status, 200, `mechanic can advance a valid request to ${status}`);
  }
  assert.equal((await request(`/requests/${requestId}/rating`, { method: 'POST', token: login.data.token, body: { stars: 5, feedback: 'Smoke check' } })).status, 201, 'driver can rate completed assistance');
  assert.equal((await request('/sos', { method: 'POST', token: login.data.token, body: { lat: 12.91, lng: 77.61, accuracy: 20 } })).status, 201, 'online SOS is recorded');
  assert.equal((await request('/sos', { token: admin.data.token })).data.sos.length, 1, 'admin can review SOS records');
  console.log('ROAD SOS smoke checks passed: registration, login, contacts, GPS mechanic discovery, verification, requests, status workflow, rating, SOS and role authorization.');
} finally {
  const stopped = server.exitCode !== null ? Promise.resolve() : new Promise(resolve => server.once('exit', resolve));
  server.kill();
  await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 3000))]);
  await rm(folder, { recursive: true, force: true });
}
