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
  Users,
  PackagePlus,
  LayoutDashboard,
  UserPlus,
  Bell,
} from "lucide-react";
import { Navigate, Link } from "react-router-dom";
import { formatMoney } from "../lib/order.js";
import {
  AdminOverview,
  MemberDirectory,
  ProductManagement,
  StaffAccounts,
} from "./StaffManagement.jsx";
import "../staff.css";
import StaffNotifications, {
  NotificationBell,
  useStaffNotifications,
} from "./StaffNotifications.jsx";

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
  const uploadsRequired = member.identityVerification?.required === true;
  const identity = member.identityVerification || {};
  const uploadId = identity.uploadId;
  const uploadedEvidenceReady =
    uploadsRequired &&
    identity.status === "pending" &&
    Boolean(uploadId) &&
    identity.documentAvailable !== false &&
    identity.selfieAvailable !== false;
  const submittedAt =
    member.ageVerification?.submittedAt || identity.submittedAt;
  const [reviewedSubmissionAt, setReviewedSubmissionAt] = useState(submittedAt);
  const [reviewedUploadId, setReviewedUploadId] = useState(uploadId);
  const [largeImages, setLargeImages] = useState(false);
  const [evidenceLoad, setEvidenceLoad] = useState({
    document: false,
    selfie: false,
    failed: false,
  });
  const [imageRevision, setImageRevision] = useState(0);
  const reviewReasons = uploadsRequired
    ? {
        identity_not_confirmed:
          "The ID photograph and selfie could not be matched.",
        details_mismatch:
          "The name or birth date did not match the application.",
        unable_to_verify: "The uploaded evidence could not be verified.",
      }
    : rejectionReasons;
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
    setReviewedUploadId(uploadId);
    setLargeImages(false);
    setEvidenceLoad({ document: false, selfie: false, failed: false });
  }, [
    member.id,
    status,
    submittedAt,
    member.name,
    member.birthDate,
    uploadId,
    identity.status,
  ]);
  const pending = status === "pending";
  const canVerify =
    pending &&
    (!uploadsRequired ||
      (uploadedEvidenceReady &&
        reviewedUploadId === uploadId &&
        evidenceLoad.document &&
        evidenceLoad.selfie &&
        !evidenceLoad.failed)) &&
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
          {uploadsRequired
            ? status === "verified"
              ? "ID + selfie reviewed"
              : uploadedEvidenceReady
                ? "ID + selfie awaiting review"
                : "ID + selfie needed"
            : ageStatusLabels[status]}
        </span>
        <ChevronRight size={18} className="staff-expand-icon" />
      </button>
      {expanded && (
        <div className="staff-age-detail" id={`age-detail-${member.id}`}>
          <dl className="staff-age-facts">
            {(!uploadsRequired || uploadedEvidenceReady) && (
              <div>
                <dt>
                  <CalendarDays size={15} /> Declared date of birth
                </dt>
                <dd>{birthDateLabel(member.birthDate)}</dd>
              </div>
            )}
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
          {uploadsRequired && !uploadedEvidenceReady ? (
            <div className="staff-age-outcome staff-provider-outcome">
              <ShieldCheck size={21} />
              <div>
                <strong>
                  {status === "verified"
                    ? "Manual ID and selfie review recorded"
                    : "ID document and selfie required"}
                </strong>
                <p>
                  {status === "verified"
                    ? "An authorised staff member recorded a manual comparison of the uploaded ID and selfie. This is not an automated face match, liveness test, or confirmation that an original document was inspected. The uploaded images are no longer retained."
                    : identity.status === "rejected"
                      ? "The previous upload was not verified. The member must submit a new ID document and selfie from their account before staff can review again."
                      : identity.status === "expired"
                        ? "The previous upload expired and its images were removed. The member must submit a new ID document and selfie."
                        : "The member must upload an ID document and a selfie from their account. Staff can review only a current pending upload."}
                </p>
                <p>
                  Upload status:{" "}
                  {String(identity.status || "not_started").replaceAll(
                    "_",
                    " ",
                  )}
                </p>
                {identity.configured === false && (
                  <p>
                    Secure identity storage is not configured. The owner must
                    complete its private storage settings before images can be
                    uploaded.
                  </p>
                )}
              </div>
            </div>
          ) : pending ? (
            <>
              {uploadedEvidenceReady && (
                <section
                  className={`staff-private-evidence ${largeImages ? "is-large" : ""}`}
                  aria-label="Private ID document and selfie"
                >
                  <div className="staff-private-evidence-heading">
                    <div>
                      <strong>Compare the uploaded images.</strong>
                      <p>
                        Visible only to authorised staff. Review the document
                        photograph against the selfie, then check the
                        application name and date of birth. These uploads do not
                        establish liveness or prove that an original document is
                        present.
                      </p>
                    </div>
                    <button
                      className="staff-secondary-button"
                      onClick={() => setLargeImages(!largeImages)}
                      aria-pressed={largeImages}
                    >
                      {largeImages ? "Compact images" : "Enlarge images"}
                    </button>
                  </div>
                  <div className="staff-private-evidence-images">
                    {["document", "selfie"].map((kind) => (
                      <figure
                        key={`${uploadId}-${submittedAt}-${member.name}-${member.birthDate}-${imageRevision}-${kind}`}
                      >
                        <img
                          src={`/api/admin/members/${encodeURIComponent(member.id)}/identity-documents/${kind}?uploadId=${encodeURIComponent(uploadId)}&reload=${imageRevision}`}
                          alt={`Private uploaded ${kind === "document" ? "ID document" : "selfie"} for ${member.name}`}
                          loading="lazy"
                          onLoad={() =>
                            setEvidenceLoad((current) => ({
                              ...current,
                              [kind]: true,
                            }))
                          }
                          onError={() =>
                            setEvidenceLoad((current) => ({
                              ...current,
                              [kind]: false,
                              failed: true,
                            }))
                          }
                        />
                        <figcaption>
                          Uploaded{" "}
                          {kind === "document" ? "ID document" : "selfie"}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                  {evidenceLoad.failed && (
                    <div className="staff-private-evidence-error">
                      <p className="staff-error-message" role="alert">
                        A private image could not be loaded. Refresh the
                        age-check queue and inspect both current images before
                        recording a match.
                      </p>
                      <button
                        className="staff-secondary-button"
                        onClick={() => {
                          setEvidenceLoad({
                            document: false,
                            selfie: false,
                            failed: false,
                          });
                          setImageRevision((value) => value + 1);
                        }}
                      >
                        <RefreshCw size={15} />
                        Reload private images
                      </button>
                    </div>
                  )}
                  <p className="staff-private-evidence-notice">
                    <ShieldCheck size={15} />
                    Do not copy or share these images or record document
                    numbers. The application removes the uploaded images after
                    review or expiry.
                  </p>
                </section>
              )}
              <div className="staff-age-method">
                <IdCard size={21} />
                <div>
                  <strong>
                    {uploadedEvidenceReady
                      ? "Manual comparison of the uploaded ID and selfie"
                      : "In-person check of the original photo ID"}
                  </strong>
                  <p>
                    {uploadedEvidenceReady
                      ? "Check that the document is readable and the face in its photograph appears to match the uploaded selfie. Match the full name and date of birth to this application. A selfie comparison is not automated face recognition or a liveness test."
                      : "Compare the government-issued ID with the person present. Check the photograph, full name and date of birth against this application. A date declaration or quiz result does not verify identity."}
                  </p>
                </div>
              </div>
              <fieldset
                className="staff-age-checks"
                disabled={
                  saving ||
                  blocked ||
                  (uploadedEvidenceReady &&
                    (!evidenceLoad.document ||
                      !evidenceLoad.selfie ||
                      evidenceLoad.failed))
                }
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
                    {uploadedEvidenceReady
                      ? "I reviewed the uploaded ID document and compared its photograph with the uploaded selfie. The face appears to match, and the visible full name and date of birth match this application."
                      : "I checked the original valid government-issued photo ID and confirmed that its photograph, full name and date of birth match the person and application."}
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
                    {uploadedEvidenceReady
                      ? "The date of birth visible on the uploaded ID shows that this applicant is 18 years or older today."
                      : "The original ID confirms this person is 18 years or older today."}
                  </span>
                </label>
              </fieldset>
              <p className="staff-age-privacy">
                {uploadedEvidenceReady
                  ? "Do not copy these images or record ID numbers. Recording a decision removes the uploaded evidence and pending birth date; the review outcome and minimal audit details remain."
                  : "Do not photograph, upload, copy or record an ID number here. Once reviewed, the submitted date of birth is removed; only the review outcome and audit details are retained."}
              </p>
              <div className="staff-age-actions">
                <button
                  className="staff-action-button"
                  disabled={saving || blocked || !canVerify}
                  onClick={() => setDecision("verified")}
                >
                  <BadgeCheck size={17} />{" "}
                  {uploadedEvidenceReady
                    ? "Record ID + selfie check"
                    : "Verify 18+ ID check"}
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
                      ? uploadedEvidenceReady
                        ? "Record this completed manual ID and selfie comparison?"
                        : "Record this completed in-person ID check?"
                      : "Record that this application could not be verified?"}
                  </strong>
                  {decision === "verified" ? (
                    <p>
                      {uploadedEvidenceReady
                        ? "This records your manual comparison and 18+ date check. It does not claim automated facial recognition, liveness, or an original-document inspection, and does not authorise commercial sales."
                        : "The member's age status will become “18+ ID checked”. This confirms the age check only; it does not authorize commercial sales."}
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
                        {Object.entries(reviewReasons).map(([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
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
                                method: uploadedEvidenceReady
                                  ? "uploaded_id_selfie"
                                  : "in_person",
                                expectedSubmittedAt: reviewedSubmissionAt,
                                ...(uploadedEvidenceReady
                                  ? { expectedUploadId: reviewedUploadId }
                                  : {}),
                                identityChecked,
                                ageChecked,
                              }
                            : {
                                decision,
                                method: uploadedEvidenceReady
                                  ? "uploaded_id_selfie"
                                  : "in_person",
                                expectedSubmittedAt: reviewedSubmissionAt,
                                ...(uploadedEvidenceReady
                                  ? { expectedUploadId: reviewedUploadId }
                                  : {}),
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
                          ? uploadedEvidenceReady
                            ? "Confirm manual ID + selfie check"
                            : "Confirm completed ID check"
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

function AgeVerificationQueue({ onSessionExpired, onNotice, initialMember }) {
  const [members, setMembers] = useState([]);
  const [status, setStatus] = useState(
    initialMember?.ageVerification?.status || "pending",
  );
  const [focusedMemberId, setFocusedMemberId] = useState(initialMember?.id || "");
  const [search, setSearch] = useState(initialMember?.id ? "" : initialMember?.email || "");
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
          `/api/admin/members/age-verifications?status=${encodeURIComponent(status)}${focusedMemberId ? `&memberId=${encodeURIComponent(focusedMemberId)}` : ""}`,
        );
        if (currentLoad !== loadId.current) return;
        if (!Array.isArray(data.members))
          throw new ApiError(
            "The server returned an invalid age-check list. Please refresh.",
            502,
          );
        setMembers(data.members);
        const focusedStatus = data.members[0]?.ageVerification?.status;
        if (
          focusedMemberId &&
          focusedStatus !== status &&
          ["required", "pending", "verified", "rejected"].includes(focusedStatus)
        ) setStatus(focusedStatus);
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
    [status, focusedMemberId, onSessionExpired],
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
          ? payload.method === "uploaded_id_selfie"
            ? "Manual ID and selfie comparison recorded"
            : "Completed in-person 18+ ID check recorded"
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
          <h2 id="staff-age-heading">Member verification, with care.</h2>
          <p>
            Compare uploaded ID documents and selfies privately. This is a
            manual staff review, without automated facial recognition or
            liveness testing. Older applications can require an in-person check.
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
      {focusedMemberId && (
        <div className="staff-member-focus" role="status">
          <span>Showing the current application for {members[0]?.name || initialMember?.name || "this member"}.</span>
          <button onClick={() => { setFocusedMemberId(""); setSearch(""); }}>View all applications</button>
        </div>
      )}
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
                setFocusedMemberId("");
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
            onChange={(event) => { setFocusedMemberId(""); setSearch(event.target.value); }}
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
                  ? "New adult age-check submissions appear here after members complete the required uploads. Staff must inspect both actual images before recording a comparison."
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

export default function StaffDashboard({ workspace: dashboardRole = "staff" }) {
  const adminDashboard = dashboardRole === "admin";
  const [auth, setAuth] = useState("checking");
  const [sessionRole, setSessionRole] = useState(null);
  const [sessionUser, setSessionUser] = useState(null);
  const authCheck = useRef(0);
  const [workspace, setWorkspace] = useState(
    adminDashboard ? "overview" : "orders",
  );
  const [ageMember, setAgeMember] = useState(null);
  const [memberFocus, setMemberFocus] = useState(null);
  const [orders, setOrders] = useState([]);
  const [config, setConfig] = useState(null);
  const [serviceError, setServiceError] = useState("");
  const [loading, setLoading] = useState(false);
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
    setSessionRole(null);
    setSessionUser(null);
    setOrders([]);
  }, []);
  const accessDenied = useCallback(() => {
    setAuth("forbidden");
    setOrders([]);
  }, []);
  const notifications = useStaffNotifications({
    enabled: auth === "authenticated" && sessionRole === dashboardRole,
    accountKey: `${sessionRole || ""}:${sessionUser?.id || ""}`,
    request,
    onSessionExpired: sessionExpired,
    onForbidden: accessDenied,
  });
  const openNotifications = () => {
    notifications.newest();
    setWorkspace("notifications");
  };

  const loadOrders = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const data = await request("/api/admin/orders");
      if (!Array.isArray(data.orders))
        throw new ApiError("The server returned an invalid request list.", 502);
      setOrders(data.orders);
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

  const loadSession = useCallback(
    async ({ quiet = false } = {}) => {
      const current = ++authCheck.current;
      if (!quiet) setAuth("checking");
      try {
        const data = await request("/api/admin/session");
        if (current !== authCheck.current) return;
        if (!data.authenticated || !["admin", "staff"].includes(data.role)) {
          sessionExpired();
          return;
        }
        setSessionRole(data.role);
        setSessionUser(data.user || null);
        if (data.role !== dashboardRole) {
          setOrders([]);
          setAuth(data.role === "admin" ? "redirect_admin" : "forbidden");
          return;
        }
        setAuth("authenticated");
        setServiceError("");
        await loadOrders({ quiet });
      } catch (problem) {
        if (current !== authCheck.current) return;
        if (problem.status === 401) sessionExpired();
        else {
          setServiceError(problem.message);
          setAuth("unavailable");
        }
      }
    },
    [dashboardRole, loadOrders, sessionExpired],
  );
  useEffect(() => {
    request("/api/config")
      .then(setConfig)
      .catch(() => {});
  }, []);
  useEffect(() => {
    setWorkspace(adminDashboard ? "overview" : "orders");
    loadSession();
    return () => {
      authCheck.current += 1;
    };
  }, [adminDashboard, loadSession]);
  useEffect(() => {
    if (auth !== "authenticated") return;
    const timer = setInterval(() => {
      if (!document.hidden) loadSession({ quiet: true });
    }, 30000);
    return () => clearInterval(timer);
  }, [auth, loadSession]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function logout() {
    try {
      await request("/api/admin/logout", { method: "POST", body: "{}" });
      setAuth("login");
      setSessionRole(null);
      setSessionUser(null);
      setOrders([]);
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

  if (auth === "login")
    return <Navigate to={`/login?next=${dashboardRole}`} replace />;
  if (
    auth === "redirect_admin" ||
    (auth === "authenticated" && sessionRole === "admin" && !adminDashboard)
  )
    return <Navigate to="/admin" replace />;
  if (
    auth === "forbidden" ||
    (auth === "authenticated" && sessionRole !== dashboardRole)
  )
    return (
      <div className="staff-app staff-access-page">
        <main className="staff-access-card">
          <Brand />
          <ShieldCheck size={32} />
          <span className="staff-eyebrow">ROLE PROTECTED</span>
          <h1>Admin access required.</h1>
          <p>
            Your staff session can open the staff dashboard. The admin overview
            requires an administrator sign-in.
          </p>
          <Link className="staff-action-button" to="/staff">
            Open staff dashboard <ArrowRight size={16} />
          </Link>
          <Link className="staff-secondary-button" to="/login?next=admin">
            Use an admin sign-in
          </Link>
        </main>
      </div>
    );
  if (auth !== "authenticated")
    return (
      <div className="staff-app staff-access-page">
        <main className="staff-access-card">
          <Brand />
          {auth === "checking" ? (
            <LoaderCircle className="staff-spin" size={32} />
          ) : (
            <LockKeyhole size={32} />
          )}
          <span className="staff-eyebrow">
            {adminDashboard ? "ADMIN ACCESS" : "STAFF ACCESS"}
          </span>
          <h1>
            {auth === "checking"
              ? "Checking your session."
              : "The workspace is unavailable."}
          </h1>
          <p>
            {auth === "checking"
              ? "Confirming your protected dashboard access…"
              : "The dashboard needs the full service. Try again when the connection is available."}
          </p>
          {serviceError && (
            <p className="staff-error-message" role="alert">
              {serviceError}
            </p>
          )}
          {auth !== "checking" && (
            <button
              className="staff-action-button"
              onClick={() => loadSession()}
            >
              Try again <RefreshCw size={16} />
            </button>
          )}
          <Link
            className="staff-secondary-button"
            to={`/login?next=${dashboardRole}`}
          >
            Go to shared sign-in
          </Link>
          <Link to="/">Back to the storefront</Link>
        </main>
      </div>
    );

  return (
    <div className="staff-app staff-dashboard">
      <aside className="staff-sidebar">
        <Brand small />
        <span className="staff-workspace-label">
          {adminDashboard ? "THE ADMIN WORKSPACE" : "THE STAFF WORKSPACE"}
        </span>
        <nav
          aria-label={adminDashboard ? "Admin navigation" : "Staff navigation"}
        >
          {adminDashboard && (
            <button
              className={workspace === "overview" ? "staff-nav-active" : ""}
              onClick={() => setWorkspace("overview")}
            >
              <LayoutDashboard size={17} />
              Overview
            </button>
          )}
          <button
            className={workspace === "notifications" ? "staff-nav-active" : ""}
            onClick={openNotifications}
          >
            <Bell size={17} />
            Notifications
            {notifications.unreadCount > 0 && <span aria-hidden="true">{notifications.unreadCount > 99 ? "99+" : notifications.unreadCount}</span>}
          </button>
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
            onClick={() => {
              setAgeMember(null);
              setWorkspace("age");
            }}
          >
            <IdCard size={17} />
            Age checks
          </button>
          <button
            className={workspace === "members" ? "staff-nav-active" : ""}
            onClick={() => { setMemberFocus(null); setWorkspace("members"); }}
          >
            <Users size={17} />
            Members
          </button>
          <button
            className={workspace === "products" ? "staff-nav-active" : ""}
            onClick={() => setWorkspace("products")}
          >
            <PackagePlus size={17} />
            Products
          </button>
          {adminDashboard && (
            <button
              className={workspace === "team" ? "staff-nav-active" : ""}
              onClick={() => setWorkspace("team")}
            >
              <UserPlus size={17} />
              Staff accounts
            </button>
          )}
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
              Gauteng, South Africa <span>·</span>{" "}
              {adminDashboard ? "Admin workspace" : "Staff workspace"}
              {sessionUser?.name && (
                <>
                  <span>·</span> {sessionUser.name}
                </>
              )}
            </p>
          </div>
          <div className="staff-topbar-actions">
            <NotificationBell inbox={notifications} onOpen={openNotifications} />
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
        <div className="staff-notification-announcement" role="status" aria-live="polite">{notifications.announcement}</div>
        <main className="staff-main">
          <div className="staff-page-heading">
            <div>
              <span className="staff-eyebrow">
                {adminDashboard
                  ? "THE WHOLE PICTURE"
                  : "GOOD THINGS TO TAKE CARE OF"}
              </span>
              <h1>{adminDashboard ? "Admin dashboard" : "Staff dashboard"}</h1>
              <p>
                {workspace === "overview"
                  ? "Members, products, requests and setup, brought together for the administrator."
                  : workspace === "notifications"
                    ? "Stay up to date with member applications and private account activity."
                  : workspace === "age"
                    ? "Compare uploaded ID and selfie images, and record a private manual review."
                    : workspace === "members"
                      ? "Your registered members, with their details kept private to the team."
                      : workspace === "products"
                        ? "Create, refine, and publish the products that make your store yours."
                        : workspace === "team"
                          ? "Create personal staff sign-ins and control access to your team’s workspaces."
                          : "Review requests, verify the details, and keep your team in step."}
              </p>
            </div>
            {workspace === "orders" && (
              <div className="staff-page-heading-actions">
                <button
                  className="staff-action-button"
                  onClick={() => {
                    setAgeMember(null);
                    setWorkspace("age");
                  }}
                >
                  <IdCard size={16} />
                  Review applications
                </button>
                <button
                  className="staff-secondary-button staff-refresh"
                  onClick={() => loadOrders()}
                  disabled={loading}
                >
                  <RefreshCw
                    size={15}
                    className={loading ? "staff-spin" : ""}
                  />
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            )}
          </div>
          <div
            className="staff-workspace-tabs"
            role="tablist"
            aria-label={adminDashboard ? "Admin workspace" : "Staff workspace"}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const workspaces = [
                ...(adminDashboard ? ["overview"] : []),
                "notifications",
                "orders",
                "age",
                "members",
                "products",
                ...(adminDashboard ? ["team"] : []),
              ];
              const index = workspaces.indexOf(workspace);
              const next =
                event.key === "Home"
                  ? workspaces[0]
                  : event.key === "End"
                    ? workspaces.at(-1)
                    : workspaces[
                        (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          workspaces.length) %
                          workspaces.length
                      ];
              setWorkspace(next);
              if (next === "age") setAgeMember(null);
              if (next === "members") setMemberFocus(null);
              if (next === "notifications") notifications.newest();
              document.getElementById(`staff-${next}-tab`)?.focus();
            }}
          >
            {adminDashboard && (
              <button
                id="staff-overview-tab"
                role="tab"
                aria-selected={workspace === "overview"}
                tabIndex={workspace === "overview" ? 0 : -1}
                aria-controls="staff-overview-panel"
                onClick={() => setWorkspace("overview")}
              >
                <LayoutDashboard size={17} />
                Overview
              </button>
            )}
            <button
              id="staff-notifications-tab"
              role="tab"
              aria-selected={workspace === "notifications"}
              tabIndex={workspace === "notifications" ? 0 : -1}
              aria-controls="staff-notifications-panel"
              onClick={openNotifications}
            >
              <Bell size={17} />
              Notifications
              {notifications.unreadCount > 0 && <span className="staff-notification-tab-count" aria-hidden="true">{notifications.unreadCount > 99 ? "99+" : notifications.unreadCount}</span>}
            </button>
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
              onClick={() => {
                setAgeMember(null);
                setWorkspace("age");
              }}
            >
              <IdCard size={17} />
              Age checks
            </button>
            <button
              id="staff-members-tab"
              role="tab"
              aria-selected={workspace === "members"}
              tabIndex={workspace === "members" ? 0 : -1}
              aria-controls="staff-members-panel"
              onClick={() => { setMemberFocus(null); setWorkspace("members"); }}
            >
              <Users size={17} />
              Members
            </button>
            <button
              id="staff-products-tab"
              role="tab"
              aria-selected={workspace === "products"}
              tabIndex={workspace === "products" ? 0 : -1}
              aria-controls="staff-products-panel"
              onClick={() => setWorkspace("products")}
            >
              <PackagePlus size={17} />
              Products
            </button>
            {adminDashboard && (
              <button
                id="staff-team-tab"
                role="tab"
                aria-selected={workspace === "team"}
                tabIndex={workspace === "team" ? 0 : -1}
                aria-controls="staff-team-panel"
                onClick={() => setWorkspace("team")}
              >
                <UserPlus size={17} />
                Staff accounts
              </button>
            )}
          </div>
          <div
            id="staff-notifications-panel"
            role="tabpanel"
            aria-labelledby="staff-notifications-tab"
            hidden={workspace !== "notifications"}
          >
            {workspace === "notifications" && (
              <StaffNotifications
                inbox={notifications}
                onOpen={(target, member) => {
                  if (target === "age") setAgeMember(member);
                  else setMemberFocus(member);
                  setWorkspace(target);
                }}
              />
            )}
          </div>
          {adminDashboard && (
            <div
              id="staff-overview-panel"
              role="tabpanel"
              aria-labelledby="staff-overview-tab"
              hidden={workspace !== "overview"}
            >
              {workspace === "overview" && (
                <AdminOverview
                  request={request}
                  onSessionExpired={sessionExpired}
                  onForbidden={accessDenied}
                  onOpen={(next) => {
                    setAgeMember(null);
                    setMemberFocus(null);
                    setWorkspace(next);
                  }}
                />
              )}
            </div>
          )}
          {adminDashboard && (
            <div
              id="staff-team-panel"
              role="tabpanel"
              aria-labelledby="staff-team-tab"
              hidden={workspace !== "team"}
            >
              {workspace === "team" && (
                <StaffAccounts
                  request={request}
                  onSessionExpired={sessionExpired}
                  onForbidden={accessDenied}
                  onNotice={setNotice}
                />
              )}
            </div>
          )}
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
                initialMember={ageMember}
              />
            )}
          </div>
          <div
            id="staff-members-panel"
            role="tabpanel"
            aria-labelledby="staff-members-tab"
            hidden={workspace !== "members"}
          >
            {workspace === "members" && (
              <MemberDirectory
                request={request}
                onSessionExpired={sessionExpired}
                initialMember={memberFocus}
                canDelete={sessionRole === "admin"}
                onNotice={setNotice}
                onOpenAge={(member) => {
                  setAgeMember(member);
                  setWorkspace("age");
                }}
              />
            )}
          </div>
          <div
            id="staff-products-panel"
            role="tabpanel"
            aria-labelledby="staff-products-tab"
            hidden={workspace !== "products"}
          >
            {workspace === "products" && (
              <ProductManagement
                request={request}
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
