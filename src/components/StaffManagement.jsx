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
  Trash2,
  Users,
  X,
} from "lucide-react";
import { categories } from "../lib/products.js";
import { formatMoney } from "../lib/order.js";

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
const photoFor = (product) =>
  product.imageUrl ||
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
                  Staff sign-in and secure identity storage use separate private
                  host settings.
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

export function MemberDirectory({ request, onSessionExpired, onOpenAge }) {
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
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
      if (current === generation.current) setLoading(false);
    }
  }, [page, search, request, onSessionExpired]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
    };
  }, [load]);
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
          disabled={loading}
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
                </div>
                <MemberVerification member={member} />
                <button
                  className="staff-secondary-button"
                  onClick={() => onOpenAge(member)}
                >
                  Age checks <ArrowRight size={14} />
                </button>
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
        loading={loading}
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
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const edit = (key, value) => {
    setFields((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setConfirm("");
  };
  const close = () => {
    if (dirty) setConfirm("discard");
    else onClose();
  };
  async function save(event) {
    event.preventDefault();
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
        disabled={saving}
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
          disabled={saving}
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
              disabled={saving}
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
              disabled={saving}
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
              disabled={saving}
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
          {field("imageUrl", "Product image URL (optional)", {
            maxLength: 2048,
            placeholder: "https://…/product.webp",
            wide: true,
          })}
          <p className="staff-product-field-help is-wide">
            <Image size={15} />
            Use a secure JPG, PNG, WebP or AVIF image URL. Leave this blank to
            use the category presentation. The image must be suitable for public
            display.
          </p>
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
                  disabled={saving}
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
                  disabled={saving}
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
                disabled={saving}
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
            disabled={saving}
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
              disabled={saving}
            />
            <span>Product details approved by the store</span>
          </label>
          <label className="staff-product-checkbox">
            <input
              type="checkbox"
              checked={fields.priceConfirmed}
              onChange={(event) => edit("priceConfirmed", event.target.checked)}
              disabled={saving}
            />
            <span>Price confirmed by the store</span>
          </label>
        </div>
        <ErrorNotice error={error} />
        <div className="staff-product-form-actions">
          <button
            className="staff-secondary-button"
            type="button"
            disabled={saving}
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="staff-action-button"
            disabled={saving}
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
