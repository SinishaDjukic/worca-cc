import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/messaging.mjs';

const FILES = {
  'java/OrderEvents.java': `public class OrderEvents {
    private static final String PAID = "invoice.paid";
    @KafkaListener(topics = {"order.placed", "order.amended"}, groupId = "billing")
    public void onOrder(String m) {}
    @KafkaListener(topics = "\${app.refunds.topic}")
    public void onRefund(String m) {}
    void emit() { kafkaTemplate.send(PAID, key, value); }
    void emit2() { producer.send(new ProducerRecord<>("audit.log", k, v)); }
    @RabbitListener(queues = "email.send")
    public void onEmail(String m) {}
    void notify() { rabbitTemplate.convertAndSend("notifications", "sms.send", msg); }
    @SqsListener("shipments-queue")
    public void onShip(String m) {}
}
`,
  'js/kafka.js': `import Redis from 'ioredis';
await producer.send({ topic: 'user.created', messages: [{ value }] });
await consumer.subscribe({ topics: ['cart.updated', 'cart.cleared'], fromBeginning: true });
await consumer.subscribe({ topic: someVar });
ch.sendToQueue('jobs', Buffer.from(x));
channel.publish('events', 'order.shipped', payload);
channel.consume('jobs', onJob);
channel.bindQueue(q.queue, 'events', 'order.*');
await sqs.send(new SendMessageCommand({ QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/invoices', MessageBody }));
await client.send(new ReceiveMessageCommand({ QueueUrl: process.env.QUEUE_URL }));
await sns.send(new PublishCommand({ TopicArn: 'arn:aws:sns:eu-west-1:123456789012:order-events', Message }));
await client.publish({ TopicArn: 'arn:aws:sns:eu-west-1:123456789012:billing-alerts', Message });
nc.publish('metrics.cpu', data);
nc.subscribe('metrics.>');
redis.publish('chat:room1', msg);
sub.psubscribe('chat:*');
pubsub.topic('billing-events').publishMessage({ data });
pubsub.subscription('billing-events-sub').on('message', h);
pubsub.topic('audit').createSubscription('audit-sub');
res.send({ topic: 'General', posts });
`,
  // CRLF (Windows checkout): same keys, lines and evidence
  'py/workers.py': `import redis
from kafka import KafkaConsumer, KafkaProducer
consumer = KafkaConsumer('payments', 'refunds', bootstrap_servers='kafka:9092')
producer.send('payments.done', b'x')
p.produce('ledger', value=b'x')
c.subscribe(['inventory'])
channel.basic_publish(exchange='', routing_key='task_queue', body=b'x')
channel.basic_publish(exchange='logs', routing_key='', body=b'x')
channel.basic_consume(queue='task_queue', on_message_callback=cb)
r.publish('alerts', 'x')
p = r.pubsub(); p.subscribe('alerts', 'news')
topic_path = publisher.topic_path(project_id, 'orders-topic')
sqs.send_message(QueueUrl='https://sqs.us-east-1.amazonaws.com/1/emails', MessageBody='x')
`.replace(/\n/g, '\r\n'),
  'go/bus.go': `func run() {
    msg := &sarama.ProducerMessage{Topic: "clicks", Value: v}
    w := &kafka.Writer{Addr: kafka.TCP("k:9092"), Topic: "views"}
    r := kafka.NewReader(kafka.ReaderConfig{Brokers: b, Topic: "views", GroupID: "g"})
    c.SubscribeTopics([]string{"logins", "logouts"}, nil)
    rdb.Publish(ctx, "presence", "online")
    sub := rdb.Subscribe(ctx, "presence")
    nc.QueueSubscribe("orders.*", "workers", h)
    t := client.Topic("gcp-orders")
}
`,
  'cs/Bus.cs': `await producer.ProduceAsync("telemetry", new Message<string, string> { Value = v });
consumer.Subscribe("telemetry");
channel.BasicPublish(exchange: "", routingKey: "hello", body: body);
channel.BasicConsume(queue: "hello", autoAck: true, consumer: c);
`,
  'test/bus.test.js': "nc.publish('test.subject', data);\nnc.publish(subjectVar, data);\n",
  'nest/orders.controller.ts': `import { Controller, Inject } from '@nestjs/common';
import { ClientProxy, EventPattern, MessagePattern } from '@nestjs/microservices';
@Controller()
export class OrdersController {
  constructor(@Inject('BILLING') private readonly client: ClientProxy) {}
  @EventPattern('order.created')
  handle(data) {}
  @MessagePattern({ cmd: 'sum' })
  sum(data) {}
  place() { this.client.emit('order.placed', { id: 1 }); return this.client.send('billing.charge', { id: 1 }); }
}
`,
  'js/dup.js': "import Redis from 'ioredis';\nredis.publish('dup.topic', 1);\nredis.publish('dup.topic', 2);\n",
  'web/socket.js': "socketClient.emit('typing', msg);\nsocketClient.send('hello');\n",
  'js/aws.js': "const QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/123456789012/refunds';\nconst TOPIC_ARN = 'arn:aws:sns:eu-west-1:123456789012:refund-events';\nawait sqs.send(new SendMessageCommand({ QueueUrl: QUEUE_URL, MessageBody }));\nawait sns.send(new PublishCommand({ TopicArn: TOPIC_ARN, Message }));\n",
  'go/sqs.go': 'func send() {\n    client.SendMessage(ctx, &sqs.SendMessageInput{QueueUrl: aws.String("https://sqs.us-east-1.amazonaws.com/1/go-orders"), MessageBody: aws.String(b)})\n}\n',
  'java/Worker.java': 'class Worker {\n    private static final String TOPIC = "ledger.v1";\n    void run() {\n        consumer.subscribe(Arrays.asList("payments.v1", "refunds.v1"));\n        kafkaConsumer.subscribe(Collections.singletonList(TOPIC));\n    }\n}\n',
  'java/Spel.java': 'class Spel {\n    @RabbitListener(queues = "#{autoDeleteQueue1.name}")\n    public void a(String m) {}\n    @KafkaListener(topics = {Topics.ORDERS})\n    public void b(String m) {}\n}\n',
  'functions/index.js': "exports.onOrder = functions.pubsub.topic('orders-fn').onPublish((m) => {});\nexports.onPay = onMessagePublished('payments-fn', (e) => {});\n",
  'js/consts.js': "const TOPIC = 'orders.created';\nawait consumer.subscribe({ topics: [TOPIC] });\n",
  'web/chat.js': "client.subscribe({ query: ON_MESSAGE, variables: { topic: 'general' } });\n",
  // a template's `${env}` and a nested call's argument are no list constants, even when a same-file literal names them
  'js/tpl.js': "const env = 'prod';\nawait producer.send({ topic: `${env}.orders`, messages });\nawait consumer.subscribe({ topics: [`${env}.payments`, topicFor(env)] });\n",
  'py/fstr.py': "PREFIX = 'acme'\nc.subscribe([f'{PREFIX}.orders'])\n",
  'js/prefix.js': "const TOPIC_PREFIX = 'acme.';\nconst SQS_BASE = 'https://sqs.eu-west-1.amazonaws.com/123456789012';\nconst ARN = 'arn:aws:sns:eu-west-1:123456789012';\nawait producer.send({ topic: TOPIC_PREFIX + 'orders', messages });\nawait consumer.subscribe({ topic: 'payments.' + env });\nawait sqs.send(new SendMessageCommand({ QueueUrl: SQS_BASE + '/orders', MessageBody }));\nawait sqs.send(new ReceiveMessageCommand({ QueueUrl: SQS_BASE + '/' + name }));\nawait sns.send(new PublishCommand({ TopicArn: ARN + ':order-events', Message }));\n",
  'java/Prefix.java': 'class Prefix {\n    static final String PREFIX = "acme";\n    @KafkaListener(topics = PREFIX + ".orders")\n    public void a(String m) {}\n    @KafkaListener(topics = "orders." + SUFFIX, groupId = "g")\n    public void b(String m) {}\n}\n',
  'go/prefix.go': 'const prefix = "acme"\nfunc emit() {\n    msg := &sarama.ProducerMessage{Topic: prefix + ".clicks", Value: v}\n}\n',
  'py/prefix.py': "PREFIX = 'acme'\nchannel.basic_publish(exchange=PREFIX + '.events', routing_key='', body=b'x')\n",
  'py/kconst.py': "TOPIC = 'payments.v2'\nconsumer = KafkaConsumer(TOPIC, bootstrap_servers='kafka:9092')\nother = KafkaConsumer(topic_name, group_id='g')\n",
  'js/suffix.js': "const SQS_ROOT = 'https://sqs.eu-west-1.amazonaws.com/123456789012/';\nawait sqs.send(new SendMessageCommand({ QueueUrl: QUEUE_URL + '-dlq', MessageBody }));\nawait sqs.send(new SendMessageCommand({ QueueUrl: SQS_ROOT + 'refunds', MessageBody }));\nawait sns.send(new PublishCommand({ TopicArn: TOPIC_ARN + '.fifo', Message }));\n",
  'js/listcat.js': "const TOPIC_PREFIX = 'acme.';\nawait consumer.subscribe({ topics: [TOPIC_PREFIX + 'orders', 'audit'] });\n",
  'py/listcat.py': "c.subscribe([PREFIX + 'orders', 'plain'])\n",
  'go/listcat.go': "func f() {\n    c.SubscribeTopics([]string{prefix + \"orders\", \"clicks\"}, nil)\n    r := kafka.NewReader(kafka.ReaderConfig{Brokers: b, GroupTopics: []string{\"views\", \"carts\"}})\n}\n",
  'java/ListCat.java': "class ListCat {\n    @KafkaListener(topics = {PREFIX + \"orders\", \"plain.java\"})\n    public void a(String m) {}\n    @RabbitListener(bindings = @QueueBinding(value = @Queue(value = \"jobs.\" + ENV), exchange = @Exchange(\"jobs-ex\"), key = \"rk\"))\n    public void b(String m) {}\n}\n",
  'src/main/java/OrderService.java': "import org.springframework.amqp.rabbit.core.RabbitTemplate;\n@Service\npublic class OrderService {\n    public void placeOrder(Order order) { rabbitTemplate.convertAndSend(\"notifications\", order); }\n}\n",
  'tools/cli.py': "def emit(v):\n    producer.send(topic='payments', value=v)\n\ndef replay():\n    topic = 'orders-replay'\n    return topic\n\ndef tail(topic):\n    for msg in KafkaConsumer(topic, bootstrap_servers=B):\n        print(msg)\n",
  'kt/Emit.kt': "fun emit(topic: String = \"payments\") {}\nfun tail(topic: String) { kafkaTemplate.send(topic, v) }\n",
  'k/ArrayOf.kt': "const val T = \"orders.kt\"\nclass L {\n    @KafkaListener(topics = arrayOf(T))\n    fun a(m: String) {}\n}\n",
  'app/main.py': "from kafka import KafkaProducer\ndef main():\n    topic = \"orders.local\"\n    producer.send(topic, b\"x\")\n",
  'js/multidecl.js': "const ORDERS = 'orders.a', PAYMENTS = 'payments.a';\nawait producer.send({ topic: PAYMENTS, messages });\n",
  'go/constblock.go': "const (\n    Clicks = \"clicks.a\"\n)\nfunc f() { c.SubscribeTopics([]string{Clicks}, nil) }\n",
  'js/defaults.js': "function sendEvent(\n  payload,\n  topic = 'orders.b',\n) {}\nexport const x = (topic) => producer.send({ topic: topic, messages });\n",
  'py/boto.py': "import boto3\nsqs.send_message(QueueUrl=f\"https://sqs.us-east-1.amazonaws.com/{ACCOUNT}/boto-orders\", MessageBody=\"x\")\n",
  'py/klass.py': "class Topics:\n    ORDERS = 'orders.v3'\nc = KafkaConsumer(Topics.ORDERS)\n",
  'java/Placeholders.java': 'class Placeholders {\n    private static final String orders = "legacy-orders";\n    @KafkaListener(topics = {"${app.topic.orders}"})\n    public void a(String m) {}\n}\n',
  // implementation review cycle 1: interpolation placeholders, Python self./cls. attributes, clashing names, rabbit positions, topic= keyword
  'py/fqueue.py': 'def send(queue_name, b):\n    sqs.send_message(QueueUrl=f"https://sqs.{REGION}.amazonaws.com/{ACCOUNT}/{queue_name}", MessageBody=b)\n    sns.publish(TopicArn=f"{TOPIC_ARN}-dlq", Message=b)\n    sqs.send_message(QueueUrl=f"{QUEUE_BASE}/f-orders", MessageBody=b)\n',
  'cs/FQueue.cs': 'await client.SendMessageAsync(new SendMessageRequest { QueueUrl = $"{_baseUrl}/{queueName}", MessageBody = "x" });\n',
  'py/selfattr.py': 'class OrderProducer:\n    def __init__(self):\n        self.topic = "order.events.self"\n\n    def publish(self, order):\n        self.producer.send(self.topic, order)\n\n\ndef tail(topic):\n    consumer = KafkaConsumer(topic)\n',
  'py/selftwo.py': 'class A:\n    def __init__(self):\n        self.topic = "a.events"\n\n    def go(self):\n        producer.send(self.topic, b"x")\n\n\nclass B:\n    def __init__(self):\n        self.topic = "b.events"\n\n    def go(self):\n        producer.send(self.topic, b"x")\n',
  'py/selfparam.py': 'class P:\n    def __init__(self, topic):\n        self.topic = topic\n\n    def go(self):\n        producer.send(self.topic, b"x")\n',
  'java/RabbitKey.java': 'class RabbitKey {\n    static final String EXCHANGE = "billing.x";\n    static final String ROUTING_KEY = "invoice.paid.rk";\n    void a(Invoice i) { rabbitTemplate.convertAndSend(EXCHANGE, ROUTING_KEY, i); }\n}\n',
  'java/RabbitQual.java': 'class RabbitQual {\n    static final String ROUTING_KEY = "local.rk";\n    void b(Invoice i) { rabbitTemplate.convertAndSend("billing.q", Keys.ROUTING_KEY, i); }\n}\n',
  'py/notattr.py': 'class Fwd:\n    def __init__(self):\n        self.topic = "orders.own"\n\n    def forward(self, msg):\n        producer.send(msg.topic, msg.value)\n\n\nif __name__ == "__main__":\n    topic = "main.t"\n    producer.send(args.topic, b"x")\n',
  'py/twoclass.py':'class Inbound:\n    ORDERS = "orders.in"\n\n\nclass Outbound:\n    ORDERS = "orders.out"\n\n\nproducer.send(Outbound.ORDERS, b"x")\n',
  'js/twofn.js': "async function send() {\n  const queue = 'tasks.a';\n  ch.sendToQueue(queue, buf);\n}\nasync function receive() {\n  const queue = 'results.a';\n  ch.consume(queue, onMsg);\n}\n",
  'java/RabbitPos.java': 'class RabbitPos {\n    static final String EXCHANGE = "shop.orders.x";\n    void a(Order o) { rabbitTemplate.convertAndSend(EXCHANGE, "order.created.rk", o); }\n    void b(Order o) { rabbitTemplate.convertAndSend(Config.EXCHANGE, "order.paid.rk", "Hello from RabbitMQ!"); }\n}\n',
  'js/fanout.js': "var exchange = 'logs.fanout';\nchannel.publish(exchange, '', Buffer.from(msg));\nchannel.publish('', 'work.q', Buffer.from(msg));\n",
  'py/methodlocal.py': 'class Worker:\n    def run(self):\n        queue = "jobs.local"\n        channel.basic_consume(queue=queue, on_message_callback=cb)\n\n\nproducer.send(cfg.queue, b"x")\n',
};

let ws;
let buses;
let r;
before(async () => {
  ws = await makeWorkspace({ app: FILES });
  r = await runDetector(detector, ws.members[0], ws.members);
  // two front ends talking over an in-process event bus: no broker import, so no topics
  buses = await makeWorkspace({ admin: { 'src/auth.js': "bus.publish('logout', {});\n" }, spa: { 'src/session.js': "bus.subscribe('logout', onLogout);\nconst r = cache.publish('x');\n" } });
});
after(async () => { await ws.cleanup(); await buses.cleanup(); });
const rows = (file) => r.facts.filter((f) => f.file === file).map((f) => `${f.dir === 'provides' ? 'P' : 'C'} ${f.key}`).sort();

test('messaging (Spring): @KafkaListener lists, KafkaTemplate with a same-file constant, ProducerRecord, Rabbit listener/template, @SqsListener', () => {
  assert.deepEqual(rows('java/OrderEvents.java'), [
    'C email.send', 'C order.amended', 'C order.placed', 'C shipments-queue', 'P audit.log', 'P invoice.paid', 'P notifications', 'P sms.send',
  ]);
  assert.ok(r.unresolved.some((u) => u.reason === 'config placeholder' && u.raw === '${app.refunds.topic}'));
});

test('messaging (JS): kafkajs, amqplib (publish/consume/bind), SQS/SNS commands, NATS, Redis, GCP Pub/Sub', () => {
  assert.deepEqual(rows('js/kafka.js'), [
    'C audit', 'C billing-events-sub', 'C cart.cleared', 'C cart.updated', 'C chat:*', 'C events', 'C jobs', 'C metrics.>',
    'P billing-alerts', 'P billing-events', 'P chat:room1', 'P events', 'P invoices', 'P jobs', 'P metrics.cpu', 'P order-events', 'P order.shipped', 'P user.created',
  ]);
  assert.ok(!r.facts.some((f) => f.key.startsWith('arn:')), 'an SNS options object is never read as a topic list');
  assert.deepEqual(rows('js/dup.js'), ['P dup.topic'], 'one fact per (dir, key) per file');
  const dyn = r.unresolved.filter((u) => u.file === 'js/kafka.js').map((u) => u.raw);
  assert.ok(dyn.includes('someVar') && dyn.includes('process.env.QUEUE_URL'));
});

test('messaging (Python): kafka-python/confluent, pika default vs named exchange, Redis, GCP topic_path, boto3 SQS', () => {
  assert.deepEqual(rows('py/workers.py'), [
    'C alerts', 'C inventory', 'C news', 'C payments', 'C refunds', 'C task_queue',
    'P alerts', 'P emails', 'P ledger', 'P logs', 'P orders-topic', 'P payments.done', 'P task_queue',
  ]);
});

test('messaging (Go / .NET): sarama, kafka-go writer/reader, confluent SubscribeTopics, go-redis ctx-first, NATS queue groups, Confluent .NET, RabbitMQ.Client', () => {
  assert.deepEqual(rows('go/bus.go'), ['C logins', 'C logouts', 'C orders.*', 'C presence', 'C views', 'P clicks', 'P gcp-orders', 'P presence', 'P views']);
  assert.deepEqual(rows('cs/Bus.cs'), ['C hello', 'C telemetry', 'P hello', 'P telemetry']);
});

test('messaging: generic receivers (bus, r, p, pub, sub, cache, client, conn) count only in a file that imports a broker', async () => {
  for (const m of buses.members) assert.deepEqual((await runDetector(detector, m, buses.members)).facts, [], m.key);
});

test('messaging: NestJS microservices — patterns consume, ClientProxy emit/send provide, only in files that use them', () => {
  assert.deepEqual(rows('nest/orders.controller.ts'), ['C order.created', 'P billing.charge', 'P order.placed']);
  assert.deepEqual(rows('web/socket.js'), [], "socket.io's client.emit is not a message topic");
});

test('messaging: SQS / SNS constants key on the queue / topic name; plain Kafka consumers; Firebase triggers consume; SpEL and constant lists are unresolved, not keys', () => {
  assert.deepEqual(rows('js/aws.js'), ['P refund-events', 'P refunds'], 'a same-file constant holding the URL / ARN keys like its literal');
  assert.deepEqual(rows('go/sqs.go'), ['P go-orders'], 'Go SDK aws.String("…")');
  assert.deepEqual(rows('java/Worker.java'), ['C ledger.v1', 'C payments.v1', 'C refunds.v1']);
  assert.deepEqual(rows('functions/index.js'), ['C orders-fn', 'C payments-fn'], 'a Pub/Sub trigger consumes its topic');
  assert.deepEqual(rows('js/consts.js'), ['C orders.created'], 'a constant inside a topic list');
  assert.deepEqual(rows('java/Spel.java'), []);
  assert.ok(r.unresolved.some((u) => u.file === 'java/Spel.java' && u.reason === 'config placeholder' && u.raw === '#{autoDeleteQueue1.name}'));
  assert.ok(r.unresolved.some((u) => u.file === 'java/Spel.java' && u.raw === 'Topics.ORDERS'));
  assert.deepEqual(rows('web/chat.js'), [], "Apollo's client.subscribe({ variables: { topic } }) is not a Kafka consumer");
});

test('messaging: a list constant resolves only at the top level of the list — never an identifier inside a string or a nested call', () => {
  assert.deepEqual(rows('js/tpl.js'), [], "`${env}.orders` is a placeholder: const env = 'prod' is not the topic");
  assert.deepEqual(r.unresolved.filter((u) => u.file === 'js/tpl.js').map((u) => `${u.reason}: ${u.raw}`).sort(), ['config placeholder: ${env}.orders', 'config placeholder: ${env}.payments', 'dynamic topic: topicFor(env)'], 'a call in a topic list is a dynamic topic, never its argument');
  assert.deepEqual(rows('java/Placeholders.java'), [], '"${app.topic.orders}" never resolves through a constant named orders');
  assert.ok(!r.unresolved.some((u) => u.file === 'py/fstr.py' && u.raw === 'f') && !rows('py/fstr.py').includes('C acme'), "an f-string's prefix and braces are no list constants");
});

test('messaging: a concatenated topic is never keyed by its head; an SQS / SNS base + a literal tail keys the tail', () => {
  assert.deepEqual(rows('js/prefix.js'), ['P order-events', 'P orders'], "TOPIC_PREFIX + 'orders' is not the topic acme., SQS_BASE + '/orders' not the account id");
  assert.deepEqual(rows('java/Prefix.java'), []);
  assert.deepEqual(rows('go/prefix.go'), []);
  assert.deepEqual(rows('py/prefix.py'), []);
  const dyn = r.unresolved.filter((u) => /prefix/i.test(u.file) && u.reason === 'dynamic topic').map((u) => u.raw);
  assert.deepEqual(rows('py/kconst.py'), ['C payments.v2'], 'KafkaConsumer(TOPIC, …) reads a same-file constant');
  assert.ok(r.unresolved.some((u) => u.file === 'py/kconst.py' && u.raw === 'topic_name'));
  assert.ok(dyn.includes("TOPIC_PREFIX + 'orders'") && dyn.includes("'payments.' + env") && dyn.includes("SQS_BASE + '/' + name"), JSON.stringify(dyn));
});

test('messaging: an SQS / SNS tail names the queue only when it starts a segment — a suffix is a dynamic topic', () => {
  assert.deepEqual(rows('js/suffix.js'), ['P refunds'], "QUEUE_URL + '-dlq' is not the queue -dlq; a root ending in '/' + 'refunds' is");
  const dyn = r.unresolved.filter((u) => u.file === 'js/suffix.js').map((u) => u.raw);
  assert.deepEqual(dyn.sort(), ["QUEUE_URL + '-dlq'", "TOPIC_ARN + '.fifo'"]);
});

test('messaging: a topic list is read element by element — a concatenated element is dynamic, never keyed by its pieces; @Queue continuations; convertAndSend alone; GroupTopics; keyword arguments are no constants', () => {
  assert.deepEqual(rows('js/listcat.js'), ['C audit']);
  assert.deepEqual(rows('py/listcat.py'), ['C plain']);
  assert.deepEqual(rows('go/listcat.go'), ['C carts', 'C clicks', 'C views']);
  assert.deepEqual(rows('java/ListCat.java'), ['C jobs-ex', 'C plain.java'], 'the @Exchange beside a continued @Queue still counts');
  const dyn = r.unresolved.filter((u) => /listcat|ListCat/i.test(u.file)).map((u) => u.raw).sort();
  assert.deepEqual(dyn, ['"jobs." + ENV', 'PREFIX + "orders"', "PREFIX + 'orders'", "TOPIC_PREFIX + 'orders'", 'prefix + "orders"']);
  assert.deepEqual(rows('src/main/java/OrderService.java'), ['P notifications'], 'a file whose only broker call is convertAndSend');
  assert.deepEqual(rows('tools/cli.py'), ['P payments'], "neither a keyword argument (topic='payments') nor another function's local is a constant for KafkaConsumer(topic, …) — but send(topic='payments') produces it");
  assert.deepEqual(rows('kt/Emit.kt'), [], 'a default parameter is no constant');
  assert.deepEqual(rows('app/main.py'), ['P orders.local'], "a function's own local");
  assert.deepEqual([rows('js/multidecl.js'), rows('go/constblock.go')], [['P payments.a'], ['C clicks.a']], 'the second name of a multi-declaration; a Go const block');
  assert.deepEqual(rows('js/defaults.js'), [], 'a default parameter on its own line');
  assert.deepEqual(rows('py/boto.py'), ['P boto-orders'], 'QueueUrl=f"…/boto-orders"');
  assert.deepEqual(rows('py/klass.py'), ['C orders.v3'], 'an UPPER_CASE class constant');
  assert.deepEqual([rows('k/ArrayOf.kt'), r.unresolved.filter((u) => u.file === 'k/ArrayOf.kt')], [['C orders.kt'], []], 'arrayOf(T) is a list: its constant, and no dynamic arrayOf');
});

test('messaging: review fixes — placeholders are no queue names; Python attributes; clashing names; rabbit arguments by position', () => {
  assert.deepEqual(rows('py/fqueue.py'), ['P f-orders'], 'f"…/{queue_name}" and f"{TOPIC_ARN}-dlq" are dynamic, never {queue_name}');
  assert.deepEqual(rows('cs/FQueue.cs'), [], 'C# $"…/{queueName}"');
  assert.deepEqual(rows('py/selfattr.py'), ['P order.events.self'], "self.topic set in __init__ — never a bare parameter's");
  assert.deepEqual(rows('py/selftwo.py'), [], 'self.topic bound to two values in two classes: neither');
  assert.deepEqual(rows('py/selfparam.py'), [], 'self.topic = topic (a parameter) is no constant');
  assert.deepEqual(rows('java/RabbitKey.java'), ['P billing.x', 'P invoice.paid.rk'], 'a bare same-file constant names the routing key');
  assert.deepEqual(rows('java/RabbitQual.java'), ['P billing.q'], 'Keys.ROUTING_KEY is never the same-file ROUTING_KEY');
  assert.deepEqual(rows('py/notattr.py'), [], "msg.topic is not self.topic; args.topic is not a __main__ block's local");
  assert.deepEqual(rows('py/twoclass.py'), [], "Outbound.ORDERS is never Inbound's value");
  assert.deepEqual(rows('js/twofn.js'), [], 'one name, two functions, two values: neither');
  assert.deepEqual(rows('java/RabbitPos.java'), ['P order.created.rk', 'P order.paid.rk', 'P shop.orders.x'], 'the exchange constant; the key heuristic; the payload never');
  assert.deepEqual(r.facts.filter((f) => f.file === 'java/RabbitPos.java').map((f) => `${f.key} ${f.confidence}`).sort(), ['order.created.rk heuristic', 'order.paid.rk heuristic', 'shop.orders.x heuristic']);
  assert.deepEqual(rows('js/fanout.js'), ['P logs.fanout', 'P work.q'], "publish(exchange, '', buf): the fanout exchange; publish('', q, buf): the queue");
  assert.equal(r.facts.find((f) => f.key === 'work.q').confidence, 'exact', 'the default exchange names the queue itself');
  assert.deepEqual(rows('py/methodlocal.py'), ['C jobs.local'], "a method's local is no class field: it answers its own bare use, never cfg.queue");
});

test('messaging: test files still emit (marked test) but report no unresolved; every fact cites its line', () => {
  assert.equal(r.facts.find((f) => f.file === 'test/bus.test.js').test, true);
  assert.ok(!r.unresolved.some((u) => u.file === 'test/bus.test.js'));
  assertEvidence(ws.members[0], r);
});
