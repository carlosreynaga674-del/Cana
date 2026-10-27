import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Landmark, LoaderCircle, RefreshCw, RotateCcw, Save, ShieldCheck } from "lucide-react";
import "../merchandise-payment-details.css";

const PATH = "/api/admin/merchandise-payment-details";
const FIELDS = ["bankName", "accountHolder", "accountNumber", "branchCode", "accountType", "reference", "instructions"];
const emptyDetails = () => ({ bankName: "", accountHolder: "", accountNumber: "", branchCode: "", accountType: "current", reference: "", instructions: "" });

function checkedResponse(data) {
  if (!data || data.scope !== "non_cannabis_merchandise" || !Number.isSafeInteger(data.revision) || data.revision < 1 ||
      typeof data.configured !== "boolean" || (data.updatedAt !== null && (typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt)))) ||
      !data.details || FIELDS.some((field) => typeof data.details[field] !== "string") ||
      !["current", "savings", "business"].includes(data.details.accountType))
    throw new Error("The saved payment details could not be confirmed. Please refresh.");
  return { ...data, details: Object.fromEntries(FIELDS.map((field) => [field, data.details[field]])) };
}

function validate(details) {
  const errors = {};
  const invalidText = (value) => /[\u0000-\u001f\u007f]/.test(value);
  if (details.bankName.length < 2 || details.bankName.length > 80 || invalidText(details.bankName)) errors.bankName = "Enter the bank name using 2–80 characters.";
  if (details.accountHolder.length < 2 || details.accountHolder.length > 120 || invalidText(details.accountHolder)) errors.accountHolder = "Enter the account holder using 2–120 characters.";
  if (!/^\d{6,20}$/.test(details.accountNumber)) errors.accountNumber = "Enter 6–20 account-number digits, including any leading zeros.";
  if (!/^\d{6}$/.test(details.branchCode)) errors.branchCode = "Enter the six-digit South African branch code.";
  if (!["current", "savings", "business"].includes(details.accountType)) errors.accountType = "Choose an available account type.";
  if (details.reference.length > 80 || invalidText(details.reference)) errors.reference = "Keep the payment reference within 80 characters.";
  if (details.instructions.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(details.instructions)) errors.instructions = "Keep the payment note within 1,000 characters.";
  return errors;
}

function savedDate(value) {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

export default function MerchandisePaymentDetails({ request, onSessionExpired, onForbidden }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(emptyDetails);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const mounted = useRef(true);
  const loadVersion = useRef(0);
  const loadController = useRef(null);
  const saveController = useRef(null);

  const handleAccess = useCallback((problem) => {
    if (problem.status === 401) { onSessionExpired(); return true; }
    if (problem.status === 403) { onForbidden(); return true; }
    return false;
  }, [onSessionExpired, onForbidden]);

  const load = useCallback(async () => {
    if (saveController.current) return;
    const version = ++loadVersion.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true); setError(""); setNotice("");
    try {
      const data = checkedResponse(await request(PATH, { signal: controller.signal }));
      if (!mounted.current || controller.signal.aborted || version !== loadVersion.current) return;
      setSaved(data); setDraft({ ...data.details }); setErrors({}); setConflict(false);
    } catch (problem) {
      if (!mounted.current || controller.signal.aborted || version !== loadVersion.current) return;
      if (!handleAccess(problem)) setError(problem.message || "Payment details could not be loaded.");
    } finally {
      if (mounted.current && !controller.signal.aborted && version === loadVersion.current) setLoading(false);
    }
  }, [request, handleAccess]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false; loadVersion.current += 1;
      loadController.current?.abort(); saveController.current?.abort();
    };
  }, [load]);

  const dirty = saved && FIELDS.some((field) => draft[field] !== saved.details[field]);
  const busy = loading || saving;

  function change(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setNotice("");
  }

  function resetChanges() {
    if (!saved || busy) return;
    setDraft({ ...saved.details }); setErrors({}); setNotice("");
    if (!conflict) setError("");
  }

  async function save(event) {
    event.preventDefault();
    if (!saved || busy || conflict || saveController.current) return;
    const details = Object.fromEntries(FIELDS.map((field) => [field, draft[field].trim()]));
    const fieldErrors = validate(details);
    setErrors(fieldErrors); setNotice("");
    if (Object.keys(fieldErrors).length) {
      document.getElementById("merchandise-payment-" + Object.keys(fieldErrors)[0])?.focus();
      return;
    }
    const controller = new AbortController();
    saveController.current = controller;
    setSaving(true); setError("");
    try {
      const data = checkedResponse(await request(PATH, {
        method: "PUT", signal: controller.signal,
        body: JSON.stringify({ details, expectedRevision: saved.revision }),
      }));
      if (!mounted.current || controller.signal.aborted) return;
      setSaved(data); setDraft({ ...data.details }); setErrors({}); setConflict(false);
      setNotice("Payment details saved.");
    } catch (problem) {
      if (!mounted.current || controller.signal.aborted) return;
      if (handleAccess(problem)) return;
      if (problem.status === 409) {
        setConflict(true);
        setError("These details changed in another admin session. Your edits have been kept. Load the latest saved details before editing again.");
      } else {
        const returned = Object.fromEntries(FIELDS.map((field) => [field, problem.errors?.[field] || problem.errors?.["details." + field]]).filter(([, value]) => typeof value === "string"));
        setErrors(returned);
        setError(problem.message || "The payment details could not be saved. Your edits are still here.");
      }
    } finally {
      if (saveController.current === controller) saveController.current = null;
      if (mounted.current && !controller.signal.aborted) setSaving(false);
    }
  }

  function textField(field, label, maxLength, options = {}) {
    return <label className={options.wide ? "merchandise-details-wide" : ""} htmlFor={"merchandise-payment-" + field}>
      <span>{label}{options.optional && <small aria-hidden="true">Optional</small>}</span>
      <input id={"merchandise-payment-" + field} aria-label={label} value={draft[field]} maxLength={maxLength} required={!options.optional}
        autoComplete="off" spellCheck={false} inputMode={options.numeric ? "numeric" : undefined} disabled={busy}
        aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? "merchandise-payment-" + field + "-error" : undefined}
        onChange={(event) => change(field, event.target.value)} />
      {errors[field] && <small className="staff-field-error" id={"merchandise-payment-" + field + "-error"}>{errors[field]}</small>}
    </label>;
  }

  return <section className="merchandise-details" aria-labelledby="merchandise-details-heading">
    <div className="merchandise-details-heading">
      <div><span className="staff-eyebrow">PRIVATE ADMINISTRATION</span><h2 id="merchandise-details-heading"><Landmark size={24} />Merchandise payment details</h2><p>Keep the business EFT details up to date for non-cannabis merchandise.</p></div>
      <button className="staff-secondary-button" type="button" onClick={() => void load()} disabled={busy || Boolean(dirty)}><RefreshCw size={16} className={loading ? "staff-spin" : ""} />Refresh details</button>
    </div>
    <p className="merchandise-details-private"><ShieldCheck size={17} />Only administrators can edit these details. Verified members can view the bank details and reference at eligible merchandise checkout.</p>
    {loading && !saved && <p className="merchandise-details-feedback" role="status"><LoaderCircle size={18} className="staff-spin" />Loading payment details…</p>}
    {error && <p className="staff-error-message merchandise-details-error" role="alert">{error}</p>}
    {!saved && !loading && error && <button className="staff-secondary-button" onClick={() => void load()}>Try again</button>}
    {conflict && <div className="merchandise-details-conflict"><p>Loading the latest saved details replaces your unsaved edits.</p><button className="staff-secondary-button" type="button" disabled={busy} onClick={() => void load()}>Load latest details</button></div>}
    {saved && <form className="merchandise-details-form" onSubmit={save} noValidate>
      <div className="merchandise-details-form-heading"><h3>South African bank account</h3><span className={saved.configured ? "is-configured" : ""}>{saved.configured ? "Details saved" : "Not configured"}</span></div>
      <p className="merchandise-details-intro">Enter the actual business bank details for non-cannabis merchandise. The payment note stays private to administrators. Bank transfers are reviewed manually by the store.</p>
      <div className="merchandise-details-fields">
        {textField("bankName", "Bank name", 80)}
        {textField("accountHolder", "Account holder", 120)}
        {textField("accountNumber", "Account number", 20, { numeric: true })}
        {textField("branchCode", "Branch code", 6, { numeric: true })}
        <label htmlFor="merchandise-payment-accountType"><span>Account type</span><select id="merchandise-payment-accountType" aria-label="Account type" value={draft.accountType} disabled={busy} aria-invalid={Boolean(errors.accountType)} aria-describedby={errors.accountType ? "merchandise-payment-accountType-error" : undefined} onChange={(event) => change("accountType", event.target.value)}><option value="current">Current / Cheque</option><option value="savings">Savings</option><option value="business">Business</option></select>{errors.accountType && <small id="merchandise-payment-accountType-error" className="staff-field-error">{errors.accountType}</small>}</label>
        {textField("reference", "Payment reference", 80, { optional: true })}
        <label className="merchandise-details-wide" htmlFor="merchandise-payment-instructions"><span>Payment note<small aria-hidden="true">Optional</small></span><textarea id="merchandise-payment-instructions" aria-label="Payment note" value={draft.instructions} maxLength={1000} rows={4} disabled={busy} aria-invalid={Boolean(errors.instructions)} aria-describedby={errors.instructions ? "merchandise-payment-instructions-error" : undefined} onChange={(event) => change("instructions", event.target.value)} />{errors.instructions && <small className="staff-field-error" id="merchandise-payment-instructions-error">{errors.instructions}</small>}</label>
      </div>
      <div className="merchandise-details-actions"><span>{dirty ? "You have unsaved changes." : saved.updatedAt ? "Last saved " + savedDate(saved.updatedAt) + " SAST" : "Add the account details to create your first saved record."}</span><div><button className="staff-secondary-button" type="button" disabled={busy || !dirty} onClick={resetChanges}><RotateCcw size={16} />Reset changes</button><button className="staff-action-button" type="submit" disabled={busy || !dirty || conflict}>{saving ? <LoaderCircle size={16} className="staff-spin" /> : <Save size={16} />}{saving ? "Saving…" : "Save payment details"}</button></div></div>
      {notice && <p className="merchandise-details-notice" role="status"><Check size={16} />{notice}</p>}
    </form>}
  </section>;
}
