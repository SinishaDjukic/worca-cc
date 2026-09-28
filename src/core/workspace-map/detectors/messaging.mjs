// messaging: message topics / queues / subjects / channels. Producers → provides topic,
// consumers → consumes topic (key = the name as written; wildcards kept).
// ROWS is the whole detector: [id, langs, regex (ends where the arguments start), dir, how]
//   how: 'arg'        first argument (string literal, list literal, or a same-file constant)
//        'arg2'       the first argument after a leading ctx / context argument (Go go-redis)
//        'args'       every leading string literal argument (Redis subscribe('a','b'))
//        'obj:<k>'    `<k>: …` / `<K>: …` inside the call's object / struct literal
//        'kw:<k>'     Python keyword argument <k>= (or C# named argument <k>:)
//        'ann'        annotation args: topics= / queues= / value= / topicPattern=, @Queue/@Exchange
//        'rabbit'     by position: (exchange, routingKey, message…) / (routingKey, message): the exchange (a literal,
//                     else a constant) and the key (heuristic); exchange '' → the key names the queue
//        'amqp-bind'  bindQueue(queue, exchange, key) → the exchange (and key) the queue listens to
//        'sqs'        a QueueUrl literal in the call → the queue name (last URL segment)
//        'sns'        a TopicArn literal in the call → the topic name (last ARN segment)
// Spring Cloud Stream bindings live in application.yml and are owned by config-env (P3);
// StreamBridge.send("<binding>") names a binding, not a destination, and is not read here.
// NestJS microservice rows (id 'nest-…') run only in files that import @nestjs/microservices or
// name a ClientProxy (socket.io's client.emit('x') is not a message topic).
// A topic that is a variable not bound in the same file → unresolved ('dynamic topic', ≤ 50);
// a ${…} placeholder → unresolved ('config placeholder').
import { splitLines, fact, lineIndex } from './lib/text.mjs';
import { isSource, isMinified, langOf, stripComments, argAt, stringsIn, firstPerKey, fileUnresolved } from './lib/code.mjs';

const JVM = ['java', 'kotlin'];
const ANY = ['js', 'py', 'java', 'kotlin', 'go', 'cs', 'rb', 'php'];
const ARGS = String.raw`(?:[^()]|\([^()]{0,200}\)){0,600}`;
const ROWS = [
  // Kafka
  ['kafka-listener', JVM, new RegExp(String.raw`@KafkaListener\s*\((${ARGS})\)`, 'g'), 'consumes', 'ann'],
  ['kafka-template', JVM, /\b(?:\w*[Kk]afka[Tt]emplate|kafkaTemplate|template)\.send\s*\(/g, 'provides', 'arg'],
  ['producer-record', JVM, /new\s+ProducerRecord(?:\s*<[^<>\n]{0,100}>)?\s*\(/g, 'provides', 'arg'],
  ['kafka-streams', JVM, /\b\w*[Bb]uilder\.stream\s*\(/g, 'consumes', 'arg'],
  ['kafka-consumer', JVM, /\b\w*[Cc]onsumer\.subscribe\s*\(\s*(?:Collections\.singletonList|Collections\.singleton|Arrays\.asList|List\.of|Set\.of|listOf|setOf|mutableListOf)\s*\(/g, 'consumes', 'list'],
  ['kafkajs-send', ['js'], /\b\w{0,60}(?:[Pp]roducer|[Kk]afka\w{0,60})\.send\s*\(\s*(?=\{)/g, 'provides', 'obj:topic'], // not res.send({ … })
  ['kafkajs-subscribe', ['js'], /\b\w{0,60}(?:[Cc]onsumer|[Kk]afka\w{0,60})\.subscribe\s*\(\s*(?=\{)/g, 'consumes', 'obj:topics|topic'], // not Apollo client.subscribe({ variables })
  ['rdkafka-produce', ['js', 'py'], /\b(?:p|\w*[Pp]roducer)\.produce\s*\(/g, 'provides', 'arg'],
  ['kafka-python-send', ['py'], /\b\w*[Pp]roducer\.send(?:_and_wait)?\s*\(/g, 'provides', 'arg'],
  ['kafka-python-consumer', ['py'], /\b(?:KafkaConsumer|AIOKafkaConsumer)\s*\(/g, 'consumes', 'args'],
  ['subscribe-list', ['js', 'py', 'go'], /\.(?:subscribe|SubscribeTopics)\s*\(\s*(?=\[|\[\]string\s*\{)/g, 'consumes', 'arg'],
  ['sarama-message', ['go'], /sarama\.ProducerMessage\s*\{/g, 'provides', 'obj:Topic'],
  ['kafka-go-writer', ['go'], /kafka\.(?:Writer|WriterConfig|Message)\s*\{/g, 'provides', 'obj:Topic'],
  ['kafka-go-reader', ['go'], /kafka\.ReaderConfig\s*\{/g, 'consumes', 'obj:Topic|GroupTopics'],
  ['sarama-consume', ['go'], /\.ConsumePartition\s*\(/g, 'consumes', 'arg'],
  ['sarama-group', ['go'], /\.Consume\s*\(\s*\w{1,40}\s*,\s*(?=\[\]string)/g, 'consumes', 'arg'],
  ['dotnet-produce', ['cs'], /\.Produce(?:Async)?\s*\((?=\s*["\w])/g, 'provides', 'arg'],
  ['dotnet-subscribe', ['cs'], /\b\w*[Cc]onsumer\.Subscribe\s*\(/g, 'consumes', 'arg'],
  // RabbitMQ
  ['rabbit-listener', JVM, new RegExp(String.raw`@RabbitListener\s*\(`, 'g'), 'consumes', 'ann'],
  ['rabbit-template', JVM, /\b(?:\w*[Rr]abbit[Tt]emplate|\w*[Aa]mqp[Tt]emplate)\.(?:convertAndSend|send)\s*\(/g, 'provides', 'rabbit'],
  ['amqplib-send', ['js'], /\.sendToQueue\s*\(/g, 'provides', 'arg'],
  ['amqplib-publish', ['js'], /\b(?:\w*[Cc]hannel|ch|chan)\.publish\s*\(/g, 'provides', 'rabbit'],
  ['amqplib-consume', ['js'], /\b(?:\w*[Cc]hannel|ch|chan)\.consume\s*\(/g, 'consumes', 'arg'],
  ['amqplib-bind', ['js'], /\.bindQueue\s*\(/g, 'consumes', 'amqp-bind'],
  ['pika-publish', ['py'], /\.basic_publish\s*\(/g, 'provides', 'kw:exchange|routing_key'],
  ['pika-consume', ['py'], /\.basic_consume\s*\(/g, 'consumes', 'kw:queue'],
  ['pika-bind', ['py'], /\.queue_bind\s*\(/g, 'consumes', 'kw:exchange'],
  ['dotnet-rabbit-publish', ['cs'], /\.BasicPublish(?:Async)?\s*\(/g, 'provides', 'kw:exchange|routingKey'],
  ['dotnet-rabbit-consume', ['cs'], /\.BasicConsume(?:Async)?\s*\(/g, 'consumes', 'kw:queue'],
  ['masstransit', ['cs'], /\.ReceiveEndpoint\s*\(/g, 'consumes', 'arg'],
  // AWS SQS / SNS
  ['sqs-send', ANY, /\b(?:sendMessage|SendMessageCommand|sendMessageBatch|SendMessageBatchCommand|send_message|send_message_batch|SendMessage|SendMessageAsync|SendMessageBatchAsync)\s*\(/g, 'provides', 'sqs'],
  ['sqs-receive', ANY, /\b(?:receiveMessage|ReceiveMessageCommand|receive_message|ReceiveMessage|ReceiveMessageAsync)\s*\(/g, 'consumes', 'sqs'],
  ['sqs-listener', JVM, new RegExp(String.raw`@SqsListener\s*\((${ARGS})\)`, 'g'), 'consumes', 'ann'],
  ['sqs-template', JVM, /\b\w*[Ss]qs[Tt]emplate\.send\s*\(/g, 'provides', 'arg'],
  ['sns-publish', ANY, /\b(?:publish|PublishCommand|Publish|PublishAsync)\s*\(/g, 'provides', 'sns'],
  ['sns-subscribe', ANY, /\b(?:subscribe|SubscribeCommand|Subscribe|SubscribeAsync)\s*\(/g, 'consumes', 'sns'],
  // NATS / Redis pub/sub (receiver names that are brokers / connections)
  ['pubsub-publish', ANY, /\b(?:nc|nats|natsConn|js|jetstream|redis|rdb|redisClient|publisher)\.(?:publish|Publish|publishAsync|PublishAsync)\s*\(/g, 'provides', 'arg2'],
  ['pubsub-subscribe', ANY, /\b(?:nc|nats|natsConn|js|jetstream|redis|rdb|redisClient|subscriber|pubsub|ps)\.(?:subscribe|Subscribe|psubscribe|PSubscribe|SubscribeSync|ChanSubscribe|pSubscribe)\s*\(/g, 'consumes', 'args'],
  // generic receiver names (an in-process event bus, a cache, any client): only in a file that imports a broker
  ['pubsub-publish-generic', ANY, /\b(?:client|conn|pub|bus|r|cache)\.(?:publish|Publish|publishAsync|PublishAsync)\s*\(/g, 'provides', 'arg2'],
  ['pubsub-subscribe-generic', ANY, /\b(?:client|conn|sub|p|bus|r)\.(?:subscribe|Subscribe|psubscribe|PSubscribe|SubscribeSync|ChanSubscribe|pSubscribe)\s*\(/g, 'consumes', 'args'],
  ['nats-queue-subscribe', ANY, /\b(?:nc|nats|natsConn|js|jetstream|conn)\.QueueSubscribe(?:Sync)?\s*\(/g, 'consumes', 'arg'],
  // GCP Pub/Sub
  ['gcp-topic', ['js', 'go', 'java', 'kotlin'], /\.(?:topic|Topic)\s*\((?=\s*["'`])/g, 'provides', 'gcp-topic'],
  ['gcp-topic-path', ['py'], /\.topic_path\s*\(/g, 'provides', 'arg2'],
  ['gcp-subscription', ['js', 'go', 'java', 'kotlin'], /\.(?:subscription|Subscription)\s*\((?=\s*["'`])/g, 'consumes', 'arg'],
  ['gcp-subscription-path', ['py'], /\.subscription_path\s*\(/g, 'consumes', 'arg2'],
  ['gcf-v2-pubsub', ['js'], /\bonMessagePublished\s*\((?=\s*["'`])/g, 'consumes', 'arg'], // firebase-functions/v2/pubsub
  ['gcf-v2-pubsub-opts', ['js'], /\bonMessagePublished\s*\(\s*(?=\{)/g, 'consumes', 'obj:topic'],
  // NestJS microservices: @EventPattern / @MessagePattern handlers consume; ClientProxy emit / send produce
  ['nest-pattern', ['js'], /@(?:EventPattern|MessagePattern)\s*\(/g, 'consumes', 'arg'],
  ['nest-client', ['js'], /\b(?:client|\w+Client|\w+Proxy)\.(?:emit|send)\s*\((?=\s*['"`])/g, 'provides', 'arg'],
];

/** Is offset `i` inside an unclosed `(` — a call's arguments or a parameter list, across lines (≤ 300 chars back;
 *  a `;`, `{` or `}` at depth 0 ends the search)? `send(topic='x')`, `function f(\n  topic = 'x',\n)` are; the second name
 *  of `const A = 'a', B = 'b';` is not, nor is a Go `const ( … )` / `var ( … )` block. */
function inParens(code, i) {
  let depth = 0;
  for (let j = i - 1; j >= 0 && i - j <= 300; j -= 1) {
    const c = code[j];
    if (c === ')' || c === ']') depth += 1;
    else if (c === '(' || c === '[') { if (depth === 0) return c === '(' && !/\b(?:const|var)\s*$/.test(code.slice(Math.max(0, j - 12), j)); depth -= 1; } else if (depth === 0 && (c === ';' || c === '{' || c === '}')) return false;
  }
  return false;
}

/** name = "literal" constants in this file (const / final / val / Go const / Python module level) → Map name → value.
 *  A keyword argument or a default parameter (`send(topic='x')`, `f(topic = 'x')`) is no constant. A name bound to
 *  two different values (`const queue` in two functions, `Inbound.ORDERS` / `Outbound.ORDERS`) answers nothing
 *  (`clash`), like a base URL bound twice. Python: `self.x = 'v'` / `cls.x = 'v'` answers only a `self.x` / `cls.x`
 *  use (`map.own`, with its own clash set); any other name that is indented and not UPPER_CASE is a function local,
 *  kept in `map.locals` under the offset of the nearest `def` above it (`map.defs`, ascending), so it answers only a
 *  bare use under that same `def` (`constOf`): name → Map(def → first value), one lookup per use. */
function constants(code, lang) {
  const py = lang === 'py';
  const map = Object.assign(new Map(), { clash: new Set(), locals: new Map() });
  map.own = Object.assign(new Map(), { clash: new Set() });
  map.defs = py ? [...code.matchAll(/^[ \t]*(?:async[ \t]+)?def[ \t]/gm)].map((m) => m.index) : [];
  const bind = (mp, name, value) => { if (!mp.has(name)) mp.set(name, value); else if (mp.get(name) !== value) mp.clash.add(name); };
  for (const m of code.matchAll(/\b([A-Za-z_]\w{0,60})\s*(?::[ \t]*[\w<>?]{1,40}[ \t]*)?:?=\s*["'`]([^"'`\n$]{1,200})["'`]\s*[;\n,)]/g)) {
    if (inParens(code, m.index)) continue;
    if (py && m.index > 0 && code[m.index - 1] !== '\n') {
      if (/\b(?:self|cls)\.$/.test(code.slice(Math.max(0, m.index - 5), m.index))) { bind(map.own, m[1], m[2]); continue; }
      if (!/^[A-Z][A-Z0-9_]*$/.test(m[1])) {
        const d = defAbove(map.defs, m.index);
        if (!map.locals.has(m[1])) map.locals.set(m[1], new Map());
        if (!map.locals.get(m[1]).has(d)) map.locals.get(m[1]).set(d, m[2]);
        continue;
      }
    }
    bind(map, m[1], m[2]);
  }
  return map;
}
/** Offset of the nearest `def` header above `pos` (binary search), -1 at module level. */
function defAbove(defs, pos) {
  let lo = 0; let hi = defs.length - 1; let hit = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (defs[mid] < pos) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
  return hit === -1 ? -1 : defs[hit];
}

/** Top-level elements of a list literal → [{ text, at }] (`at`: offset in `text`). The list opens at its first
 *  bracket after an optional constructor (`[]string{…}`, `new[] {…}`, `new List<string>{…}`, `arrayOf(…)`);
 *  strings are skipped whole and nesting is counted, so a comma inside a call or a string never splits. */
function listElems(text) {
  const t = String(text ?? '');
  const open = (/^(?:\[\]string\s*|new\s*\[\]\s*|new\s+List<string>\s*(?:\(\s*\)\s*)?|arrayOf\s*|listOf\s*)?/.exec(t)?.[0] ?? '').length;
  if (!'[{('.includes(t[open] || 'x')) return [];
  const out = [];
  const push = (from, to) => { const raw = t.slice(from, to); const lead = raw.length - raw.trimStart().length; if (raw.trim()) out.push({ text: raw.trim(), at: from + lead }); };
  let depth = 0;
  let q = null;
  let start = open + 1;
  for (let i = open; i < t.length; i += 1) {
    const c = t[i];
    if (q) { if (c === '\\') i += 1; else if (c === q || c === '\n') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth += 1; continue; }
    if (c === ')' || c === ']' || c === '}') { depth -= 1; if (depth === 0) { push(start, i); return out; } continue; }
    if (c === ',' && depth === 1) { push(start, i); start = i + 1; }
  }
  return out;
}

/** Leading string-literal arguments at pos (stops at the first non-literal). */
function literalArgs(code, pos, lang, max = 4) {
  const out = [];
  let i = pos;
  for (let k = 0; k < max; k += 1) {
    const a = argAt(code, i, lang);
    if (!a) break;
    out.push(a);
    const end = a.kind === 'literal' ? a.start + a.value.length + 1 : a.start + a.text.length;
    const comma = code.slice(end, end + 40).match(/^\s*(?:["'`])?\s*,/);
    if (!comma) break;
    i = end + comma[0].length;
  }
  return out;
}

function callText(code, pos) {
  let depth = 0;
  let j = pos;
  for (; j < code.length && j - pos < 800; j += 1) {
    const c = code[j];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth -= 1; }
  }
  return code.slice(pos, j);
}

function detect({ rel, text }, ctx) {
  const lang = langOf(rel);
  if (!lang || isMinified(rel, text)) return undefined;
  const st = ctx.state;
  const code = stripComments(text, lang);
  if (!/topic|queue|subscri|publish|produc|consum|send|Send|stream|Listener|channel|Topic|Queue|Publish|Subscri|Produce|Consume|Pattern|ClientProxy/.test(code)) return undefined;
  const lines = splitLines(text);
  const lineOf = lineIndex(text);
  const nestFile = lang === 'js' && /@nestjs\/microservices|\bClientProxy\b/.test(code);
  const brokerFile = /\b(?:nats|@nats-io|redis|ioredis|go-redis|StackExchange\.Redis|mqtt)\b/.test(code);
  const consts = constants(code, lang);
  // a same-file constant for a name used at `pos`: `self.x` / `cls.x` reads a Python `self.x = 'v'` when the file binds
  // one; any other qualified name (`Topics.ORDERS`) the module constant of its last segment; a bare name the module
  // constant, else a Python local of the same function. A clashing name answers nothing.
  const constOf = (name, pos) => {
    const last = name.split('.').pop();
    const pick = (mp) => (mp.clash.has(last) ? undefined : mp.get(last));
    if (/^(?:self|cls)\.[^.]+$/.test(name) && (consts.own.has(last) || consts.own.clash.has(last))) return pick(consts.own);
    if (name.includes('.')) return pick(consts);
    return pick(consts) ?? consts.locals.get(name)?.get(defAbove(consts.defs, pos));
  };
  const facts = [];
  const unresolved = [];
  const put = (dir, name, at, id, confidence = 'exact') => {
    if (typeof name !== 'string' || !name.trim()) return;
    if (/[$#]\{/.test(name)) { unresolved.push({ kind: 'topic', raw: name.slice(0, 200), file: rel, line: lineOf(at), reason: 'config placeholder' }); return; }
    facts.push(fact({ kind: 'topic', dir, key: name, rel, lines, line: lineOf(at), needle: name, detail: id, confidence }));
  };
  const dynamic = (at, raw) => unresolved.push({ kind: 'topic', raw: String(raw).slice(0, 200), file: rel, line: lineOf(at), reason: 'dynamic topic' });
  // `prefix + '.orders'`, `'orders.' + env`, `getTopic()`, `TOPICS[env]`, `a ? b : c`, `a || b`: the scalar is only the
  // head of an expression — never keyed by that head (the R2-07 class for concatenation)
  const continued = (tail) => /^\s*(?:\+|\|\||\?|%|\(|\[|\.(?!\.))/.test(tail);
  // A list literal, element by element: a string literal is a topic, a bare identifier a same-file constant (else
  // dynamic), and any other element — a concatenation (`PREFIX + 'orders'`), a call (`topicFor(ENV)`), a `%` /
  // `.format` string — is a dynamic topic: never keyed by a string or identifier inside it (R2-07, R3-05 for list elements).
  const keyList = (text, start, dir, id) => {
    const els = listElems(text);
    for (const e of els) {
      const lit = /^[rRbBuUfF$@]{0,3}(?:"([^"\n]{0,300})"|'([^'\n]{0,300})'|`([^`\n]{0,300})`)$/.exec(e.text);
      if (lit) { const v = lit[1] ?? lit[2] ?? lit[3]; put(dir, v, start + e.at + 1, id); continue; }
      if (/^[A-Za-z_][\w.]{0,80}$/.test(e.text)) {
        const c = constOf(e.text, start + e.at);
        if (c) put(dir, c, start + e.at, id, 'heuristic'); else dynamic(start + e.at, e.text);
        continue;
      }
      dynamic(start + e.at, e.text);
    }
    return els.length;
  };
  const fromArg = (a, dir, id) => {
    if (!a) return;
    if (a.kind === 'literal') { put(dir, a.value, a.start, id); return; }
    if (/^\{[^}]*:/.test(a.text)) return; // an options object (kafkajs / SNS rows read it), not a list
    if (/^(?:\[\]string\s*)?[[{]|^new\s*(?:\[\]|List<string>)/.test(a.text) && keyList(a.text, a.start, dir, id)) return;
    const c = constOf(a.text, a.start);
    if (c) { put(dir, c, a.start, id, 'heuristic'); return; }
    dynamic(a.start, a.text);
  };
  for (const [id, langs, re, dir, how] of ROWS) {
    if (!langs.includes(lang) || (id.startsWith('nest-') && !nestFile) || (id.endsWith('-generic') && !brokerFile)) continue;
    for (const m of code.matchAll(re)) {
      const pos = m.index + m[0].length;
      if (how === 'arg') {
        // a Python keyword call (`producer.send(topic='x', value=v)`, confluent `produce(topic=t, …)`) names its topic by
        // `topic=`; any other keyword first (`send(value=v)`) names none
        const a = argAt(code, pos, lang);
        const kw = lang === 'py' && a?.kind === 'expr' && /^[A-Za-z_]\w*\s*=(?!=)/.test(a.text);
        const t = kw ? /\btopic\s*=(?!=)\s*/.exec(callText(code, pos)) : null;
        if (t) fromArg(argAt(code, pos + t.index + t[0].length, lang), dir, id); else if (!kw) fromArg(a, dir, id);
      }
      else if (how === 'list') for (const a of literalArgs(code, pos, lang, 8)) fromArg(a, dir, id);
      else if (how === 'arg2') {
        const as = literalArgs(code, pos, lang, 3);
        const first = as[0];
        const skipCtx = first && first.kind === 'expr' && /^(ctx|context\.\w+\(\)|project(?:_id)?|self\.\w+|\w*[Pp]roject\w*)$/.test(first.text);
        fromArg(skipCtx ? as[1] : first, dir, id);
      } else if (how === 'args') {
        const as = literalArgs(code, pos, lang, 8);
        const skipCtx = as[0]?.kind === 'expr' && /^(ctx|context\.\w+\(\))$/.test(as[0].text);
        // KafkaConsumer(TOPIC, …): its first argument may be a same-file constant (else a dynamic topic)
        const lits = (skipCtx ? as.slice(1) : as).filter((a, i) => a.kind === 'literal' || /^[[{]/.test(a.text) || (id === 'kafka-python-consumer' && i === 0 && /^[A-Za-z_][\w.]{0,80}$/.test(a.text)));
        for (const a of lits) fromArg(a, dir, id);
      } else if (how.startsWith('obj:')) {
        const body = callText(code, pos + (code[pos] === '{' ? 1 : 0));
        for (const key of how.slice(4).split('|')) {
          const mm = new RegExp(String.raw`\b${key}\s*:\s*(\[\]string\s*\{[^}]{0,600}\}|\[[^\]]{0,600}\]|["'\`][^"'\`\n]{1,200}["'\`]|[A-Za-z_][\w.]{0,80})`).exec(body);
          if (!mm) continue;
          const at = pos + body.indexOf(mm[1]);
          const rest = body.slice(mm.index + mm[0].length, mm.index + mm[0].length + 200);
          if (!/^\[/.test(mm[1]) && continued(rest)) { dynamic(at, `${mm[1]}${rest.split(/[,}\n]/)[0]}`.trim()); break; }
          if (/^\[|^\[\]string/.test(mm[1])) keyList(mm[1], at, dir, id);
          else if (/^["'`]/.test(mm[1])) for (const s of stringsIn(mm[1])) put(dir, s, at + mm[1].indexOf(s), id);
          else fromArg({ kind: 'expr', text: mm[1], start: at }, dir, id);
          break;
        }
      } else if (how.startsWith('kw:')) {
        const body = callText(code, pos);
        let found = false;
        for (const key of how.slice(3).split('|')) {
          const mm = new RegExp(String.raw`\b${key}\s*[=:]\s*(?:["']([^"'\n]{0,200})["']|([A-Za-z_][\w.]{0,80}))`).exec(body);
          if (!mm) continue;
          found = true;
          if (mm[1] === '') continue; // default exchange '' → the routing key names the queue
          const at = pos + mm.index + mm[0].length - (mm[1] ?? mm[2]).length - (mm[1] !== undefined ? 1 : 0);
          const rest = body.slice(mm.index + mm[0].length, mm.index + mm[0].length + 200);
          if (continued(rest)) { dynamic(at, `${mm[0].replace(/^[^=:]*[=:]\s*/, '')}${rest.split(/[,)\n]/)[0]}`.trim()); if (how.startsWith('kw:exchange') && dir === 'provides') continue; break; }
          if (mm[1] !== undefined) put(dir, mm[1], at, id); else fromArg({ kind: 'expr', text: mm[2], start: at }, dir, id);
          if (how.startsWith('kw:exchange') && dir === 'provides') continue;
          break;
        }
        if (!found) fromArg(argAt(code, pos, lang), dir, id);
      } else if (how === 'ann') {
        const body = m[1] ?? callText(code, pos);
        const base = m[1] !== undefined ? m.index + m[0].indexOf(m[1]) : pos;
        const named = /\b(topics|queues|topicPattern|value|queueNames)\s*=\s*(\{[^}]{0,600}\}|\[[^\]]{0,600}\]|arrayOf\([^)]{0,600}\)|"[^"\n]{0,300}")/.exec(body);
        const lead = /^\s*(\{[^}]{0,600}\}|"[^"\n]{0,300}")/.exec(body);
        const cut = named || lead;
        const cutDynamic = !!cut && /^"/.test(cut[cut.length - 1]) && continued(body.slice(cut.index + cut[0].length));
        if (cutDynamic) dynamic(base + cut.index, `${cut[cut.length - 1]}${body.slice(cut.index + cut[0].length).split(/[,)\n]/)[0]}`.trim());
        const src = cutDynamic ? '' : named ? named[2] : lead ? lead[1] : '';
        if (/^[[{]|^arrayOf/.test(src)) keyList(src, base + body.indexOf(src), dir, id);
        else for (const s of stringsIn(src)) put(dir, s, base + body.indexOf(s), id);
        for (const q of body.matchAll(/@(?:Queue|Exchange)\s*\(\s*(?:(?:value|name)\s*=\s*)?"([^"\n]{1,200})"/g)) {
          if (continued(body.slice(q.index + q[0].length))) dynamic(base + q.index, `"${q[1]}"${body.slice(q.index + q[0].length).split(/[,)\n]/)[0]}`.trim());
          else put(dir, q[1], base + q.index + q[0].indexOf(q[1]), id);
        }
        if (!cutDynamic && !/^[[{]|^arrayOf/.test(src) && !stringsIn(src).length && !/@(?:Queue|Exchange)\s*\(/.test(body)) {
          const ref = /\b(?:topics|queues|value)\s*=\s*([A-Za-z_][\w.]{0,80})/.exec(body);
          if (ref && continued(body.slice(ref.index + ref[0].length))) dynamic(base + ref.index, body.slice(ref.index + ref[0].length - ref[1].length).split(/[,)\n]/)[0].trim());
          else if (ref) fromArg({ kind: 'expr', text: ref[1], start: base + ref.index }, dir, id);
        }
      } else if (how === 'rabbit') {
        // by POSITION: (exchange, routingKey, message…) from three arguments on, (routingKey, message) with two — never the
        // literals compacted (`convertAndSend(EXCHANGE, "rk", o)` is no default-exchange queue "rk", and the Spring guide's
        // payload "Hello from RabbitMQ!" no routing key); `publish(exchange, '', buf)` is a fanout exchange. The key is a
        // literal or a BARE same-file constant, never a qualified name (`Keys.ROUTING_KEY` is not this file's ROUTING_KEY).
        const as = literalArgs(code, pos, lang, 3);
        const lit = (a) => a?.kind === 'literal';
        const [ex, rk] = as.length >= 3 ? as : [null, as.length === 2 ? as[0] : null];
        if (lit(ex) && ex.value === '') { if (lit(rk)) put(dir, rk.value, rk.start, id); else fromArg(rk, dir, id); } else if (ex) {
          if (lit(ex)) put(dir, ex.value, ex.start, `${id} exchange`); else fromArg(ex, dir, `${id} exchange`);
          const key = lit(rk) ? rk.value : rk?.kind === 'expr' && /^[A-Za-z_]\w{0,80}$/.test(rk.text) ? constOf(rk.text, rk.start) : null;
          if (key) put(dir, key, rk.start, `${id} routing key`, 'heuristic');
        } else fromArg(rk, dir, id);
      } else if (how === 'amqp-bind') {
        const as = literalArgs(code, pos, lang, 3);
        if (as[1]?.kind === 'literal') put(dir, as[1].value, as[1].start, `${id} exchange`);
        else if (as[1]) fromArg(as[1], dir, id);
      } else if (how === 'sqs' || how === 'sns') {
        const body = callText(code, pos);
        const key = how === 'sqs' ? 'QueueUrl' : 'TopicArn';
        // Go SDK: QueueUrl: aws.String("…") / &queueURL
        const mm = new RegExp(String.raw`\b${key}\s*[:=]\s*(?:aws\.String\(\s*|&)?(?:[fFrR$]?["'\`]([^"'\`\n]{1,300})["'\`]|([A-Za-z_][\w.]{0,80}))`).exec(body);
        if (!mm) continue;
        const at = pos + mm.index + mm[0].length - (mm[1] ?? mm[2]).length - (mm[1] !== undefined ? 1 : 0);
        const last = (v) => (how === 'sqs' ? v.split('/').pop() : v.split(':').pop());
        const rest = body.slice(mm.index + mm[0].length, mm.index + mm[0].length + 300);
        const tailLit = /^\s*\+\s*["'`]([^"'`\n$]{1,300})["'`]\s*(?:\)\s*)?(?:[,}\n]|$)/.exec(rest);
        // the tail names the queue / topic only when it starts a new segment: a separator up front ('/orders',
        // ':events') or a same-file head constant ending in one — a suffix (`QUEUE_URL + '-dlq'`, `+ '.fifo'`) is dynamic
        const sep = how === 'sqs' ? '/' : ':';
        const head = mm[1] ?? constOf(mm[2], at) ?? '';
        // an f-string / C# $"" / str.format placeholder (`{queue_name}`, `{TOPIC_ARN}-dlq`) is no name: SQS / SNS names hold no braces
        const named = (v) => !!v && !/[{}]/.test(v);
        if (tailLit && named(last(tailLit[1])) && (tailLit[1].startsWith(sep) || head.endsWith(sep))) { put(dir, last(tailLit[1]), at, id, 'heuristic'); continue; }
        if (continued(rest)) { dynamic(at, `${mm[1] ?? mm[2]}${rest.split(/[,}\n]/)[0]}`.trim()); continue; }
        if (mm[1] !== undefined) {
          const name = last(mm[1]);
          if (named(name)) put(dir, name, at, id); else dynamic(at, mm[1]);
        } else {
          // a same-file constant holds the whole URL / ARN: key on its last segment like a literal
          const c = constOf(mm[2], at);
          if (c && named(last(c))) put(dir, last(c), at, id, 'heuristic'); else dynamic(at, mm[2]);
        }
      } else if (how === 'gcp-topic') {
        const a = argAt(code, pos, lang);
        if (a?.kind !== 'literal') continue;
        const after = code.slice(a.start + a.value.length + 1, a.start + a.value.length + 300);
        const topicDir = /^\s*\)\s*\.(?:subscription|createSubscription|Subscription|onPublish)\s*\(/.test(after) ? 'consumes' : dir;
        put(topicDir, a.value, a.start, id);
      }
    }
  }
  return { facts: firstPerKey(facts), unresolved: fileUnresolved(st, rel, unresolved) };
}

export default Object.freeze({ id: 'messaging', claims: isSource, detect });
