import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  IdCard,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  PackageCheck,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Truck,
  X,
} from "lucide-react";
import { formatMoney } from "../lib/order.js";
import "../staff.css";

const statusLabels = {
  pending: "New request",
  confirmed: "Confirmed",
  preparing: "Preparing",
  out_for_delivery: "Out for delivery",
  ready_for_pickup: "Ready for pickup",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

const statusActions = {
  confirmed: "Confirm request",
  preparing: "Start preparing",
  out_for_delivery: "Mark out for delivery",
  ready_for_pickup: "Mark ready for pickup",
  delivered: "Mark delivered",
  completed: "Complete pickup",
  cancelled: "Cancel request",
};

const readinessLabels = {
  businessName: "Business name",
  businessJurisdiction: "Operating jurisdiction",
  jurisdiction: "Operating jurisdiction",
  storeLicenseNumber: "Sales authorization",
  license: "Sales authorization",
  deliveryZips: "Delivery postal codes",
  pickupAddress: "Pickup address",
  contactEmail: "Public contact email",
  adminPassword: "Staff authentication",
  liveOrdersEnabled: "Live intake setting",
};

function allowedStatuses(order) {
  const next = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["preparing", "cancelled"],
    preparing: [
      order.fulfillment === "pickup" ? "ready_for_pickup" : "out_for_delivery",
      "cancelled",
    ],
    out_for_delivery: ["delivered"],
    ready_for_pickup: ["completed"],
  };
  return next[order.status] || [];
}

function readableDate(value, detailed = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(detailed ? { year: "numeric" } : {}),
  });
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
  } catch {
    throw new ApiError(
      "The staff service could not be reached. Check your connection and try again.",
      0,
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "The staff dashboard needs the order server. This static preview does not provide staff access.",
      response.status === 200 ? 404 : response.status,
    );
  }
  if (!response.ok) {
    const message =
      typeof data.error === "string"
        ? data.error
        : data.error?.message || data.message;
    throw new ApiError(
      message || "The request could not be completed. Please try again.",
      response.status,
    );
  }
  return data;
}

function Brand({ small = false }) {
  return (
    <a
      className={`staff-brand ${small ? "staff-brand-small" : ""}`}
      href="/"
      aria-label="Loud and Cana storefront"
    >
      LOUD<span>+</span>CANA<sup>®</sup>
    </a>
  );
}

function Sun() {
  return (
    <svg viewBox="0 0 60 60" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      >
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} d="M30 7v13" transform={`rotate(${i * 45} 30 30)`} />
        ))}
      </g>
    </svg>
  );
}

function Status({ value }) {
  return (
    <span className={`staff-status staff-status-${value}`}>
      {statusLabels[value] || value}
    </span>
  );
}

function OrderDetail({ order, onUpdate, saving, updateError }) {
  const transitions = allowedStatuses(order);
  const [selectedStatus, setSelectedStatus] = useState(transitions[0] || "");
  const [confirming, setConfirming] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    setSelectedStatus(allowedStatuses(order)[0] || "");
    setConfirming(false);
    setReviewed(false);
  }, [order.id, order.status]);
  const customer = order.customer || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const totals = order.totals || {};
  return (
    <div className="staff-order-detail">
      <div className="staff-detail-grid">
        <section className="staff-detail-items">
          <h4>
            <ShoppingBag size={15} />
            The good inside
          </h4>
          <div className="staff-item-list">
            {items.map((item, index) => (
              <div
                className="staff-line-item"
                key={`${item.productId || item.id || item.name}-${index}`}
              >
                <span className="staff-line-quantity">{item.quantity}×</span>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.size || "Standard"}</span>
                </div>
                <strong>
                  {formatMoney((item.price || 0) * item.quantity)}
                </strong>
              </div>
            ))}
          </div>
          <div className="staff-order-totals">
            <div>
              <span>Subtotal</span>
              <span>{formatMoney(totals.subtotal || 0)}</span>
            </div>
            {totals.discount > 0 && (
              <div>
                <span>Discount</span>
                <span>−{formatMoney(totals.discount)}</span>
              </div>
            )}
            <div>
              <span>
                {order.fulfillment === "pickup" ? "Pickup" : "Delivery"}
              </span>
              <span>
                {totals.deliveryFee ? formatMoney(totals.deliveryFee) : "Free"}
              </span>
            </div>
            <div className="staff-detail-total">
              <strong>Request total</strong>
              <strong>{formatMoney(totals.total || 0)}</strong>
            </div>
          </div>
          <p className="staff-payment-note">
            No online payment collected by this app.
          </p>
        </section>
        <section className="staff-detail-customer">
          <h4>
            <MapPin size={15} />
            {order.fulfillment === "pickup"
              ? "Pickup customer"
              : "Delivery details"}
          </h4>
          <strong className="staff-customer-name">
            {customer.name || "Name unavailable"}
          </strong>
          {order.fulfillment !== "pickup" && (
            <p className="staff-address">
              {customer.address}
              <br />
              {[customer.city, customer.postcode].filter(Boolean).join(", ")}
            </p>
          )}
          <div className="staff-contact-links">
            {customer.phone && (
              <a href={`tel:${customer.phone.replace(/[^+\d]/g, "")}`}>
                <Phone size={13} />
                {customer.phone}
              </a>
            )}
            {customer.email && (
              <a href={`mailto:${customer.email}`}>
                <Mail size={13} />
                {customer.email}
              </a>
            )}
          </div>
          {order.notes && (
            <div className="staff-delivery-notes">
              <span>CUSTOMER NOTES</span>
              <p>{order.notes}</p>
            </div>
          )}
          <p className="staff-submitted">
            Requested {readableDate(order.createdAt, true)}
          </p>
        </section>
      </div>
      {transitions.length > 0 ? (
        <section className="staff-status-update">
          <div>
            <h4>Next good step</h4>
            <p>
              {order.status === "pending"
                ? "Review this request before accepting it. Confirm lawful authorization, availability, and the customer verification process."
                : "Update the request when your team has completed the next step."}
            </p>
          </div>
          <div className="staff-status-controls">
            <label
              className="staff-visually-hidden"
              htmlFor={`status-${order.id}`}
            >
              Next status for {order.id}
            </label>
            <div className="staff-select-wrap">
              <select
                id={`status-${order.id}`}
                value={selectedStatus}
                onChange={(event) => {
                  setSelectedStatus(event.target.value);
                  setConfirming(false);
                  setReviewed(false);
                }}
                disabled={saving}
              >
                {transitions.map((status) => (
                  <option key={status} value={status}>
                    {statusActions[status]}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
            <button
              className={`staff-action-button ${selectedStatus === "cancelled" ? "staff-action-danger" : ""}`}
              disabled={saving || !selectedStatus}
              onClick={() => setConfirming(true)}
            >
              {statusActions[selectedStatus] || "Update request"}
              <ArrowRight size={15} />
            </button>
          </div>
          {confirming && (
            <div className="staff-confirm-update">
              <div>
                <strong>
                  {selectedStatus === "cancelled"
                    ? "Cancel this request?"
                    : `Update to ${statusLabels[selectedStatus].toLowerCase()}?`}
                </strong>
                {selectedStatus === "confirmed" ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(event) => setReviewed(event.target.checked)}
                    />
                    <span>
                      I have completed the required authorization, stock,
                      delivery-area, and customer verification checks.
                    </span>
                  </label>
                ) : (
                  <p>The customer’s tracking page will show the new status.</p>
                )}
              </div>
              <div className="staff-confirm-buttons">
                <button
                  className="staff-secondary-button"
                  disabled={saving}
                  onClick={() => setConfirming(false)}
                >
                  Go back
                </button>
                <button
                  className={`staff-action-button ${selectedStatus === "cancelled" ? "staff-action-danger" : ""}`}
                  disabled={
                    saving || (selectedStatus === "confirmed" && !reviewed)
                  }
                  onClick={() => onUpdate(order.id, selectedStatus)}
                >
                  {saving ? (
                    <LoaderCircle size={15} className="staff-spin" />
                  ) : (
                    <Check size={15} />
                  )}
                  {saving ? "Updating…" : "Confirm update"}
                </button>
              </div>
            </div>
          )}
          {updateError && (
            <p className="staff-error-message" role="alert">
              {updateError}
            </p>
          )}
        </section>
      ) : (
        <div className="staff-terminal-note">
          <CheckCircle2 size={16} />
          <span>
            This request is{" "}
            {statusLabels[order.status]?.toLowerCase() || order.status}. Its
            status can no longer be changed.
          </span>
        </div>
      )}
    </div>
  );
}

const ageStatusLabels = {
  required: "Member submission needed",
  pending: "Pending ID check",
  verified: "18+ ID checked",
  rejected: "Not verified",
};

const rejectionReasons = {
  identity_not_confirmed:
    "The original ID could not confirm the applicant's identity.",
  details_mismatch: "The original ID did not match the submitted details.",
  unable_to_verify: "The in-person age check could not be completed.",
};

function birthDateLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "Not retained";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleDateString("en-ZA", {
        timeZone: "Africa/Johannesburg",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

function AgeReviewCard({ member, saving, blocked = false, error, onReview }) {
  const status = member.ageVerification?.status || "required";
  const submittedAt = member.ageVerification?.submittedAt;
  const [reviewedSubmissionAt, setReviewedSubmissionAt] = useState(submittedAt);
  const [expanded, setExpanded] = useState(false);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [ageChecked, setAgeChecked] = useState(false);
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    setIdentityChecked(false);
    setAgeChecked(false);
    setDecision("");
    setReason("");
    setReviewedSubmissionAt(submittedAt);
  }, [member.id, status, submittedAt, member.name, member.birthDate]);
  const pending = status === "pending";
  const canVerify =
    pending &&
    Boolean(member.birthDate) &&
    Boolean(reviewedSubmissionAt) &&
    reviewedSubmissionAt === submittedAt &&
    identityChecked &&
    ageChecked;
  return (
    <article className={`staff-age-card ${expanded ? "is-expanded" : ""}`}>
      <button
        className="staff-age-summary"
        aria-expanded={expanded}
        aria-controls={`age-detail-${member.id}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="staff-age-person">
          <strong>{member.name}</strong>
          <span>{member.email}</span>
        </span>
        <span className={`staff-age-status staff-age-status-${status}`}>
          {ageStatusLabels[status]}
        </span>
        <ChevronRight size={18} className="staff-expand-icon" />
      </button>
      {expanded && (
        <div className="staff-age-detail" id={`age-detail-${member.id}`}>
          <dl className="staff-age-facts">
            <div>
              <dt>
                <CalendarDays size={15} /> Declared date of birth
              </dt>
              <dd>{birthDateLabel(member.birthDate)}</dd>
            </div>
            <div>
              <dt>Minimum age</dt>
              <dd>18 years</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>
                {member.ageVerification?.submittedAt
                  ? readableDate(member.ageVerification.submittedAt, true)
                  : "Not submitted"}
              </dd>
            </div>
            {member.ageVerification?.verifiedAt && (
              <div>
                <dt>ID checked</dt>
                <dd>{readableDate(member.ageVerification.verifiedAt, true)}</dd>
              </div>
            )}
          </dl>
          {pending ? (
            <>
              <div className="staff-age-method">
                <IdCard size={21} />
                <div>
                  <strong>In-person check of the original photo ID</strong>
                  <p>
                    Compare the government-issued ID with the person present.
                    Check the photograph, full name and date of birth against
                    this application. A date declaration or quiz result does not
                    verify identity.
                  </p>
                </div>
              </div>
              <fieldset
                className="staff-age-checks"
                disabled={saving || blocked}
              >
                <legend>Checks you have completed</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={identityChecked}
                    onChange={(event) => {
                      setIdentityChecked(event.target.checked);
                      setDecision("");
                    }}
                  />
                  <span>
                    I checked the original valid government-issued photo ID and
                    confirmed that its photograph, full name and date of birth
                    match the person and application.
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={ageChecked}
                    onChange={(event) => {
                      setAgeChecked(event.target.checked);
                      setDecision("");
                    }}
                  />
                  <span>
                    The original ID confirms this person is 18 years or older
                    today.
                  </span>
                </label>
              </fieldset>
              <p className="staff-age-privacy">
                Do not photograph, upload, copy or record an ID number here.
                Once reviewed, the submitted date of birth is removed; only the
                review outcome and audit details are retained.
              </p>
              <div className="staff-age-actions">
                <button
                  className="staff-action-button"
                  disabled={saving || blocked || !canVerify}
                  onClick={() => setDecision("verified")}
                >
                  <BadgeCheck size={17} /> Verify 18+ ID check
                </button>
                <button
                  className="staff-secondary-button"
                  disabled={saving || blocked}
                  onClick={() => setDecision("rejected")}
                >
                  Do not verify
                </button>
              </div>
              {decision && (
                <div
                  className="staff-age-confirm"
                  role="region"
                  aria-label="Confirm age check decision"
                >
                  <strong>
                    {decision === "verified"
                      ? "Record this completed in-person ID check?"
                      : "Record that this application could not be verified?"}
                  </strong>
                  {decision === "verified" ? (
                    <p>
                      The member's age status will become “18+ ID checked”. This
                      confirms the age check only; it does not authorize
                      commercial sales.
                    </p>
                  ) : (
                    <label className="staff-age-reason">
                      Reason for not verifying
                      <select
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        disabled={saving || blocked}
                        required
                      >
                        <option value="">Choose a reason</option>
                        {Object.entries(rejectionReasons).map(
                          ([value, label]) => (
                            <option value={value} key={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}
                  <div className="staff-age-actions">
                    <button
                      className="staff-secondary-button"
                      disabled={saving || blocked}
                      onClick={() => setDecision("")}
                    >
                      Go back
                    </button>
                    <button
                      className={`staff-action-button ${decision === "rejected" ? "staff-action-danger" : ""}`}
                      disabled={
                        saving ||
                        blocked ||
                        (decision === "verified" ? !canVerify : !reason)
                      }
                      onClick={() =>
                        onReview(
                          member.id,
                          decision === "verified"
                            ? {
                                decision,
                                method: "in_person",
                                expectedSubmittedAt: reviewedSubmissionAt,
                                identityChecked,
                                ageChecked,
                              }
                            : {
                                decision,
                                method: "in_person",
                                expectedSubmittedAt: reviewedSubmissionAt,
                                reason,
                              },
                        )
                      }
                    >
                      {saving ? (
                        <LoaderCircle size={16} className="staff-spin" />
                      ) : (
                        <Check size={16} />
                      )}
                      {saving
                        ? "Saving check…"
                        : decision === "verified"
                          ? "Confirm completed ID check"
                          : "Confirm not verified"}
                    </button>
                  </div>
                </div>
              )}
              {error && (
                <p className="staff-error-message" role="alert">
                  {error}
                </p>
              )}
            </>
          ) : (
            <div className="staff-age-outcome">
              <ShieldCheck size={20} />
              <p>
                {status === "verified"
                  ? "An in-person 18+ ID check was recorded. The submitted date of birth is no longer retained."
                  : status === "rejected"
                    ? rejectionReasons[member.ageVerification?.reason] ||
                      "The application was not verified. The member must submit a new age-check request from their account before staff can review it again."
                    : "The member must submit their date of birth, consent and responsible-use questions from their account before an in-person ID check can be reviewed here."}
                {status === "rejected" &&
                  " The member can submit a new request from their account."}
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function AgeVerificationQueue({ onSessionExpired, onNotice }) {
  const [members, setMembers] = useState([]);
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewErrorId, setReviewErrorId] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const loadId = useRef(0);
  const load = useCallback(
    async ({ quiet = false } = {}) => {
      const currentLoad = ++loadId.current;
      if (!quiet) setLoading(true);
      try {
        const data = await request(
          `/api/admin/members/age-verifications?status=${encodeURIComponent(status)}`,
        );
        if (currentLoad !== loadId.current) return;
        if (!Array.isArray(data.members))
          throw new ApiError(
            "The server returned an invalid age-check list. Please refresh.",
            502,
          );
        setMembers(data.members);
        setError("");
        setUpdatedAt(new Date());
      } catch (problem) {
        if (currentLoad !== loadId.current) return;
        if (problem.status === 401) onSessionExpired();
        else setError(problem.message);
      } finally {
        if (currentLoad === loadId.current) setLoading(false);
      }
    },
    [status, onSessionExpired],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) load({ quiet: true });
    }, 30000);
    return () => clearInterval(timer);
  }, [load]);
  const displayed = members.filter((member) =>
    `${member.name} ${member.email}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  async function review(id, payload) {
    if (savingId) return;
    setSavingId(id);
    setReviewError("");
    setReviewErrorId(id);
    try {
      const data = await request(
        `/api/admin/members/${encodeURIComponent(id)}/age-verification`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      if (data.member?.ageVerification?.status !== payload.decision)
        throw new ApiError(
          "The server did not confirm the review outcome. Refresh the list before retrying.",
          502,
        );
      setMembers((current) => current.filter((member) => member.id !== id));
      onNotice(
        payload.decision === "verified"
          ? "Completed in-person 18+ ID check recorded"
          : "Application marked not verified",
      );
      await load({ quiet: true });
    } catch (problem) {
      if (problem.status === 401) onSessionExpired();
      else {
        setReviewError(problem.message);
        if (problem.status === 409) {
          await load({ quiet: true });
          setError(
            problem.message ||
              "This application changed. Review the latest details before recording an ID check.",
          );
        }
      }
    } finally {
      setSavingId(null);
    }
  }
  return (
    <section
      className="staff-age-workspace"
      aria-labelledby="staff-age-heading"
    >
      <div className="staff-age-heading">
        <div>
          <span className="staff-eyebrow">MEMBER AGE VERIFICATION</span>
          <h2 id="staff-age-heading">Review original photo ID.</h2>
          <p>
            Review adult eligibility with the person present. Question answers
            and date declarations are not identity proof.
          </p>
        </div>
        <button
          className="staff-secondary-button"
          disabled={loading}
          onClick={() => load()}
        >
          <RefreshCw size={16} className={loading ? "staff-spin" : ""} />
          {loading ? "Refreshing…" : "Refresh age checks"}
        </button>
      </div>
      <div className="staff-age-toolbar">
        <div
          className="staff-filter-tabs"
          role="group"
          aria-label="Filter age checks"
        >
          {[
            ["pending", "Pending"],
            ["required", "Submission needed"],
            ["verified", "Verified"],
            ["rejected", "Not verified"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={status === value ? "selected" : ""}
              aria-pressed={status === value}
              disabled={Boolean(savingId)}
              onClick={() => {
                loadId.current += 1;
                setStatus(value);
                setMembers([]);
                setReviewError("");
                setReviewErrorId(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="staff-search">
          <Search size={17} />
          <input
            aria-label="Search member age checks"
            type="search"
            placeholder="Find a member by name or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      {error && (
        <div className="staff-service-error" role="alert">
          <span>{error}</span>
          <button onClick={() => load()}>
            Try again <RefreshCw size={14} />
          </button>
        </div>
      )}
      {loading && members.length === 0 ? (
        <div className="staff-age-loading" role="status">
          <LoaderCircle size={22} className="staff-spin" />
          Loading member age checks…
        </div>
      ) : displayed.length ? (
        <div className="staff-age-list">
          {displayed.map((member) => (
            <AgeReviewCard
              key={member.id}
              member={member}
              saving={savingId === member.id}
              blocked={Boolean(savingId) && savingId !== member.id}
              error={reviewErrorId === member.id ? reviewError : ""}
              onReview={review}
            />
          ))}
        </div>
      ) : (
        !error && (
          <div className="staff-empty staff-age-empty">
            <span>
              <IdCard size={30} />
            </span>
            <h3>
              {search
                ? "No members match your search."
                : status === "pending"
                  ? "No pending ID checks."
                  : "No members in this status."}
            </h3>
            <p>
              {search
                ? "Try a different name or clear the search."
                : status === "pending"
                  ? "New adult age-check submissions will appear here. Members complete their date declaration and questions before staff review an original photo ID."
                  : "Choose another age-check status to view its members."}
            </p>
            {search && (
              <button
                className="staff-secondary-button"
                onClick={() => setSearch("")}
              >
                Clear search <X size={15} />
              </button>
            )}
          </div>
        )
      )}
      <div className="staff-age-list-footer">
        <span>
          {displayed.length} member{displayed.length === 1 ? "" : "s"}
        </span>
        <span>
          {updatedAt
            ? `Updated ${updatedAt.toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" })} SAST`
            : "Updates every 30 seconds"}
        </span>
      </div>
    </section>
  );
}

export default function StaffDashboard() {
  const [auth, setAuth] = useState("checking");
  const [workspace, setWorkspace] = useState("orders");
  const [orders, setOrders] = useState([]);
  const [config, setConfig] = useState(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [serviceError, setServiceError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [fulfillment, setFulfillment] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [updateError, setUpdateError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  const sessionExpired = useCallback(() => {
    setAuth("login");
    setOrders([]);
  }, []);

  const loadOrders = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const data = await request("/api/admin/orders");
      if (!Array.isArray(data.orders))
        throw new ApiError("The server returned an invalid request list.", 502);
      setOrders(data.orders);
      setAuth("authenticated");
      setServiceError("");
      setUpdatedAt(new Date());
    } catch (error) {
      if (error.status === 401) {
        setAuth("login");
        setOrders([]);
      } else {
        setServiceError(error.message);
        setAuth((previous) =>
          previous === "checking" ? "unavailable" : previous,
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    request("/api/config")
      .then(setConfig)
      .catch(() => {});
    loadOrders();
  }, [loadOrders]);
  useEffect(() => {
    if (auth !== "authenticated") return;
    const timer = setInterval(() => {
      if (!document.hidden) loadOrders({ quiet: true });
    }, 30000);
    return () => clearInterval(timer);
  }, [auth, loadOrders]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function login(event) {
    event.preventDefault();
    if (!password.trim()) {
      setLoginError("Enter your staff password.");
      return;
    }
    setLoginLoading(true);
    setLoginError("");
    try {
      await request("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setPassword("");
      await loadOrders();
    } catch (error) {
      setLoginError(
        error.status === 401
          ? "That password wasn’t recognized. Please try again."
          : error.message,
      );
      setPassword("");
    } finally {
      setLoginLoading(false);
    }
  }

  async function logout() {
    try {
      await request("/api/admin/logout", { method: "POST", body: "{}" });
      setAuth("login");
      setOrders([]);
      setPassword("");
      setExpandedId(null);
    } catch (error) {
      setServiceError(error.message);
    }
  }

  async function updateOrder(id, status) {
    setSavingId(id);
    setUpdateError("");
    try {
      const data = await request(
        `/api/admin/orders/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      if (!data.order?.id)
        throw new ApiError(
          "The server did not confirm the update. Refresh the request list before retrying.",
          502,
        );
      setOrders((previous) =>
        previous.map((order) => (order.id === id ? data.order : order)),
      );
      setNotice(`${id} · ${statusLabels[status]}`);
    } catch (error) {
      if (error.status === 401) {
        setAuth("login");
        setOrders([]);
      } else setUpdateError(error.message);
    } finally {
      setSavingId(null);
    }
  }

  const counts = useMemo(
    () => ({
      pending: orders.filter((order) => order.status === "pending").length,
      active: orders.filter((order) =>
        [
          "confirmed",
          "preparing",
          "out_for_delivery",
          "ready_for_pickup",
        ].includes(order.status),
      ).length,
      completed: orders.filter((order) =>
        ["completed", "delivered"].includes(order.status),
      ).length,
      cancelled: orders.filter((order) => order.status === "cancelled").length,
    }),
    [orders],
  );
  const displayedOrders = useMemo(
    () =>
      orders
        .filter((order) => {
          const statusMatch =
            filter === "all" ||
            (filter === "active"
              ? [
                  "confirmed",
                  "preparing",
                  "out_for_delivery",
                  "ready_for_pickup",
                ].includes(order.status)
              : filter === "completed"
                ? ["completed", "delivered"].includes(order.status)
                : order.status === filter);
          const fulfillmentMatch =
            fulfillment === "all" || order.fulfillment === fulfillment;
          const term = search.toLowerCase().trim();
          const searchable =
            `${order.id} ${order.customer?.name || ""} ${order.customer?.email || ""} ${order.customer?.postcode || ""}`.toLowerCase();
          return (
            statusMatch &&
            fulfillmentMatch &&
            (!term || searchable.includes(term))
          );
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [orders, filter, fulfillment, search],
  );
  const readiness = config?.readiness;
  const missingLabels = {
    BUSINESS_NAME: "business name",
    BUSINESS_JURISDICTION: "operating jurisdiction",
    STORE_LICENSE_NUMBER: "sales authorization",
    LEGAL_SALES_AUTHORIZATION_CONFIRMED: "authorization confirmation",
    DELIVERY_ZIPS: "delivery postal codes",
    PICKUP_ADDRESS: "pickup address",
    CONTACT_EMAIL: "public contact email",
    ADMIN_PASSWORD: "staff authentication",
    LIVE_ORDERS_ENABLED: "live-intake setting",
    CATALOG_APPROVED: "approved product catalog",
  };
  const missing = Array.isArray(config?.missingRequirements)
    ? config.missingRequirements.map((name) => missingLabels[name] || name)
    : Array.isArray(readiness?.missing)
      ? readiness.missing
      : readiness && typeof readiness === "object"
        ? Object.entries(readiness)
            .filter(([name, value]) => name !== "ready" && value === false)
            .map(
              ([name]) =>
                readinessLabels[name] ||
                name.replace(/([a-z])([A-Z])/g, "$1 $2"),
            )
        : [];
  const isLive = config?.mode === "live";

  if (auth !== "authenticated")
    return (
      <div className="staff-app staff-login-page">
        <div className="staff-login-top">
          <Brand />
          <a href="/">
            Back to the good stuff <ArrowUpRight size={15} />
          </a>
        </div>
        <main className="staff-login-layout">
          <section className="staff-login-story">
            <span className="staff-eyebrow">
              THE GOOD STUFF, BEHIND THE SCENES.
            </span>
            <h1>
              A little care.
              <br />A lot of good.
            </h1>
            <p>
              Your team’s space to review requests,
              <br />
              keep things moving, and mind the details.
            </p>
            <div className="staff-login-sun">
              <Sun />
            </div>
            <div className="staff-login-caption">
              <span>LOUD + CANA · GAUTENG</span>
              <span>THOUGHTFULLY MANAGED.</span>
            </div>
          </section>
          <section className="staff-login-card">
            <span className="staff-login-icon">
              <LockKeyhole size={24} />
            </span>
            <span className="staff-eyebrow">FOR THE TEAM</span>
            <h2>
              {auth === "checking"
                ? "Getting things ready."
                : auth === "unavailable"
                  ? "The server comes first."
                  : "Good to see you."}
            </h2>
            {auth === "checking" ? (
              <p className="staff-login-description">
                <LoaderCircle className="staff-spin" size={17} />
                Checking your staff session…
              </p>
            ) : auth === "unavailable" ? (
              <>
                <p className="staff-login-description">
                  Staff access needs the deployed order service. It is
                  unavailable in an offline or static preview.
                </p>
                <p className="staff-error-message" role="alert">
                  {serviceError}
                </p>
                <button
                  className="staff-action-button staff-login-submit"
                  onClick={() => loadOrders()}
                  disabled={loading}
                >
                  {loading ? (
                    <LoaderCircle className="staff-spin" size={16} />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  Try the service again
                </button>
                <a className="staff-login-return" href="/">
                  Explore the storefront <ArrowUpRight size={15} />
                </a>
              </>
            ) : (
              <>
                <p className="staff-login-description">
                  Sign in to review and manage customer requests.
                </p>
                <form onSubmit={login}>
                  <label className="staff-login-label" htmlFor="staff-password">
                    Staff password
                  </label>
                  <input
                    id="staff-password"
                    className="staff-password-input"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your staff password"
                    required
                    disabled={loginLoading}
                    aria-invalid={!!loginError}
                    aria-describedby={
                      loginError ? "staff-login-error" : undefined
                    }
                  />
                  {loginError && (
                    <p
                      className="staff-error-message"
                      role="alert"
                      id="staff-login-error"
                    >
                      {loginError}
                    </p>
                  )}
                  <button
                    className="staff-action-button staff-login-submit"
                    type="submit"
                    disabled={loginLoading}
                  >
                    {loginLoading ? "Signing in…" : "Let’s get to the good"}
                    {loginLoading ? (
                      <LoaderCircle size={17} className="staff-spin" />
                    ) : (
                      <ArrowRight size={17} />
                    )}
                  </button>
                </form>
                <div className="staff-login-security">
                  <ShieldCheck size={16} />
                  <p>
                    Staff sessions are protected with secure cookies.
                    <br />
                    Your password is never saved in this browser.
                  </p>
                </div>
              </>
            )}
          </section>
        </main>
        <div className="staff-login-footer">
          Loud + Cana staff workspace · Authorized personnel only.
        </div>
      </div>
    );

  return (
    <div className="staff-app staff-dashboard">
      <aside className="staff-sidebar">
        <Brand small />
        <span className="staff-workspace-label">THE STAFF WORKSPACE</span>
        <nav aria-label="Staff navigation">
          <button
            className={workspace === "orders" ? "staff-nav-active" : ""}
            onClick={() => {
              setWorkspace("orders");
              setFilter("all");
              setSearch("");
            }}
          >
            <ClipboardList size={17} />
            Order requests<span>{orders.length}</span>
          </button>
          <button
            className={workspace === "age" ? "staff-nav-active" : ""}
            onClick={() => setWorkspace("age")}
          >
            <IdCard size={17} />
            Age checks
          </button>
          <a href="/">
            <ShoppingBag size={17} />
            View storefront
            <ArrowUpRight size={14} />
          </a>
        </nav>
        <div className="staff-sidebar-note">
          <Sun />
          <p>
            A little extra care
            <br />
            makes a lot of good.
          </p>
        </div>
        <button className="staff-signout" onClick={logout}>
          <LogOut size={16} />
          Sign out
        </button>
      </aside>
      <div className="staff-dashboard-body">
        <header className="staff-topbar">
          <div>
            <span className="staff-eyebrow">LOUD + CANA</span>
            <p>
              Gauteng, South Africa <span>·</span> Staff workspace
            </p>
          </div>
          <div className="staff-topbar-actions">
            <span className={`staff-service-badge ${isLive ? "is-live" : ""}`}>
              <span />
              {isLive ? "Live intake enabled" : "Intake paused"}
            </span>
            <button
              className="staff-mobile-signout"
              aria-label="Sign out"
              onClick={logout}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="staff-main">
          <div className="staff-page-heading">
            <div>
              <span className="staff-eyebrow">GOOD THINGS TO TAKE CARE OF</span>
              <h1>
                {workspace === "age"
                  ? "Adult age checks. A little care."
                  : "Every request. A little care."}
              </h1>
              <p>
                {workspace === "age"
                  ? "Check original photo ID and record a clear, private review outcome."
                  : "Review requests, verify the details, and keep your team in step."}
              </p>
            </div>
            {workspace === "orders" && (
              <button
                className="staff-secondary-button staff-refresh"
                onClick={() => loadOrders()}
                disabled={loading}
              >
                <RefreshCw size={15} className={loading ? "staff-spin" : ""} />
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            )}
          </div>
          <div
            className="staff-workspace-tabs"
            role="tablist"
            aria-label="Staff workspace"
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "orders"
                  : event.key === "End"
                    ? "age"
                    : workspace === "orders"
                      ? "age"
                      : "orders";
              setWorkspace(next);
              document
                .getElementById(
                  next === "orders" ? "staff-orders-tab" : "staff-age-tab",
                )
                ?.focus();
            }}
          >
            <button
              id="staff-orders-tab"
              role="tab"
              aria-selected={workspace === "orders"}
              tabIndex={workspace === "orders" ? 0 : -1}
              aria-controls="staff-orders-panel"
              onClick={() => setWorkspace("orders")}
            >
              <ClipboardList size={17} />
              Order requests
            </button>
            <button
              id="staff-age-tab"
              role="tab"
              aria-selected={workspace === "age"}
              tabIndex={workspace === "age" ? 0 : -1}
              aria-controls="staff-age-panel"
              onClick={() => setWorkspace("age")}
            >
              <IdCard size={17} />
              Age checks
            </button>
          </div>
          <div
            id="staff-orders-panel"
            role="tabpanel"
            aria-labelledby="staff-orders-tab"
            hidden={workspace !== "orders"}
          >
            {!isLive && (
              <section className="staff-readiness-notice">
                <ShieldCheck size={21} />
                <div>
                  <strong>Live intake is not enabled.</strong>
                  <p>
                    {missing.length
                      ? `Configure ${missing.join(", ")} before accepting live requests.`
                      : "Configure the business’s lawful sales authorization, store details, delivery coverage, and live-intake setting before launch."}
                  </p>
                  <small>
                    Commercial cannabis sales require appropriate authorization.
                    This workspace does not verify that authorization for you.
                  </small>
                </div>
              </section>
            )}
            {serviceError && (
              <div className="staff-service-error" role="alert">
                <span>{serviceError}</span>
                <button onClick={() => loadOrders()}>
                  Try again <RefreshCw size={13} />
                </button>
              </div>
            )}
            <section className="staff-stats" aria-label="Request overview">
              {[
                {
                  name: "New requests",
                  count: counts.pending,
                  icon: Clock3,
                  filter: "pending",
                  color: "orange",
                },
                {
                  name: "In progress",
                  count: counts.active,
                  icon: Truck,
                  filter: "active",
                  color: "green",
                },
                {
                  name: "Completed",
                  count: counts.completed,
                  icon: PackageCheck,
                  filter: "completed",
                  color: "olive",
                },
                {
                  name: "All requests",
                  count: orders.length,
                  icon: ClipboardList,
                  filter: "all",
                  color: "neutral",
                },
              ].map(
                ({ name, count, icon: Icon, filter: nextFilter, color }) => (
                  <button
                    key={name}
                    className={`staff-stat ${filter === nextFilter ? "is-selected" : ""}`}
                    onClick={() => setFilter(nextFilter)}
                  >
                    <div>
                      <span>{name}</span>
                      <strong>{count}</strong>
                    </div>
                    <span className={`staff-stat-icon ${color}`}>
                      <Icon size={20} />
                    </span>
                  </button>
                ),
              )}
            </section>
            <section className="staff-requests">
              <div className="staff-request-section-heading">
                <h2>
                  The daily good<span>.</span>
                </h2>
                <p>
                  {updatedAt
                    ? `Updated ${updatedAt.toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" })} SAST`
                    : "Updates every 30 seconds"}
                </p>
              </div>
              <div className="staff-request-toolbar">
                <div
                  className="staff-filter-tabs"
                  role="group"
                  aria-label="Filter requests"
                >
                  {[
                    ["all", "All requests"],
                    ["pending", "New"],
                    ["active", "In progress"],
                    ["completed", "Completed"],
                    ["cancelled", "Cancelled"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={filter === value ? "selected" : ""}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                      {value === "pending" && counts.pending > 0 && (
                        <span>{counts.pending}</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="staff-request-tools">
                  <label className="staff-search">
                    <Search size={16} />
                    <input
                      aria-label="Search order requests"
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Find an order or customer"
                    />
                  </label>
                  <div className="staff-select-wrap">
                    <select
                      aria-label="Filter fulfillment"
                      value={fulfillment}
                      onChange={(event) => setFulfillment(event.target.value)}
                    >
                      <option value="all">All fulfillment</option>
                      <option value="delivery">Delivery</option>
                      <option value="pickup">Pickup</option>
                    </select>
                    <ChevronDown size={13} />
                  </div>
                </div>
              </div>
              <div className="staff-list-header" aria-hidden="true">
                <span>REQUEST / CUSTOMER</span>
                <span>FULFILLMENT</span>
                <span>STATUS</span>
                <span>TOTAL</span>
                <span />
              </div>
              {displayedOrders.length ? (
                <div className="staff-order-list">
                  {displayedOrders.map((order) => {
                    const expanded = expandedId === order.id;
                    const quantity = (order.items || []).reduce(
                      (sum, item) => sum + item.quantity,
                      0,
                    );
                    return (
                      <article
                        className={`staff-order ${expanded ? "is-expanded" : ""}`}
                        key={order.id}
                      >
                        <button
                          className="staff-order-summary"
                          aria-expanded={expanded}
                          aria-controls={`detail-${order.id}`}
                          onClick={() => {
                            setExpandedId(expanded ? null : order.id);
                            setUpdateError("");
                          }}
                        >
                          <div className="staff-order-identity">
                            <strong>{order.id}</strong>
                            <span>
                              {order.customer?.name || "Customer"}{" "}
                              <span className="staff-dot-separator">·</span>{" "}
                              {quantity} item{quantity === 1 ? "" : "s"}
                            </span>
                            <small>{readableDate(order.createdAt)}</small>
                          </div>
                          <div className="staff-fulfillment">
                            {order.fulfillment === "pickup" ? (
                              <ShoppingBag size={15} />
                            ) : (
                              <Truck size={16} />
                            )}
                            <span>
                              {order.fulfillment === "pickup"
                                ? "Pickup"
                                : "Delivery"}
                            </span>
                          </div>
                          <Status value={order.status} />
                          <strong className="staff-order-amount">
                            {formatMoney(order.totals?.total || 0)}
                          </strong>
                          <ChevronRight
                            className="staff-expand-icon"
                            size={17}
                          />
                        </button>
                        {expanded && (
                          <div id={`detail-${order.id}`}>
                            <OrderDetail
                              order={order}
                              onUpdate={updateOrder}
                              saving={savingId === order.id}
                              updateError={updateError}
                            />
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="staff-empty">
                  <span>
                    <ClipboardList size={30} />
                  </span>
                  <h3>
                    {orders.length
                      ? "No requests match that search."
                      : "A fresh start. Good things ahead."}
                  </h3>
                  <p>
                    {orders.length
                      ? "Try another name, order number, or filter."
                      : "New customer requests will appear here when live intake is configured and enabled."}
                  </p>
                  {orders.length > 0 && (
                    <button
                      className="staff-secondary-button"
                      onClick={() => {
                        setFilter("all");
                        setFulfillment("all");
                        setSearch("");
                      }}
                    >
                      Clear filters <X size={14} />
                    </button>
                  )}
                </div>
              )}
              <div className="staff-list-footer">
                <span>
                  {displayedOrders.length} of {orders.length} requests
                </span>
                <span>
                  <ShieldCheck size={12} />
                  Manual review. Thoughtful fulfillment.
                </span>
              </div>
            </section>
          </div>
          <div
            id="staff-age-panel"
            role="tabpanel"
            aria-labelledby="staff-age-tab"
            hidden={workspace !== "age"}
          >
            {workspace === "age" && (
              <AgeVerificationQueue
                onSessionExpired={sessionExpired}
                onNotice={setNotice}
              />
            )}
          </div>
        </main>
        <footer className="staff-dashboard-footer">
          <span>
            LOUD + CANA <span>·</span> A little loud. A lot of good.
          </span>
          <a href="/">
            Back to the storefront <ArrowUpRight size={12} />
          </a>
        </footer>
      </div>
      {notice && (
        <div className="staff-toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
