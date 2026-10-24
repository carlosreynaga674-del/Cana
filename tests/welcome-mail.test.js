import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWelcomeMailer, mailConfigFromEnv } from "../server/welcome-mail.mjs";

// Local-only, injected transports. These values never authenticate a real mailbox.
const config = {
  provider: "smtp", from: "Loud + Cana <sender@example.test>",
  replyTo: "support@example.test", publicOrigin: "https://store.example.test",
  smtpHost: "smtp.example.test", smtpPort: 587,
  smtpUser: "sender@example.test", smtpPassword: "Local test SMTP credential only",
};

function database(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
      password_hash TEXT DEFAULT 'never-email-this-password-hash',
      birth_date TEXT DEFAULT '2000-01-01'
    );`);
  return db;
}
function fixture(t, options = {}) {
  const db = database();
  const messages = [];
  const transport = { async sendMail(message) { messages.push(message); return { accepted: [message.to] }; } };
  const mailer = createWelcomeMailer({ db, config, transport, ...options });
  t.after(() => { mailer.close(); db.close(); });
  const add = (extra = {}) => {
    const member = { id: randomUUID(), name: "Jordan Adult", email: "jordan@example.test", ...extra };
    db.prepare("INSERT INTO members(id,name,email) VALUES (?,?,?)").run(member.id, member.name, member.email);
    return member;
  };
  return { db, mailer, messages, add };
}

test("new-member welcome jobs are transactional, unique and never backfill existing members", async (t) => {
  const f = fixture(t);
  const historical = f.add();
  assert.equal(f.mailer.status(historical.id).status, "not_queued");
  assert.equal((await f.mailer.processDue()).processed, 0);
  f.db.exec("BEGIN IMMEDIATE");
  const rolledBack = f.add({ email: "rolled-back@example.test" });
  f.mailer.enqueue(rolledBack.id);
  f.db.exec("ROLLBACK");
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM member_welcome_outbox").get().count, 0);
  const current = f.add({ email: "new-member@example.test" });
  f.mailer.enqueue(current.id);
  f.mailer.enqueue(current.id);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM member_welcome_outbox").get().count, 1);
  await f.mailer.processDue();
  assert.equal(f.messages.length, 1);
  assert.equal(f.mailer.status(current.id).status, "sent");
  assert.equal(f.mailer.status(historical.id).status, "not_queued");
  f.mailer.enqueue(current.id);
  await f.mailer.processDue();
  assert.equal(f.messages.length, 1, "Repeated signup notifications must not resend a sent welcome.");
});

test("unconfigured mail remains honestly pending and starts after a configured restart", async (t) => {
  const f = fixture(t, { config: {} });
  const member = f.add(); f.mailer.enqueue(member.id);
  assert.equal(f.mailer.configStatus().configured, false);
  assert.ok(f.mailer.configStatus().missingSetup.includes("EMAIL_FROM"));
  assert.equal((await f.mailer.processDue()).processed, 0);
  assert.equal(f.mailer.status(member.id).status, "pending");
  assert.equal(f.mailer.status(member.id).attempts, 0);
  assert.equal(f.messages.length, 0);
  assert.throws(() => f.mailer.retry(member.id), (error) => error.status === 503);
  f.mailer.close();
  const sent = [];
  const restored = createWelcomeMailer({ db: f.db, config,
    transport: { async sendMail(message) { sent.push(message); return { accepted: [message.to] }; } },
  });
  t.after(() => restored.close());
  await restored.processDue();
  assert.equal(restored.status(member.id).status, "sent");
  assert.equal(sent.length, 1);
});

test("welcome content is account-service only and excludes passwords, dates, documents and unsafe HTML", async (t) => {
  const f = fixture(t);
  const member = f.add({ name: '<img/src=x/onerror="bad"> Adult' });
  f.mailer.enqueue(member.id); await f.mailer.processDue();
  const sent = f.messages[0];
  assert.equal(sent.subject, "Welcome to Loud + Cana");
  assert.equal(sent.to, member.email);
  assert.equal(sent.replyTo, "support@example.test");
  assert.deepEqual(sent.envelope, { from: "sender@example.test", to: [member.email] });
  assert.match(sent.text, /https:\/\/store\.example\.test\/account/);
  assert.match(sent.text, /current verification status/);
  assert.match(sent.text, /not a marketing subscription/);
  assert.ok(!sent.html.includes('<img/src=x/onerror="bad">'));
  assert.match(sent.html, /&lt;img\/src=x\/onerror=/);
  for (const secret of [config.smtpPassword, "never-email-this-password-hash", "2000-01-01"])
    assert.ok(!JSON.stringify(sent).includes(secret));
  assert.equal(Object.hasOwn(sent, "attachments"), false);
  assert.match(sent.messageId, /^<welcome\.[a-f0-9-]+@example\.test>$/);
  assert.ok(!JSON.stringify(f.mailer.configStatus()).includes(config.smtpPassword));
  assert.equal(f.mailer.configStatus().deliveryConfirmation, "provider_acceptance");
});

test("transient failures use bounded backoff, sanitize errors and retry with the same message ID", async (t) => {
  let clock = Date.now(), failing = true;
  const sent = [];
  const f = fixture(t, { now: () => clock, transport: { async sendMail(message) {
    sent.push(message);
    if (failing) throw new Error(`Do not expose ${config.smtpPassword} or recipient ${message.to}`);
    return { accepted: [message.to] };
  } } });
  const member = f.add(); f.mailer.enqueue(member.id);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await f.mailer.processDue();
    assert.equal(result.processed, 1);
    const state = f.mailer.status(member.id);
    assert.equal(state.attempts, attempt);
    assert.equal(state.lastError, "provider_unavailable");
    assert.ok(!JSON.stringify(state).includes(config.smtpPassword));
    if (attempt < 5) {
      assert.equal(state.status, "pending");
      assert.ok(Date.parse(state.nextAttemptAt) > clock);
      assert.equal((await f.mailer.processDue()).processed, 0);
      clock = Date.parse(state.nextAttemptAt);
    }
  }
  assert.equal(f.mailer.status(member.id).status, "failed");
  assert.equal(new Set(sent.map((message) => message.messageId)).size, 1);
  failing = false;
  f.mailer.retry(member.id); await f.mailer.processDue();
  assert.equal(f.mailer.status(member.id).status, "sent");
  assert.throws(() => f.mailer.retry(member.id), (error) => error.status === 409);
  assert.throws(() => f.mailer.retry("historical-account"), (error) => error.status === 404);
});

test("provider rejection never becomes a false sent result", async (t) => {
  const f = fixture(t, { transport: { async sendMail() { return { accepted: [], rejected: ["jordan@example.test"] }; } } });
  const member = f.add(); f.mailer.enqueue(member.id); await f.mailer.processDue();
  const state = f.mailer.status(member.id);
  assert.equal(state.status, "failed");
  assert.equal(state.sentAt, null);
  assert.equal(state.lastError, "provider_rejected");
});

test("member deletion cancels an unsent welcome and removes linked outbox data", async (t) => {
  const f = fixture(t);
  const member = f.add(); f.mailer.enqueue(member.id);
  f.db.prepare("DELETE FROM members WHERE id=?").run(member.id);
  await f.mailer.processDue();
  assert.equal(f.messages.length, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM member_welcome_outbox").get().count, 0);
  assert.equal(f.mailer.status(member.id).status, "not_queued");
});

test("overlapping worker ticks claim one send and close does not access a closed database", async (t) => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  let sends = 0;
  const f = fixture(t, { transport: { async sendMail(message) { sends += 1; await waiting; return { accepted: [message.to] }; } } });
  const member = f.add(); f.mailer.enqueue(member.id);
  const first = f.mailer.processDue(), second = f.mailer.processDue();
  assert.equal(sends, 1);
  f.mailer.close();
  release();
  await Promise.all([first, second]);
  assert.equal(sends, 1);
  assert.equal(f.mailer.status(member.id).status, "sending");
});

test("persistent leases recover after restart without claiming work still owned by a live worker", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "cana-mail-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "mail.sqlite");
  let clock = Date.now();
  const one = database(filename);
  one.prepare("INSERT INTO members(id,name,email) VALUES ('member-one','Jordan Adult','jordan@example.test')").run();
  const first = createWelcomeMailer({ db: one, config, now: () => clock,
    transport: { async sendMail() { throw new Error("This test never processes the first worker"); } },
  });
  first.enqueue("member-one");
  one.prepare("UPDATE member_welcome_outbox SET status='sending',attempts=1,lease_token='old-process',lease_until=?").run(clock + 1000);
  first.close(); one.close();
  const two = database(filename); const messages = [];
  const second = createWelcomeMailer({ db: two, config, now: () => clock,
    transport: { async sendMail(message) { messages.push(message); return { accepted: [message.to] }; } },
  });
  t.after(() => { second.close(); two.close(); });
  assert.equal((await second.processDue()).processed, 0);
  clock += 1001;
  assert.equal((await second.processDue()).processed, 1);
  assert.equal(messages.length, 1);
  assert.equal(second.status("member-one").status, "sent");
});

test("Resend uses authenticated HTTPS, bounded responses and a stable idempotency key", async (t) => {
  let clock = Date.now(), attempt = 0;
  const requests = [];
  const f = fixture(t, { config: { provider: "resend", from: config.from, publicOrigin: config.publicOrigin, resendApiKey: "Local Resend API test key only" },
    now: () => clock, fetchImpl: async (url, options) => {
      requests.push({ url, options }); attempt += 1;
      if (attempt === 1) return new Response("do not store provider details", { status: 429 });
      return new Response(JSON.stringify({ id: "provider-message-id" }), { status: 200 });
    },
  });
  const member = f.add(); f.mailer.enqueue(member.id); await f.mailer.processDue();
  assert.equal(f.mailer.status(member.id).status, "pending");
  assert.equal(f.mailer.status(member.id).lastError, "provider_rate_limited");
  clock = Date.parse(f.mailer.status(member.id).nextAttemptAt);
  await f.mailer.processDue();
  assert.equal(f.mailer.status(member.id).status, "sent");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.resend.com/emails");
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(requests[0].options.headers["Idempotency-Key"], requests[1].options.headers["Idempotency-Key"]);
  assert.equal(requests[0].options.headers.Authorization, "Bearer Local Resend API test key only");
  assert.ok(!JSON.stringify(f.mailer.status(member.id)).includes("Local Resend"));
});

test("invalid sender configuration is rejected without networking and environment secrets remain private", (t) => {
  for (const extra of [
    { from: "bad\r\nBcc: stranger@example.test" }, { publicOrigin: "javascript:alert(1)" },
    { publicOrigin: "http://public.example.test", production: true }, { smtpPort: 25 },
    { smtpHost: "https://smtp.example.test" }, { replyTo: "a@example.test,b@example.test" },
    { provider: "unknown" },
  ]) {
    const f = fixture(t, { config: { ...config, ...extra } });
    assert.equal(f.mailer.configStatus().configured, false);
  }
  const settings = mailConfigFromEnv({
    EMAIL_PROVIDER: "smtp", EMAIL_FROM: config.from, CONTACT_EMAIL: config.replyTo,
    RENDER_EXTERNAL_URL: config.publicOrigin, SMTP_HOST: config.smtpHost, SMTP_PORT: "587",
    SMTP_USER: config.smtpUser, SMTP_PASSWORD: config.smtpPassword, NODE_ENV: "production",
  });
  const f = fixture(t, { config: settings });
  assert.equal(f.mailer.configStatus().configured, true);
  assert.equal(settings.replyTo, config.replyTo);
  assert.equal(settings.publicOrigin, config.publicOrigin);
});
