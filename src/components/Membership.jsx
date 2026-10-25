import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  CalendarDays,
  Camera,
  FileCheck2,
  LockKeyhole,
  RefreshCw,
  Clock3,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Heart,
  KeyRound,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { request, offlinePreview } from "../lib/api.js";
import MembershipCard, { MemberSetupJourney } from "./MembershipCard.jsx";
import { hasCompletedVerification } from "../lib/membership.js";

const MEMBER_SITE = "https://loud-cana.onrender.com";
const EMPTY_SIGNUP = {
  name: "",
  email: "",
  password: "",
  confirmPassword: "",
  ageConfirmed: false,
  termsAccepted: false,
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function MemberLink({ to, onNavigate, children, ...props }) {
  return (
    <a
      href={offlinePreview ? `#${to}` : to}
      {...props}
      onClick={(event) => {
        if (
          onNavigate &&
          props.target !== "_blank" &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          onNavigate(to);
        }
      }}
    >
      {children}
    </a>
  );
}

function FieldError({ name, error }) {
  return error ? (
    <span className="auth-field-error" id={`${name}-error`}>
      {error}
    </span>
  ) : null;
}

function PasswordField({
  name,
  label,
  value,
  onChange,
  error,
  autoComplete = "current-password",
  hint,
  disabled = false,
  maxLength = 128,
}) {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${name}-hint` : "";
  const errorId = error ? `${name}-error` : "";
  return (
    <div className="auth-field">
      <label htmlFor={name}>{label}</label>
      <div className="auth-password">
        <input
          id={name}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          maxLength={maxLength}
          disabled={disabled}
          required
          aria-invalid={!!error}
          aria-describedby={
            [hintId, errorId].filter(Boolean).join(" ") || undefined
          }
        />
        <button
          type="button"
          className="auth-password-toggle"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
          disabled={disabled}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {hint && (
        <small className="auth-hint" id={hintId}>
          {hint}
        </small>
      )}
      <FieldError name={name} error={error} />
    </div>
  );
}

function focusInvalid(form, errors) {
  const first = Object.keys(errors)[0];
  if (!first) return;
  const field = form?.elements.namedItem(first);
  if (typeof field?.focus === "function") field.focus();
  else if (field?.[0]) field[0].focus();
  else form?.querySelector(".age-questionnaire")?.focus();
}

function formatMemberDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Your member account"
    : `Member since ${new Intl.DateTimeFormat("en-ZA", {
        month: "long",
        year: "numeric",
      }).format(date)}`;
}

export default function Membership({
  mode = "membership",
  member = null,
  loading = false,
  onSessionChange = () => {},
  onNavigate = () => {},
  store,
  visibleSavedCount,
  offline = false,
}) {
  const [fields, setFields] = useState(EMPTY_SIGNUP);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    setFields({ ...EMPTY_SIGNUP });
    setErrors({});
    setServerError("");
  }, [mode]);

  const change = (name) => (event) => {
    const value =
      event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value;
    setFields((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
    setServerError("");
  };

  const signup = mode === "signup";
  async function submit(event) {
    event.preventDefault();
    if (busy || offline) return;
    const nextErrors = {};
    const name = fields.name.trim();
    const email = fields.email.trim().toLowerCase();
    if (signup && (name.length < 2 || name.length > 80))
      nextErrors.name = "Enter your name using 2 to 80 characters.";
    const validIdentifier = EMAIL.test(email) || /^[a-z][a-z0-9._-]{2,39}$/.test(email);
    if ((signup ? !EMAIL.test(email) : !validIdentifier) || email.length > 254)
      nextErrors.email = signup ? "Enter a valid email address." : "Enter your email address or username.";
    if (!fields.password || (signup && fields.password.length < 12))
      nextErrors.password = signup
        ? "Use at least 12 characters for your password."
        : "Enter your password.";
    const passwordLimit = signup ? 128 : 256;
    if (fields.password.length > passwordLimit)
      nextErrors.password = `Use no more than ${passwordLimit} characters.`;
    if (signup && fields.confirmPassword !== fields.password)
      nextErrors.confirmPassword = "Your passwords do not match.";
    if (signup && !fields.ageConfirmed)
      nextErrors.ageConfirmed = "Please confirm that you are 18 or older.";
    if (signup && !fields.termsAccepted)
      nextErrors.termsAccepted = "Please accept the terms and privacy notice.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusInvalid(formRef.current, nextErrors);
      return;
    }
    setBusy(true);
    setServerError("");
    try {
      if (!signup) {
        const result = await request("/api/auth/login", {
          method: "POST",
          body: { identifier: email, password: fields.password },
        });
        if (result.role === "member" && result.member?.id) {
          setFields({ ...EMPTY_SIGNUP });
          onSessionChange(result.member);
          onNavigate("/account");
          return;
        }
        if (!["admin", "staff"].includes(result.role) || !result.user?.id || !result.user?.username)
          throw new Error("Sign-in could not be confirmed. Please try again.");
        setFields({ ...EMPTY_SIGNUP });
        onNavigate(result.role === "admin" ? "/admin" : "/staff");
        return;
      }
      const result = await request(
        `/api/members/${signup ? "signup" : "login"}`,
        {
          method: "POST",
          body: signup
            ? {
                name,
                email,
                password: fields.password,
                ageConfirmed: fields.ageConfirmed,
                termsAccepted: fields.termsAccepted,
              }
            : { email, password: fields.password },
        },
      );
      if (!result.member)
        throw new Error(
          "Account access could not be completed. Please try again.",
        );
      setFields({ ...EMPTY_SIGNUP });
      onSessionChange(result.member);
      onNavigate("/account");
    } catch (error) {
      setServerError(
        error.message || "Account access is unavailable. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (mode === "membership") {
    return (
      <section className="membership-page">
        <div className="member-hero container">
          <div className="member-hero-copy">
            <span className="eyebrow">THE LOUD +CANA COMMUNITY</span>
            <h1>
              Your people.
              <br />
              <span className="lime-text">Your kind of good.</span>
            </h1>
            <p>
              Make yourself at home. A free Loud +Cana account keeps your
              favourites together and gives you a place to make the collection
              your own.
            </p>
            <div className="member-actions">
              {member ? (
                <MemberLink
                  to="/account"
                  onNavigate={onNavigate}
                  className="button lime"
                >
                  Go to your account <ArrowRight size={17} />
                </MemberLink>
              ) : offline ? (
                <>
                  <a href={`${MEMBER_SITE}/signup`} className="button lime">
                    Create your account <ArrowUpRight size={17} />
                  </a>
                  <a href={`${MEMBER_SITE}/login`} className="button outline">
                    Member login <ArrowUpRight size={17} />
                  </a>
                </>
              ) : (
                <>
                  <MemberLink
                    to="/signup"
                    onNavigate={onNavigate}
                    className="button lime"
                  >
                    Create your account <ArrowRight size={17} />
                  </MemberLink>
                  <MemberLink
                    to="/login"
                    onNavigate={onNavigate}
                    className="button outline"
                  >
                    Member login <ArrowRight size={17} />
                  </MemberLink>
                </>
              )}
            </div>
            <small className="member-note">
              Free to join. For adults 18 and older.
            </small>
          </div>
          <div className="member-hero-visual" aria-hidden="true">
            <Users size={54} strokeWidth={1.2} />
            <strong>
              GOOD PEOPLE.
              <br />
              GOOD CULTURE.
            </strong>
            <span>LOUD +CANA MEMBERS</span>
          </div>
        </div>
        <div className="member-benefits container">
          <article>
            <Heart size={26} />
            <h2>Keep your favourites.</h2>
            <p>
              Save products to your account and find them again when you sign in
              on another device.
            </p>
          </article>
          <article>
            <UserRound size={26} />
            <h2>A space of your own.</h2>
            <p>
              Manage your name, account details, and password from your personal
              member page.
            </p>
          </article>
          <article>
            <ShieldCheck size={26} />
            <h2>You’re in control.</h2>
            <p>
              Sign out when you’re done, change your password, or close your
              account from your settings.
            </p>
          </article>
        </div>
        <div className="member-bottom-note container">
          <Check size={18} />
          <p>
            Your account keeps your favourites and profile in one place. Product
            availability and ordering status are shown in the shop.
          </p>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="membership-page container">
        <div className="member-loading" role="status">
          <LoaderCircle size={24} className="member-spinner" />
          <p>Loading your membership…</p>
        </div>
      </section>
    );
  }

  if (offline) {
    return (
      <section className="membership-page container">
        <div className="member-panel auth-panel">
          <ShieldCheck size={34} />
          <span className="eyebrow">YOUR LOUD +CANA ACCOUNT</span>
          <h1>
            Meet us on
            <br />
            <span className="lime-text">the member site.</span>
          </h1>
          <p>
            Account signup and login are available on our full website. Open the
            secure member site to continue.
          </p>
          <a
            className="button lime"
            href={`${MEMBER_SITE}/${mode === "signup" ? "signup" : mode === "account" ? "account" : "login"}`}
          >
            Open member website <ArrowUpRight size={17} />
          </a>
        </div>
      </section>
    );
  }

  if (mode === "account") {
    return member ? (
      <MemberAccount
        member={member}
        onSessionChange={onSessionChange}
        onNavigate={onNavigate}
        store={store}
        visibleSavedCount={visibleSavedCount}
      />
    ) : (
      <section className="membership-page container">
        <div className="member-panel auth-panel">
          <UserRound size={34} />
          <span className="eyebrow">YOUR LOUD +CANA ACCOUNT</span>
          <h1>
            Your space.
            <br />
            <span className="lime-text">Ready when you are.</span>
          </h1>
          <p>Sign in to see your saved favourites and account settings.</p>
          <MemberLink
            to="/login"
            onNavigate={onNavigate}
            className="button lime"
          >
            Sign in <ArrowRight size={17} />
          </MemberLink>
          <p className="auth-switch">
            New here?{" "}
            <MemberLink to="/signup" onNavigate={onNavigate}>
              Create an account
            </MemberLink>
          </p>
        </div>
      </section>
    );
  }

  if (member && signup) {
    return (
      <section className="membership-page container">
        <div className="member-panel auth-panel">
          <CheckCircle2 size={34} />
          <span className="eyebrow">WELCOME BACK</span>
          <h1>You’re signed in.</h1>
          <p>You’re currently signed in as {member.name}.</p>
          <MemberLink
            to="/account"
            onNavigate={onNavigate}
            className="button lime"
          >
            Go to your account <ArrowRight size={17} />
          </MemberLink>
        </div>
      </section>
    );
  }

  if (signup) {
    return (
      <SignupWizard onSessionChange={onSessionChange} onNavigate={onNavigate} />
    );
  }

  return (
    <section className="membership-page container">
      <div className="auth-layout">
        <div className="auth-intro">
          <span className="eyebrow">LOUD +CANA ACCESS</span>
          <h1>
            {signup ? (
              <>
                Make yourself
                <br />
                <span className="lime-text">at home.</span>
              </>
            ) : (
              <>
                Welcome
                <br />
                <span className="lime-text">back.</span>
              </>
            )}
          </h1>
          <p>
            {signup
              ? "Your favourites. Your account. Your own corner of the Loud +Cana community."
              : "Sign in to your account to pick up where you left off."}
          </p>
          <div className="auth-trust">
            <ShieldCheck size={21} />
            <span>
              Your password is protected. Access your account securely.
            </span>
          </div>
        </div>
        <div className="member-panel auth-panel">
          <span className="eyebrow">
            {signup ? "FREE MEMBERSHIP" : "YOUR ACCOUNT"}
          </span>
          <h2>{signup ? "Create your account" : "Sign in"}</h2>
          <form
            className="auth-form"
            onSubmit={submit}
            ref={formRef}
            noValidate
          >
            {signup && (
              <div className="auth-field">
                <label htmlFor="member-name">Full name</label>
                <input
                  id="member-name"
                  name="name"
                  autoComplete="name"
                  value={fields.name}
                  onChange={change("name")}
                  minLength={2}
                  maxLength={80}
                  required
                  disabled={busy}
                  aria-invalid={!!errors.name}
                  aria-describedby={
                    errors.name ? "member-name-error" : undefined
                  }
                />
                <FieldError name="member-name" error={errors.name} />
              </div>
            )}
            <div className="auth-field">
              <label htmlFor="member-email">Email or username</label>
              <input
                id="member-email"
                name="email"
                type="text"
                autoComplete="username"
                inputMode="text"
                autoCapitalize="none"
                spellCheck={false}
                value={fields.email}
                onChange={change("email")}
                maxLength={254}
                required
                disabled={busy}
                aria-invalid={!!errors.email}
                aria-describedby={`login-identifier-hint${errors.email ? " member-email-error" : ""}`}
              />
              <small className="auth-hint" id="login-identifier-hint">
                Use the email address or username associated with your account.
              </small>
              <FieldError name="member-email" error={errors.email} />
            </div>
            <PasswordField
              name="password"
              label="Password"
              value={fields.password}
              onChange={change("password")}
              error={errors.password}
              autoComplete={signup ? "new-password" : "current-password"}
              maxLength={signup ? 128 : 256}
              hint={
                signup
                  ? "At least 12 characters. A unique passphrase works well."
                  : undefined
              }
              disabled={busy}
            />
            {signup && (
              <>
                <PasswordField
                  name="confirmPassword"
                  label="Confirm password"
                  value={fields.confirmPassword}
                  onChange={change("confirmPassword")}
                  error={errors.confirmPassword}
                  autoComplete="new-password"
                  disabled={busy}
                />
                <div className="auth-check">
                  <label>
                    <input
                      type="checkbox"
                      name="ageConfirmed"
                      checked={fields.ageConfirmed}
                      onChange={change("ageConfirmed")}
                      disabled={busy}
                      aria-invalid={!!errors.ageConfirmed}
                      aria-describedby={
                        errors.ageConfirmed ? "ageConfirmed-error" : undefined
                      }
                    />
                    <span>I confirm I am 18 or older.</span>
                  </label>
                  <FieldError name="ageConfirmed" error={errors.ageConfirmed} />
                </div>
                <div className="auth-check">
                  <label>
                    <input
                      type="checkbox"
                      name="termsAccepted"
                      checked={fields.termsAccepted}
                      onChange={change("termsAccepted")}
                      disabled={busy}
                      aria-invalid={!!errors.termsAccepted}
                      aria-describedby={
                        errors.termsAccepted ? "termsAccepted-error" : undefined
                      }
                    />
                    <span>
                      I accept the{" "}
                      <MemberLink to="/terms" onNavigate={onNavigate}>
                        Terms of Use
                      </MemberLink>{" "}
                      and have read the{" "}
                      <MemberLink to="/privacy" onNavigate={onNavigate}>
                        Privacy Notice
                      </MemberLink>
                      .
                    </span>
                  </label>
                  <FieldError
                    name="termsAccepted"
                    error={errors.termsAccepted}
                  />
                </div>
              </>
            )}
            {serverError && (
              <p className="auth-error" role="alert">
                {serverError}
              </p>
            )}
            <button
              type="submit"
              className="button lime auth-submit"
              disabled={busy}
            >
              {busy ? (
                <>
                  <LoaderCircle size={17} className="member-spinner" />
                  {signup ? "Creating your account…" : "Signing you in…"}
                </>
              ) : (
                <>
                  {signup ? "Create account" : "Sign in"}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          <p className="auth-switch">
            {signup ? "Already part of the community?" : "New to Loud +Cana?"}{" "}
            <MemberLink
              to={signup ? "/login" : "/signup"}
              onNavigate={onNavigate}
            >
              {signup ? "Sign in" : "Create an account"}
            </MemberLink>
          </p>
          {!signup && (
            <MemberLink
              className="auth-help"
              to="/contact"
              onNavigate={onNavigate}
            >
              Need help signing in? Contact us <ArrowUpRight size={13} />
            </MemberLink>
          )}
          <p className="auth-footnote">
            {signup
              ? "Membership is free. Creating an account does not place an order or sign you up for marketing emails."
              : "For your privacy, sign out after using a shared device."}
          </p>
        </div>
      </div>
    </section>
  );
}

const EMPTY_ELIGIBILITY = {
  birthDate: "",
  ageConfirmed: false,
  verificationConsent: false,
};

function southAfricanToday() {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return Object.fromEntries(
    parts
      .filter((part) => ["year", "month", "day"].includes(part.type))
      .map((part) => [part.type, part.value]),
  );
}

function eligibilityErrors(fields) {
  const errors = {};
  const value = fields.birthDate;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : null;
  const today = southAfricanToday();
  const currentDay = `${today.year}-${today.month}-${today.day}`;
  const cutoff = `${Number(today.year) - 18}-${today.month}-${today.day}`;
  if (
    !parsed ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value ||
    value > currentDay
  )
    errors.birthDate = "Enter a valid date of birth.";
  else if (value > cutoff)
    errors.birthDate = "You must be at least 18 to create a member account.";
  if (!fields.ageConfirmed)
    errors.ageConfirmed = "Confirm that you are 18 or older.";
  if (!fields.verificationConsent)
    errors.verificationConsent =
      "Please consent to the adult-eligibility and identity check.";
  return errors;
}

function useSignupQuestions(enabled) {
  const [challenge, setChallenge] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const controller = useRef(null);
  async function refresh() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError("");
    setChallenge(null);
    setAnswers({});
    try {
      const result = await request("/api/members/signup-challenge", {
        signal: current.signal,
      });
      if (
        !result.challengeId ||
        !Array.isArray(result.questions) ||
        !result.questions.length
      )
        throw new Error("Questions are unavailable. Please request a new set.");
      if (controller.current !== current || current.signal.aborted) return;
      setChallenge(result);
      setClock(Date.now());
    } catch (failure) {
      if (!current.signal.aborted)
        setError(
          failure.message || "Questions could not be loaded. Please try again.",
        );
    } finally {
      if (controller.current === current && !current.signal.aborted)
        setLoading(false);
    }
  }
  useEffect(() => {
    if (!enabled) return;
    // Delay the request so React's development remount cannot replace the
    // HttpOnly challenge cookie with an abandoned first request.
    const timer = setTimeout(refresh, 0);
    const tick = setInterval(() => setClock(Date.now()), 15000);
    return () => {
      clearTimeout(timer);
      clearInterval(tick);
      controller.current?.abort();
    };
  }, [enabled]);
  const expired = Boolean(
    challenge && Date.parse(challenge.expiresAt) <= clock,
  );
  return { challenge, answers, setAnswers, loading, error, expired, refresh };
}

function questionError(quiz) {
  if (!quiz.challenge) return "Load a new set of questions before continuing.";
  if (Date.parse(quiz.challenge.expiresAt) <= Date.now())
    return "These questions have expired. Get new questions to continue.";
  if (
    quiz.challenge.questions.some(
      (question) =>
        !question.choices.some(
          (choice) => choice.id === quiz.answers[question.id],
        ),
    )
  )
    return "Choose one answer for each question.";
  return "";
}

function answersPayload(quiz) {
  return quiz.challenge.questions.map((question) => ({
    questionId: question.id,
    choiceId: quiz.answers[question.id],
  }));
}

function AgeEligibilityFields({
  fields,
  onChange,
  errors,
  busy,
  onNavigate,
  identityRequired = false,
}) {
  const today = southAfricanToday();
  return (
    <>
      <div className="age-eligibility-note">
        <CalendarDays size={22} />
        <div>
          <strong>For adults 18 and older.</strong>
          <p>
            {identityRequired
              ? "Your date of birth is a declaration. You must also upload your ID and a current selfie for a private staff comparison before your account can be approved."
              : "Your date of birth is a declaration. Your account stays pending until a staff member checks your original valid photo ID."}
          </p>
        </div>
      </div>
      <div className="auth-field">
        <label htmlFor="birthDate">Date of birth</label>
        <input
          id="birthDate"
          name="birthDate"
          type="date"
          autoComplete="bday"
          max={`${today.year}-${today.month}-${today.day}`}
          value={fields.birthDate}
          onChange={onChange("birthDate")}
          disabled={busy}
          required
          aria-invalid={!!errors.birthDate}
          aria-describedby={`birthDate-hint${errors.birthDate ? " birthDate-error" : ""}`}
        />
        <small className="auth-hint" id="birthDate-hint">
          Used to assess whether you are 18 or older. The server checks your age
          using the date in South Africa.
        </small>
        <FieldError name="birthDate" error={errors.birthDate} />
      </div>
      <div className="auth-check">
        <label>
          <input
            type="checkbox"
            name="ageConfirmed"
            checked={fields.ageConfirmed}
            onChange={onChange("ageConfirmed")}
            disabled={busy}
            aria-invalid={!!errors.ageConfirmed}
            aria-describedby={
              errors.ageConfirmed ? "ageConfirmed-error" : undefined
            }
          />
          <span>I confirm I am 18 or older.</span>
        </label>
        <FieldError name="ageConfirmed" error={errors.ageConfirmed} />
      </div>
      <div className="auth-check">
        <label>
          <input
            type="checkbox"
            name="verificationConsent"
            checked={fields.verificationConsent}
            onChange={onChange("verificationConsent")}
            disabled={busy}
            aria-invalid={!!errors.verificationConsent}
            aria-describedby={
              errors.verificationConsent
                ? "verificationConsent-error"
                : undefined
            }
          />
          <span>
            {identityRequired
              ? "I consent to my date of birth being used to assess adult eligibility and matched against my identity document."
              : "I consent to my date of birth being used to assess adult eligibility and to an in-person identity check."}
          </span>
        </label>
        <FieldError
          name="verificationConsent"
          error={errors.verificationConsent}
        />
      </div>
      <p className="age-data-note">
        {identityRequired
          ? "Upload your ID and selfie only through the private upload fields. Do not enter an ID number in text fields. "
          : "No ID number, ID photograph, or document upload is requested here. "}
        Pending dates of birth are removed after review or after 30 days. See our{" "}
        <MemberLink
          to="/privacy"
          onNavigate={onNavigate}
          target="_blank"
          rel="noreferrer"
        >
          Privacy Notice
        </MemberLink>
        .
      </p>
    </>
  );
}

function SignupQuestions({ quiz, busy, error, onAnswer }) {
  return (
    <div
      className="age-questionnaire"
      tabIndex={-1}
      aria-label="Responsible-use questions"
      aria-invalid={!!error}
      aria-describedby={error ? "age-questions-error" : undefined}
    >
      <div className="age-questionnaire-heading">
        <div>
          <span className="eyebrow">A FEW THINGS TO KNOW</span>
          <h3>Responsible-use questions</h3>
        </div>
        <button
          className="text-link age-refresh"
          type="button"
          onClick={quiz.refresh}
          disabled={busy || quiz.loading}
        >
          <RefreshCw size={15} />
          Get new questions
        </button>
      </div>
      <p className="age-questionnaire-intro">
        A fresh set is selected for each signup. This is an awareness check;
        answering correctly does not prove your age or identity.
      </p>
      {quiz.loading ? (
        <p className="age-question-loading" role="status">
          <LoaderCircle size={19} className="member-spinner" />
          Loading your questions…
        </p>
      ) : quiz.error ? (
        <p className="auth-error" role="alert">
          {quiz.error}
        </p>
      ) : (
        quiz.challenge && (
          <>
            {quiz.expired && (
              <p className="auth-error" role="alert">
                These questions have expired. Get new questions to continue.
              </p>
            )}
            {quiz.challenge.questions.map((question, index) => (
              <fieldset
                className="age-question"
                key={question.id}
                disabled={busy || quiz.expired}
              >
                <legend>
                  <span>
                    {index + 1} / {quiz.challenge.questions.length}
                  </span>
                  {question.prompt}
                </legend>
                <div>
                  {question.choices.map((choice) => (
                    <label
                      key={choice.id}
                      className={
                        quiz.answers[question.id] === choice.id
                          ? "selected"
                          : ""
                      }
                    >
                      <input
                        type="radio"
                        name={`answer-${question.id}`}
                        value={choice.id}
                        checked={quiz.answers[question.id] === choice.id}
                        onChange={() => {
                          quiz.setAnswers((current) => ({
                            ...current,
                            [question.id]: choice.id,
                          }));
                          onAnswer?.();
                        }}
                        required
                      />
                      <span>{choice.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <p className="age-expiry-note">
              <Clock3 size={14} />
              These questions are valid for 15 minutes. You can request a new
              set.
            </p>
          </>
        )
      )}
      {error && (
        <p className="auth-field-error" id="age-questions-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const MAX_IDENTITY_IMAGE_BYTES = 6 * 1024 * 1024;
const IDENTITY_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function identityImageErrors(files) {
  const errors = {};
  for (const [name, label] of [["document", "ID document"], ["selfie", "selfie"]]) {
    const file = files[name];
    if (!file) errors[name] = `Choose your ${label} image.`;
    else if (!IDENTITY_IMAGE_TYPES.has(file.type))
      errors[name] = "Choose a JPEG, PNG, or WebP image.";
    else if (!file.size || file.size > MAX_IDENTITY_IMAGE_BYTES)
      errors[name] = "Choose an image no larger than 6 MB.";
  }
  return errors;
}

function imageBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) reject(new Error("The selected image could not be read."));
      else resolve(result.slice(separator + 1));
    };
    reader.onerror = () => reject(new Error("The selected image could not be read. Choose it again."));
    reader.onabort = () => reject(new Error("Image reading was interrupted. Choose it again."));
    reader.readAsDataURL(file);
  });
}

async function identityUploadBody(files) {
  const [document, selfie] = await Promise.all([
    imageBase64(files.document),
    imageBase64(files.selfie),
  ]);
  return { identityConsent: true, document: { data: document }, selfie: { data: selfie } };
}

function IdentityImagePreview({ file, label }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file || !IDENTITY_IMAGE_TYPES.has(file.type) || file.size > MAX_IDENTITY_IMAGE_BYTES) {
      setUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url ? <img className="identity-image-preview" src={url} alt={`Selected ${label} preview`} /> : null;
}

function IdentityEvidenceFields({ files, onChange, errors = {}, disabled = false, prefix = "identity" }) {
  return (
    <div className="identity-evidence-fields">
      {[
        { name: "document", label: "Photo ID document", hint: "A clear image of your original valid government-issued photo ID.", capture: "environment" },
        { name: "selfie", label: "Your selfie", hint: "A current, unfiltered photo showing your face clearly in good light.", capture: "user" },
      ].map((item) => (
        <div className="auth-field identity-evidence-field" key={item.name}>
          <label htmlFor={`${prefix}-${item.name}`}>{item.label}</label>
          <input
            id={`${prefix}-${item.name}`}
            type="file"
            name={item.name}
            accept="image/jpeg,image/png,image/webp"
            capture={item.capture}
            onChange={(event) => onChange(item.name, event.target.files?.[0] || null)}
            disabled={disabled}
            required
            aria-invalid={!!errors[item.name]}
            aria-describedby={`${prefix}-${item.name}-hint${errors[item.name] ? ` ${item.name}-error` : ""}`}
          />
          <small className="auth-hint" id={`${prefix}-${item.name}-hint`}>
            {item.hint} JPEG, PNG, or WebP; up to 6 MB.
          </small>
          <IdentityImagePreview file={files[item.name]} label={item.label.toLowerCase()} />
          <FieldError name={item.name} error={errors[item.name]} />
        </div>
      ))}
    </div>
  );
}

function IdentityConsent({ checked, onChange, error, disabled, onNavigate }) {
  return (
    <div className="auth-check identity-consent">
      <label>
        <input
          type="checkbox"
          name="identityConsent"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? "identityConsent-error" : undefined}
        />
        <span>
          I consent to Loud +Cana processing my ID document and selfie for a
          private manual identity and adult-age review, as described in the{" "}
          <MemberLink to="/privacy" onNavigate={onNavigate} target="_blank" rel="noreferrer">
            Privacy Notice
          </MemberLink>
          .
        </span>
      </label>
      <FieldError name="identityConsent" error={error} />
    </div>
  );
}

function IdentityVerificationCard({ member, onSessionChange, onNavigate, store }) {
  const [verification, setVerification] = useState(member.identityVerification);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState({ document: null, selfie: null });
  const [fileErrors, setFileErrors] = useState({});
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [inputVersion, setInputVersion] = useState(0);
  useEffect(() => {
    setVerification(member.identityVerification);
  }, [member.identityVerification]);
  useEffect(() => {
    const current = new AbortController();
    setLoading(true);
    request("/api/members/identity-verification", { signal: current.signal })
      .then((result) => {
        if (!current.signal.aborted && result.verification) setVerification(result.verification);
      })
      .catch((failure) => {
        if (!current.signal.aborted) setError(failure.message || "Your review status could not be loaded.");
      })
      .finally(() => {
        if (!current.signal.aborted) setLoading(false);
      });
    return () => current.abort();
  }, [member.id]);

  async function refreshStatus() {
    if (busy || loading) return;
    setLoading(true);
    setError("");
    try {
      const [result, account] = await Promise.all([
        request("/api/members/identity-verification"),
        request("/api/members/me"),
      ]);
      if (result.verification) setVerification(result.verification);
      if (account.member) onSessionChange(account.member);
    } catch (failure) {
      setError(failure.message || "Your review status could not be refreshed.");
    } finally {
      setLoading(false);
    }
  }

  async function uploadEvidence(event) {
    event.preventDefault();
    if (busy || loading || !verification?.configured) return;
    const invalidFiles = identityImageErrors(files);
    setFileErrors(invalidFiles);
    setConsentError(consent ? "" : "Please consent to the private ID and selfie review.");
    if (Object.keys(invalidFiles).length || !consent) {
      focusInvalid(event.currentTarget, {
        ...invalidFiles,
        ...(!consent ? { identityConsent: "Consent required" } : {}),
      });
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await request("/api/members/identity-verification", {
        method: "POST",
        body: await identityUploadBody(files),
      });
      if (result.verification?.status !== "pending")
        throw new Error("Your upload could not be confirmed. Please try again.");
      setVerification(result.verification);
      onSessionChange({ ...member, identityVerification: result.verification });
      setFiles({ document: null, selfie: null });
      setConsent(false);
      setInputVersion((version) => version + 1);
    } catch (failure) {
      setError(failure.message || "Your ID and selfie could not be uploaded. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const status = verification?.status || "not_started";
  const verified = status === "verified";
  const unavailable = !verification?.configured || status === "unavailable";
  const needsEligibility = ["required", "rejected"].includes(member.ageVerification?.status);
  const labels = {
    not_started: "ID and selfie required",
    pending: "ID and selfie review pending",
    verified: "ID and selfie reviewed · 18+",
    rejected: "Review needs attention",
    expired: "Review expired",
    unavailable: "Private uploads unavailable",
  };
  return (
    <>
      <section
        className={`age-verification-card identity-verification-card${verified ? " age-status-verified" : ""}`}
        aria-labelledby="identity-verification-title"
      >
        <div className="age-verification-summary">
          <ShieldCheck size={29} />
          <div>
            <span className="eyebrow">PRIVATE ADULT MEMBERSHIP REVIEW</span>
            <h2 id="identity-verification-title">Your ID & selfie review</h2>
            <strong className="age-status-badge" role="status">
              {loading ? "Checking review status…" : labels[status] || labels.not_started}
            </strong>
          </div>
        </div>
        {verified ? (
          <p>
            An authorised staff member has reviewed your ID and compared it
            with your selfie and account details for adult eligibility. Keep
            your original ID available for any check required at fulfilment.
            Changing your account name requires a new review.
          </p>
        ) : (
          <>
            <p>
              Provide a clear image of your original government-issued photo
              ID and a current selfie. Authorised staff compare the images and
              your account details privately. Your account stays restricted
              until the review is completed.
            </p>
            <ol className="identity-check-steps">
              <li><FileCheck2 size={21} /><span><strong>Photo ID</strong>Use a clear image of your original valid photo identity document.</span></li>
              <li><Camera size={21} /><span><strong>Current selfie</strong>Show your face clearly, in good light, without filters.</span></li>
              <li><ShieldCheck size={21} /><span><strong>Private staff review</strong>Staff compare your ID, selfie, full name, and date of birth.</span></li>
            </ol>
            {needsEligibility ? (
              <p className="identity-next-note">
                Update your adult-eligibility details below before submitting
                new ID and selfie images.
              </p>
            ) : unavailable && !loading ? (
              <p className="identity-unavailable" role="status">
                Private ID uploads are currently unavailable. Contact the
                store or try again later. Your account remains restricted;
                please do not email your ID or selfie.
              </p>
            ) : status === "pending" ? (
              <p className="identity-next-note">
                Your images were submitted for private staff review. You do not
                need to upload again unless staff request a new submission.
                Check your status here later.
              </p>
            ) : (
              <form className="auth-form identity-start-form" onSubmit={uploadEvidence} noValidate>
                <IdentityEvidenceFields
                  key={inputVersion}
                  files={files}
                  onChange={(name, file) => {
                    setFiles((current) => ({ ...current, [name]: file }));
                    setFileErrors((current) => ({ ...current, [name]: "" }));
                    setError("");
                  }}
                  errors={fileErrors}
                  disabled={busy || loading || unavailable}
                  prefix="account-identity"
                />
                <IdentityConsent
                  checked={consent}
                  onChange={(event) => {
                    setConsent(event.target.checked);
                    setConsentError("");
                  }}
                  error={consentError}
                  disabled={busy || loading || unavailable}
                  onNavigate={onNavigate}
                />
                <button type="submit" className="button lime" disabled={busy || loading || unavailable}>
                  {busy ? <LoaderCircle size={17} className="member-spinner" /> : <LockKeyhole size={17} />}
                  {busy ? "Uploading securely…" : "Upload ID & selfie for review"}
                  <ArrowRight size={16} />
                </button>
              </form>
            )}
          </>
        )}
        <div className="identity-status-actions">
          <button type="button" className="button outline" onClick={refreshStatus} disabled={busy || loading}>
            <RefreshCw size={15} className={loading ? "member-spinner" : undefined} />
            {loading ? "Checking status…" : "Refresh review status"}
          </button>
          {!verified && <MemberLink className="text-link" to="/contact" onNavigate={onNavigate}>Get help <ArrowUpRight size={15} /></MemberLink>}
        </div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <p className="age-verification-limits">
          This is a manual staff comparison of ID and selfie images, not an
          automated biometric or liveness check. Images are sent to this
          service for private review, not to a third-party verification
          provider. Read the{" "}
          <MemberLink to="/privacy" onNavigate={onNavigate}>Privacy Notice</MemberLink>
          . Membership does not authorize commercial cannabis sales.
        </p>
      </section>
      {needsEligibility && (
        <AgeVerificationCard
          member={member}
          store={store}
          onSessionChange={onSessionChange}
          onNavigate={onNavigate}
          identityRequired
        />
      )}
    </>
  );
}

function SignupWizard({ onSessionChange, onNavigate }) {
  const [fields, setFields] = useState({
    ...EMPTY_SIGNUP,
    ...EMPTY_ELIGIBILITY,
    identityConsent: false,
  });
  const [files, setFiles] = useState({ document: null, selfie: null });
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const quiz = useSignupQuestions(true);
  const formRef = useRef(null);
  const titleRef = useRef(null);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [step]);
  const change = (name) => (event) => {
    setFields((current) => ({
      ...current,
      [name]:
        event.target.type === "checkbox"
          ? event.target.checked
          : event.target.value,
    }));
    setErrors((current) => ({ ...current, [name]: "" }));
    setServerError("");
  };
  function detailsErrors() {
    const found = {};
    if (fields.name.trim().length < 2 || fields.name.trim().length > 80)
      found.name = "Enter your name using 2 to 80 characters.";
    if (!EMAIL.test(fields.email.trim()) || fields.email.trim().length > 254)
      found.email = "Enter a valid email address.";
    if (fields.password.length < 12 || fields.password.length > 128)
      found.password = "Use a password with 12 to 128 characters.";
    if (fields.confirmPassword !== fields.password)
      found.confirmPassword = "Your passwords do not match.";
    return found;
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const found =
      step === 0
        ? detailsErrors()
        : step === 1
          ? eligibilityErrors(fields)
          : {};
    if (step === 2) {
      const issue = questionError(quiz);
      if (issue) found.questions = issue;
      if (!fields.termsAccepted)
        found.termsAccepted = "Please accept the terms and privacy notice.";
      Object.assign(found, identityImageErrors(files));
      if (!fields.identityConsent)
        found.identityConsent = "Please consent to the private ID and selfie review.";
    }
    setErrors(found);
    if (Object.keys(found).length) {
      focusInvalid(formRef.current, found);
      return;
    }
    if (step < 2) {
      setStep(step + 1);
      setServerError("");
      return;
    }
    // Repeat eligibility validation at final submission so changing steps or
    // leaving a form open never bypasses the server's authoritative checks.
    const invalidDetails = detailsErrors();
    const invalidAge = eligibilityErrors(fields);
    if (Object.keys(invalidDetails).length) {
      setErrors(invalidDetails);
      setStep(0);
      return;
    }
    if (Object.keys(invalidAge).length) {
      setErrors(invalidAge);
      setStep(1);
      return;
    }
    setBusy(true);
    setServerError("");
    try {
      const { member } = await request("/api/members/signup", {
        method: "POST",
        body: {
          name: fields.name.trim(),
          email: fields.email.trim().toLowerCase(),
          password: fields.password,
          birthDate: fields.birthDate,
          ageConfirmed: fields.ageConfirmed,
          termsAccepted: fields.termsAccepted,
          verificationConsent: fields.verificationConsent,
          identityConsent: fields.identityConsent,
          challengeId: quiz.challenge.challengeId,
          answers: answersPayload(quiz),
        },
      });
      if (!member)
        throw new Error("Your account could not be created. Please try again.");
      // Signup creates a restricted account, never a completed identity
      // review. Send the two selected images only to the private member API.
      let updatedMember = member;
      let uploadCompleted = false;
      try {
        const result = await request("/api/members/identity-verification", {
          method: "POST",
          body: await identityUploadBody(files),
        });
        if (result.verification?.status === "pending") {
          updatedMember = { ...member, identityVerification: result.verification };
          uploadCompleted = true;
        }
      } catch {
        // A failed upload must not retry account creation. The account page
        // offers a private upload retry; files are not kept in local storage,
        // query strings, or account profile data.
      }
      setFields({ ...EMPTY_SIGNUP, ...EMPTY_ELIGIBILITY, identityConsent: false });
      setFiles({ document: null, selfie: null });
      onSessionChange(updatedMember);
      onNavigate(uploadCompleted ? "/account" : "/account?identityUpload=required");
    } catch (error) {
      const message =
        error.message || "Your account could not be created. Please try again.";
      if (
        /request new questions|questions have expired|challenge.*expired|already used/i.test(
          message,
        )
      ) {
        quiz.refresh();
        setServerError(
          "This set of questions expired or changed. Answer the new questions below and try again.",
        );
      } else setServerError(message);
    } finally {
      setBusy(false);
    }
  }
  const steps = ["Details", "Adult eligibility", "Responsible use"];
  return (
    <section className="membership-page container">
      <div className="auth-layout signup-layout">
        <div className="auth-intro">
          <span className="eyebrow">LOUD +CANA MEMBERS · 18+</span>
          <h1>
            Make yourself
            <br />
            <span className="lime-text">at home.</span>
          </h1>
          <p>
            A free account for adults. Complete your details and awareness
            questions, then upload your ID and a current selfie for private
            staff review.
          </p>
          <div className="auth-trust">
            <ShieldCheck size={22} />
            <span>
              Your date of birth and quiz answers do not prove identity. Your
              account stays restricted until staff review your ID, compare
              your face in the selfie, and assess your adult eligibility.
            </span>
          </div>
          <MemberLink
            className="text-link"
            to="/responsible-use"
            onNavigate={onNavigate}
            target="_blank"
            rel="noreferrer"
          >
            Read the responsible-use guide <ArrowUpRight size={15} />
          </MemberLink>
        </div>
        <div className="member-panel auth-panel">
          <span className="eyebrow">FREE MEMBERSHIP</span>
          <ol className="signup-progress" aria-label="Signup progress">
            {steps.map((label, index) => (
              <li
                key={label}
                className={
                  step === index ? "current" : step > index ? "complete" : ""
                }
                aria-current={step === index ? "step" : undefined}
              >
                <span>{step > index ? <Check size={13} /> : index + 1}</span>
                <strong>{label}</strong>
              </li>
            ))}
          </ol>
          <h2 className="signup-step-title" tabIndex={-1} ref={titleRef}>
            {step === 0
              ? "Your account details"
              : step === 1
                ? "Adult eligibility"
                : "A responsible start"}
          </h2>
          <form
            className="auth-form signup-form"
            ref={formRef}
            onSubmit={submit}
            noValidate
          >
            {step === 0 && (
              <>
                <div className="auth-field">
                  <label htmlFor="member-name">Full name</label>
                  <input
                    id="member-name"
                    name="name"
                    autoComplete="name"
                    value={fields.name}
                    onChange={change("name")}
                    minLength={2}
                    maxLength={80}
                    required
                    disabled={busy}
                    aria-invalid={!!errors.name}
                    aria-describedby={
                      errors.name ? "member-name-error" : undefined
                    }
                  />
                  <small className="auth-hint">
                    Use the full name shown on the government-issued photo ID
                    you will use for verification.
                  </small>
                  <FieldError name="member-name" error={errors.name} />
                </div>
                <div className="auth-field">
                  <label htmlFor="member-email">Email address</label>
                  <input
                    id="member-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={fields.email}
                    onChange={change("email")}
                    maxLength={254}
                    required
                    disabled={busy}
                    aria-invalid={!!errors.email}
                  />
                  <FieldError name="member-email" error={errors.email} />
                </div>
                <PasswordField
                  name="password"
                  label="Password"
                  value={fields.password}
                  onChange={change("password")}
                  error={errors.password}
                  autoComplete="new-password"
                  hint="At least 12 characters. A unique passphrase works well."
                  disabled={busy}
                />
                <PasswordField
                  name="confirmPassword"
                  label="Confirm password"
                  value={fields.confirmPassword}
                  onChange={change("confirmPassword")}
                  error={errors.confirmPassword}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </>
            )}
            {step === 1 && (
              <AgeEligibilityFields
                fields={fields}
                onChange={change}
                errors={errors}
                busy={busy}
                onNavigate={onNavigate}
                identityRequired
              />
            )}
            {step === 2 && (
              <>
                <SignupQuestions
                  quiz={quiz}
                  busy={busy}
                  error={errors.questions}
                  onAnswer={() => {
                    setErrors((current) => ({ ...current, questions: "" }));
                    setServerError("");
                  }}
                />
                <div className="signup-identity-next">
                  <div className="signup-identity-heading">
                    <LockKeyhole size={21} />
                    <div>
                      <span className="eyebrow">REQUIRED · PRIVATE STAFF REVIEW</span>
                      <h3>Your ID and a current selfie.</h3>
                    </div>
                  </div>
                  <p>
                    Upload a clear image of your government-issued photo ID
                    and a current selfie. Authorised staff privately compare
                    your ID photograph, selfie, and account details. This is
                    a manual review, not an automated face or liveness check.
                  </p>
                  <IdentityEvidenceFields
                    files={files}
                    onChange={(name, file) => {
                      setFiles((current) => ({ ...current, [name]: file }));
                      setErrors((current) => ({ ...current, [name]: "" }));
                      setServerError("");
                    }}
                    errors={errors}
                    disabled={busy}
                    prefix="signup-identity"
                  />
                  <IdentityConsent
                    checked={fields.identityConsent}
                    onChange={change("identityConsent")}
                    error={errors.identityConsent}
                    disabled={busy}
                    onNavigate={onNavigate}
                  />
                  <p className="age-data-note">
                    Your images are uploaded privately after your account is
                    created. They are not published or sent to an external
                    verification provider. Your account remains restricted
                    until staff complete the review.
                  </p>
                </div>
                <div className="auth-check">
                  <label>
                    <input
                      type="checkbox"
                      name="termsAccepted"
                      checked={fields.termsAccepted}
                      onChange={change("termsAccepted")}
                      disabled={busy}
                      aria-invalid={!!errors.termsAccepted}
                    />
                    <span>
                      I accept the{" "}
                      <MemberLink
                        to="/terms"
                        onNavigate={onNavigate}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Terms of Use
                      </MemberLink>{" "}
                      and have read the{" "}
                      <MemberLink
                        to="/privacy"
                        onNavigate={onNavigate}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Privacy Notice
                      </MemberLink>
                      .
                    </span>
                  </label>
                  <FieldError
                    name="termsAccepted"
                    error={errors.termsAccepted}
                  />
                </div>
              </>
            )}
            {serverError && (
              <p className="auth-error" role="alert">
                {serverError}
              </p>
            )}
            <div className="signup-actions">
              {step > 0 && (
                <button
                  type="button"
                  className="button outline"
                  disabled={busy}
                  onClick={() => {
                    setStep(step - 1);
                    setServerError("");
                  }}
                >
                  <ArrowLeft size={15} />
                  Back
                </button>
              )}
              <button
                type="submit"
                className="button lime auth-submit"
                disabled={
                  busy ||
                  (step === 2 &&
                    (quiz.loading || !quiz.challenge || quiz.expired))
                }
              >
                {busy ? (
                  <>
                    <LoaderCircle size={17} className="member-spinner" />
                    Uploading your ID & selfie…
                  </>
                ) : (
                  <>
                    {step === 2 ? "Create account" : "Continue"}
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
            </div>
          </form>
          <p className="auth-switch">
            Already part of the community?{" "}
            <MemberLink to="/login" onNavigate={onNavigate}>
              Sign in
            </MemberLink>
          </p>
          <p className="auth-footnote">
            Membership is free. ID and selfie review is required to complete
            your eligibility check. Creating an account does not place an order
            or subscribe you to marketing emails.
          </p>
        </div>
      </div>
    </section>
  );
}

function AgeVerificationCard({
  member,
  store,
  onSessionChange,
  onNavigate,
  identityRequired = false,
}) {
  const verification = member.ageVerification || {
    status: "required",
    minimumAge: 18,
  };
  const status = verification.status;
  const [expanded, setExpanded] = useState(false);
  const [fields, setFields] = useState({ ...EMPTY_ELIGIBILITY });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useRef(null);
  const quiz = useSignupQuestions(
    expanded && ["required", "rejected"].includes(status),
  );
  const change = (name) => (event) => {
    setFields((current) => ({
      ...current,
      [name]:
        event.target.type === "checkbox"
          ? event.target.checked
          : event.target.value,
    }));
    setErrors((current) => ({ ...current, [name]: "" }));
    setError("");
  };
  async function refreshStatus() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await request("/api/members/me");
      onSessionChange(result.member);
    } catch (failure) {
      setError(
        failure.message ||
          "Your ID-check status could not be refreshed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const found = eligibilityErrors(fields);
    const issue = questionError(quiz);
    if (issue) found.questions = issue;
    setErrors(found);
    if (Object.keys(found).length) {
      focusInvalid(form.current, found);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await request("/api/members/age-verification", {
        method: "POST",
        body: {
          birthDate: fields.birthDate,
          ageConfirmed: fields.ageConfirmed,
          verificationConsent: fields.verificationConsent,
          challengeId: quiz.challenge.challengeId,
          answers: answersPayload(quiz),
        },
      });
      onSessionChange(result.member);
      setFields({ ...EMPTY_ELIGIBILITY });
      setExpanded(false);
    } catch (failure) {
      const message =
        failure.message ||
        "Your age check could not be submitted. Please try again.";
      setError(message);
      if (
        /request new questions|questions have expired|challenge.*expired|already used/i.test(
          message,
        )
      )
        quiz.refresh();
    } finally {
      setBusy(false);
    }
  }
  const reasons = {
    identity_not_confirmed:
      "The original photo ID could not be confirmed. Contact the store before submitting a new check.",
    details_mismatch:
      "The details presented did not match the application. Check your full name and date of birth before submitting again.",
    unable_to_verify:
      "The store could not complete the original-ID check. Contact the store to arrange another review.",
  };
  return (
    <section
      className={`age-verification-card age-status-${status}`}
      aria-labelledby="age-verification-title"
    >
      <div className="age-verification-summary">
        <ShieldCheck size={29} />
        <div>
          <span className="eyebrow">ADULT MEMBERSHIP</span>
          <h2 id="age-verification-title">
            {identityRequired ? "Renew adult eligibility" : "Age verification"}
          </h2>
          <strong className="age-status-badge">
            {status === "verified"
              ? "18+ ID checked"
              : status === "pending"
                ? "ID check pending"
                : status === "rejected"
                  ? "ID check needs attention"
                  : "ID check required"}
          </strong>
        </div>
      </div>
      {status === "verified" ? (
        <p>
          Your original photo ID was checked in person
          {verification.verifiedAt &&
          !Number.isNaN(new Date(verification.verifiedAt).getTime())
            ? ` on ${new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }).format(new Date(verification.verifiedAt))}`
            : ""}
          . Keep your original ID available for any eligibility check required
          at fulfilment.
        </p>
      ) : status === "pending" ? (
        <>
          <p>
            Your date-of-birth declaration and awareness questions are complete.
            A staff member must still check your original valid photo ID against
            your full name, date of birth, and identity in person.
          </p>
          <div className="age-check-next">
            <strong>What to bring</strong>
            <p>
              An original valid photo identity document, such as your South
              African ID or passport. Do not email an ID copy or enter an ID
              number on this website.
            </p>
            {store?.pickupAddress && (
              <p>
                <strong>Store location:</strong> {store.pickupAddress}
              </p>
            )}
            {store?.contactEmail ? (
              <a
                className="text-link"
                href={`mailto:${store.contactEmail}?subject=${encodeURIComponent("Arrange an adult ID check")}`}
              >
                Contact the store to arrange your ID check{" "}
                <ArrowUpRight size={15} />
              </a>
            ) : (
              <MemberLink
                className="text-link"
                to="/contact"
                onNavigate={onNavigate}
              >
                See contact and ID-check arrangements <ArrowRight size={15} />
              </MemberLink>
            )}
          </div>
          <p className="age-data-note">
            Your account remains pending until the ID check is completed.
            Pending dates of birth are removed after 30 days if the review is
            not completed; you can submit again.
          </p>
          <button
            className="button outline"
            type="button"
            onClick={refreshStatus}
            disabled={busy}
          >
            <RefreshCw
              size={15}
              className={busy ? "member-spinner" : undefined}
            />
            {busy ? "Checking status…" : "Refresh ID status"}
          </button>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <p>
            {identityRequired
              ? "Review your full name, submit your date of birth again, and answer a fresh set of awareness questions. Then upload new ID and selfie images for private staff review."
              : status === "rejected"
                ? reasons[verification.reason] ||
                  "Your ID check could not be completed. Review your details and contact the store before submitting again."
                : "Complete an adult-eligibility declaration and a fresh set of awareness questions. A staff member will then need to check your original photo ID in person."}
          </p>
          {!expanded && (
            <button
              className="button outline"
              type="button"
              onClick={() => setExpanded(true)}
            >
              {identityRequired ? "Update eligibility details" : "Complete age check"}
              <ArrowRight size={16} />
            </button>
          )}
        </>
      )}
      {expanded && ["required", "rejected"].includes(status) && (
        <form
          className="auth-form age-review-form"
          ref={form}
          onSubmit={submit}
          noValidate
        >
          <AgeEligibilityFields
            fields={fields}
            onChange={change}
            errors={errors}
            busy={busy}
            onNavigate={onNavigate}
            identityRequired={identityRequired}
          />
          <SignupQuestions
            quiz={quiz}
            busy={busy}
            error={errors.questions}
            onAnswer={() =>
              setErrors((current) => ({ ...current, questions: "" }))
            }
          />
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <div className="signup-actions">
            <button
              type="button"
              className="button outline"
              onClick={() => setExpanded(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button lime"
              disabled={busy || quiz.loading || !quiz.challenge || quiz.expired}
            >
              {busy
                ? "Submitting…"
                : identityRequired
                  ? "Save eligibility details"
                  : "Submit for ID review"}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      )}
      <p className="age-verification-limits">
        {identityRequired
          ? "Saving these details does not verify your identity. Upload your ID and selfie for private staff review next."
          : "Only a completed original-ID check can mark this account age-verified. The awareness questions alone do not verify age."}
        {" "}Membership does not authorize cannabis sales.
      </p>
    </section>
  );
}

function MemberAccount({
  member,
  onSessionChange,
  onNavigate,
  store,
  visibleSavedCount,
}) {
  const uploadIncomplete =
    new URLSearchParams(window.location.search).get("identityUpload") === "required";
  const [name, setName] = useState(member.name);
  const [profileState, setProfileState] = useState({
    busy: false,
    error: "",
    success: "",
  });
  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
  });
  const [passwordErrors, setPasswordErrors] = useState({});
  const [passwordState, setPasswordState] = useState({
    busy: false,
    error: "",
    success: "",
  });
  const [logoutState, setLogoutState] = useState({ busy: false, error: "" });
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteState, setDeleteState] = useState({ busy: false, error: "" });
  const passwordForm = useRef(null);
  const savedCount = Number.isInteger(visibleSavedCount)
    ? visibleSavedCount
    : Array.isArray(member.favorites)
      ? member.favorites.length
      : 0;

  useEffect(() => setName(member.name), [member.name]);

  async function saveProfile(event) {
    event.preventDefault();
    if (profileState.busy) return;
    if (name.trim().length < 2 || name.trim().length > 80) {
      setProfileState({
        busy: false,
        error: "Enter your name using 2 to 80 characters.",
        success: "",
      });
      return;
    }
    setProfileState({ busy: true, error: "", success: "" });
    try {
      const { member: updated } = await request("/api/members/me", {
        method: "PATCH",
        body: { name: name.trim() },
      });
      onSessionChange(updated);
      setProfileState({
        busy: false,
        error: "",
        success: "Your profile has been updated.",
      });
    } catch (error) {
      setProfileState({ busy: false, error: error.message, success: "" });
    }
  }

  async function updatePassword(event) {
    event.preventDefault();
    if (passwordState.busy) return;
    const nextErrors = {};
    if (!passwords.currentPassword)
      nextErrors.currentPassword = "Enter your current password.";
    if (passwords.newPassword.length < 12 || passwords.newPassword.length > 128)
      nextErrors.newPassword = "Use a new password with 12 to 128 characters.";
    if (passwords.newPassword === passwords.currentPassword)
      nextErrors.newPassword =
        "Choose a different password from your current one.";
    if (passwords.confirmNewPassword !== passwords.newPassword)
      nextErrors.confirmNewPassword = "Your passwords do not match.";
    setPasswordErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusInvalid(passwordForm.current, nextErrors);
      return;
    }
    setPasswordState({ busy: true, error: "", success: "" });
    try {
      const result = await request("/api/members/password", {
        method: "POST",
        body: {
          currentPassword: passwords.currentPassword,
          newPassword: passwords.newPassword,
        },
      });
      onSessionChange(result.member);
      setPasswords({
        currentPassword: "",
        newPassword: "",
        confirmNewPassword: "",
      });
      setPasswordState({
        busy: false,
        error: "",
        success: "Password updated. Your other sessions have been signed out.",
      });
    } catch (error) {
      setPasswordState({ busy: false, error: error.message, success: "" });
    }
  }

  async function signOut() {
    if (logoutState.busy) return;
    setLogoutState({ busy: true, error: "" });
    try {
      await request("/api/members/logout", { method: "POST" });
      onSessionChange(null);
      onNavigate("/login");
    } catch (error) {
      setLogoutState({ busy: false, error: error.message });
    }
  }

  async function closeAccount(event) {
    event.preventDefault();
    if (deleteState.busy) return;
    if (!deletePassword || !deleteConfirmed) {
      setDeleteState({
        busy: false,
        error:
          "Enter your password and confirm that you want to close your account.",
      });
      return;
    }
    setDeleteState({ busy: true, error: "" });
    try {
      await request("/api/members/me", {
        method: "DELETE",
        body: { password: deletePassword },
      });
      setDeletePassword("");
      onSessionChange(null);
      onNavigate("/membership");
    } catch (error) {
      setDeleteState({ busy: false, error: error.message });
    }
  }

  return (
    <section className="membership-page account-page container">
      <div className="account-heading">
        <div>
          <span className="eyebrow">YOUR LOUD +CANA ACCOUNT</span>
          <h1>
            Welcome,{" "}
            <span className="lime-text">{member.name.split(" ")[0]}.</span>
          </h1>
          <p>{formatMemberDate(member.createdAt)}</p>
        </div>
        <button
          className="button outline"
          onClick={signOut}
          disabled={logoutState.busy}
        >
          {logoutState.busy ? (
            <LoaderCircle className="member-spinner" size={17} />
          ) : (
            <LogOut size={17} />
          )}
          {logoutState.busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
      {logoutState.error && (
        <p className="auth-error" role="alert">
          {logoutState.error}
        </p>
      )}
      {uploadIncomplete && member.identityVerification?.status !== "pending" && member.identityVerification?.status !== "verified" && (
        <p className="auth-error" role="alert">
          Your account was created, but your ID and selfie were not submitted.
          Your account remains restricted. When private uploads are available,
          choose your files again below to complete your submission.
        </p>
      )}
      <div className="member-dashboard-showcase">
        <MembershipCard member={member} />
        <MemberSetupJourney member={member} savedCount={savedCount} />
      </div>
      {!hasCompletedVerification(member) && (
        <div id="member-verification" className="member-verification-section">
          {member.identityVerification?.required ? (
            <IdentityVerificationCard
              member={member}
              store={store}
              onSessionChange={onSessionChange}
              onNavigate={onNavigate}
            />
          ) : (
            <AgeVerificationCard
              member={member}
              store={store}
              onSessionChange={onSessionChange}
              onNavigate={onNavigate}
            />
          )}
        </div>
      )}
      <div className="account-grid">
        <section className="account-card account-favourites">
          <Heart size={27} />
          <span className="eyebrow">YOUR COLLECTION</span>
          <h2>
            {savedCount === 1
              ? "1 saved favourite"
              : `${savedCount} saved favourites`}
          </h2>
          <p>
            {savedCount
              ? "Your picks are saved to your account. Sign in on any device to find them again."
              : "Find a product you like and tap its heart to start your own collection."}
          </p>
          <MemberLink
            className="button lime"
            to="/shop?favorites=1"
            onNavigate={onNavigate}
          >
            View saved favourites <ArrowRight size={17} />
          </MemberLink>
          <MemberLink className="text-link" to="/shop" onNavigate={onNavigate}>
            Explore all products <ArrowUpRight size={15} />
          </MemberLink>
        </section>
        <section className="account-card" id="member-profile">
          <UserRound size={27} />
          <h2>Your profile</h2>
          <form className="auth-form" onSubmit={saveProfile} noValidate>
            <div className="auth-field">
              <label htmlFor="profile-name">Full name</label>
              <input
                id="profile-name"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setProfileState((current) => ({
                    ...current,
                    error: "",
                    success: "",
                  }));
                }}
                maxLength={80}
                disabled={profileState.busy}
                aria-invalid={!!profileState.error}
                aria-describedby={
                  profileState.error ? "profile-error" : undefined
                }
              />
            </div>
            {member.ageVerification?.status === "verified" && (
              <p className="auth-hint">
                Changing your name will require a new ID check.
              </p>
            )}
            <div className="account-meta">
              <span>Account email</span>
              <strong>{member.email}</strong>
            </div>
            {profileState.error && (
              <p className="auth-error" id="profile-error" role="alert">
                {profileState.error}
              </p>
            )}
            {profileState.success && (
              <p className="auth-message" role="status">
                <CheckCircle2 size={16} />
                {profileState.success}
              </p>
            )}
            <button
              className="button outline"
              type="submit"
              disabled={profileState.busy}
            >
              {profileState.busy ? "Saving…" : "Save profile"}
              <Check size={16} />
            </button>
          </form>
        </section>
        <section className="account-card account-password">
          <KeyRound size={27} />
          <h2>Change password</h2>
          <p>Choose a unique passphrase you don’t use elsewhere.</p>
          <form
            className="auth-form"
            onSubmit={updatePassword}
            ref={passwordForm}
            noValidate
          >
            {[
              {
                name: "currentPassword",
                label: "Current password",
                autoComplete: "current-password",
              },
              {
                name: "newPassword",
                label: "New password",
                autoComplete: "new-password",
              },
              {
                name: "confirmNewPassword",
                label: "Confirm new password",
                autoComplete: "new-password",
              },
            ].map((field) => (
              <PasswordField
                key={field.name}
                {...field}
                value={passwords[field.name]}
                error={passwordErrors[field.name]}
                disabled={passwordState.busy}
                onChange={(event) => {
                  setPasswords((current) => ({
                    ...current,
                    [field.name]: event.target.value,
                  }));
                  setPasswordErrors((current) => ({
                    ...current,
                    [field.name]: "",
                  }));
                  setPasswordState((current) => ({
                    ...current,
                    error: "",
                    success: "",
                  }));
                }}
                hint={
                  field.name === "newPassword"
                    ? "Use 12 to 128 characters."
                    : undefined
                }
              />
            ))}
            {passwordState.error && (
              <p className="auth-error" role="alert">
                {passwordState.error}
              </p>
            )}
            {passwordState.success && (
              <p className="auth-message" role="status">
                <CheckCircle2 size={16} />
                {passwordState.success}
              </p>
            )}
            <button
              type="submit"
              className="button outline"
              disabled={passwordState.busy}
            >
              {passwordState.busy ? "Updating password…" : "Update password"}
              <ArrowRight size={16} />
            </button>
          </form>
        </section>
      </div>
      <details className="account-danger">
        <summary>
          <Trash2 size={17} />
          Close your account
        </summary>
        <div>
          <p>
            This permanently removes your member profile, saved favourites, and
            sign-in sessions. It does not cancel a separately submitted order
            request.
          </p>
          <form className="auth-form" onSubmit={closeAccount} noValidate>
            <PasswordField
              name="deletePassword"
              label="Confirm your password"
              value={deletePassword}
              onChange={(event) => {
                setDeletePassword(event.target.value);
                setDeleteState((current) => ({ ...current, error: "" }));
              }}
              disabled={deleteState.busy}
            />
            <div className="auth-check">
              <label>
                <input
                  type="checkbox"
                  checked={deleteConfirmed}
                  onChange={(event) => setDeleteConfirmed(event.target.checked)}
                  disabled={deleteState.busy}
                />
                <span>I understand that closing my account is permanent.</span>
              </label>
            </div>
            {deleteState.error && (
              <p className="auth-error" role="alert">
                {deleteState.error}
              </p>
            )}
            <button
              type="submit"
              className="button account-delete-button"
              disabled={deleteState.busy}
            >
              {deleteState.busy
                ? "Closing your account…"
                : "Permanently close account"}
              <Trash2 size={16} />
            </button>
          </form>
        </div>
      </details>
    </section>
  );
}
