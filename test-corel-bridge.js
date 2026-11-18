const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tcut-bridge-test-'));
  process.env.TCUT_BRIDGE_DIR = dir;
  const { handler, bridge } = require('./server');
  const server = http.createServer(handler);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm"></svg>';
    assert.equal(await (await fetch(`${base}/api/corel/ping`)).text(), 'tcut-corel-bridge-v1');
    assert.equal((await fetch(`${base}/api/corel/input`)).status, 404);
    await fs.writeFile(bridge.input, svg);
    const incoming = await fetch(`${base}/api/corel/input`);
    assert.equal(incoming.status, 200);
    assert.equal(await incoming.text(), svg);
    const outgoing = await fetch(`${base}/api/corel/output`, { method: 'POST', body: svg });
    assert.equal(outgoing.status, 200);
    assert.equal(await fs.readFile(bridge.output, 'utf8'), svg);
    assert.equal((await fetch(`${base}/api/corel/output`, { method: 'POST', body: 'texto' })).status, 400);
    assert.equal((await fetch(`${base}/api/corel/input`, { headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await fetch(`${base}/.git/config`)).status, 403);
    console.log('Ponte Corel: troca SVG, validação e acesso local OK');
  } finally {
    server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
