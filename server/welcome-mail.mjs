import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

const MAX_ATTEMPTS = 5;
const LEASE_MS = 90_000;
const clean = (value) => typeof value === "string" ? value.trim() : "";
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const email = (value) => typeof value === "string" && value.length <= 254 &&
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value);
const html = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

function address(value) {
  const source = clean(value);
  if (!source || source.length > 340 || /[\r\n]/.test(source)) return null;
  if (email(source)) return { formatted: source, email: source.toLowerCase() };
  const match = /^([^<>]{1,80})\s*<([^<>]+)>$/.exec(source);
  return match && email(match[2])
    ? { formatted: source, email: match[2].toLowerCase() } : null;
}

function originOf(value, production) {
  try {
    const url = new URL(value);
    const local = !production && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!local && url.protocol !== "https:") || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) return "";
    return url.origin;
  } catch { return ""; }
}

export function mailConfigFromEnv(env = process.env) {
  return {
    provider: clean(env.EMAIL_PROVIDER).toLowerCase(),
    from: clean(env.EMAIL_FROM), replyTo: clean(env.EMAIL_REPLY_TO || env.CONTACT_EMAIL),
    publicOrigin: clean(env.EMAIL_PUBLIC_ORIGIN || env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL),
    smtpHost: clean(env.SMTP_HOST), smtpPort: clean(env.SMTP_PORT) || "587",
    smtpUser: clean(env.SMTP_USER), smtpPassword: env.SMTP_PASSWORD || "",
    resendApiKey: clean(env.RESEND_API_KEY), production: env.NODE_ENV === "production",
  };
}

export class WelcomeMailError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** A durable transactional queue, not a marketing list or an inbox-delivery receipt. */
export function createWelcomeMailer({
  db, HttpError = WelcomeMailError, config = mailConfigFromEnv(),
  transport, fetchImpl = globalThis.fetch, now = () => Date.now(),
} = {}) {
  if (!db) throw new TypeError("A SQLite database is required.");
  const provider = clean(config.provider).toLowerCase() || (clean(config.resendApiKey) ? "resend" : "smtp");
  const sender = address(config.from);
  const replyTo = clean(config.replyTo) ? address(config.replyTo) : null;
  const publicOrigin = originOf(config.publicOrigin, config.production === true);
  const smtpPort = Number(config.smtpPort || 587);
  const smtpHost = clean(config.smtpHost);
  const smtpUser = clean(config.smtpUser);
  const smtpPassword = typeof config.smtpPassword === "string" ? config.smtpPassword : "";
  const resendApiKey = clean(config.resendApiKey);
  const missingSetup = [
    ...(!["smtp", "resend"].includes(provider) ? ["EMAIL_PROVIDER"] : []),
    ...(!sender ? ["EMAIL_FROM"] : []),
    ...(!publicOrigin ? ["EMAIL_PUBLIC_ORIGIN"] : []),
    ...(clean(config.replyTo) && !replyTo ? ["EMAIL_REPLY_TO"] : []),
    ...(provider === "smtp" ? [
      ...(!/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(smtpHost) ? ["SMTP_HOST"] : []),
      ...(![465, 587, 2525].includes(smtpPort) ? ["SMTP_PORT"] : []),
      ...(!smtpUser || smtpUser.length > 254 || /[\r\n]/.test(smtpUser) ? ["SMTP_USER"] : []),
      ...(!smtpPassword || smtpPassword.length > 4096 ? ["SMTP_PASSWORD"] : []),
    ] : []),
    ...(provider === "resend" && (!resendApiKey || resendApiKey.length > 4096) ? ["RESEND_API_KEY"] : []),
  ];
  const configured = missingSetup.length === 0;
  let smtpTransport = transport || null;
  let timer = null, kickoff = null, active = null, closed = false;

  db.exec(`
    CREATE TABLE IF NOT EXISTS member_welcome_outbox (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('pending','sending','sent','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      next_attempt_at INTEGER NOT NULL,
      lease_until INTEGER,
      lease_token TEXT,
      sent_at TEXT,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS welcome_outbox_due ON member_welcome_outbox(status,next_attempt_at);
  `);
  const memberById = db.prepare("SELECT id,name,email FROM members WHERE id=?");
  const jobByMember = db.prepare("SELECT * FROM member_welcome_outbox WHERE member_id=?");
  const stamp = () => new Date(now()).toISOString();

  function configStatus() {
    return { provider, configured, missingSetup: [...missingSetup],
      automatedWelcomeEnabled: configured, deliveryConfirmation: "provider_acceptance" };
  }
  function status(memberId) {
    const job = jobByMember.get(memberId);
    return {
      status: job?.status || "not_queued", configured,
      attempts: job?.attempts || 0, sentAt: job?.sent_at || null,
      nextAttemptAt: job && ["pending", "sending"].includes(job.status)
        ? new Date(job.status === "sending" ? job.lease_until : job.next_attempt_at).toISOString() : null,
      lastError: job?.last_error || null,
    };
  }
  function schedule() {
    if (closed || timer === null || kickoff !== null) return;
    kickoff = setTimeout(() => {
      kickoff = null;
      void processDue().catch(() => { /* No recipient, provider response or secret is logged. */ });
    }, 0);
    kickoff.unref();
  }
  function enqueue(memberId) {
    if (!memberById.get(memberId)) throw new HttpError(404, "Member not found.");
    db.prepare(`INSERT INTO member_welcome_outbox
      (id,member_id,status,created_at,next_attempt_at) VALUES (?,?,'pending',?,?)
      ON CONFLICT(member_id) DO NOTHING`).run(randomUUID(), memberId, stamp(), now());
    // The timer cannot run until the caller's synchronous signup transaction completes.
    schedule();
    return status(memberId);
  }
  function retry(memberId) {
    if (!configured) throw new HttpError(503, "Configure the welcome-email sender before retrying delivery.");
    const job = jobByMember.get(memberId);
    if (!job) throw new HttpError(404, "No welcome email was queued for this account.");
    if (job.status !== "failed") throw new HttpError(409, "Only a failed welcome email can be retried.");
    db.prepare("UPDATE member_welcome_outbox SET status='pending',attempts=0,next_attempt_at=?,lease_until=NULL,lease_token=NULL,last_error=NULL WHERE id=? AND status='failed'")
      .run(now(), job.id);
    schedule();
    return status(memberId);
  }
  function claim() {
    db.exec("BEGIN IMMEDIATE");
    try {
      // A process restart recovers only expired leases, not work another process owns.
      db.prepare("UPDATE member_welcome_outbox SET status=CASE WHEN attempts>=? THEN 'failed' ELSE 'pending' END,lease_until=NULL,lease_token=NULL,last_error='delivery_unconfirmed' WHERE status='sending' AND lease_until<=?")
        .run(MAX_ATTEMPTS, now());
      const job = db.prepare("SELECT * FROM member_welcome_outbox WHERE status='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,created_at,id LIMIT 1").get(now());
      if (!job) { db.exec("COMMIT"); return null; }
      const token = randomUUID();
      db.prepare("UPDATE member_welcome_outbox SET status='sending',attempts=attempts+1,lease_until=?,lease_token=? WHERE id=? AND status='pending'")
        .run(now() + LEASE_MS, token, job.id);
      db.exec("COMMIT");
      return { ...job, attempts: job.attempts + 1, lease_token: token };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function messageFor(job, member) {
    const firstName = clean(member.name).replace(/[\u0000-\u001f\u007f]/g, "").split(/\s+/)[0].slice(0, 40);
    const greeting = firstName ? `Hi ${firstName},` : "Hello,";
    const accountUrl = `${publicOrigin}/account`;
    const supportUrl = `${publicOrigin}/contact`;
    const text = `${greeting}\n\nWelcome to Loud + Cana. Your account has been created.\n\nCheck your account for the current verification status and complete any required private ID and selfie review. Creating an account or uploading images does not by itself verify your identity or approve an order.\n\nContinue your application and manage your account:\n${accountUrl}\n\nIf you did not create this account or need help, contact the store:\n${supportUrl}\n\nThis is an account-service message, not a marketing subscription.`;
    const body = `<div style="background:#080b05;color:#f7f9f0;padding:32px;font-family:Arial,sans-serif;max-width:600px;margin:auto"><p style="font-weight:bold;letter-spacing:2px">LOUD <span style="color:#d4ff00">+ CANA</span></p><h1 style="font-size:28px">Welcome to your account.</h1><p>${html(greeting)}</p><p>Your account has been created. Check your account for the current verification status and complete any required private ID and selfie review.</p><p>Creating an account or uploading images does not by itself verify your identity or approve an order.</p><p style="margin:28px 0"><a href="${html(accountUrl)}" style="background:#d4ff00;color:#080b05;padding:14px 22px;text-decoration:none;font-weight:bold">Open your account</a></p><p>If you did not create this account or need help, <a href="${html(supportUrl)}" style="color:#d4ff00">contact the store</a>.</p><p style="font-size:12px;color:#bbc3ad">This is an account-service message, not a marketing subscription.</p></div>`;
    return {
      from: sender.formatted, to: member.email,
      ...(replyTo ? { replyTo: replyTo.formatted } : {}),
      subject: "Welcome to Loud + Cana", text, html: body,
      messageId: `<welcome.${job.id}@${sender.email.split("@")[1]}>`,
      envelope: { from: sender.email, to: [member.email] },
    };
  }
  function getTransport() {
    if (!smtpTransport) smtpTransport = nodemailer.createTransport({
      host: smtpHost, port: smtpPort, secure: smtpPort === 465,
      ...(smtpPort === 465 ? {} : { requireTLS: true }),
      auth: { user: smtpUser, pass: smtpPassword },
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
    });
    return smtpTransport;
  }
  function deliveryError(code, permanent = false) {
    const error = new Error("Welcome email delivery was not accepted.");
    error.safeCode = code; error.permanent = permanent; return error;
  }
  async function deliver(job, member) {
    if (!email(member.email)) throw deliveryError("recipient_invalid", true);
    const message = messageFor(job, member);
    if (provider === "smtp") {
      const result = await getTransport().sendMail(message);
      const accepted = Array.isArray(result?.accepted) && result.accepted.some((item) =>
        clean(typeof item === "string" ? item : item?.address).toLowerCase() === member.email.toLowerCase());
      if (!accepted) throw deliveryError("provider_rejected", true);
      return;
    }
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(25_000),
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": `welcome/${job.id}` },
      body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject,
        text: message.text, html: message.html, ...(replyTo ? { reply_to: message.replyTo } : {}) }),
    });
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => {});
      throw deliveryError(response.status === 429 ? "provider_rate_limited" : "provider_rejected",
        response.status >= 400 && response.status < 500 && response.status !== 429);
    }
    const reader = response.body?.getReader();
    if (!reader) throw deliveryError("delivery_unconfirmed");
    let bytes = 0; const chunks = [];
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length;
      if (bytes > 16_384) { await reader.cancel(); throw deliveryError("delivery_unconfirmed"); }
      chunks.push(part.value);
    }
    let result;
    try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw deliveryError("delivery_unconfirmed"); }
    if (!record(result) || typeof result.id !== "string" || !result.id.length)
      throw deliveryError("delivery_unconfirmed");
  }
  async function runBatch() {
    if (!configured || closed) return { processed: 0, configured };
    let processed = 0;
    while (!closed && processed < 10) {
      const job = claim(); if (!job) break;
      const member = memberById.get(job.member_id);
      if (!member) continue; // Foreign-key cascade normally removed this job already.
      try {
        await deliver(job, member);
        if (closed) break;
        db.prepare("UPDATE member_welcome_outbox SET status='sent',sent_at=?,lease_until=NULL,lease_token=NULL,last_error=NULL WHERE id=? AND lease_token=? AND status='sending'")
          .run(stamp(), job.id, job.lease_token);
      } catch (error) {
        if (closed) break;
        const permanent = error.permanent === true || (Number(error.responseCode) >= 500 && Number(error.responseCode) < 600);
        const exhausted = permanent || job.attempts >= MAX_ATTEMPTS;
        const delay = Math.min(6 * 60 * 60 * 1000, 60_000 * 2 ** (job.attempts - 1));
        db.prepare("UPDATE member_welcome_outbox SET status=?,next_attempt_at=?,lease_until=NULL,lease_token=NULL,last_error=? WHERE id=? AND lease_token=? AND status='sending'")
          .run(exhausted ? "failed" : "pending", now() + delay,
            ["recipient_invalid", "provider_rejected", "provider_rate_limited", "delivery_unconfirmed"].includes(error.safeCode)
              ? error.safeCode : "provider_unavailable", job.id, job.lease_token);
      }
      processed += 1;
    }
    return { processed, configured };
  }
  async function processDue() {
    if (active) return active;
    active = runBatch();
    try { return await active; } finally { active = null; }
  }
  function start() {
    if (closed || timer !== null) return;
    timer = setInterval(() => { void processDue().catch(() => {}); }, 15_000);
    timer.unref(); schedule();
  }
  function close() {
    closed = true;
    if (timer !== null) clearInterval(timer);
    if (kickoff !== null) clearTimeout(kickoff);
    timer = null; kickoff = null;
    if (typeof smtpTransport?.close === "function") smtpTransport.close();
  }
  return { enqueue, status, configStatus, retry, start, close, processDue };
}
