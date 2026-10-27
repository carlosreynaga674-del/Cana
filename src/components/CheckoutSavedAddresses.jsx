import React, { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, MapPin, RefreshCw } from "lucide-react";
import { request } from "../lib/api.js";
import "../checkout-addresses.css";

const normalize = (value) => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-ZA");
const addressKey = (value) => [normalize(value.address), normalize(value.city), String(value.postcode || "").trim()].join("\n");

function checkedAddresses(data, memberId) {
  if (data?.memberId !== memberId) {
    const error = new Error("Your account changed. Sign in again before using saved delivery addresses.");
    error.status = 401;
    throw error;
  }
  if (!data || data.limit !== 3 || !Array.isArray(data.addresses) || data.addresses.length > 3 ||
      data.addresses.some((value) => !value || ["id", "label", "address", "city", "postcode"].some((field) => typeof value[field] !== "string") ||
        !Number.isSafeInteger(value.revision) || value.revision < 1 || !/^\d{4}$/.test(value.postcode)))
    throw new Error("Your saved addresses could not be confirmed. Please try again.");
  return data.addresses;
}

/** The parent mounts this only for eligible ordinary-merchandise deliveries. */
export default function CheckoutSavedAddresses({ memberId, customer, onUseAddress, onManage, onBlocked, busy = false }) {
  const [addresses, setAddresses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const flight = useRef(null);
  const initialized = useRef(false);
  const actions = useRef({ customer, onUseAddress, onManage, onBlocked });
  actions.current = { customer, onUseAddress, onManage, onBlocked };

  const load = useCallback(async () => {
    const version = ++generation.current;
    flight.current?.abort();
    const controller = new AbortController();
    flight.current = controller;
    setLoading(true); setError("");
    try {
      const values = checkedAddresses(await request("/api/members/addresses", { signal: controller.signal, memberId }), memberId);
      if (controller.signal.aborted || version !== generation.current) return;
      setAddresses(values); setLoaded(true);
      if (!initialized.current) {
        initialized.current = true;
        const current = actions.current.customer;
        if (values.length && ![current.address, current.city, current.postcode].some((value) => String(value || "").trim()))
          actions.current.onUseAddress(values[0], memberId, true);
      }
    } catch (problem) {
      if (controller.signal.aborted || version !== generation.current) return;
      setAddresses([]); setLoaded(false);
      setError(problem.message || "Your saved addresses are unavailable. Please try again.");
    } finally {
      if (!controller.signal.aborted && version === generation.current) setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    initialized.current = false;
    setAddresses([]); setLoaded(false);
    void load();
    return () => {
      generation.current += 1;
      flight.current?.abort();
      actions.current.onBlocked(false);
    };
  }, [load]);

  const matching = addresses.find((value) => addressKey(value) === addressKey(customer));
  const full = loaded && addresses.length >= 3;
  const fullAndUnmatched = full && !matching;
  const blocked = !loaded || fullAndUnmatched;
  useEffect(() => { actions.current.onBlocked(blocked); }, [blocked]);

  function selectAddress(event) {
    const address = addresses.find((value) => value.id === event.target.value) || null;
    initialized.current = true;
    actions.current.onUseAddress(address, memberId, false);
  }

  return <section className="checkout-saved-addresses" aria-labelledby="checkout-saved-addresses-heading">
    <div className="checkout-saved-addresses-heading">
      <h4 id="checkout-saved-addresses-heading"><MapPin size={17} />Your saved addresses</h4>
      <button type="button" className="checkout-address-refresh" disabled={loading || busy} onClick={() => void load()} aria-label="Refresh saved addresses"><RefreshCw size={15} /></button>
    </div>
    <p>Reuse a saved address or enter a new one below. Up to three addresses can be kept on your account.</p>
    {loading && <p className="checkout-address-status" role="status"><LoaderCircle size={15} className="member-spinner" />Loading your addresses…</p>}
    {error && <p className="checkout-address-error" role="alert">{error}</p>}
    {loaded && <label htmlFor="checkout-saved-address"><span>Saved delivery address</span><select id="checkout-saved-address" aria-label="Saved delivery address" value={matching?.id || ""} disabled={busy || loading} onChange={selectAddress}>
      <option value="">New delivery address</option>
      {addresses.map((value) => <option key={value.id} value={value.id}>{value.label} · {value.address} · {value.city}, {value.postcode}</option>)}
    </select></label>}
    <div className="checkout-address-actions"><small>{loaded ? addresses.length + " of 3 addresses saved" : "Private to your account"}</small><button type="button" disabled={busy} onClick={() => actions.current.onManage()}>Manage saved addresses</button></div>
    {fullAndUnmatched ? <p className="checkout-address-error" role="alert">Your three saved slots are full. Choose a saved address, or edit or remove one in your account before using a new delivery address.</p> :
      <p className="checkout-address-note">This delivery address is saved after your merchandise request is accepted. You can edit saved addresses in your account.</p>}
  </section>;
}
