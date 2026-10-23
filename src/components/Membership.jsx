import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
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
          maxLength={128}
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
  if (first) form?.elements.namedItem(first)?.focus();
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
    if (!EMAIL.test(email) || email.length > 254)
      nextErrors.email = "Enter a valid email address.";
    if (!fields.password || (signup && fields.password.length < 12))
      nextErrors.password = signup
        ? "Use at least 12 characters for your password."
        : "Enter your password.";
    if (fields.password.length > 128)
      nextErrors.password = "Use no more than 128 characters.";
    if (signup && fields.confirmPassword !== fields.password)
      nextErrors.confirmPassword = "Your passwords do not match.";
    if (signup && !fields.ageConfirmed)
      nextErrors.ageConfirmed = "Please confirm that you are 21 or older.";
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
              Free to join. For adults 21 and older.
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
            Your account keeps your favourites and profile in one place.
            Product availability and ordering status are shown in the shop.
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

  if (member) {
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

  return (
    <section className="membership-page container">
      <div className="auth-layout">
        <div className="auth-intro">
          <span className="eyebrow">LOUD +CANA MEMBERS</span>
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
              : "Sign in to pick up where you left off. Your saved favourites and account settings are waiting."}
          </p>
          <div className="auth-trust">
            <ShieldCheck size={21} />
            <span>
              Your password is protected. Account access uses a secure server
              session.
            </span>
          </div>
        </div>
        <div className="member-panel auth-panel">
          <span className="eyebrow">
            {signup ? "FREE MEMBERSHIP" : "MEMBER ACCESS"}
          </span>
          <h2>{signup ? "Create your account" : "Member login"}</h2>
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
                aria-describedby={
                  errors.email ? "member-email-error" : undefined
                }
              />
              <FieldError name="member-email" error={errors.email} />
            </div>
            <PasswordField
              name="password"
              label="Password"
              value={fields.password}
              onChange={change("password")}
              error={errors.password}
              autoComplete={signup ? "new-password" : "current-password"}
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
                    <span>I confirm I am 21 or older.</span>
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

function MemberAccount({ member, onSessionChange, onNavigate }) {
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
  const savedCount = Array.isArray(member.favorites)
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
        <section className="account-card">
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
