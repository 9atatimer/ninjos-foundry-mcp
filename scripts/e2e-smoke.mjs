// End-to-end smoke test of the whole bridge, exercised the way Claude Desktop
// exercises it: spawn the stdio wrapper, speak MCP over its stdin/stdout, and
// call a tool that can only answer if a live Foundry world is on the far end.
//
// Requires, all three, or it will time out rather than fail cleanly:
//   - the MCP backend listening on 31414/31415
//   - Foundry serving a world
//   - a browser joined to that world as GM with the module active
//
// See docs/DEV-ENVIRONMENT.md for how to get to that state.
//
// NOTE the wrapper's stdin is held open until the last response is read. A
// pipeline that closes stdin (printf ... | node) makes the wrapper run its
// cleanup before replies arrive, and every response after initialize is lost.

import { spawn } from 'node:child_process';
const p = spawn('node', [new URL('../packages/mcp-server/dist/index.js', import.meta.url).pathname], { stdio: ['pipe','pipe','pipe'] });
let buf = '';
const want = new Map();
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
p.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (want.has(m.id)) { want.get(m.id)(m); want.delete(m.id); }
  }
});
const rpc = (id, method, params) => new Promise(res => { want.set(id, res); send({jsonrpc:'2.0', id, method, params}); });

const init = await rpc(1, 'initialize', {protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{name:'e2e',version:'0'}});
console.log('serverInfo:', JSON.stringify(init.result.serverInfo));
send({jsonrpc:'2.0', method:'notifications/initialized'});
const tools = await rpc(2, 'tools/list', {});
console.log('tools exposed:', tools.result.tools.length);
const call = await rpc(3, 'tools/call', {name:'get-world-info', arguments:{}});
const txt = JSON.stringify(call.result ?? call.error).slice(0, 700);
console.log('get-world-info ->', txt);
p.stdin.end(); p.kill();
process.exit(0);
