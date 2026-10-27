import React, { useCallback, useEffect, useRef, useState } from "react";
import { Landmark, LoaderCircle, RefreshCw } from "lucide-react";
import { request } from "../lib/api.js";
import "../checkout-payment-details.css";

const PATH = "/api/members/merchandise-payment-details";
const FIELDS = ["bankName", "accountHolder", "accountNumber", "branchCode", "accountType", "reference"];
const TYPES = { current: "Current / Cheque", savings: "Savings", business: "Business" };

function checkedDetails(data, memberId) {
  if (!data || data.memberId !== memberId || data.scope !== "non_cannabis_merchandise" ||
      typeof data.configured !== "boolean" || !Number.isSafeInteger(data.revision) || data.revision < 1 ||
      (data.updatedAt !== null && (typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt)))))
    throw new Error("The payment details could not be confirmed. Refresh your account and try again.");
  if (!data.configured) {
    if (data.details !== null) throw new Error("The payment details could not be confirmed.");
    return null;
  }
  if (!data.details || FIELDS.some((field) => typeof data.details[field] !== "string") ||
      !data.details.bankName.trim() || !data.details.accountHolder.trim() ||
      !/^\d{6,20}$/.test(data.details.accountNumber) || !/^\d{6}$/.test(data.details.branchCode) ||
      !Object.hasOwn(TYPES, data.details.accountType))
    throw new Error("The payment details could not be confirmed. Please try again.");
  return Object.fromEntries(FIELDS.map((field) => [field, data.details[field]]));
}

/** Read-only EFT details. The parent mounts this only for verified merchandise checkout. */
export default function CheckoutPaymentDetails({ memberId, productIds, busy = false }) {
  const productKey = JSON.stringify([...new Set(productIds)].sort());
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const flight = useRef(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const load = useCallback(async () => {
    const version = ++sequence.current;
    flight.current?.abort();
    const controller = new AbortController();
    flight.current = controller;
    setLoading(true); setError(""); setResult(null);
    try {
      const data = await request(PATH, {
        method: "POST", body: { productIds: JSON.parse(productKey) },
        memberId, signal: controller.signal,
      });
      const details = checkedDetails(data, memberId);
      if (controller.signal.aborted || version !== sequence.current) return;
      setResult({ memberId, productKey, details });
    } catch (problem) {
      if (controller.signal.aborted || version !== sequence.current) return;
      setError(problem.message || "The bank transfer details are unavailable. Please try again.");
    } finally {
      if (!controller.signal.aborted && version === sequence.current) setLoading(false);
    }
  }, [memberId, productKey]);

  useEffect(() => {
    void load();
    const refresh = () => { if (!document.hidden && !busyRef.current) void load(); };
    window.addEventListener("focus", refresh);
    return () => {
      sequence.current += 1;
      flight.current?.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const confirmed = result?.memberId === memberId && result.productKey === productKey ? result : null;
  const details = confirmed?.details;
  return <section className="checkout-payment-details" aria-labelledby="checkout-payment-details-heading">
    <div className="checkout-payment-details-heading">
      <h3 id="checkout-payment-details-heading"><Landmark size={19} />Payment details</h3>
      <button type="button" className="checkout-payment-refresh" aria-label="Refresh payment details" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={15} /></button>
    </div>
    <p className="checkout-payment-intro">Bank transfer details for eligible non-cannabis merchandise. The store reviews payment manually; submitting a request does not confirm payment.</p>
    {loading && <p className="checkout-payment-feedback" role="status"><LoaderCircle size={16} className="member-spinner" />Loading bank transfer details…</p>}
    {error && <div className="checkout-payment-error" role="alert"><p>{error}</p><button type="button" disabled={loading || busy} onClick={() => void load()}>Try again</button></div>}
    {!loading && !error && confirmed && !details && <p className="checkout-payment-feedback" role="status">The store has not added bank transfer details yet.</p>}
    {!loading && !error && details && <dl className="checkout-payment-bank-details">
      {[["Bank", details.bankName], ["Account holder", details.accountHolder], ["Account number", details.accountNumber], ["Branch code", details.branchCode], ["Account type", TYPES[details.accountType]], ["Payment reference", details.reference || "Confirm the reference with the store."]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>}
  </section>;
}
