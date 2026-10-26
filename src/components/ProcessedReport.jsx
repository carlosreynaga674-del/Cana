import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardCheck, LoaderCircle, RefreshCw, Search, Settings2 } from "lucide-react";
import { MerchandisePaymentDialog } from "./MerchandiseRewards.jsx";
import "../processed-report.css";

const DAY = 24 * 60 * 60 * 1000;
const SETTINGS_PATH = "/api/admin/reports/processed-products";
const REPORT_PATH = "/api/admin/reports/processed";
const LIMIT = 50;

function sastDay(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

function defaultRange() {
  return { from: sastDay(new Date(Date.now() - 29 * DAY)), to: sastDay(new Date()) };
}

function dayLabel(value) {
  const date = new Date(value + "T12:00:00+02:00");
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", weekday: "long", day: "numeric", month: "short", year: "numeric",
  }).format(date);
}

function timeLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function checkedSettings(data) {
  if (!data || data.scope !== "non_cannabis_merchandise" || !Number.isSafeInteger(data.revision) ||
      !Array.isArray(data.products) || !Array.isArray(data.selectedProductIds) ||
      data.products.some((product) => !product || typeof product.id !== "string" || typeof product.name !== "string") ||
      data.selectedProductIds.some((id) => typeof id !== "string"))
    throw new Error("Report product settings could not be loaded. Please try again.");
  return data;
}

function checkedReport(data) {
  if (!data || !Array.isArray(data.groups) || !Number.isSafeInteger(data.total) || data.total < 0 ||
      !Number.isSafeInteger(data.page) || data.page < 1 || !Number.isSafeInteger(data.limit) || data.limit < 1 ||
      !Number.isSafeInteger(data.summary?.records) || !Number.isSafeInteger(data.summary?.units) ||
      data.groups.some((group) => typeof group.date !== "string" || !Array.isArray(group.records) ||
        group.records.some((record) => typeof record.id !== "string" || typeof record.processedAt !== "string" ||
          !Array.isArray(record.products) || record.products.some((product) => typeof product.id !== "string" ||
            typeof product.name !== "string" || !Number.isSafeInteger(product.quantity) || product.quantity < 1))))
    throw new Error("Processed records could not be loaded. Please refresh the report.");
  return data;
}

const sameIds = (left, right) => [...left].sort().join("\n") === [...right].sort().join("\n");

export default function ProcessedReport({ request, onSessionExpired, onForbidden }) {
  const [settings, setSettings] = useState(null);
  const [selection, setSelection] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [dates, setDates] = useState(defaultRange);
  const [range, setRange] = useState(defaultRange);
  const [dateError, setDateError] = useState("");
  const [page, setPage] = useState(1);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [paymentOrder, setPaymentOrder] = useState(null);
  const mounted = useRef(true);
  const settingsSequence = useRef(0);
  const reportSequence = useRef(0);
  const settingsController = useRef(null);
  const reportController = useRef(null);
  const saveController = useRef(null);

  const handleAccess = useCallback((problem) => {
    if (problem.status === 401) { onSessionExpired(); return true; }
    if (problem.status === 403) { onForbidden(); return true; }
    return false;
  }, [onSessionExpired, onForbidden]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      settingsSequence.current += 1;
      reportSequence.current += 1;
      settingsController.current?.abort();
      reportController.current?.abort();
      saveController.current?.abort();
    };
  }, []);

  const loadSettings = useCallback(async () => {
    const sequence = ++settingsSequence.current;
    settingsController.current?.abort();
    const controller = new AbortController();
    settingsController.current = controller;
    setSettingsLoading(true);
    setSettingsError("");
    try {
      const data = checkedSettings(await request(SETTINGS_PATH, { signal: controller.signal }));
      if (!mounted.current || controller.signal.aborted || sequence !== settingsSequence.current) return;
      setSettings(data);
      setSelection(data.selectedProductIds);
      setPage(1);
    } catch (problem) {
      if (!mounted.current || controller.signal.aborted || sequence !== settingsSequence.current) return;
      if (!handleAccess(problem)) setSettingsError(problem.message || "Report products could not be loaded.");
    } finally {
      if (mounted.current && sequence === settingsSequence.current) setSettingsLoading(false);
    }
  }, [handleAccess, request]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  useEffect(() => {
    if (!settings) return;
    const sequence = ++reportSequence.current;
    reportController.current?.abort();
    const controller = new AbortController();
    reportController.current = controller;
    setLoading(true);
    setReportError("");
    const query = new URLSearchParams({ ...range, page: String(page), limit: String(LIMIT) });
    request(REPORT_PATH + "?" + query, { signal: controller.signal })
      .then((payload) => {
        const data = checkedReport(payload);
        if (!mounted.current || controller.signal.aborted || sequence !== reportSequence.current) return;
        setReport(data);
      })
      .catch((problem) => {
        if (!mounted.current || controller.signal.aborted || sequence !== reportSequence.current) return;
        setReport(null);
        if (!handleAccess(problem)) setReportError(problem.message || "The processed report could not be loaded.");
      })
      .finally(() => {
        if (mounted.current && sequence === reportSequence.current) setLoading(false);
      });
    return () => controller.abort();
  }, [settings, range, page, refreshKey, handleAccess, request]);

  async function saveProducts() {
    if (!settings || saving || settingsLoading) return;
    const controller = new AbortController();
    saveController.current?.abort();
    saveController.current = controller;
    setSaving(true);
    setSettingsError("");
    setNotice("");
    try {
      const data = checkedSettings(await request(SETTINGS_PATH, {
        method: "PUT", signal: controller.signal,
        body: JSON.stringify({ productIds: selection, expectedRevision: settings.revision }),
      }));
      if (!mounted.current || controller.signal.aborted) return;
      reportSequence.current += 1;
      reportController.current?.abort();
      setReport(null);
      setPage(1);
      setSettings(data);
      setSelection(data.selectedProductIds);
      setNotice("Report products saved.");
    } catch (problem) {
      if (!mounted.current || controller.signal.aborted) return;
      if (handleAccess(problem)) return;
      if (problem.status === 409) {
        await loadSettings();
        if (mounted.current) setSettingsError("The saved selection changed elsewhere. Review the latest selection and save again.");
      } else setSettingsError(problem.message || "Your report products could not be saved.");
    } finally {
      if (saveController.current === controller) saveController.current = null;
      if (mounted.current) setSaving(false);
    }
  }

  function toggle(id) {
    setNotice("");
    setSettingsError("");
    setSelection((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= 100) {
        setSettingsError("Choose up to 100 merchandise products for this report.");
        return current;
      }
      return [...current, id];
    });
  }

  function applyDates(event) {
    event.preventDefault();
    if (!dates.from || !dates.to || dates.from > dates.to) {
      setDateError("Choose a start date on or before the end date.");
      return;
    }
    if ((Date.parse(dates.to) - Date.parse(dates.from)) / DAY > 365) {
      setDateError("Choose a date range of up to 366 days.");
      return;
    }
    setDateError("");
    setRange({ ...dates });
    setPage(1);
    setRefreshKey((value) => value + 1);
  }

  const filteredProducts = (settings?.products || []).filter((product) =>
    product.name.toLocaleLowerCase().includes(productSearch.trim().toLocaleLowerCase()));
  const dirty = settings && !sameIds(selection, settings.selectedProductIds);
  const totalPages = Math.max(1, Math.ceil((report?.total || 0) / LIMIT));

  return (
    <section className="processed-report" aria-labelledby="processed-report-heading">
      <div className="processed-report-heading">
        <div><span className="staff-eyebrow">MERCHANDISE RECORDS</span><h2 id="processed-report-heading">Processed reports</h2><p>Completed merchandise records, grouped by date with the staff member recorded at completion.</p></div>
        <button className="staff-secondary-button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading || !settings}>
          <RefreshCw size={16} className={loading ? "staff-spin" : ""} />Refresh report
        </button>
      </div>
      <section className="processed-product-settings" aria-labelledby="processed-products-heading">
        <div className="processed-settings-heading"><div><h3 id="processed-products-heading"><Settings2 size={18} />Choose report products</h3><p>Choose the eligible merchandise you want included, then save your selection.</p></div><button className="processed-text-button" onClick={() => void loadSettings()} disabled={saving || settingsLoading}>Refresh products</button></div>
        <label className="processed-product-search"><Search size={16} /><input aria-label="Search report products" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Find a merchandise product" /></label>
        {settingsLoading ? <p className="processed-loading" role="status"><LoaderCircle size={17} className="staff-spin" />Loading report products…</p> : (
          settings?.products.length ? (
            <div className="processed-product-list" role="group" aria-label="Report products">
              {filteredProducts.length ? filteredProducts.map((product) => (
                <label key={product.id}>
                  <input type="checkbox" checked={selection.includes(product.id)} disabled={saving} onChange={() => toggle(product.id)} />
                  <span>{product.name}{product.status === "archived" && <small>Archived</small>}</span>
                </label>
              )) : <p>No products match your search.</p>}
            </div>
          ) : <p className="processed-quiet">No eligible merchandise products are available for reporting yet.</p>
        )}
        <div className="processed-selection-actions"><span>{selection.length} selected{dirty ? " · unsaved changes" : ""}</span><div><button className="staff-secondary-button" disabled={saving || !selection.length} onClick={() => { setSelection([]); setNotice(""); }}>Clear selection</button><button className="staff-action-button" onClick={saveProducts} disabled={saving || settingsLoading || !dirty}>{saving ? <LoaderCircle size={16} className="staff-spin" /> : <Check size={16} />}{saving ? "Saving…" : "Save report products"}</button></div></div>
        {settingsError && <p className="staff-error-message" role="alert">{settingsError}</p>}
        {notice && <p className="processed-notice" role="status"><Check size={15} />{notice}</p>}
      </section>
      <form className="processed-date-filter" onSubmit={applyDates}>
        <label><span>From date</span><input type="date" aria-label="Report from date" required value={dates.from} onChange={(event) => setDates((current) => ({ ...current, from: event.target.value }))} /></label>
        <label><span>To date</span><input type="date" aria-label="Report to date" required value={dates.to} onChange={(event) => setDates((current) => ({ ...current, to: event.target.value }))} /></label>
        <button className="staff-secondary-button" disabled={!settings || loading}><CalendarDays size={16} />Apply dates</button>
        <small>South African time (SAST) · up to 366 days</small>
      </form>
      {dateError && <p className="staff-error-message" role="alert">{dateError}</p>}
      <div className="processed-summary" aria-label="Processed report summary">
        <div><strong>{report?.summary.records ?? "—"}</strong><span>Processed records</span></div>
        <div><strong>{report?.summary.units ?? "—"}</strong><span>Selected merchandise units</span></div>
        <div><strong>{settings?.selectedProductIds.length ?? "—"}</strong><span>Saved report products</span></div>
      </div>
      <p className="processed-quiet">Reports use your saved product selection. Only matching merchandise lines appear. Older records without a recorded staff name show “Not recorded”.</p>
      {reportError && <div className="processed-report-error" role="alert"><p>{reportError}</p><button className="staff-secondary-button" onClick={() => setRefreshKey((value) => value + 1)}>Try again<RefreshCw size={14} /></button></div>}
      {loading ? <p className="processed-loading" role="status"><LoaderCircle size={19} className="staff-spin" />Loading processed records…</p> : report && report.groups.length ? (
        <div className="processed-date-groups">
          {report.groups.map((group) => (
            <section className="processed-date-group" key={group.date} aria-label={"Processed records for " + group.date}>
              <h3><CalendarDays size={17} />{dayLabel(group.date)}</h3>
              <ol className="processed-record-list">
                {group.records.map((record) => (
                  <li className="processed-record" key={record.id}>
                    <div className="processed-record-heading"><strong>{record.id}</strong><time dateTime={record.processedAt}>{timeLabel(record.processedAt)} SAST</time></div>
                    <div className="processed-record-staff"><span>Completed by</span><strong>{record.attribution === "recorded" ? record.staffName || "Not recorded" : "Not recorded"}</strong>{record.attribution === "recorded" && record.staffUsername && <small>@{record.staffUsername}</small>}</div>
                    <ul className="processed-record-products" aria-label="Products in this report">{record.products.map((product, index) => <li key={product.id + ":" + index}><span>{product.name}{product.size && <small>{product.size}</small>}</span><strong>× {product.quantity}</strong></li>)}</ul>
                    <button className="staff-secondary-button processed-payment-button" onClick={() => setPaymentOrder(record.id)}>Record merchandise payment</button>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : report && !reportError && (
        <div className="staff-empty processed-empty"><ClipboardCheck size={30} /><h3>{settings?.selectedProductIds.length ? "No matching processed records." : "Choose your report products."}</h3><p>{settings?.selectedProductIds.length ? "Try another date range or update your saved product selection." : "Save the merchandise products you want to report on above."}</p></div>
      )}
      {report && report.total > 0 && <div className="processed-pagination"><span>Page {page} of {totalPages} · {report.total} records</span><div><button className="staff-secondary-button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} />Previous</button><button className="staff-secondary-button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight size={15} /></button></div></div>}
      {paymentOrder && <MerchandisePaymentDialog orderId={paymentOrder} request={request} onClose={() => setPaymentOrder(null)} onSaved={() => { setPaymentOrder(null); setNotice("Merchandise payment recorded."); setRefreshKey((value) => value + 1); }} onSessionExpired={onSessionExpired} onForbidden={onForbidden} />}
    </section>
  );
}
