import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Image,
  LoaderCircle,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  KeyRound,
  UserRoundCheck,
  UserRoundX,
  Upload,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { categories } from "../lib/products.js";
import { formatMoney } from "../lib/order.js";
import { safeProductImage } from "../lib/catalog.js";

const ageLabels = {
  pending: "ID check pending",
  required: "Verification needed",
  verified: "18+ ID checked",
  rejected: "Not verified",
  processing: "Verification processing",
};
const productStatusLabels = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};
const visuals = {
  Flower: "flower",
  "Pre-rolls": "preroll",
  Edibles: "gummies",
  Vapes: "vape",
  Drinks: "drink",
  Accessories: "accessory",
};
const uploadedPhotoId = (value) =>
  /^\/media\/products\/([a-f0-9-]{36})\.webp$/.exec(value || "")?.[1];
const privateProductPhoto = (value) => {
  const id = uploadedPhotoId(value);
  return id ? `/api/admin/product-images/${id}` : safeProductImage(value);
};
const photoFor = (product) =>
  privateProductPhoto(product.imageUrl) ||
  (product.visual === "drink"
    ? "/images/product-drink.webp"
    : `/images/reference-${product.visual || visuals[product.category] || "flower"}.webp`);
const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : date.toLocaleDateString("en-ZA", {
        timeZone: "Africa/Johannesburg",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
};

export function AdminOverview({
  request,
  onSessionExpired,
  onForbidden,
  onOpen,
}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(
    async ({ quiet = false } = {}) => {
      const current = ++generation.current;
      if (!quiet) setLoading(true);
      try {
        const data = await request("/api/admin/overview");
        if (current !== generation.current) return;
        if (
          ![
            data.members?.total,
            data.members?.pending,
            data.members?.verified,
            data.products?.total,
            data.products?.published,
            data.products?.draft,
            data.products?.archived,
            data.orders?.total,
            data.orders?.pending,
          ].every((value) => Number.isInteger(value) && value >= 0) ||
          typeof data.setup?.staffConfigured !== "boolean" ||
          typeof data.setup?.identityStorageConfigured !== "boolean"
        )
          throw new Error(
            "The admin summary could not be loaded. Please refresh.",
          );
        setSummary(data);
        setError("");
      } catch (problem) {
        if (current !== generation.current) return;
        if (problem.status === 401) onSessionExpired();
        else if (problem.status === 403) onForbidden();
        else setError(problem.message);
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [request, onSessionExpired, onForbidden],
  );
  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load({ quiet: true });
    }, 30000);
    return () => {
      generation.current += 1;
      clearInterval(timer);
    };
  }, [load]);
  return (
    <section
      className="staff-admin-overview"
      aria-labelledby="admin-overview-heading"
    >
      <div className="staff-management-heading">
        <div>
          <span className="staff-eyebrow">ADMIN OVERVIEW</span>
          <h2 id="admin-overview-heading">Keep the whole picture in view.</h2>
          <p>
            A current summary of your community, collection and requests. This
            overview is restricted to administrators.
          </p>
        </div>
        <button
          className="staff-secondary-button"
          disabled={loading}
          onClick={() => load()}
        >
          <RefreshCw size={16} className={loading ? "staff-spin" : ""} />
          Refresh overview
        </button>
      </div>
      <ErrorNotice error={error} onRetry={() => load()} />
      {loading && !summary ? (
        <div className="staff-management-loading" role="status">
          <LoaderCircle size={22} className="staff-spin" />
          Loading admin overview…
        </div>
      ) : (
        summary && (
          <>
            <div className="staff-overview-grid">
              <article className="staff-overview-card">
                <Users size={23} />
                <span>Registered members</span>
                <strong>{summary.members.total}</strong>
                <p>
                  {summary.members.verified} verified <span>·</span>{" "}
                  {summary.members.pending} pending checks
                </p>
                <button
                  className="staff-secondary-button"
                  onClick={() => onOpen("members")}
                >
                  View members <ArrowRight size={15} />
                </button>
              </article>
              <article className="staff-overview-card">
                <PackagePlus size={23} />
                <span>Published products</span>
                <strong>{summary.products.published}</strong>
                <p>
                  {summary.products.draft} drafts <span>·</span>{" "}
                  {summary.products.archived} archived <span>·</span>{" "}
                  {summary.products.total} total
                </p>
                <button
                  className="staff-secondary-button"
                  onClick={() => onOpen("products")}
                >
                  Manage products <ArrowRight size={15} />
                </button>
              </article>
              <article className="staff-overview-card">
                <ShieldCheck size={23} />
                <span>Order requests</span>
                <strong>{summary.orders.total}</strong>
                <p>{summary.orders.pending} new requests awaiting review</p>
                <button
                  className="staff-secondary-button"
                  onClick={() => onOpen("orders")}
                >
                  Review requests <ArrowRight size={15} />
                </button>
              </article>
            </div>
            <div className="staff-overview-setup">
              <div>
                <span className="staff-eyebrow">WORKSPACE SETUP</span>
                <h3>A clear view of what is ready.</h3>
                <p>
                  Create individual staff accounts here. Secure identity storage
                  uses a separate private host setting.
                </p>
              </div>
              <dl>
                <div>
                  <dt>Staff sign-in</dt>
                  <dd
                    className={
                      summary.setup.staffConfigured ? "is-ready" : "is-pending"
                    }
                  >
                    {summary.setup.staffConfigured
                      ? "Configured"
                      : "Configuration needed"}
                  </dd>
                  <button
                    className="staff-secondary-button"
                    onClick={() => onOpen("team")}
                  >
                    Manage staff <ArrowRight size={15} />
                  </button>
                </div>
                <div>
                  <dt>Secure ID and selfie storage</dt>
                  <dd
                    className={
                      summary.setup.identityStorageConfigured
                        ? "is-ready"
                        : "is-pending"
                    }
                  >
                    {summary.setup.identityStorageConfigured
                      ? "Configured"
                      : "Configuration needed"}
                  </dd>
                </div>
                {typeof summary.setup.welcomeEmailConfigured === "boolean" && (
                  <div>
                    <dt>Welcome emails</dt>
                    <dd
                      className={
                        summary.setup.welcomeEmailConfigured
                          ? "is-ready"
                          : "is-pending"
                      }
                    >
                      {summary.setup.welcomeEmailConfigured
                        ? "Sender connected"
                        : "Sender not connected"}
                    </dd>
                    <small className="staff-mail-setup-note">
                      {summary.setup.welcomeEmailConfigured
                        ? "Check member email status for queued, accepted or failed messages."
                        : "Connect a sending account in the host’s private settings. New welcome emails remain queued until it is ready."}
                    </small>
                  </div>
                )}
              </dl>
              <p>
                Configuration status does not establish lawful sales
                authorization, available stock, or a completed identity check.
              </p>
            </div>
            <div className="staff-overview-next">
              <div>
                <ShieldCheck size={21} />
                <span>Give member verification a little care.</span>
              </div>
              <button
                className="staff-action-button"
                onClick={() => onOpen("age")}
              >
                Open age checks <ArrowRight size={16} />
              </button>
            </div>
          </>
        )
      )}
    </section>
  );
}

function ErrorNotice({ error, onRetry }) {
  return error ? (
    <div className="staff-service-error" role="alert">
      <span>{error}</span>
      {onRetry && (
        <button onClick={onRetry}>
          Try again <RefreshCw size={14} />
        </button>
      )}
    </div>
  ) : null;
}

const emptyStaffForm = {
  name: "",
  username: "",
  password: "",
  confirmPassword: "",
};

export function StaffAccounts({
  request,
  onSessionExpired,
  onForbidden,
  onNotice,
}) {
  const [staff, setStaff] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [errors, setErrors] = useState({});
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(emptyStaffForm);
  const [confirmReset, setConfirmReset] = useState(false);
  const [accessChange, setAccessChange] = useState(null);
  const generation = useRef(0);
  const editorRef = useRef(null);
  const failAccess = useCallback(
    (problem) => {
      if (problem.status === 401) {
        onSessionExpired();
        return true;
      }
      if (problem.status === 403) {
        onForbidden();
        return true;
      }
      return false;
    },
    [onSessionExpired, onForbidden],
  );
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const data = await request(
        `/api/admin/staff?q=${encodeURIComponent(search.trim())}&page=${page}&limit=20`,
      );
      if (current !== generation.current) return;
      if (
        !Array.isArray(data.staff) ||
        !Number.isInteger(data.total) ||
        data.total < 0 ||
        data.staff.some(
          (person) =>
            !person.id ||
            person.role !== "staff" ||
            typeof person.username !== "string" ||
            typeof person.name !== "string" ||
            typeof person.active !== "boolean" ||
            !Number.isInteger(person.revision),
        )
      )
        throw new Error(
          "The staff account list could not be loaded. Please refresh.",
        );
      setStaff(data.staff);
      setTotal(data.total);
      if (page > 1 && !data.staff.length)
        setPage(Math.max(1, Math.ceil(data.total / 20)));
    } catch (problem) {
      if (current !== generation.current) return;
      if (!failAccess(problem)) setError(problem.message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [request, search, page, failAccess]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (!editor) return;
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    editorRef.current?.querySelector("input")?.focus({ preventScroll: true });
  }, [editor]);

  function closeEditor() {
    setEditor(null);
    setForm({ ...emptyStaffForm });
    setFormError("");
    setErrors({});
    setConfirmReset(false);
  }
  function openEditor(person = null) {
    setEditor(
      person ? { mode: "reset", person: { ...person } } : { mode: "create" },
    );
    setForm({ ...emptyStaffForm });
    setFormError("");
    setErrors({});
    setConfirmReset(false);
    setAccessChange(null);
  }
  function change(name, value) {
    setForm((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: "" }));
    setFormError("");
    setConfirmReset(false);
  }
  function validateForm() {
    const next = {};
    if (editor?.mode === "create") {
      if (form.name.trim().length < 2 || form.name.trim().length > 80)
        next.name = "Enter a name using 2 to 80 characters.";
      const username = form.username.trim().toLowerCase();
      if (
        !/^[a-z][a-z0-9._-]{2,39}$/.test(username) ||
        ["admin", "staff"].includes(username)
      )
        next.username =
          "Use 3–40 letters, numbers, dots, hyphens or underscores, starting with a letter. Choose a personal username, not admin or staff.";
    }
    if (form.password.length < 16 || form.password.length > 256)
      next.password = "Use a unique password between 16 and 256 characters.";
    if (form.confirmPassword !== form.password)
      next.confirmPassword = "The passwords do not match.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  async function saveStaff() {
    if (busy || !editor || !validateForm()) return;
    const action = editor;
    setBusy(true);
    setFormError("");
    try {
      const data =
        action.mode === "create"
          ? await request("/api/admin/staff", {
              method: "POST",
              body: JSON.stringify({
                name: form.name.trim(),
                username: form.username.trim().toLowerCase(),
                password: form.password,
              }),
            })
          : await request(
              `/api/admin/staff/${encodeURIComponent(action.person.id)}`,
              {
                method: "PATCH",
                body: JSON.stringify({
                  revision: action.person.revision,
                  password: form.password,
                }),
              },
            );
      if (!data.staff?.id || data.staff.role !== "staff")
        throw new Error(
          "The staff account change was not confirmed. Refresh before trying again.",
        );
      closeEditor();
      onNotice(
        action.mode === "create"
          ? `Staff account created for ${data.staff.name}.`
          : `Password reset for ${data.staff.name}; existing sessions ended.`,
      );
      await load();
    } catch (problem) {
      if (!failAccess(problem)) {
        if (problem.status === 409 && action.mode === "reset") {
          closeEditor();
          setError(
            "This staff account changed. Refresh the latest details before resetting its password.",
          );
          await load();
          setError(
            "This staff account changed. Review the latest details before resetting its password.",
          );
        } else setFormError(problem.message);
      }
    } finally {
      setForm((previous) => ({
        ...previous,
        password: "",
        confirmPassword: "",
      }));
      setConfirmReset(false);
      setBusy(false);
    }
  }
  async function submitForm(event) {
    event.preventDefault();
    if (busy || !validateForm()) return;
    if (editor.mode === "reset") setConfirmReset(true);
    else await saveStaff();
  }
  async function changeAccess() {
    if (!accessChange || busy) return;
    const person = accessChange;
    setBusy(true);
    setError("");
    try {
      const data = await request(
        `/api/admin/staff/${encodeURIComponent(person.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            revision: person.revision,
            active: !person.active,
          }),
        },
      );
      if (!data.staff?.id || data.staff.role !== "staff")
        throw new Error(
          "The access change was not confirmed. Refresh before trying again.",
        );
      setAccessChange(null);
      onNotice(
        `${data.staff.active ? "Access enabled" : "Access disabled"} for ${data.staff.name}.`,
      );
      await load();
    } catch (problem) {
      if (!failAccess(problem)) {
        if ([404, 409].includes(problem.status)) {
          setAccessChange(null);
          await load();
          setError(
            "This staff account changed. Review its latest details before changing access.",
          );
        } else setError(problem.message);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="staff-management staff-team-management"
      aria-labelledby="staff-team-heading"
    >
      <div className="staff-management-heading">
        <div>
          <span className="staff-eyebrow">YOUR STAFF</span>
          <h2 id="staff-team-heading">Individual access for your team.</h2>
          <p>
            Create staff sign-ins and manage who can review applications,
            products and requests. Only administrators can manage these
            accounts.
          </p>
        </div>
        <button
          className="staff-action-button"
          disabled={busy}
          onClick={() => openEditor()}
        >
          <UserPlus size={17} />
          Create staff account
        </button>
      </div>
      <div className="staff-management-toolbar">
        <label className="staff-search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Search staff accounts"
            placeholder="Search name or username"
            value={search}
            disabled={busy}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <button
          className="staff-secondary-button"
          disabled={busy || loading}
          onClick={load}
        >
          <RefreshCw size={16} className={loading ? "staff-spin" : ""} />
          Refresh staff
        </button>
      </div>
      <ErrorNotice error={error} onRetry={load} />
      {editor && (
        <section
          className="staff-team-editor"
          aria-labelledby="staff-team-editor-heading"
          ref={editorRef}
        >
          <div className="staff-team-editor-heading">
            <div>
              <span className="staff-eyebrow">
                {editor.mode === "create"
                  ? "NEW STAFF SIGN-IN"
                  : "ACCOUNT SECURITY"}
              </span>
              <h3 id="staff-team-editor-heading">
                {editor.mode === "create"
                  ? "Create staff account"
                  : `Reset password for ${editor.person.name}`}
              </h3>
            </div>
            <button
              className="staff-icon-button"
              aria-label="Close staff account form"
              disabled={busy}
              onClick={closeEditor}
            >
              <X size={18} />
            </button>
          </div>
          <form className="staff-team-form" onSubmit={submitForm} noValidate>
            <div className="staff-product-fields">
              {editor.mode === "create" && (
                <>
                  <label className="staff-product-field">
                    <span>Staff member name</span>
                    <input
                      name="staffName"
                      aria-label="Staff member name"
                      autoComplete="off"
                      value={form.name}
                      maxLength={80}
                      disabled={busy}
                      aria-invalid={!!errors.name}
                      onChange={(event) => change("name", event.target.value)}
                    />
                    {errors.name && (
                      <small className="staff-field-error">{errors.name}</small>
                    )}
                  </label>
                  <label className="staff-product-field">
                    <span>Staff username</span>
                    <input
                      name="staffUsername"
                      aria-label="Staff username"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={form.username}
                      maxLength={40}
                      disabled={busy}
                      aria-invalid={!!errors.username}
                      onChange={(event) =>
                        change("username", event.target.value.toLowerCase())
                      }
                    />
                    <small>
                      Use this personal username on the shared sign-in page.
                    </small>
                    {errors.username && (
                      <small className="staff-field-error">
                        {errors.username}
                      </small>
                    )}
                  </label>
                </>
              )}
              <label className="staff-product-field">
                <span>
                  {editor.mode === "create"
                    ? "Staff password"
                    : "New staff password"}
                </span>
                <input
                  name="staffPassword"
                  aria-label={
                    editor.mode === "create"
                      ? "Staff password"
                      : "New staff password"
                  }
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  minLength={16}
                  maxLength={256}
                  disabled={busy}
                  aria-invalid={!!errors.password}
                  onChange={(event) => change("password", event.target.value)}
                />
                <small>
                  16–256 characters. Give this directly to the staff member.
                </small>
                {errors.password && (
                  <small className="staff-field-error">{errors.password}</small>
                )}
              </label>
              <label className="staff-product-field">
                <span>
                  {editor.mode === "create"
                    ? "Confirm staff password"
                    : "Confirm new staff password"}
                </span>
                <input
                  name="staffConfirmPassword"
                  aria-label={
                    editor.mode === "create"
                      ? "Confirm staff password"
                      : "Confirm new staff password"
                  }
                  type="password"
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  minLength={16}
                  maxLength={256}
                  disabled={busy}
                  aria-invalid={!!errors.confirmPassword}
                  onChange={(event) =>
                    change("confirmPassword", event.target.value)
                  }
                />
                {errors.confirmPassword && (
                  <small className="staff-field-error">
                    {errors.confirmPassword}
                  </small>
                )}
              </label>
            </div>
            <p className="staff-team-security-note">
              <ShieldCheck size={16} />
              Passwords cannot be retrieved later. Resetting a password ends
              that staff member’s active sessions. The staff role cannot create
              other staff or access administrator controls.
            </p>
            <ErrorNotice error={formError} />
            {confirmReset ? (
              <div
                className="staff-team-confirm"
                role="region"
                aria-label="Confirm staff password reset"
              >
                <strong>Reset {editor.person.name}’s password?</strong>
                <p>
                  Their current password will stop working and their active
                  sessions will end. Share the new password through your
                  approved private process.
                </p>
                <div>
                  <button
                    type="button"
                    className="staff-secondary-button"
                    disabled={busy}
                    onClick={() => setConfirmReset(false)}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="staff-action-button"
                    disabled={busy}
                    onClick={saveStaff}
                  >
                    {busy ? (
                      <LoaderCircle size={16} className="staff-spin" />
                    ) : (
                      <KeyRound size={16} />
                    )}
                    Reset password and end sessions
                  </button>
                </div>
              </div>
            ) : (
              <div className="staff-product-form-actions">
                <button
                  type="button"
                  className="staff-secondary-button"
                  disabled={busy}
                  onClick={closeEditor}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="staff-action-button"
                  disabled={busy}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="staff-spin" />
                  ) : editor.mode === "create" ? (
                    <UserPlus size={16} />
                  ) : (
                    <KeyRound size={16} />
                  )}
                  {editor.mode === "create"
                    ? "Create account"
                    : "Review password reset"}
                </button>
              </div>
            )}
          </form>
        </section>
      )}
      {accessChange && (
        <div
          className="staff-team-access-confirm staff-team-confirm"
          role="region"
          aria-label="Confirm staff access change"
        >
          <strong>
            {accessChange.active ? "Disable" : "Enable"} access for{" "}
            {accessChange.name}?
          </strong>
          <p>
            {accessChange.active
              ? "They will be signed out and cannot open the staff dashboard until you enable their account again."
              : "They will be able to sign in using their assigned username and current password."}
          </p>
          <div>
            <button
              className="staff-secondary-button"
              disabled={busy}
              onClick={() => setAccessChange(null)}
            >
              Cancel
            </button>
            <button
              className="staff-action-button"
              disabled={busy}
              onClick={changeAccess}
            >
              {busy ? (
                <LoaderCircle size={16} className="staff-spin" />
              ) : accessChange.active ? (
                <UserRoundX size={16} />
              ) : (
                <UserRoundCheck size={16} />
              )}
              {accessChange.active ? "Disable access" : "Enable access"}
            </button>
          </div>
        </div>
      )}
      {loading ? (
        <div className="staff-management-loading" role="status">
          <LoaderCircle size={22} className="staff-spin" />
          Loading staff accounts…
        </div>
      ) : (
        !error &&
        (staff.length ? (
          <div
            role="list"
            aria-label="Staff accounts"
            className="staff-team-list"
          >
            {staff.map((person) => (
              <article
                role="listitem"
                className="staff-team-record"
                key={person.id}
              >
                <span className="staff-member-avatar" aria-hidden="true">
                  {person.name.trim().charAt(0).toUpperCase()}
                </span>
                <div className="staff-member-info">
                  <h3>{person.name}</h3>
                  <p>@{person.username}</p>
                  <small>Created {dateLabel(person.createdAt)}</small>
                </div>
                <span
                  className={`staff-team-status ${person.active ? "is-active" : "is-disabled"}`}
                >
                  {person.active ? "Active" : "Disabled"}
                </span>
                <div className="staff-team-record-actions">
                  <button
                    className="staff-secondary-button"
                    disabled={busy}
                    onClick={() => openEditor(person)}
                  >
                    <KeyRound size={15} />
                    Reset password
                  </button>
                  <button
                    className="staff-secondary-button"
                    disabled={busy}
                    onClick={() => {
                      closeEditor();
                      setAccessChange({ ...person });
                    }}
                  >
                    {person.active ? (
                      <UserRoundX size={15} />
                    ) : (
                      <UserRoundCheck size={15} />
                    )}
                    {person.active ? "Disable access" : "Enable access"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="staff-empty">
            <span>
              <Users size={30} />
            </span>
            <h3>
              {search
                ? "No staff accounts found."
                : "Give your team their own sign-in."}
            </h3>
            <p>
              {search
                ? "Search another name or username."
                : "Create a staff account to give someone access to member applications, products and orders."}
            </p>
          </div>
        ))
      )}
      <Pager
        page={page}
        pageSize={20}
        total={total}
        loading={loading || busy}
        onPage={setPage}
      />
      <p className="staff-management-privacy">
        Each staff member uses their own username and password. Disabling access
        or resetting a password ends their current sessions. Administrator
        credentials are managed separately in your host’s private settings.
      </p>
    </section>
  );
}

function MemberVerification({ member }) {
  const status = member.ageVerification?.status || "required";
  const uploadsRequired = member.identityVerification?.required === true;
  return (
    <div className="staff-directory-verification">
      <span className={`staff-age-status staff-age-status-${status}`}>
        {uploadsRequired
          ? status === "verified"
            ? "ID + selfie reviewed"
            : "ID + selfie needed"
          : ageLabels[status] || "Verification needed"}
      </span>
      {uploadsRequired && (
        <small className="staff-provider-badge">
          ID + selfie <span>·</span>{" "}
          {String(member.identityVerification?.status || "required").replaceAll(
            "_",
            " ",
          )}
        </small>
      )}
    </div>
  );
}

function Pager({ page, pageSize, total, loading, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="staff-management-pagination">
      <span>
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
          : "0 results"}
      </span>
      <div>
        <button
          className="staff-secondary-button"
          aria-label="Previous page"
          disabled={page <= 1 || loading}
          onClick={() => onPage(page - 1)}
        >
          <ArrowLeft size={15} />
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button
          className="staff-secondary-button"
          aria-label="Next page"
          disabled={page >= pages || loading}
          onClick={() => onPage(page + 1)}
        >
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

export function MemberDirectory({
  request,
  onSessionExpired,
  onOpenAge,
  canDelete = false,
  onNotice = () => {},
}) {
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteMember, setDeleteMember] = useState(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [retryingEmail, setRetryingEmail] = useState(null);
  const [emailError, setEmailError] = useState("");
  const deleteInput = useRef(null);
  const generation = useRef(0);
  const load = useCallback(
    async ({ quiet = false } = {}) => {
      const current = ++generation.current;
      if (!quiet) setLoading(true);
      setError("");
      try {
        const data = await request(
          `/api/admin/members?q=${encodeURIComponent(search.trim())}&page=${page}&limit=20`,
        );
        if (current !== generation.current) return;
        if (!Array.isArray(data.members) || !Number.isInteger(data.total))
          throw new Error(
            "The member directory could not be loaded. Please refresh.",
          );
        setMembers(data.members);
        setTotal(data.total);
        if (page > 1 && !data.members.length)
          setPage(Math.max(1, Math.ceil(data.total / 20)));
      } catch (problem) {
        if (current !== generation.current) return;
        if (problem.status === 401) onSessionExpired();
        else setError(problem.message);
      } finally {
        if (current === generation.current && !quiet) setLoading(false);
      }
    },
    [page, search, request, onSessionExpired],
  );
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden && !deleting && !retryingEmail)
        load({ quiet: true });
    }, 30000);
    return () => clearInterval(timer);
  }, [load, deleting, retryingEmail]);
  useEffect(() => {
    if (deleteMember) deleteInput.current?.focus();
  }, [deleteMember]);
  async function removeMember() {
    if (
      !canDelete ||
      !deleteMember ||
      deleting ||
      confirmEmail.trim().toLowerCase() !== deleteMember.email.toLowerCase()
    )
      return;
    if (!deleteMember.updatedAt) {
      setDeleteError(
        "Refresh the member directory before deleting this account.",
      );
      return;
    }
    setDeleting(true);
    setDeleteError("");
    try {
      const result = await request(
        `/api/admin/members/${encodeURIComponent(deleteMember.id)}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            expectedUpdatedAt: deleteMember.updatedAt,
            confirmEmail: confirmEmail.trim(),
          }),
        },
      );
      if (result?.ok !== true)
        throw new Error(
          "The server did not confirm deletion. Refresh the member directory before trying again.",
        );
      setDeleteMember(null);
      setConfirmEmail("");
      onNotice("Member account deleted and sign-in sessions ended");
      await load();
    } catch (problem) {
      if (problem.status === 401) onSessionExpired();
      else if ([404, 409].includes(problem.status)) {
        setDeleteMember(null);
        setConfirmEmail("");
        await load();
        setError(
          problem.status === 409
            ? "This member changed. Review the latest details before deleting the account."
            : "The member account is no longer available.",
        );
      } else
        setDeleteError(
          problem.message ||
            "This member could not be deleted. Please try again.",
        );
    } finally {
      setDeleting(false);
    }
  }
  async function retryWelcome(member) {
    if (!canDelete || deleting || retryingEmail) return;
    setRetryingEmail(member.id);
    setEmailError("");
    try {
      const data = await request(
        `/api/admin/members/${encodeURIComponent(member.id)}/welcome-email/retry`,
        { method: "POST", body: "{}" },
      );
      if (
        !data.welcomeEmail ||
        !["pending", "sending", "sent"].includes(data.welcomeEmail.status)
      )
        throw new Error(
          "The mail service did not confirm the retry. Refresh the member directory before trying again.",
        );
      setMembers((current) =>
        current.map((row) =>
          row.id === member.id
            ? { ...row, welcomeEmail: data.welcomeEmail }
            : row,
        ),
      );
      onNotice(
        data.welcomeEmail.status === "sent"
          ? "Welcome email accepted by the mail service"
          : "Welcome email queued for retry",
      );
    } catch (problem) {
      if (problem.status === 401) onSessionExpired();
      else
        setEmailError(
          problem.message || "The welcome email could not be retried.",
        );
    } finally {
      setRetryingEmail(null);
    }
  }
  return (
    <section
      className="staff-management"
      aria-labelledby="staff-members-heading"
    >
      <div className="staff-management-heading">
        <div>
          <span className="staff-eyebrow">YOUR COMMUNITY</span>
          <h2 id="staff-members-heading">Every member, in one place.</h2>
          <p>Find registered members and their current verification status.</p>
        </div>
        <button
          className="staff-secondary-button"
          disabled={loading || deleting}
          onClick={load}
        >
          <RefreshCw size={16} className={loading ? "staff-spin" : ""} />
          Refresh members
        </button>
      </div>
      <div className="staff-management-toolbar">
        <label className="staff-search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Search registered members"
            disabled={deleting}
            placeholder="Search name or email"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <span className="staff-private-note">
          <ShieldCheck size={15} />
          Staff access only
        </span>
      </div>
      <ErrorNotice error={error} onRetry={load} />
      <ErrorNotice error={emailError} />
      {canDelete && deleteMember && (
        <section
          className="staff-member-delete-confirm"
          role="region"
          aria-label="Delete member confirmation"
        >
          <span className="staff-eyebrow">PERMANENT ACCOUNT DELETION</span>
          <h3>Delete {deleteMember.name}?</h3>
          <p>
            This removes the member account, saved favourites, private ID/selfie
            records, pending welcome emails, and sign-in sessions. Existing
            order records remain separate business records. This action cannot
            be undone.
          </p>
          <label className="staff-product-field">
            <span>Type the member’s email to confirm</span>
            <input
              ref={deleteInput}
              type="email"
              aria-label="Confirm member email for deletion"
              value={confirmEmail}
              maxLength={254}
              autoComplete="off"
              spellCheck={false}
              disabled={deleting}
              onChange={(event) => {
                setConfirmEmail(event.target.value);
                setDeleteError("");
              }}
            />
            <small>{deleteMember.email}</small>
          </label>
          {deleteError && (
            <p className="staff-error-message" role="alert">
              {deleteError}
            </p>
          )}
          <div className="staff-member-delete-actions">
            <button
              className="staff-secondary-button"
              disabled={deleting}
              onClick={() => {
                setDeleteMember(null);
                setConfirmEmail("");
                setDeleteError("");
              }}
            >
              Keep member
            </button>
            <button
              className="staff-action-button staff-action-danger"
              disabled={
                deleting ||
                confirmEmail.trim().toLowerCase() !==
                  deleteMember.email.toLowerCase() ||
                !deleteMember.updatedAt
              }
              onClick={removeMember}
            >
              {deleting ? (
                <LoaderCircle size={16} className="staff-spin" />
              ) : (
                <Trash2 size={16} />
              )}
              {deleting ? "Deleting…" : "Delete member permanently"}
            </button>
          </div>
        </section>
      )}
      {loading ? (
        <div className="staff-management-loading" role="status">
          <LoaderCircle size={22} className="staff-spin" />
          Loading members…
        </div>
      ) : (
        !error &&
        (members.length ? (
          <div
            className="staff-member-directory"
            role="list"
            aria-label="Registered members"
          >
            {members.map((member) => (
              <article
                key={member.id}
                role="listitem"
                className="staff-member-record"
              >
                <span className="staff-member-avatar" aria-hidden="true">
                  {member.name?.trim().charAt(0).toUpperCase() || "M"}
                </span>
                <div className="staff-member-info">
                  <h3>{member.name}</h3>
                  <p>{member.email}</p>
                  <small>Joined {dateLabel(member.createdAt)}</small>
                  {member.welcomeEmail && (
                    <small
                      className={`staff-welcome-status is-${member.welcomeEmail.status}`}
                    >
                      {{
                        pending: "Welcome email queued",
                        sending: "Welcome email sending",
                        sent: "Welcome email accepted by mail service",
                        failed: "Welcome email needs attention",
                        not_queued: "No welcome email queued",
                      }[member.welcomeEmail.status] || "Welcome email not sent"}
                    </small>
                  )}
                </div>
                <MemberVerification member={member} />
                <div className="staff-member-row-actions">
                  <button
                    className="staff-secondary-button"
                    onClick={() => onOpenAge(member)}
                    disabled={deleting}
                  >
                    Age checks <ArrowRight size={14} />
                  </button>
                  {canDelete && (
                    <button
                      className="staff-secondary-button staff-member-delete-button"
                      aria-label={`Delete member ${member.email}`}
                      disabled={deleting}
                      onClick={() => {
                        setDeleteMember({ ...member });
                        setConfirmEmail("");
                        setDeleteError("");
                      }}
                    >
                      <Trash2 size={14} />
                      Delete member
                    </button>
                  )}
                  {canDelete && member.welcomeEmail?.status === "failed" && (
                    <button
                      className="staff-secondary-button"
                      aria-label={`Retry welcome email for ${member.email}`}
                      disabled={deleting || Boolean(retryingEmail)}
                      onClick={() => retryWelcome(member)}
                    >
                      {retryingEmail === member.id ? (
                        <LoaderCircle size={14} className="staff-spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                      Retry welcome email
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="staff-empty">
            <span>
              <Users size={30} />
            </span>
            <h3>
              {search ? "No members found." : "Your community starts here."}
            </h3>
            <p>
              {search
                ? "Try another name or email address."
                : "Registered members will appear here automatically."}
            </p>
            {search && (
              <button
                className="staff-secondary-button"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
              >
                Clear search <X size={14} />
              </button>
            )}
          </div>
        ))
      )}
      <Pager
        page={page}
        pageSize={20}
        total={total}
        loading={loading || deleting}
        onPage={setPage}
      />
      <p className="staff-management-privacy">
        The directory does not expose dates of birth, passwords, identity
        documents, or biometric data.
      </p>
    </section>
  );
}

const moneyInput = (cents) =>
  Number.isInteger(cents) ? (cents / 100).toFixed(2) : "";
function parsePrice(value) {
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(String(value).trim())) return null;
  const [whole, fraction = ""] = String(value).trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return cents >= 1 && cents <= 100000000 ? cents : null;
}
function productFields(product) {
  return {
    name: product?.name || "",
    category: product?.category || "Flower",
    type: product?.type || "Hybrid",
    price: moneyInput(product?.price),
    size: product?.size || "",
    description: product?.description || "",
    imageUrl: product?.imageUrl || "",
    collection: product?.collection || "Signature",
    effect: product?.effect || "",
    availability: product?.availability || "Awaiting store confirmation",
    featured: Boolean(product?.featured),
    catalogApproved: product?.catalogStatus === "approved",
    priceConfirmed: product?.priceStatus === "confirmed",
    additionalSizes: (product?.sizes || [])
      .slice(1)
      .map((size) => ({ label: size.label, price: moneyInput(size.price) })),
  };
}

function ProductEditor({
  product,
  request,
  onSessionExpired,
  onSaved,
  onClose,
}) {
  const [fields, setFields] = useState(() => productFields(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState("");
  const [dirty, setDirty] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const photoInput = useRef(null);
  const photoSection = useRef(null);
  const heading = useRef(null);
  const imagePreview = photoPreview || privateProductPhoto(fields.imageUrl);
  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview("");
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);
  useEffect(() => {
    setPreviewFailed(false);
  }, [imagePreview]);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const edit = (key, value) => {
    setFields((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setConfirm("");
  };
  const close = () => {
    if (saving || photoUploading) return;
    if (dirty) setConfirm("discard");
    else onClose();
  };
  function selectPhoto(event) {
    const file = event.target.files?.[0] || null;
    setPhotoError("");
    if (!file) {
      setPhotoFile(null);
      return;
    }
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 6 * 1024 * 1024 ||
      !file.size
    ) {
      setPhotoError("Choose a JPEG, PNG or WebP photograph of at most 6 MB.");
      setPhotoFile(null);
      event.target.value = "";
      return;
    }
    setPhotoFile(file);
    setDirty(true);
    setConfirm("");
  }
  async function uploadPhoto() {
    if (!photoFile || photoUploading || saving) return;
    const file = photoFile;
    setPhotoUploading(true);
    setPhotoError("");
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string" && reader.result.includes(",")
            ? resolve(reader.result.slice(reader.result.indexOf(",") + 1))
            : reject(
                new Error(
                  "This photo could not be read. Please choose it again.",
                ),
              );
        reader.onerror = () =>
          reject(
            new Error("This photo could not be read. Please choose it again."),
          );
        reader.readAsDataURL(file);
      });
      const result = await request("/api/admin/product-images", {
        method: "POST",
        body: JSON.stringify({ image: { data } }),
      });
      if (
        !result.image?.id ||
        uploadedPhotoId(result.image.url) !== result.image.id ||
        result.image.previewUrl !==
          `/api/admin/product-images/${result.image.id}`
      )
        throw new Error(
          "The photo upload was not confirmed. Please try again.",
        );
      edit("imageUrl", result.image.url);
      setPhotoFile(null);
      if (photoInput.current) photoInput.current.value = "";
    } catch (problem) {
      if (problem.status === 401) onSessionExpired();
      else
        setPhotoError(
          problem.message ||
            "The photo could not be uploaded. Please try again.",
        );
    } finally {
      setPhotoUploading(false);
    }
  }
  function removePhoto() {
    setPhotoFile(null);
    setPhotoError("");
    if (photoInput.current) photoInput.current.value = "";
    edit("imageUrl", "");
  }
  async function save(event) {
    event.preventDefault();
    if (saving || photoUploading) return;
    if (photoFile) {
      setPhotoError(
        "Upload the selected photo before saving the product, or remove the selection.",
      );
      photoSection.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }
    const price = parsePrice(fields.price);
    if (price === null) {
      setError(
        "Enter a rand price between R0.01 and R1,000,000.00, using at most two decimal places.",
      );
      return;
    }
    const extras = fields.additionalSizes.map((size) => ({
      label: size.label.trim(),
      price: parsePrice(size.price),
    }));
    if (extras.some((size) => !size.label || size.price === null)) {
      setError("Each additional size needs a label and a valid rand price.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      name: fields.name.trim(),
      category: fields.category,
      visual: visuals[fields.category],
      type: fields.type.trim(),
      price,
      size: fields.size.trim(),
      description: fields.description.trim(),
      imageUrl: fields.imageUrl.trim(),
      collection: fields.collection,
      effect: fields.effect.trim(),
      availability: fields.availability.trim(),
      featured: fields.featured,
      catalogStatus: fields.catalogApproved ? "approved" : "unapproved",
      priceStatus: fields.priceConfirmed ? "confirmed" : "indicative",
      sizes: extras.length
        ? [{ label: fields.size.trim(), price }, ...extras]
        : [],
      ...(!product ? { status: "draft" } : { revision: product.revision }),
    };
    try {
      const data = await request(
        product
          ? `/api/admin/products/${encodeURIComponent(product.id)}`
          : "/api/admin/products",
        { method: product ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      if (!data.product?.id)
        throw new Error(
          "The server did not confirm the product. Refresh before trying again.",
        );
      setDirty(false);
      onSaved(
        data.product,
        product ? "Product changes saved" : "Product draft created",
      );
    } catch (problem) {
      if (problem.status === 401) onSessionExpired();
      else
        setError(
          problem.status === 409
            ? "This product changed in another session. Close this editor and refresh before saving."
            : problem.message,
        );
    } finally {
      setSaving(false);
    }
  }
  const field = (name, label, { wide, ...options } = {}) => (
    <label className={`staff-product-field ${wide ? "is-wide" : ""}`}>
      <span>{label}</span>
      <input
        name={name}
        value={fields[name]}
        onChange={(event) => edit(name, event.target.value)}
        disabled={saving || photoUploading}
        {...options}
      />
    </label>
  );
  return (
    <section
      className="staff-product-editor"
      aria-labelledby="staff-product-editor-heading"
    >
      <div className="staff-management-heading">
        <div>
          <span className="staff-eyebrow">
            {product
              ? productStatusLabels[product.status]?.toUpperCase()
              : "NEW PRODUCT"}
          </span>
          <h2 id="staff-product-editor-heading" tabIndex={-1} ref={heading}>
            {product ? "Make every detail count." : "Add something good."}
          </h2>
          <p>
            {product
              ? "Changes to a published product appear on the storefront after saving."
              : "Create a draft, review the details, then publish it to the storefront."}
          </p>
        </div>
        <button
          className="staff-secondary-button"
          disabled={saving || photoUploading}
          onClick={close}
        >
          <X size={16} />
          Close editor
        </button>
      </div>
      {confirm === "discard" && (
        <div
          className="staff-product-confirm"
          role="region"
          aria-label="Discard product changes"
        >
          <strong>Discard unsaved changes?</strong>
          <p>Your saved product will stay as it is.</p>
          <div>
            <button
              className="staff-secondary-button"
              onClick={() => setConfirm("")}
            >
              Keep editing
            </button>
            <button
              className="staff-action-button staff-action-danger"
              onClick={onClose}
            >
              Discard changes
            </button>
          </div>
        </div>
      )}
      <form className="staff-product-form" onSubmit={save}>
        <div className="staff-product-fields">
          {field("name", "Product name", {
            required: true,
            minLength: 2,
            maxLength: 120,
            wide: true,
            autoComplete: "off",
          })}
          <label className="staff-product-field">
            <span>Category</span>
            <select
              aria-label="Category"
              value={fields.category}
              onChange={(event) => {
                edit("category", event.target.value);
                if (!product)
                  edit(
                    "type",
                    event.target.value === "Accessories"
                      ? "Accessory"
                      : "Hybrid",
                  );
              }}
              disabled={saving || photoUploading}
            >
              {categories.slice(1).map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label className="staff-product-field">
            <span>Collection</span>
            <select
              aria-label="Collection"
              value={fields.collection}
              onChange={(event) => edit("collection", event.target.value)}
              disabled={saving || photoUploading}
            >
              {["Signature", "Ritual", "Reserve"].map((collection) => (
                <option key={collection}>{collection}</option>
              ))}
            </select>
          </label>
          {field("price", "Price (ZAR)", {
            required: true,
            inputMode: "decimal",
            placeholder: "320.00",
            maxLength: 10,
          })}
          {field("size", "Size or pack", {
            required: true,
            maxLength: 80,
            placeholder: "3.5 g or 1 piece",
          })}
          {field("type", "Product type", {
            required: true,
            maxLength: 40,
            placeholder: "Hybrid or Accessory",
          })}
          {field("effect", "Short product note", {
            maxLength: 500,
            placeholder: "Berry & citrus",
          })}
          <label className="staff-product-field is-wide">
            <span>Description</span>
            <textarea
              aria-label="Description"
              name="description"
              rows={5}
              value={fields.description}
              onChange={(event) => edit("description", event.target.value)}
              minLength={10}
              maxLength={4000}
              required
              disabled={saving || photoUploading}
            />
            <small>
              Use accurate product details. Avoid unsupported health, potency,
              or availability claims.
            </small>
          </label>
          {field("availability", "Availability note", {
            maxLength: 160,
            wide: true,
          })}
          <section
            className="staff-product-photo is-wide"
            aria-labelledby="staff-product-photo-heading"
            ref={photoSection}
          >
            <div className="staff-product-photo-copy">
              <h3 id="staff-product-photo-heading">Product photo</h3>
              <p>
                Upload a clear product photograph from your phone or computer.
                JPEG, PNG or WebP, up to 6 MB, at least 64 × 64 pixels. Use an
                image approved for public display.
              </p>
              <label className="staff-product-field">
                <span>Choose product photo</span>
                <input
                  ref={photoInput}
                  type="file"
                  name="productPhoto"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Choose product photo"
                  disabled={saving || photoUploading}
                  onChange={selectPhoto}
                />
              </label>
              <div className="staff-product-photo-actions">
                <button
                  type="button"
                  className="staff-action-button"
                  onClick={uploadPhoto}
                  disabled={saving || photoUploading || !photoFile}
                >
                  {photoUploading ? (
                    <LoaderCircle size={16} className="staff-spin" />
                  ) : (
                    <Upload size={16} />
                  )}
                  {photoUploading ? "Uploading photo…" : "Upload photo"}
                </button>
                {(photoFile || fields.imageUrl) && (
                  <button
                    type="button"
                    className="staff-secondary-button"
                    disabled={saving || photoUploading}
                    onClick={removePhoto}
                  >
                    <X size={15} />
                    Remove photo
                  </button>
                )}
              </div>
              <p className="staff-product-photo-status" role="status">
                {photoUploading
                  ? "Uploading and preparing your photo…"
                  : photoFile
                    ? "Photo selected. Upload it before saving the product."
                    : uploadedPhotoId(fields.imageUrl)
                      ? "Photo uploaded. Save the product to use it. Draft photos stay private until publication."
                      : "Upload a photo or keep the category presentation."}
              </p>
              {photoError && (
                <p className="staff-error-message" role="alert">
                  {photoError}
                </p>
              )}
            </div>
            <div className="staff-product-photo-preview">
              {imagePreview && !previewFailed ? (
                <img
                  src={imagePreview}
                  alt={
                    photoFile
                      ? "Selected product photo"
                      : "Product photo preview"
                  }
                  onError={() => setPreviewFailed(true)}
                />
              ) : (
                <div>
                  <Image size={38} />
                  <span>
                    {previewFailed
                      ? "Photo preview unavailable"
                      : "Your product photo"}
                  </span>
                </div>
              )}
            </div>
          </section>
          <details
            className="staff-product-image-link is-wide"
            open={Boolean(fields.imageUrl && !uploadedPhotoId(fields.imageUrl))}
          >
            <summary>Use an image URL instead (optional)</summary>
            {field("imageUrl", "Product image URL (optional)", {
              maxLength: 2048,
              placeholder: "https://…/product.webp",
              wide: true,
              disabled: saving || photoUploading || Boolean(photoFile),
            })}
            <p className="staff-product-field-help">
              <Image size={15} />
              Use a direct secure product-image URL. Uploaded photos are saved
              automatically in the image field.
            </p>
          </details>
        </div>
        <div className="staff-product-sizes">
          <h3>Additional sizes</h3>
          <p>
            The main size and price above are the first option. Add other pack
            sizes if needed.
          </p>
          {fields.additionalSizes.map((size, index) => (
            <div className="staff-size-row" key={index}>
              <label>
                <span>Size {index + 2}</span>
                <input
                  aria-label={`Additional size ${index + 1}`}
                  value={size.label}
                  maxLength={80}
                  required
                  disabled={saving || photoUploading}
                  onChange={(event) =>
                    edit(
                      "additionalSizes",
                      fields.additionalSizes.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, label: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                <span>Price (ZAR)</span>
                <input
                  aria-label={`Additional size ${index + 1} price`}
                  inputMode="decimal"
                  value={size.price}
                  required
                  disabled={saving || photoUploading}
                  onChange={(event) =>
                    edit(
                      "additionalSizes",
                      fields.additionalSizes.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, price: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <button
                className="staff-secondary-button"
                type="button"
                aria-label={`Remove additional size ${index + 1}`}
                disabled={saving || photoUploading}
                onClick={() =>
                  edit(
                    "additionalSizes",
                    fields.additionalSizes.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="staff-secondary-button"
            disabled={saving || fields.additionalSizes.length >= 11}
            onClick={() =>
              edit("additionalSizes", [
                ...fields.additionalSizes,
                { label: "", price: "" },
              ])
            }
          >
            <Plus size={15} />
            Add size
          </button>
        </div>
        <label className="staff-product-checkbox">
          <input
            type="checkbox"
            checked={fields.featured}
            onChange={(event) => edit("featured", event.target.checked)}
            disabled={saving || photoUploading}
          />
          <span>Feature this product on the home page</span>
        </label>
        <div className="staff-product-approvals">
          <h3>Store approval</h3>
          <p>
            Record these confirmations only after checking the actual product
            and price. They do not verify potency or sales authorization.
          </p>
          <label className="staff-product-checkbox">
            <input
              type="checkbox"
              checked={fields.catalogApproved}
              onChange={(event) =>
                edit("catalogApproved", event.target.checked)
              }
              disabled={saving || photoUploading}
            />
            <span>Product details approved by the store</span>
          </label>
          <label className="staff-product-checkbox">
            <input
              type="checkbox"
              checked={fields.priceConfirmed}
              onChange={(event) => edit("priceConfirmed", event.target.checked)}
              disabled={saving || photoUploading}
            />
            <span>Price confirmed by the store</span>
          </label>
        </div>
        <ErrorNotice error={error} />
        <div className="staff-product-form-actions">
          <button
            className="staff-secondary-button"
            type="button"
            disabled={saving || photoUploading}
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="staff-action-button"
            disabled={saving || photoUploading || Boolean(photoFile)}
            type="submit"
          >
            {saving ? (
              <LoaderCircle size={16} className="staff-spin" />
            ) : (
              <Check size={16} />
            )}
            {saving
              ? "Saving…"
              : product
                ? "Save product changes"
                : "Save draft"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ProductManagement({ request, onSessionExpired, onNotice }) {
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(null);
  const [action, setAction] = useState(null);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const confirmation = useRef(null);
  useEffect(() => {
    if (action) confirmation.current?.focus();
  }, [action]);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const data = await request(
        `/api/admin/products?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search.trim())}&limit=50&offset=${(page - 1) * 50}`,
      );
      if (current !== generation.current) return;
      if (!Array.isArray(data.products) || !Number.isInteger(data.total))
        throw new Error(
          "The product list could not be loaded. Please refresh.",
        );
      setProducts(data.products);
      setTotal(data.total);
      if (page > 1 && !data.products.length)
        setPage(Math.max(1, Math.ceil(data.total / 50)));
    } catch (problem) {
      if (current !== generation.current) return;
      if (problem.status === 401) onSessionExpired();
      else setError(problem.message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [page, search, status, request, onSessionExpired]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [load]);
  async function changeStatus() {
    if (!action || saving) return;
    setSaving(true);
    setError("");
    try {
      const data = await request(
        `/api/admin/products/${encodeURIComponent(action.product.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: action.status,
            revision: action.product.revision,
          }),
        },
      );
      if (!data.product?.id || data.product.status !== action.status)
        throw new Error(
          "The product status was not confirmed. Refresh before retrying.",
        );
      onNotice(
        action.status === "published"
          ? "Product published to the storefront"
          : action.status === "archived"
            ? "Product archived from the storefront"
            : "Product moved to drafts",
      );
      setAction(null);
      await load();
    } catch (problem) {
      if (problem.status === 401) onSessionExpired();
      else {
        setError(problem.message);
        if (problem.status === 409) {
          setAction(null);
          await load();
          setError(
            "The product changed in another session. Review the latest version before updating its status.",
          );
        }
      }
    } finally {
      setSaving(false);
    }
  }
  if (editor)
    return (
      <ProductEditor
        key={editor.product?.id || "new"}
        product={editor.product}
        request={request}
        onSessionExpired={onSessionExpired}
        onClose={() => setEditor(null)}
        onSaved={(product, message) => {
          setEditor(null);
          onNotice(message);
          load();
        }}
      />
    );
  return (
    <section
      className="staff-management"
      aria-labelledby="staff-products-heading"
    >
      <div className="staff-management-heading">
        <div>
          <span className="staff-eyebrow">YOUR STOREFRONT</span>
          <h2 id="staff-products-heading">Curate the good things.</h2>
          <p>
            Manage products here. Published changes are shared with the live
            storefront.
          </p>
        </div>
        <button
          className="staff-action-button"
          disabled={saving}
          onClick={() => {
            setError("");
            setAction(null);
            setEditor({ product: null });
          }}
        >
          <Plus size={17} />
          Add product
        </button>
      </div>
      <div className="staff-management-toolbar">
        <div
          className="staff-filter-tabs"
          role="group"
          aria-label="Filter products"
        >
          {["all", "draft", "published", "archived"].map((value) => (
            <button
              key={value}
              className={status === value ? "selected" : ""}
              aria-pressed={status === value}
              disabled={saving}
              onClick={() => {
                setStatus(value);
                setPage(1);
                setAction(null);
              }}
            >
              {value === "all"
                ? "All products"
                : value === "draft"
                  ? "Drafts"
                  : productStatusLabels[value]}
            </button>
          ))}
        </div>
        <label className="staff-search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Search staff products"
            placeholder="Find a product"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
              setAction(null);
            }}
          />
        </label>
        <button
          className="staff-secondary-button staff-icon-button"
          disabled={loading || saving}
          aria-label="Refresh products"
          onClick={load}
        >
          <RefreshCw size={16} className={loading ? "staff-spin" : ""} />
        </button>
      </div>
      <ErrorNotice error={error} onRetry={action ? undefined : load} />
      {action && (
        <div
          className="staff-product-confirm"
          role="region"
          aria-label="Confirm product status"
          tabIndex={-1}
          ref={confirmation}
        >
          <strong>
            {action.status === "published"
              ? `Publish ${action.product.name}?`
              : action.status === "archived"
                ? `Archive ${action.product.name}?`
                : `Move ${action.product.name} to drafts?`}
          </strong>
          <p>
            {action.status === "published"
              ? "The product, price and image will be visible on the storefront. Confirm the details are accurate and approved for publication."
              : "This product will be removed from the current storefront. Existing order records will keep their original details."}
          </p>
          <div>
            <button
              className="staff-secondary-button"
              disabled={saving}
              onClick={() => setAction(null)}
            >
              Cancel
            </button>
            <button
              className={`staff-action-button ${action.status === "archived" ? "staff-action-danger" : ""}`}
              disabled={saving}
              onClick={changeStatus}
            >
              {saving ? (
                <LoaderCircle size={16} className="staff-spin" />
              ) : (
                <Check size={16} />
              )}
              {saving
                ? "Saving…"
                : action.status === "published"
                  ? "Confirm publish"
                  : action.status === "archived"
                    ? "Confirm archive"
                    : "Confirm move to drafts"}
            </button>
          </div>
        </div>
      )}
      {loading ? (
        <div className="staff-management-loading" role="status">
          <LoaderCircle size={22} className="staff-spin" />
          Loading products…
        </div>
      ) : (
        !error &&
        (products.length ? (
          <div
            className="staff-product-list"
            role="list"
            aria-label="Managed products"
          >
            {products.map((product) => (
              <article
                key={product.id}
                className="staff-product-record"
                role="listitem"
              >
                <img
                  src={photoFor(product)}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    const fallback = photoFor({ ...product, imageUrl: "" });
                    if (!event.currentTarget.src.endsWith(fallback))
                      event.currentTarget.src = fallback;
                  }}
                />
                <div className="staff-product-info">
                  <h3>{product.name}</h3>
                  <p>
                    {product.category} <span>·</span> {product.size}
                  </p>
                  <small>Updated {dateLabel(product.updatedAt)}</small>
                </div>
                <strong className="staff-product-price">
                  {formatMoney(product.price)}
                </strong>
                <span className={`staff-product-status is-${product.status}`}>
                  {productStatusLabels[product.status] || "Draft"}
                </span>
                <div className="staff-product-row-actions">
                  <button
                    className="staff-secondary-button"
                    disabled={saving}
                    onClick={() => {
                      setAction(null);
                      setEditor({ product });
                    }}
                    aria-label={`Edit ${product.name}`}
                  >
                    <Pencil size={14} />
                    Edit
                  </button>
                  {product.status !== "published" && (
                    <button
                      className="staff-secondary-button"
                      disabled={saving}
                      onClick={() => {
                        setError("");
                        setAction({ product, status: "published" });
                      }}
                      aria-label={`Publish ${product.name}`}
                    >
                      Publish <ArrowRight size={14} />
                    </button>
                  )}
                  {product.status === "published" && (
                    <button
                      className="staff-secondary-button"
                      disabled={saving}
                      onClick={() => {
                        setError("");
                        setAction({ product, status: "draft" });
                      }}
                      aria-label={`Unpublish ${product.name}`}
                    >
                      Unpublish
                    </button>
                  )}
                  {product.status !== "archived" && (
                    <button
                      className="staff-secondary-button staff-icon-button"
                      disabled={saving}
                      onClick={() => {
                        setError("");
                        setAction({ product, status: "archived" });
                      }}
                      aria-label={`Archive ${product.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="staff-empty">
            <span>
              <PackagePlus size={30} />
            </span>
            <h3>{search ? "No products found." : "Room for something new."}</h3>
            <p>
              {search
                ? "Try another product name or clear your filters."
                : "Add a product draft or choose another status to browse the catalog."}
            </p>
          </div>
        ))
      )}
      <Pager
        page={page}
        pageSize={50}
        total={total}
        loading={loading}
        onPage={setPage}
      />
      <p className="staff-management-privacy">
        Publishing controls visibility. It does not establish lawful sales
        authorization, verified potency, or available stock.
      </p>
    </section>
  );
}
