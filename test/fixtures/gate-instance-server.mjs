// test/fixtures/gate-instance-server.mjs — a stand-in for ui/server.mjs in test/stillhet-gate-instances.test.mjs: it listens
// on PORT and answers the readiness probe, so the instances tool's start, list and stop run without a real Worca server.
import http from 'node:http';

http.createServer((req, res) => {
  res.writeHead(req.url === '/api/projects' ? 200 : 404, { 'Content-Type': 'application/json' });
  res.end(req.url === '/api/projects' ? '{"projects":[]}' : '{}');
}).listen(Number(process.env.PORT), '127.0.0.1');
