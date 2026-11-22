// The http server a test puts in front of the app. Node closes an idle keep-alive socket after 5 s by default; a test
// whose work between two requests passes that (git clones, a run pausing, a loaded machine) sends the next request on
// a socket the server is closing just then, which fails ECONNRESET and takes the tests after it down too. So idle
// sockets are never timed out here; `srv.close()` still closes them.
import http from 'node:http';

export function appServer(app) {
  const srv = http.createServer(app);
  srv.keepAliveTimeout = 0;
  return srv;
}
