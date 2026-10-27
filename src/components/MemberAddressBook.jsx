import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, MapPin, Pencil, Plus, RefreshCw, Save, ShieldCheck, Trash2, X } from "lucide-react";
import "../member-addresses.css";

const PATH = "/api/members/addresses";
const FIELDS = ["label", "address", "city", "postcode"];
const emptyAddress = () => ({ label: "", address: "", city: "", postcode: "" });
const dateValue = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

async function addressRequest(path, { method = "GET", body, signal, memberId } = {}) {
  const response = await fetch(path, {
    method, signal, credentials: "same-origin", cache: "no-store",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), "X-Member-ID": memberId },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The address service is unavailable. Please try again."); }
  if (!response.ok) {
    const error = new Error(typeof data.error === "string" ? data.error : data.error?.message || data.message || "Your addresses could not be updated.");
    error.status = response.status;
    error.errors = data.errors || data.error?.errors;
    throw error;
  }
  return data;
}

function checkedAddress(value) {
  if (!value || typeof value.id !== "string" || !value.id || FIELDS.some((key) => typeof value[key] !== "string") ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 || !dateValue(value.createdAt) ||
      !dateValue(value.updatedAt) || (value.lastUsedAt !== null && !dateValue(value.lastUsedAt)))
    throw new Error("The saved address could not be confirmed. Refresh your address book.");
  return {
    id: value.id, ...Object.fromEntries(FIELDS.map((key) => [key, value[key]])),
    revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt, lastUsedAt: value.lastUsedAt,
  };
}

function checkedList(value, memberId) {
  if (value?.memberId !== memberId) {
    const error = new Error("Your account changed. Sign in again before opening your saved addresses.");
    error.status = 401;
    throw error;
  }
  if (!value || value.limit !== 3 || !Array.isArray(value.addresses) || value.addresses.length > 3)
    throw new Error("Your saved addresses could not be confirmed. Please refresh.");
  const addresses = value.addresses.map(checkedAddress);
  if (new Set(addresses.map((address) => address.id)).size !== addresses.length)
    throw new Error("Your saved addresses could not be confirmed. Please refresh.");
  return addresses;
}

function validate(value) {
  const errors = {};
  for (const [key, max, message] of [
    ["label", 40, "Enter an address label using 1–40 characters."],
    ["address", 240, "Enter a street address using 1–240 characters."],
    ["city", 100, "Enter a city using 1–100 characters."],
  ]) if (!value[key] || value[key].length > max || /[\u0000-\u001f\u007f]/.test(value[key])) errors[key] = message;
  if (!/^\d{4}$/.test(value.postcode)) errors.postcode = "Enter a four-digit South African postal code, including any leading zero.";
  return errors;
}

function usedDate(value) {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric",
  }).format(new Date(value));
}

export default function MemberAddressBook({ member }) {
  const [state, setState] = useState({ memberId: "", addresses: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(emptyAddress);
  const [errors, setErrors] = useState({});
  const [conflict, setConflict] = useState(false);
  const [removing, setRemoving] = useState(null);
  const mounted = useRef(true);
  const activeMember = useRef(member.id);
  activeMember.current = member.id;
  const sequence = useRef(0);
  const listController = useRef(null);
  const mutationController = useRef(null);
  const firstInput = useRef(null);
  const addButton = useRef(null);
  const ready = state.memberId === member.id && state.addresses !== null;
  const addresses = ready ? state.addresses : [];
  const currentEditor = editor?.memberId === member.id ? editor : null;
  const currentRemoval = removing?.memberId === member.id ? removing : null;

  const sessionFailure = useCallback((problem) => {
    if (problem.status !== 401) return false;
    setState({ memberId: member.id, addresses: null });
    setEditor(null); setRemoving(null); setDraft(emptyAddress()); setErrors({});
    setError("Your session ended. Sign in again to manage your saved addresses.");
    return true;
  }, [member.id]);

  const load = useCallback(async () => {
    if (mutationController.current) return null;
    const version = ++sequence.current;
    const memberId = member.id;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setLoading(true); setError(""); setNotice("");
    try {
      const next = checkedList(await addressRequest(PATH, { signal: controller.signal, memberId }), memberId);
      if (!mounted.current || controller.signal.aborted || version !== sequence.current || activeMember.current !== memberId) return null;
      setState({ memberId, addresses: next });
      return next;
    } catch (problem) {
      if (!mounted.current || controller.signal.aborted || version !== sequence.current || activeMember.current !== memberId) return null;
      if (!sessionFailure(problem)) setError(problem.message || "Your saved addresses could not be loaded.");
      return null;
    } finally {
      if (mounted.current && !controller.signal.aborted && version === sequence.current && activeMember.current === memberId) setLoading(false);
    }
  }, [member.id, sessionFailure]);

  useEffect(() => {
    mounted.current = true;
    setState({ memberId: "", addresses: null }); setEditor(null); setRemoving(null);
    setDraft(emptyAddress()); setErrors({}); setError(""); setNotice(""); setConflict(false); setBusy(false);
    void load();
    return () => {
      mounted.current = false; sequence.current += 1;
      listController.current?.abort(); mutationController.current?.abort();
      mutationController.current = null;
    };
  }, [load]);

  useEffect(() => { if (currentEditor) firstInput.current?.focus(); }, [currentEditor?.id, currentEditor?.memberId]);

  function openEditor(address = null) {
    if (!ready || busy || loading || currentEditor || (!address && addresses.length >= 3)) return;
    setEditor({ memberId: member.id, id: address?.id || null, revision: address?.revision });
    setDraft(address ? Object.fromEntries(FIELDS.map((field) => [field, address[field]])) : emptyAddress());
    setErrors({}); setError(""); setNotice(""); setConflict(false); setRemoving(null);
  }

  function closeEditor() {
    if (mutationController.current) return;
    setEditor(null); setDraft(emptyAddress()); setErrors({}); setConflict(false); setError("");
    requestAnimationFrame(() => addButton.current?.focus());
  }

  async function loadLatest() {
    const previous = currentEditor;
    const next = await load();
    if (!next || !previous || activeMember.current !== previous.memberId) return;
    if (previous.id) {
      const latest = next.find((address) => address.id === previous.id);
      if (latest) {
        setEditor({ memberId: member.id, id: latest.id, revision: latest.revision });
        setDraft(Object.fromEntries(FIELDS.map((field) => [field, latest[field]])));
        setErrors({}); setNotice("The latest saved address is loaded. Review it before saving changes.");
      } else {
        setEditor(null); setDraft(emptyAddress());
        setNotice("This address was removed in another session. Add it again if a space is available.");
      }
    } else if (next.length >= 3) setError("Your three saved spaces are full. Cancel this form, then edit or remove a saved address.");
    setConflict(false);
  }

  async function save(event) {
    event.preventDefault();
    if (!currentEditor || busy || loading || conflict || mutationController.current) return;
    const details = Object.fromEntries(FIELDS.map((field) => [field, draft[field].trim()]));
    const fieldErrors = validate(details);
    setErrors(fieldErrors); setNotice("");
    if (Object.keys(fieldErrors).length) {
      document.getElementById("member-address-" + Object.keys(fieldErrors)[0])?.focus();
      return;
    }
    if (!currentEditor.id && addresses.length >= 3) { setError("Edit or remove one of your three saved addresses before adding another."); return; }
    const action = currentEditor;
    const controller = new AbortController();
    mutationController.current = controller;
    listController.current?.abort(); sequence.current += 1;
    setBusy(true); setError("");
    try {
      const data = await addressRequest(PATH + (action.id ? "/" + encodeURIComponent(action.id) : ""), {
        method: action.id ? "PATCH" : "POST", signal: controller.signal,
        memberId: action.memberId,
        body: { ...details, ...(action.id ? { expectedRevision: action.revision } : {}) },
      });
      const saved = checkedAddress(data.address);
      if (!mounted.current || controller.signal.aborted || activeMember.current !== action.memberId) return;
      setState((current) => ({ memberId: action.memberId, addresses: action.id ? current.addresses.map((address) => address.id === action.id ? saved : address) : [saved, ...current.addresses] }));
      setEditor(null); setDraft(emptyAddress()); setErrors({}); setConflict(false);
      setNotice(action.id ? "Address updated." : "Address saved.");
      requestAnimationFrame(() => addButton.current?.focus());
    } catch (problem) {
      if (!mounted.current || controller.signal.aborted || activeMember.current !== action.memberId) return;
      if (sessionFailure(problem)) return;
      if ([404, 409].includes(problem.status)) {
        setConflict(true);
        setError((problem.message || "Your address book changed.") + " Your edits are still here. Refresh the latest saved details before trying again.");
      } else {
        setErrors(Object.fromEntries(FIELDS.map((field) => [field, problem.errors?.[field]]).filter(([, message]) => typeof message === "string")));
        setError(problem.message || "The address could not be saved. Your edits are still here.");
      }
    } finally {
      if (mutationController.current === controller) mutationController.current = null;
      if (mounted.current && !controller.signal.aborted && activeMember.current === action.memberId) setBusy(false);
    }
  }

  async function remove() {
    if (!currentRemoval || busy || loading || mutationController.current) return;
    const action = currentRemoval;
    const controller = new AbortController();
    mutationController.current = controller;
    listController.current?.abort(); sequence.current += 1;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await addressRequest(PATH + "/" + encodeURIComponent(action.id), {
        method: "DELETE", signal: controller.signal, memberId: action.memberId, body: { expectedRevision: action.revision },
      });
      if (data.ok !== true) throw new Error("The removal was not confirmed. Refresh your address book before retrying.");
      if (!mounted.current || controller.signal.aborted || activeMember.current !== action.memberId) return;
      setState((current) => ({ ...current, addresses: current.addresses.filter((address) => address.id !== action.id) }));
      setRemoving(null); setNotice("Address removed.");
    } catch (problem) {
      if (!mounted.current || controller.signal.aborted || activeMember.current !== action.memberId) return;
      if (sessionFailure(problem)) return;
      setRemoving(null);
      setError(problem.status === 409 || problem.status === 404 ? "This address changed in another session. Refresh your address book before removing it." : problem.message || "The address could not be removed.");
    } finally {
      if (mutationController.current === controller) mutationController.current = null;
      if (mounted.current && !controller.signal.aborted && activeMember.current === action.memberId) setBusy(false);
    }
  }

  return <section className="member-address-book" aria-labelledby="member-address-book-heading">
    <div className="member-address-book-heading">
      <div><span className="eyebrow">A PLACE FOR YOUR NEXT DELIVERY</span><h2 id="member-address-book-heading"><MapPin size={24} aria-hidden="true" />Saved addresses</h2></div>
      <div><button className="button outline" type="button" disabled={loading || busy || Boolean(currentEditor) || Boolean(currentRemoval)} onClick={() => void load()}><RefreshCw size={15} className={loading ? "member-spinner" : ""} />Refresh addresses</button><button className="button lime" type="button" ref={addButton} disabled={!ready || loading || busy || Boolean(currentEditor) || Boolean(currentRemoval) || addresses.length >= 3} onClick={() => openEditor()}><Plus size={16} />Add address</button></div>
    </div>
    <p className="member-address-book-intro">Save up to three delivery addresses and edit them whenever your details change.</p>
    {ready && <p className="member-address-book-count">{addresses.length} of 3 addresses saved{addresses.length === 3 ? " · Edit or remove one to make space." : ""}</p>}
    {(loading || !ready) && !error && <p className="member-address-book-feedback" role="status"><LoaderCircle size={17} className="member-spinner" />Loading saved addresses…</p>}
    {error && <p className="member-address-book-error" role="alert">{error}</p>}
    {notice && <p className="member-address-book-notice" role="status"><Check size={16} />{notice}</p>}
    {ready && !addresses.length && !currentEditor && <div className="member-address-book-empty"><MapPin size={25} /><h3>Your address book is ready.</h3><p>Add your first address. No delivery address is saved until you add one or use it for an eligible merchandise order.</p></div>}
    {ready && addresses.length > 0 && <div className="member-address-list">
      {addresses.map((address) => <article className="member-address-card" key={address.id} aria-labelledby={"member-address-title-" + address.id}>
        <div className="member-address-card-heading"><MapPin size={17} aria-hidden="true" /><h3 id={"member-address-title-" + address.id}>{address.label}</h3></div>
        <address>{address.address}<br />{address.city}, {address.postcode}<br /><span>South Africa</span></address>
        {address.lastUsedAt && <small className="member-address-last-used">Last used {usedDate(address.lastUsedAt)}</small>}
        {currentRemoval?.id === address.id ? <div className="member-address-remove-confirm" role="region" aria-label={"Confirm removal of " + address.label}><p>Remove this saved address? Existing order addresses stay unchanged.</p><div><button className="button outline" type="button" disabled={busy} onClick={() => setRemoving(null)}>Keep address</button><button className="button outline member-address-remove" type="button" disabled={busy} onClick={() => void remove()}>{busy ? <LoaderCircle size={15} className="member-spinner" /> : <Trash2 size={15} />}Confirm removal</button></div></div> : <div className="member-address-card-actions"><button className="button outline" type="button" disabled={loading || busy || Boolean(currentEditor) || Boolean(currentRemoval)} onClick={() => openEditor(address)}><Pencil size={14} />Edit address</button><button className="button outline member-address-remove" type="button" disabled={loading || busy || Boolean(currentEditor) || Boolean(currentRemoval)} onClick={() => { setRemoving({ ...address, memberId: member.id }); setError(""); setNotice(""); }}><Trash2 size={14} />Remove address</button></div>}
      </article>)}
    </div>}
    {currentEditor && <section className="member-address-editor" aria-labelledby="member-address-editor-heading">
      <div className="member-address-editor-heading"><h3 id="member-address-editor-heading">{currentEditor.id ? "Edit address" : "Add address"}</h3><button className="member-address-close" type="button" aria-label="Close address form" disabled={busy || loading} onClick={closeEditor}><X size={18} /></button></div>
      <p>South African delivery address</p>
      {conflict && <div className="member-address-conflict"><p>{currentEditor.id ? "Loading the latest address replaces the unsaved edits shown below." : "Refresh your saved addresses while keeping this new-address draft."}</p><button className="button outline" type="button" disabled={busy || loading} onClick={() => void loadLatest()}>{currentEditor.id ? "Load latest address" : "Refresh saved addresses"}</button></div>}
      <form onSubmit={save} noValidate><div className="member-address-fields">
        {[["label", "Address label", 40], ["address", "Street address", 240], ["city", "City", 100], ["postcode", "Postal code", 4]].map(([field, label, limit], index) => <label key={field} className={field === "address" ? "member-address-field-wide" : ""} htmlFor={"member-address-" + field}><span>{label}</span><input id={"member-address-" + field} aria-label={label} ref={index === 0 ? firstInput : undefined} value={draft[field]} maxLength={limit} required disabled={busy || loading} autoComplete={field === "address" ? "street-address" : field === "city" ? "address-level2" : field === "postcode" ? "postal-code" : "off"} inputMode={field === "postcode" ? "numeric" : undefined} aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? "member-address-" + field + "-error" : undefined} onChange={(event) => { setDraft((current) => ({ ...current, [field]: event.target.value })); setErrors((current) => ({ ...current, [field]: "" })); setNotice(""); }} />{errors[field] && <small className="member-address-field-error" id={"member-address-" + field + "-error"}>{errors[field]}</small>}</label>)}
      </div><div className="member-address-form-actions"><button className="button outline" type="button" disabled={busy || loading} onClick={closeEditor}>Cancel</button><button className="button lime" type="submit" disabled={busy || loading || conflict || (!currentEditor.id && addresses.length >= 3)}>{busy ? <LoaderCircle size={16} className="member-spinner" /> : <Save size={16} />}{busy ? "Saving…" : currentEditor.id ? "Save changes" : "Save address"}</button></div></form>
    </section>}
    <p className="member-address-book-note"><ShieldCheck size={14} aria-hidden="true" />Your address book is private to your member account. Saved-address use and automatic saving during checkout apply to eligible non-cannabis merchandise only.</p>
  </section>;
}
