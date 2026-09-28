// test/wsmap-redact.test.mjs — secrets never leave the member checkout: the redactor (wsmap P1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redactSecrets, redactLines } from '../src/shared/workspace-map/redact.mjs';

const GH = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const CASES = [
  ['DATABASE_URL=postgres://app:s3cr3t@db:5432/billing', 'DATABASE_URL=postgres://***@db:5432/billing'],
  ['postgres://app:p@ss@db:5432/billing', 'postgres://***@db:5432/billing'],
  ['https://user@host/x', 'https://user@host/x'],
  ['a'.repeat(40) + 'postgres://app:s3cr3t@db/x', 'a'.repeat(40) + 'postgres://***@db/x'],
  ['a'.repeat(40) + `https://${GH}@github.com/a`, 'a'.repeat(40) + 'https://***@github.com/a'],
  ['git@github.com:acme/x.git', 'git@github.com:acme/x.git'],
  ['API_TOKEN=abc123', 'API_TOKEN=***'],
  ['export CLIENT_SECRET = "a b c"', 'export CLIENT_SECRET = "***"'],
  ['api_key: k-123', 'api_key: ***'],
  ['"password": "hunter2"', '"password": "***"'],
  ['{"clientSecret":"xyz","name":"a"}', '{"clientSecret":"***","name":"a"}'],
  ["{'accessKey': 'q'}", "{'accessKey': '***'}"],
  ['https://x.io/cb?token=abc&next=/home', 'https://x.io/cb?token=***&next=/home'],
  ['Authorization: Bearer eyJhbGciOi.xx.yy', 'Authorization: Bearer ***'],
  ['auth = Basic dXNlcjpwYXNz', 'auth = Basic ***'],
  ['key AKIAABCDEFGHIJKLMNOP here', 'key AKIA*** here'],
  ['-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN ***-----'],
  ['-----BEGIN CERTIFICATE-----\nMIIBxyz\n-----END CERTIFICATE-----', '-----BEGIN ***-----'],
  ['AUTH_SERVICE_URL=http://auth-svc:8080/login', 'AUTH_SERVICE_URL=http://auth-svc:8080/login'],
  ['http://auth:8080/x', 'http://auth:8080/x'],
  ['auth-service:8080', 'auth-service:8080'],
  ['router.post("/auth/login", h)', 'router.post("/auth/login", h)'],
  ['fetch(`/api/tokens/${id}`)', 'fetch(`/api/tokens/${id}`)'],
  // a quoted value needs no space after the colon; prose after Basic / Bearer is not a credential
  ["const cfg = {password:'hunter2', host: 'db'};", "const cfg = {password:'***', host: 'db'};"],
  ['db.connect({user:"app",password:"hunter2"})', 'db.connect({user:"app",password:"***"})'],
  ['Basic CRUD service for invoices.', 'Basic CRUD service for invoices.'],
  ['Bearer tokens are validated by the gateway.', 'Bearer tokens are validated by the gateway.'],
  ['Supports Basic authentication.', 'Supports Basic authentication.'],
  ['Uses Bearer authentication.', 'Uses Bearer authentication.'],
  ['Bearer token-based auth for the admin API.', 'Bearer token-based auth for the admin API.'],
  ['Basic authentication is required for /admin.', 'Basic authentication is required for /admin.'],
  ['Bearer credentials expire after one hour.', 'Bearer credentials expire after one hour.'],
  // an escaped quote or backslash never ends a quoted secret
  ['"password": "abc\\"def123"', '"password": "***"'],
  ['"password": "p\\\\w0rd123"', '"password": "***"'],
  ['password: "hunter\\"2"', 'password: "***"'],
  // a URL under a secret-named key keeps its host, never its secret-named query parameters
  ['AUTH_URL=https://auth.example.com/login?api_key=abc123', 'AUTH_URL=https://auth.example.com/login?api_key=***'],
  ['OAUTH_TOKEN_URL=https://login.example.com/oauth/token?client_secret=s3cr3t&x=1', 'OAUTH_TOKEN_URL=https://login.example.com/oauth/token?client_secret=***&x=1'],
  ['AUTH_URL="https://x.io/?token=abc123"', 'AUTH_URL="https://x.io/?token=***"'],
  // known token shapes keep their prefix; Authorization with any scheme; a token as a URL's user
  [`GH=${GH}`, 'GH=ghp_***'],
  ['PAT github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', 'PAT github_pat_***'],
  ['GITLAB glpat-abcdefghij0123456789', 'GITLAB glpat-***'],
  ['SLACK=xoxb-1234567890-abcdefghij', 'SLACK=xoxb-***'],
  ['STRIPE=sk_live_abcdefghij0123', 'STRIPE=sk_live_***'],
  ['maps("AIzaSyA0123456789abcdefghijklmnopqrstuv")', 'maps("AIza***")'],
  [`Authorization: token ${GH}`, 'Authorization: token ***'],
  ['Proxy-Authorization: Negotiate YIIGhgYGKwYBBQUCoIIGejCCBnagMDAu', 'Proxy-Authorization: Negotiate ***'],
  [`git clone https://${GH}@github.com/acme/x.git`, 'git clone https://***@github.com/acme/x.git'],
  ['https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz0123@github.com/a/b', 'https://***@github.com/a/b'],
  ['https://oauth2:glpat-abcdefghij0123456789@gitlab.com/a/b.git', 'https://***@gitlab.com/a/b.git'],
  ['const ghp_count = 3;', 'const ghp_count = 3;'],
  // webhook URLs whose path is the credential: host and fixed prefix kept
  ['SLACK_HOOK=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX', 'SLACK_HOOK=https://hooks.slack.com/services/***'],
  ['post("https://discord.com/api/webhooks/123456789012345678/abcDEF-ghi_jkl")', 'post("https://discord.com/api/webhooks/***")'],
  ['https://discordapp.com/api/webhooks/1/x', 'https://discordapp.com/api/webhooks/***'],
  ['https://acme.webhook.office.com/webhookb2/1111-2222@3333-4444/IncomingWebhook/abc/5555', 'https://acme.webhook.office.com/***'],
  ['https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage', 'https://api.telegram.org/bot***/sendMessage'],
  // a host-anchored form redacts ANY path under its host, canonical-shaped or not
  ['https://hooks.slack.com/services/T123/B456/abc', 'https://hooks.slack.com/services/***'],
  ['https://api.telegram.org/bot123:abc/getMe', 'https://api.telegram.org/bot***/getMe'],
  // …and the same credentials when only the path travels (an http fact is keyed by its path)
  ['POST /services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX', 'POST /services/***'],
  ["fetch('/api/webhooks/123456789012345678/abcDEF-ghi_jklMNOpqrSTU')", "fetch('/api/webhooks/***')"],
  ['GET /bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/getUpdates', 'GET /bot***/getUpdates'],
  ['GET /services/billing/invoices', 'GET /services/billing/invoices'],
  ['POST /webhookb2/0a1b2c3d-1111-2222-3333-444455556666@7e8f9a0b-aaaa-bbbb-cccc-ddddeeeeffff/IncomingWebhook/0123456789abcdef0123456789abcdef/99998888-7777-6666-5555-444433332222',
    'POST /webhookb2/***'],
  ['https://outlook.office.com/webhook/0a1b2c3d-1111@7e8f9a0b-aaaa/IncomingWebhook/0123456789abcdef/9999', 'https://outlook.office.com/webhook/***'],
  ['POST /webhooks/incoming/{}', 'POST /webhooks/incoming/{}'],
  // v3: credential query parameters with no secret word in their name — the candidate scan copies such a URL on its own
  ["fetch('http://orders-api:8080/api/orders?key=Zq9querykey1')", "fetch('http://orders-api:8080/api/orders?key=***')"],
  ['https://orders.blob.core.windows.net/c/b.pdf?sp=r&sig=Zq9SASsig%3D&se=2026-01-01', 'https://orders.blob.core.windows.net/c/b.pdf?sp=r&sig=***&se=2026-01-01'],
  ['https://fn-orders.azurewebsites.net/api/Hook?code=Zq9fnkey==', 'https://fn-orders.azurewebsites.net/api/Hook?code=***'],
  ['https://b.s3.amazonaws.com/o?X-Amz-Signature=Zq9sig0123&X-Amz-Date=20260101', 'https://b.s3.amazonaws.com/o?X-Amz-Signature=***&X-Amz-Date=20260101'],
  ['GET /api/items?page=2&sort=name', 'GET /api/items?page=2&sort=name'],
  // v3: connection strings, CLI flags, call arguments, header pairs, XML config
  ['DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=Zq9acct+/abc==;EndpointSuffix=core.windows.net',
    'DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=***;EndpointSuffix=core.windows.net'],
  ['root:Zq9gopass@tcp(orders-db:3306)/orders', 'root:***@tcp(orders-db:3306)/orders'],
  ['postgresql://myadmin@orderssrv:Zq9azpgpass@orderssrv.postgres.database.azure.com:5432/orders', 'postgresql://***@orderssrv.postgres.database.azure.com:5432/orders'],
  ['jdbc:oracle:thin:scott/Zq9oracle@orders-db:1521/ORCL', 'jdbc:oracle:thin:scott/***@orders-db:1521/ORCL'],
  ['curl -u admin:Zq9curlpass http://orders-api:8080/x', 'curl -u admin:*** http://orders-api:8080/x'],
  ['docker run -u 1000 app', 'docker run -u 1000 app'],
  ["requests.get(url, auth=('svc', 'Zq9pyauth'))", "requests.get(url, auth=***'svc', '***'))"],
  ['conn.setRequestProperty("X-API-KEY", "Zq9hdr")', 'conn.setRequestProperty("X-API-KEY", "***")'],
  ['<password>Zq9xml</password>', '<password>***</password>'],
  ['<add key="StripeSecret" value="Zq9cfg" />', '<add key="StripeSecret" value="***" />'],
  ['DB_PASSWORD=Zq9ab,cd&ef;gh', 'DB_PASSWORD=***'],
  ["h.set('bearer eyJhbGciOi.xx.yy')", "h.set('bearer ***')"],
  ['OPENAI=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD', 'OPENAI=sk-proj-***'],
  ['hook whsec_abcdefghijklmnopqrstuv', 'hook whsec_***'],
  ['NPM=npm_abcdefghijklmnopqrstuvwxyz0123456789', 'NPM=npm_***'],
  ['STRIPE=rk_live_abcdefghij0123', 'STRIPE=rk_live_***'],
  ['AKIAABCDEFGHIJKLMNOPBearer 12345678', 'AKIA***Bearer ***'],
  // v3: a host, port, topic or path under a locator-named key is what the map joins on — kept
  ['authServiceAddress: "auth-svc:50051"', 'authServiceAddress: "auth-svc:50051"'],
  ['AUTH_SERVICE_HOST=auth-svc', 'AUTH_SERVICE_HOST=auth-svc'],
  ['AUTH_TOPIC=auth-events', 'AUTH_TOPIC=auth-events'],
  ['PASSWORD_SERVICE_PORT=8081', 'PASSWORD_SERVICE_PORT=8081'],
  ['authEndpoint: /oauth/token', 'authEndpoint: /oauth/token'],
  // v4: a route, a service host, a topic or a code expression beside a secret-named name is what the map joins on
  ["const TOKEN_PATH = '/oauth/token';", "const TOKEN_PATH = '/oauth/token';"],
  ["channel.publish('auth', 'user.created', buf)", "channel.publish('auth', 'user.created', buf)"],
  ["bindQueue(q, 'auth-events', 'user.*')", "bindQueue(q, 'auth-events', 'user.*')"],
  ["emit('oauth', 'user.linked')", "emit('oauth', 'user.linked')"],
  ["export const authPaths = { token: '/oauth/token' };", "export const authPaths = { token: '/oauth/token' };"],
  ['const tokenUrl = `${AUTH_BASE}/oauth/token`;', 'const tokenUrl = `${AUTH_BASE}/oauth/token`;'],
  ['val tokenUrl = "$authBase/oauth/token"', 'val tokenUrl = "$authBase/oauth/token"'],
  ['authService: auth-svc:8080', 'authService: auth-svc:8080'],
  ['auth.service.host: ${AUTH_HOST:auth-svc}', 'auth.service.host: ${AUTH_HOST:auth-svc}'],
  ['spring.cloud.stream.bindings.authEvents-out-0.destination=auth-events', 'spring.cloud.stream.bindings.authEvents-out-0.destination=auth-events'],
  ['auth_channel = grpc.insecure_channel("auth-svc:50051")', 'auth_channel = grpc.insecure_channel("auth-svc:50051")'],
  ['TOKEN_URL = f"{AUTH_BASE}/oauth/token"', 'TOKEN_URL = f"{AUTH_BASE}/oauth/token"'],
  ['const authClient = new AuthClient({ baseURL: AUTH_URL })', 'const authClient = new AuthClient({ baseURL: AUTH_URL })'],
  // …but a literal in such code, a token-shaped "route", a prefixed / backtick string and a glued connection string are still secrets
  ['token = base64.b64encode(b"user:Zq9pw")', 'token = base64.b64encode(b"***")'],
  ['"password": "/Zq9sEcr3t"', '"password": "***"'],
  ["app.secret_key = b'Zq9flask'", "app.secret_key = b'***'"],
  ['password = `Zq9tpl`', 'password = `***`'],
  ['Password=a.b(Zq9;Server=db', 'Password=***'],
  // v4: a whole-line value is kept as a URL only when it STARTS as one (idempotency; no password tail kept)
  ['password=&x_token=http://a?token=b', 'password=***'],
  ['DB_PASSWORD=Zq9ab,cd&ef;gh&AUTH_URL=https://x', 'DB_PASSWORD=***'],
  // v5: a JWT or a SendGrid key is no host (a host in code is lower case) …
  ['token = jwt.decode("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJacTkifQ.Zq9sig_abc-DEF")', 'token = jwt.decode("***")'],
  ['api_key = sendgrid.SendGridAPIClient("SG.Zq9ngeVfQFYQlKU0ufo8x5.TwL2iGABf9DHoTf")', 'api_key = sendgrid.SendGridAPIClient("***")'],
  // … a plain call opened by a literal, a keyword argument or a call is code, and a locator-named keyword keeps its host …
  ['auth_client = AuthClient("http://auth-svc:8080")', 'auth_client = AuthClient("http://auth-svc:8080")'],
  ['auth_db = create_engine("postgresql://auth-db:5432/auth")', 'auth_db = create_engine("postgresql://auth-db:5432/auth")'],
  ['val authDb = createEngine("postgresql://auth-db:5432/auth")', 'val authDb = createEngine("postgresql://auth-db:5432/auth")'],
  ['auth_cache = redis.Redis(host="auth-cache", port=6379)', 'auth_cache = redis.Redis(host="auth-cache", port=6379)'],
  ['auth_queue = channel.queue_declare(queue="auth-events")', 'auth_queue = channel.queue_declare(queue="auth-events")'],
  ['password = decrypt("Zq9cipher")', 'password = decrypt("***")'],
  ['password = Summer(2024)', 'password = ***'],
  ['spring.datasource.password = ENC(G6N718UuyPE5bHyWKyuLQSm02auQPUtm==)', 'spring.datasource.password = ***'],
  ['token = client.login(user="svc", password="Zq9pw")', 'token = client.login(user="***", password="***")'],
  // … Basic credentials encoded where the request is built keep the user, never the password …
  ["axios.get('http://billing:8080/x', { headers: { Authorization: 'Basic ' + Buffer.from('svc:Zq9pw').toString('base64') } })",
    "axios.get('http://billing:8080/x', { headers: { Authorization: '***' + Buffer.from('svc:***').toString('base64') } })"],
  ["headers = {'Authorization': 'Basic ' + base64.b64encode(b'svc:Zq9pw').decode()}", "headers = {'Authorization': '***' + base64.b64encode(b'svc:***').decode()}"],
  ['conn.setRequestProperty("Authorization", "Basic " + Base64.getEncoder().encodeToString("svc:Zq9pw".getBytes()));',
    'conn.setRequestProperty("Authorization", "***" + Base64.getEncoder().encodeToString("svc:***".getBytes()));'],
  ['req.SetBasicAuth(u, p); h := base64.StdEncoding.EncodeToString([]byte("svc:Zq9pw"))', 'req.SetBasicAuth(u, p); h := base64.StdEncoding.EncodeToString([]byte("svc:***"))'],
  // … a topic-shaped second string under the credential's own name is the credential, and a URL inside a password is none
  ['put("password", "zq9pass.word")', 'put("password", "***")'],
  ['headers.put("Authorization", "admin:zq9secret")', 'headers.put("Authorization", "***")'],
  ["config.set('api_key', 'zq9key:abc')", "config.set('api_key', '***')"],
  ["token = ';OAUTH_TOKEN_URL=https://x.io/t?client_secret=s3cr3t&x=1'", "token = '***'"],
  // v6: a routing key under an exchange named for tokens, keys or auth stays (only a name that IS the credential hides it) …
  ["channel.publish('auth.tokens', 'token.issued', buf)", "channel.publish('auth.tokens', 'token.issued', buf)"],
  ["bindQueue(q, 'auth-keys', 'key.rotated')", "bindQueue(q, 'auth-keys', 'key.rotated')"],
  ["emit('keycloak-auth', 'user.login')", "emit('keycloak-auth', 'user.login')"],
  ['headers.put("x-api-key", "zq9ab.cd")', 'headers.put("x-api-key", "***")'],
  // … a URL is no Basic user, a PascalCase dotted name in a code run is a queue, and more Base64 spellings keep only the user …
  ["const state = btoa('https://app.example.com/after-login')", "const state = btoa('https://app.example.com/after-login')"],
  ['token_queue = channel.queue_declare("Auth.Tokens")', 'token_queue = channel.queue_declare("Auth.Tokens")'],
  ["$auth = base64_encode('svc:zq9pw');", "$auth = base64_encode('svc:***');"],
  ['Base64.strict_encode64("svc:zq9pw")', 'Base64.strict_encode64("svc:***")'],
  // … under a credential's own name a plain call's host-shaped literal is the credential, and a call-shaped password stays one …
  ['api_key = Key("abc.def123")', 'api_key = Key("***")'],
  ['password = Password("admin:12345")', 'password = Password("***")'],
  ['password: Q(TO=lU2mugI', 'password: ***'],
  // … and a code run a spaced literal leaves open is redacted whole, so the line is stable (an agent's citation of it
  // verifies); a password holding a space keeps its tail (Known limitations).
  ['auth = Client(user="svc",password="my pass",label="Login page")', 'auth = *** pass",label="Login page")'],
  // v7: a credential-word segment anywhere in a pair's name hides a topic-shaped value (a `user:pass` is one) unless a
  // later segment names a message container …
  ['config.set("DB_PASSWORD_2", "admin:zq9pw")', 'config.set("DB_PASSWORD_2", "***")'],
  ['os.getenv("DB_PASSWORD_PROD", "correct.horse.battery.staple")', 'os.getenv("DB_PASSWORD_PROD", "***")'],
  ['props.put("db_passwd", "admin:zq9pw")', 'props.put("db_passwd", "***")'],
  ["publish('auth.token.events', 'token.issued')", "publish('auth.token.events', 'token.issued')"],
  // … a plain call LINE_KV keeps is one BARE_KV keeps too (it cut this one at the `&`: `***&mugI`) …
  ['password: Q(TO=lU2&mugI', 'password: ***'],
  ['token = sign(key=K&0xff)', 'token = ***'],
  ['put("token: Key(host=?token=Key(', 'put("token: ***'],
  ['password: Q(host=?token=Key(', 'password: ***'],
  // … and a credential builder keeps only the user.
  ['Credentials.basic("svc", "Zq9pw")', 'Credentials.basic("svc", "***")'],
  ['new UsernamePasswordCredentials("svc", "Zq9pw")', 'new UsernamePasswordCredentials("svc", "***")'],
  // v8: an event named for the credential or the infrastructure holding it keeps its routing key / host default; a
  // qualifier after the credential word (`_BACKUP`) and `refresh` (a refresh token) still hide it …
  ["channel.publish('password-reset', 'user.password.reset', buf)", "channel.publish('password-reset', 'user.password.reset', buf)"],
  ["nc.publish('auth.token.revoked', 'user.logout')", "nc.publish('auth.token.revoked', 'user.logout')"],
  ['os.getenv("TOKEN_CACHE", "token-cache:6379")', 'os.getenv("TOKEN_CACHE", "token-cache:6379")'],
  ['viper.SetDefault("secret.manager", "vault.default.svc:8200")', 'viper.SetDefault("secret.manager", "vault.default.svc:8200")'],
  ['os.getenv("DB_PASSWORD_BACKUP", "admin:zq9pw")', 'os.getenv("DB_PASSWORD_BACKUP", "***")'],
  ["publish('token-refresh', 'zq9ab.cd')", "publish('token-refresh', '***')"],
  // … a builder keeps a literal that STARTS as a URL (only), and hides its third literal too (a session token
  // lost its secret-named neighbour when the second became `***`); a singular `…Credential(` is a builder.
  ['app.configureAuthentication("jwt", "http://auth-svc:8080/jwks")', 'app.configureAuthentication("jwt", "http://auth-svc:8080/jwks")'],
  ['new ClientCredentials("orders-svc", "https://auth-svc/oauth/token")', 'new ClientCredentials("orders-svc", "https://auth-svc/oauth/token")'],
  ['Credentials("svc", "x http://auth-svc Zq9pw")', 'Credentials("svc", "***")'],
  ['new BasicSessionCredentials("AKIAIOSFODNN7EXAMPLE", "Zq9secretKey", "Zq9sessionTok")', 'new BasicSessionCredentials("AKIA***", "***", "***")'],
  ['credentials.NewStaticCredentials("id", "Zq9sec", "")', 'credentials.NewStaticCredentials("id", "***", "")'],
  ['new NetworkCredential("svc", "Zq9pw")', 'new NetworkCredential("svc", "***")'],
];

test('redactSecrets: userinfo, key/value secrets, auth headers, token shapes, AWS ids, PEM — hosts, routes and prose kept', () => {
  for (const [input, want] of CASES) assert.equal(redactSecrets(input), want, input);
});

test('redactSecrets is idempotent and total', () => {
  for (const [input] of CASES) {
    const once = redactSecrets(input);
    assert.equal(redactSecrets(once), once, input);
  }
  for (const v of [null, undefined, 42, '']) assert.equal(redactSecrets(v), v);
});

test('redactLines: a multi-line PEM body never reaches a per-line reader; the line count is kept', () => {
  const lines = ['cert: |', '  -----BEGIN PRIVATE KEY-----', '  MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', '  token=abc123', '  -----END PRIVATE KEY-----',
    "const h = '-----BEGIN CERTIFICATE-----';", 'KEY="-----BEGIN RSA PRIVATE KEY-----', 'b64body', '-----END RSA PRIVATE KEY-----"', 'password=hunter2'];
  assert.deepEqual(redactLines(lines), ['cert: |', '  -----BEGIN ***-----', '***', '***', '  -----END ***-----',
    "const h = '-----BEGIN ***-----';", 'KEY="-----BEGIN ***-----', '***', '-----END ***-----"', 'password=***']);
  // a PEM key held in a source string opens a block too; a line that merely mentions a marker opens nothing
  for (const open of ['const key = `-----BEGIN PRIVATE KEY-----', 'KEY = """-----BEGIN PRIVATE KEY-----', 'key := `-----BEGIN PRIVATE KEY-----',
    "export const PEM = '-----BEGIN PRIVATE KEY-----\\n' +"]) {
    assert.equal(redactLines([open, 'MIIEvQIBADANBgkqhkiG9w0BAQEF', '-----END PRIVATE KEY-----`'])[1], '***', open);
  }
  assert.equal(redactLines(['if (pem.startsWith("-----BEGIN CERTIFICATE-----")) {', 'MIIEvQIBADANBgkqhkiG9w0BAQEF'])[1], 'MIIEvQIBADANBgkqhkiG9w0BAQEF');
  // v4: a string closed on the marker's line is a one-line constant (it blanked the rest of the file);
  // a prefixed / parenthesised opening quote (C# @", Python r""" / (b"…\n") still opens
  assert.equal(redactLines(['PEM_HEADER = "-----BEGIN PUBLIC KEY-----"', 'TOKEN_URL = "/oauth/token"'])[1], 'TOKEN_URL = "/oauth/token"');
  for (const open of ['var key = @"-----BEGIN RSA PRIVATE KEY-----', 'KEY = r"""-----BEGIN RSA PRIVATE KEY-----', 'KEY = (b"-----BEGIN PRIVATE KEY-----\\n"']) {
    assert.equal(redactLines([open, 'MIIEvQIBADANBgkqhkiG9w0BAQEF', '-----END RSA PRIVATE KEY-----"'])[1], '***', open);
  }
  for (const bad of [null, 'x', 7]) assert.deepEqual(redactLines(bad), []);
});

test('redactSecrets and redactLines stay linear on long single-line input (ReDoS guard)', () => {
  // The first five are the shapes the unbounded v1 regexes were quadratic on (each took well over
  // 10 s); bounded, every input takes milliseconds — the 3 s ceiling only absorbs a loaded machine.
  const inputs = [
    'a'.repeat(1 << 18), // a scheme-shaped run (USERINFO)
    '0123456789abcdef'.repeat(1 << 14), // a 256 KiB hex line
    '"' + 'token'.repeat(52428), // QUOTED_KV's ambiguous key
    '-----BEGIN A-----'.repeat(61680), // PEM_BLOCK without END
    'token_'.repeat(87381), // one 512 KiB \w run full of secret words (BARE_KV's ambiguous key)
    ' token'.repeat(174762), 'ghp_'.repeat(262144), 'ghp_' + 'a'.repeat(1 << 20), ('https://ghp_' + 'a'.repeat(30) + ' ').repeat(24966),
    'xoxb-'.repeat(209715), 'AIza'.repeat(262144), 'sk_live_'.repeat(131072), 'glpat-'.repeat(174762),
    'Authorization: token ' + 'a'.repeat(1 << 20), ('Authorization:' + ' '.repeat(64)).repeat(13443),
    'Bearer ' + 'aB1'.repeat(349525), ('Bearer ' + 'x'.repeat(9) + ' ').repeat(61680),
    'https://hooks.slack.com/services/'.repeat(30840), ('https://discord.com/api/webhooks/' + 'a'.repeat(300) + ' ').repeat(3150),
    ('https://x.webhook.office.com/' + 'a@'.repeat(300) + ' ').repeat(1660), 'https://api.telegram.org/bot1:'.repeat(34952),
    '/services/TAAAAAA/BAAAAAA/'.repeat(40330), '/api/webhooks/12345/'.repeat(52429), '/bot123:'.repeat(131072),
    'x_token=http://a' + '?token=a'.repeat(131072), '"password": "' + '\\"'.repeat(262144),
    '-----BEGIN A-----' + ' '.repeat(1 << 20) + 'x', 'k:'.repeat(1 << 19),
    '/webhookb2/'.repeat(95326), ('/webhookb2/' + 'a@'.repeat(80) + '/IncomingWebhook/').repeat(5500),
    ('x://' + 'a'.repeat(250) + ':' + 'b'.repeat(250) + ' ').repeat(2000),
    // v3 rules, 1 MiB each
    ...[() => 'password=' + 'a&,;'.repeat(1 << 18), () => ('"' + 'pwd'.repeat(40) + '", "' + 'x'.repeat(4200) + " '").repeat(245),
      () => ('<' + 'pwd'.repeat(40) + '>' + 'x'.repeat(4200)).repeat(242), () => (' name="' + 'pwd'.repeat(40) + '" value="' + 'x'.repeat(4200)).repeat(237),
      () => ('!a:' + '!'.repeat(255)).repeat(3656), () => ('a:' + 'b'.repeat(250) + '@tc').repeat(4096), () => ('://a:' + 'b'.repeat(2040) + ' ').repeat(511),
      () => ('://' + 'a@'.repeat(128) + ':' + 'b'.repeat(2000) + ' ').repeat(460), () => ("Auth('a', '" + 'x'.repeat(300)).repeat(3380),
      () => (' -u ' + 'a'.repeat(128) + ':' + 'b'.repeat(256)).repeat(2703), () => ('?sig=' + 'a'.repeat(4096)).repeat(256),
      () => (' sk-' + 'a'.repeat(31) + '.').repeat(29127), () => ('jdbc:oracle:thin:' + 'a'.repeat(64) + '/' + 'b'.repeat(256)).repeat(3106),
      // v4: a code run's literals (a scan restarted at every escaped quote took 10 s), the closed-string lookahead
      () => 'token = a.b("' + '\\"'.repeat(1 << 19), () => 'token=f"' + 'x'.repeat(4095) + '"' + 'y'.repeat(1 << 20),
      () => ('"' + 'pwd'.repeat(41) + '": "/' + 'a/'.repeat(128) + '" ').repeat(3900),
      // v5: a plain call's literals and keyword look-back, the inline Basic encoding
      () => 'token = F(' + '"a",'.repeat(262143), () => 'token = F(' + 'host="a",'.repeat(116508), () => ('const token = F("a" ').repeat(52428),
      () => 'Buffer.from("a:' + '\\"'.repeat(1 << 19), () => 'btoa('.repeat(209715), () => ('x = Buffer.from(\'' + 'a'.repeat(128) + ':').repeat(7700),
      // v6: the PascalCase dotted names, the strict code run, the call-shaped password, the Base64 spellings
      () => 'password = Key("' + 'Ab.'.repeat(349525) + '")', () => 'x = F(' + '"Auth.Tokens",'.repeat(80000), () => 'password: Q(' + 'a('.repeat(500000),
      () => "auth = base64_encode('" + 'a:'.repeat(500000),
      // v7: a pair's name split into segments, a plain call judged on its kept text
      () => ('("pwd' + 'aB1_'.repeat(28) + 'x", "a.b"), ').repeat(8000), () => 'password: Q(' + 'a&'.repeat(500000),
      () => 'Credentials.basic("a", "'.repeat(43690),
      // v8: a builder's optional third literal, the URL keep
      () => 'NetworkCredential("a", "b", "'.repeat(37450), () => ('Credentials("a", "http://' + 'a'.repeat(240) + '", "').repeat(3900)].map((f) => f()),
  ];
  for (const s of inputs) {
    const t0 = performance.now();
    redactSecrets(s);
    redactLines([s]);
    const ms = performance.now() - t0;
    assert.ok(ms < 3000, `${JSON.stringify(s.slice(0, 16))}… (${s.length} chars) took ${Math.round(ms)} ms`);
  }
  assert.equal(redactSecrets('spring.cloud.config.server.git.repos.team-a.password=hunter2'),
    'spring.cloud.config.server.git.repos.team-a.password=***', 'a long dotted key is still a key');
});
