import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Coins, Gift, LoaderCircle, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { request as memberRequest } from "../lib/api.js";
import { formatMoney } from "../lib/order.js";
import { LEGACY_MEMBERSHIP_NUMBER_PATTERN, MEMBERSHIP_NUMBER_PATTERN, normalizeMembershipNumber } from "../lib/membership.js";
import "../merchandise-rewards.css";

const cents = (value) => Number.isSafeInteger(value) && value >= 0;
const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString("en-ZA", {
    timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric",
  });
};

function validRewards(value) {
  if (!value || !["balanceCents", "eligiblePaidSpendCents", "totalEarnedCents", "totalRedeemedCents", "progressCents"].every((key) => cents(value[key])) ||
      value.nextRewardAtCents !== 100000 || value.rewardCents !== 1000 || value.progressCents >= value.nextRewardAtCents ||
      !Array.isArray(value.history) || value.history.length > 20 || value.history.some((entry) =>
        typeof entry.id !== "string" || !["earned", "redeemed"].includes(entry.type) || !cents(entry.amountCents) ||
        typeof entry.createdAt !== "string" || typeof entry.orderId !== "string"))
    throw new Error("Your merchandise rewards could not be confirmed. Please refresh.");
  return value;
}

function redeemValue(value) {
  const input = value.trim().replace(",", ".");
  if (!input) return 0;
  const match = /^(\d{1,12})(?:\.(\d{0,2}))?$/.exec(input);
  if (!match) return null;
  const total = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return cents(total) ? total : null;
}

export default function MemberMerchandiseRewards({ member }) {
  const [state, setState] = useState({ memberId: "", rewards: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const generation = useRef(0);
  const flight = useRef(null);
  const load = useCallback(async ({ quiet = false } = {}) => {
    const current = ++generation.current;
    flight.current?.abort();
    const controller = new AbortController();
    flight.current = controller;
    if (!quiet) setLoading(true);
    try {
      const data = await memberRequest("/api/members/rewards", { signal: controller.signal });
      const rewards = validRewards(data?.rewards);
      if (controller.signal.aborted || current !== generation.current) return;
      setState({ memberId: member.id, rewards });
      setUpdatedAt(new Date());
      setError("");
    } catch (problem) {
      if (controller.signal.aborted || current !== generation.current) return;
      setState({ memberId: member.id, rewards: null });
      setError(problem.message || "Your rewards are temporarily unavailable. Please try again.");
    } finally {
      if (!controller.signal.aborted && current === generation.current) setLoading(false);
    }
  }, [member.id]);
  useEffect(() => {
    setState({ memberId: "", rewards: null });
    setUpdatedAt(null);
    setError("");
    void load();
    const refresh = () => { if (!document.hidden) void load({ quiet: true }); };
    window.addEventListener("focus", refresh);
    return () => {
      generation.current += 1;
      flight.current?.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  const rewards = state.memberId === member.id ? state.rewards : null;
  const progress = rewards ? Math.min(100, rewards.progressCents / rewards.nextRewardAtCents * 100) : 0;

  return (
    <section className="member-rewards" aria-labelledby="member-rewards-heading">
      <div className="member-rewards-heading">
        <div><span className="eyebrow">A LITTLE SOMETHING BACK</span><h2 id="member-rewards-heading"><Gift size={24} aria-hidden="true" />Merchandise rewards</h2></div>
        <button className="button outline" type="button" onClick={() => load()} disabled={loading}>
          <RefreshCw size={15} className={loading ? "member-spinner" : ""} />Refresh rewards
        </button>
      </div>
      <p className="member-rewards-rule">Earn {formatMoney(1000)} in merchandise credit for every {formatMoney(100000)} of eligible paid merchandise. The store confirms payment before rewards are issued.</p>
      {loading && !rewards && <p className="member-rewards-feedback" role="status"><LoaderCircle size={17} className="member-spinner" />Loading your rewards…</p>}
      {error && <p className="member-rewards-error" role="alert">{error}</p>}
      {rewards && (
        <>
          <div className="member-rewards-summary">
            <div className="member-rewards-balance"><Coins size={23} aria-hidden="true" /><span>Merchandise token balance<strong>{formatMoney(rewards.balanceCents)}</strong></span></div>
            <div className="member-rewards-progress">
              <span>Next {formatMoney(rewards.rewardCents)} reward</span>
              <strong>{formatMoney(rewards.progressCents)} <small>of {formatMoney(rewards.nextRewardAtCents)}</small></strong>
              <div role="progressbar" aria-label="Merchandise reward progress" aria-valuemin={0} aria-valuemax={100000} aria-valuenow={rewards.progressCents}
                aria-valuetext={formatMoney(rewards.progressCents) + " of " + formatMoney(rewards.nextRewardAtCents) + " eligible paid spend"}><span style={{ width: progress + "%" }} /></div>
              <small>{formatMoney(rewards.nextRewardAtCents - rewards.progressCents)} of eligible paid spend to your next reward.</small>
            </div>
          </div>
          <div className="member-rewards-history">
            <h3>Recent rewards</h3>
            {rewards.history.length ? (
              <ol aria-label="Merchandise rewards history">
                {rewards.history.map((entry) => (
                  <li key={entry.id}>
                    <span><strong>{entry.type === "earned" ? "Merchandise credit earned" : "Merchandise credit used"}</strong><small>{dateLabel(entry.createdAt)}</small></span>
                    <strong className={entry.type === "earned" ? "is-earned" : ""}>{entry.type === "earned" ? "+" : "−"}{formatMoney(entry.amountCents)}</strong>
                  </li>
                ))}
              </ol>
            ) : <p>Confirmed rewards will appear here. There is no earlier purchase backfill.</p>}
          </div>
        </>
      )}
      <p className="member-rewards-note"><ShieldCheck size={14} aria-hidden="true" />Credit applies to eligible non-cannabis merchandise only. Ask the store to apply available credit to an eligible merchandise payment.</p>
      {updatedAt && rewards && <small className="member-rewards-updated">Updated {updatedAt.toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" })} SAST</small>}
    </section>
  );
}

/** The report supplies a completed record; the administrator confirms actual payment. */
export function MerchandisePaymentDialog({ orderId, request, onClose, onSaved, onSessionExpired, onForbidden }) {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quoteError, setQuoteError] = useState("");
  const [number, setNumber] = useState("");
  const [member, setMember] = useState(null);
  const [rewards, setRewards] = useState(null);
  const [finding, setFinding] = useState(false);
  const [redeem, setRedeem] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const panel = useRef(null);
  const heading = useRef(null);
  const alive = useRef(true);
  const quoteVersion = useRef(0);
  const memberVersion = useRef(0);
  const quoteController = useRef(null);
  const memberController = useRef(null);
  const paymentController = useRef(null);
  const actions = useRef({ saving, onClose });
  actions.current = { saving, onClose };

  const handleAccessError = useCallback((problem) => {
    if (problem.status === 401) { onSessionExpired?.(); return true; }
    if (problem.status === 403) { onForbidden?.(); return true; }
    return false;
  }, [onForbidden, onSessionExpired]);

  const loadQuote = useCallback(async () => {
    const current = ++quoteVersion.current;
    quoteController.current?.abort();
    const controller = new AbortController();
    quoteController.current = controller;
    setLoading(true); setQuoteError("");
    try {
      const data = await request("/api/admin/rewards/quote?orderId=" + encodeURIComponent(orderId), { signal: controller.signal });
      const result = data?.quote;
      if (!result || result.orderId !== orderId || !cents(result.eligibleMerchandiseCents) || typeof result.paymentRecorded !== "boolean")
        throw new Error("The eligible merchandise amount could not be confirmed.");
      if (!alive.current || controller.signal.aborted || current !== quoteVersion.current) return;
      setQuote(result);
    } catch (problem) {
      if (!alive.current || controller.signal.aborted || current !== quoteVersion.current) return;
      setQuote(null);
      if (!handleAccessError(problem)) setQuoteError(problem.message || "This payment could not be loaded. Please try again.");
    } finally {
      if (alive.current && !controller.signal.aborted && current === quoteVersion.current) setLoading(false);
    }
  }, [handleAccessError, orderId, request]);

  useEffect(() => {
    alive.current = true;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    heading.current?.focus({ preventScroll: true });
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!actions.current.saving) actions.current.onClose();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.current?.querySelectorAll("button:not(:disabled),input:not(:disabled),a[href],[tabindex='0']") || []).filter((node) => node.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); heading.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      alive.current = false;
      quoteVersion.current += 1; memberVersion.current += 1;
      quoteController.current?.abort(); memberController.current?.abort(); paymentController.current?.abort();
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [orderId]);
  useEffect(() => { void loadQuote(); }, [loadQuote]);

  function changeNumber(value) {
    memberVersion.current += 1;
    memberController.current?.abort();
    setNumber(value); setMember(null); setRewards(null); setFinding(false); setRedeem(""); setConfirmed(false); setError("");
  }

  async function findMember(event) {
    event.preventDefault();
    const candidate = normalizeMembershipNumber(number);
    if (!MEMBERSHIP_NUMBER_PATTERN.test(candidate) && !LEGACY_MEMBERSHIP_NUMBER_PATTERN.test(candidate)) {
      setError("Enter a valid membership number, such as LC-123456.");
      return;
    }
    const current = ++memberVersion.current;
    memberController.current?.abort();
    const controller = new AbortController();
    memberController.current = controller;
    setFinding(true); setMember(null); setRewards(null); setConfirmed(false); setError("");
    try {
      const found = await request("/api/admin/members/lookup", {
        method: "POST", body: JSON.stringify({ membershipNumber: candidate }), signal: controller.signal,
      });
      if (!found?.member || typeof found.member.id !== "string" || typeof found.member.name !== "string" ||
          !MEMBERSHIP_NUMBER_PATTERN.test(found.member.membershipNumber)) throw new Error("The member could not be confirmed.");
      const balance = await request("/api/admin/rewards/members/" + encodeURIComponent(found.member.id), { signal: controller.signal });
      const details = validRewards(balance?.rewards);
      if (!alive.current || controller.signal.aborted || current !== memberVersion.current) return;
      setMember(found.member); setRewards(details); setNumber(found.member.membershipNumber);
    } catch (problem) {
      if (!alive.current || controller.signal.aborted || current !== memberVersion.current) return;
      if (!handleAccessError(problem)) setError(problem.message || "The member could not be loaded.");
    } finally {
      if (alive.current && !controller.signal.aborted && current === memberVersion.current) setFinding(false);
    }
  }

  const redeemCents = redeemValue(redeem);
  const redeemLimit = quote && rewards ? Math.min(quote.eligibleMerchandiseCents, rewards.balanceCents) : 0;
  const validRedemption = redeemCents !== null && redeemCents <= redeemLimit;
  const ready = !loading && !saving && !finding && quote && !quote.paymentRecorded && quote.eligibleMerchandiseCents > 0 && member && rewards && validRedemption && confirmed;

  async function recordPayment(event) {
    event.preventDefault();
    if (!ready) return;
    const controller = new AbortController();
    paymentController.current = controller;
    setSaving(true); setError("");
    try {
      const data = await request("/api/admin/rewards/payments", {
        method: "POST",
        body: JSON.stringify({
          orderId, membershipNumber: member.membershipNumber, confirmedPaid: true,
          redeemCents, expectedEligibleMerchandiseCents: quote.eligibleMerchandiseCents,
        }),
        signal: controller.signal,
      });
      if (!alive.current || controller.signal.aborted) return;
      if (!data?.receipt) throw new Error("The payment confirmation was not returned. Refresh this record before retrying.");
      validRewards(data.rewards);
      onSaved(data);
    } catch (problem) {
      if (!alive.current || controller.signal.aborted) return;
      if (handleAccessError(problem)) return;
      setError(problem.message || "The merchandise payment could not be recorded.");
      setConfirmed(false);
      if (problem.status === 409) {
        setMember(null); setRewards(null); setRedeem("");
        await loadQuote();
      }
    } finally {
      if (alive.current && !controller.signal.aborted) setSaving(false);
    }
  }

  return createPortal(
    <div className="merchandise-payment-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="merchandise-payment-dialog" role="dialog" aria-modal="true" aria-labelledby="merchandise-payment-heading" ref={panel}>
        <header>
          <div><span className="staff-eyebrow">ELIGIBLE MERCHANDISE ONLY</span><h2 id="merchandise-payment-heading" tabIndex={-1} ref={heading}>Record merchandise payment</h2></div>
          <button className="staff-icon-button" type="button" aria-label="Close merchandise payment" disabled={saving} onClick={onClose}><X size={20} /></button>
        </header>
        <p className="merchandise-payment-intro">Record {orderId}. Confirm the actual payment and the correct member before issuing merchandise credit. This form does not collect a payment.</p>
        {loading && <p className="merchandise-payment-feedback" role="status"><LoaderCircle size={17} className="staff-spin" />Checking eligible merchandise…</p>}
        {quoteError && <div className="merchandise-payment-error" role="alert"><p>{quoteError}</p><button type="button" className="staff-secondary-button" onClick={loadQuote}>Try again</button></div>}
        {quote && !loading && (
          <>
            <div className="merchandise-payment-amount"><span>Eligible merchandise total</span><strong>{formatMoney(quote.eligibleMerchandiseCents)}</strong><small>After the recorded discount; excludes delivery and ineligible products.</small></div>
            {quote.paymentRecorded ? (
              <p className="merchandise-payment-recorded" role="status"><Check size={18} />This merchandise payment has already been recorded{quote.recordedMemberNumber ? " for " + quote.recordedMemberNumber : ""}.</p>
            ) : quote.eligibleMerchandiseCents > 0 ? (
              <>
                <form className="merchandise-member-search" onSubmit={findMember}>
                  <label htmlFor="payment-membership-number">Membership number</label>
                  <div><input id="payment-membership-number" value={number} maxLength={80} autoComplete="off" spellCheck={false} placeholder="LC-123456" disabled={saving}
                    onChange={(event) => changeNumber(event.target.value)} />
                    <button className="staff-secondary-button" type="submit" disabled={finding || saving}>{finding ? <LoaderCircle size={15} className="staff-spin" /> : <Search size={15} />}Find member</button>
                  </div>
                </form>
                {member && rewards && (
                  <form className="merchandise-payment-form" onSubmit={recordPayment}>
                    <div className="merchandise-payment-member"><strong>{member.name}</strong><span>{member.membershipNumber}</span><small>Available merchandise credit: {formatMoney(rewards.balanceCents)}</small></div>
                    <label htmlFor="payment-redeem">Redeem merchandise credit (R)</label>
                    <input id="payment-redeem" inputMode="decimal" autoComplete="off" placeholder="0.00" value={redeem} disabled={saving} aria-invalid={!validRedemption}
                      onChange={(event) => { setRedeem(event.target.value); setConfirmed(false); setError(""); }} />
                    <small>Use up to {formatMoney(redeemLimit)} of this member's available credit. Leave blank to use none.</small>
                    {!validRedemption && <p className="merchandise-payment-error" role="alert">Enter an amount from {formatMoney(0)} to {formatMoney(redeemLimit)}, using at most two decimal places.</p>}
                    <div className="merchandise-payment-cash"><span>Remaining payment received</span><strong>{formatMoney(quote.eligibleMerchandiseCents - (validRedemption ? redeemCents : 0))}</strong></div>
                    <label className="merchandise-payment-attestation"><input type="checkbox" checked={confirmed} disabled={saving || !validRedemption}
                      onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>Confirm payment received</strong>I confirm that this is the correct member and the remaining merchandise amount has been paid.</span></label>
                    <p className="merchandise-payment-note">Only confirmed paid merchandise earns {formatMoney(1000)} per {formatMoney(100000)} of cumulative eligible spend. Credit used for this payment does not earn more credit.</p>
                    <button className="staff-action-button" type="submit" disabled={!ready}>{saving ? <LoaderCircle size={16} className="staff-spin" /> : <ShieldCheck size={16} />}Record paid merchandise</button>
                  </form>
                )}
              </>
            ) : <p className="merchandise-payment-feedback" role="status">This record has no eligible merchandise amount to confirm.</p>}
          </>
        )}
        {error && <p className="merchandise-payment-error" role="alert">{error}</p>}
        <footer><button className="staff-secondary-button" type="button" onClick={onClose} disabled={saving}>Close</button></footer>
      </section>
    </div>,
    document.body,
  );
}
