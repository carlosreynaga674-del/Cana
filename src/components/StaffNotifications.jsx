import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import "../notifications.css";

const emptyFeed = {
  notifications: [],
  unreadCount: 0,
  total: 0,
  nextCursor: null,
  latestSequence: 0,
};

function validateFeed(data) {
  if (
    !Array.isArray(data?.notifications) ||
    !Number.isSafeInteger(data.unreadCount) ||
    data.unreadCount < 0 ||
    !Number.isSafeInteger(data.total) ||
    data.total < 0 ||
    !Number.isSafeInteger(data.latestSequence) ||
    data.latestSequence < 0 ||
    !(data.nextCursor === null || /^\d+$/.test(data.nextCursor)) ||
    data.notifications.some(
      (item) =>
        typeof item.id !== "string" ||
        !Number.isSafeInteger(item.sequence) ||
        typeof item.title !== "string" ||
        typeof item.message !== "string" ||
        typeof item.memberId !== "string" ||
        typeof item.memberName !== "string" ||
        !["members", "age"].includes(item.target) ||
        typeof item.createdAt !== "string" ||
        !(item.readAt === null || typeof item.readAt === "string"),
    )
  )
    throw new Error("Notifications could not be loaded. Please refresh.");
  return data;
}

/** The inbox stays mounted with the authenticated workspace, not the selected tab. */
export function useStaffNotifications({
  enabled,
  accountKey,
  request,
  onSessionExpired,
  onForbidden,
}) {
  const [snapshot, setSnapshot] = useState({ ...emptyFeed, accountKey: "", scope: "" });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [mutation, setMutation] = useState(null);
  const [revision, setRevision] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const currentScope = `${accountKey}:${unreadOnly}:${cursor}`;
  const current = useRef({ enabled, accountKey, scope: currentScope });
  current.current = { enabled, accountKey, scope: currentScope };
  const getController = useRef(null);
  const mutationController = useRef(null);
  const generation = useRef(0);
  const highestSeen = useRef({ accountKey: "", sequence: null });

  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(""), 6000);
    return () => clearTimeout(timer);
  }, [announcement]);

  useEffect(() => {
    setUnreadOnly(false);
    setCursor("");
    setAnnouncement("");
    setError("");
    setActionError("");
    setMutation(null);
    highestSeen.current = { accountKey, sequence: null };
    mutationController.current?.abort();
    mutationController.current = null;
    return () => mutationController.current?.abort();
  }, [accountKey, enabled]);

  useEffect(() => {
    const effectGeneration = ++generation.current;
    let disposed = false;
    let busy = false;
    if (!enabled) {
      setSnapshot({ ...emptyFeed, accountKey: "", scope: "" });
      setLoading(false);
      setError("");
      return;
    }
    const active = () =>
      !disposed &&
      generation.current === effectGeneration &&
      current.current.enabled &&
      current.current.scope === currentScope;
    const load = async ({ quiet = false } = {}) => {
      if (!active() || busy || mutationController.current || document.hidden) return;
      const controller = new AbortController();
      getController.current = controller;
      busy = true;
      if (!quiet) setLoading(true);
      try {
        const query = new URLSearchParams({ limit: "30" });
        if (cursor) query.set("before", cursor);
        if (unreadOnly) query.set("unread", "true");
        const data = validateFeed(
          await request(`/api/admin/notifications?${query}`, { signal: controller.signal }),
        );
        if (!active() || controller.signal.aborted) return;
        const seen = highestSeen.current;
        if (
          seen.accountKey === accountKey &&
          seen.sequence !== null &&
          data.latestSequence > seen.sequence
        ) {
          setAnnouncement("New account activity. Your team inbox has been updated.");
        }
        highestSeen.current = {
          accountKey,
          sequence: Math.max(seen.sequence || 0, data.latestSequence),
        };
        setSnapshot({ ...data, accountKey, scope: currentScope });
        setError("");
      } catch (problem) {
        if (!active() || controller.signal.aborted) return;
        if ([401, 403].includes(problem.status)) {
          setSnapshot({ ...emptyFeed, accountKey: "", scope: "" });
          if (problem.status === 401) onSessionExpired();
          else onForbidden();
        } else {
          setError(problem.message || "Notifications could not be loaded. Please try again.");
        }
      } finally {
        busy = false;
        if (getController.current === controller) getController.current = null;
        if (active()) setLoading(false);
      }
    };
    void load();
    const poll = () => void load({ quiet: true });
    const timer = setInterval(poll, 15000);
    window.addEventListener("focus", poll);
    window.addEventListener("online", poll);
    document.addEventListener("visibilitychange", poll);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", poll);
      window.removeEventListener("online", poll);
      document.removeEventListener("visibilitychange", poll);
      getController.current?.abort();
      getController.current = null;
    };
  }, [
    enabled,
    accountKey,
    currentScope,
    cursor,
    unreadOnly,
    revision,
    request,
    onSessionExpired,
    onForbidden,
  ]);

  const refresh = useCallback(() => { setActionError(""); setRevision((value) => value + 1); }, []);
  const newest = useCallback(() => {
    setCursor("");
    setRevision((value) => value + 1);
  }, []);
  const filter = useCallback((unread) => {
    setCursor("");
    setUnreadOnly(unread);
  }, []);

  async function markRead(id, through) {
    if (!enabled || mutationController.current) return false;
    const key = accountKey;
    const controller = new AbortController();
    mutationController.current = controller;
    generation.current += 1;
    getController.current?.abort();
    setMutation(id || "all");
    setActionError("");
    try {
      const data = await request(
        id
          ? `/api/admin/notifications/${encodeURIComponent(id)}/read`
          : "/api/admin/notifications/read-all",
        {
          method: "POST",
          body: JSON.stringify(id ? {} : { through }),
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || current.current.accountKey !== key || !current.current.enabled)
        return false;
      if (data?.ok !== true) throw new Error("The read status was not confirmed. Please refresh.");
      return true;
    } catch (problem) {
      if (controller.signal.aborted || current.current.accountKey !== key || !current.current.enabled)
        return false;
      if ([401, 403].includes(problem.status)) {
        setSnapshot({ ...emptyFeed, accountKey: "", scope: "" });
        if (problem.status === 401) onSessionExpired();
        else onForbidden();
      } else setActionError(problem.message || "The read status could not be saved. Please try again.");
      return false;
    } finally {
      if (mutationController.current === controller) mutationController.current = null;
      if (!controller.signal.aborted && current.current.accountKey === key && current.current.enabled) {
        setMutation(null);
        setRevision((value) => value + 1);
      }
    }
  }

  const authorizedSnapshot = enabled && snapshot.accountKey === accountKey ? snapshot : emptyFeed;
  const displayed = snapshot.scope === currentScope ? authorizedSnapshot : { ...emptyFeed, unreadCount: authorizedSnapshot.unreadCount };
  return {
    ...displayed,
    loading,
    error: actionError || error,
    mutation,
    unreadOnly,
    cursor,
    announcement,
    refresh,
    newest,
    filter,
    older: () => { if (displayed.nextCursor) setCursor(displayed.nextCursor); },
    markRead: (id) => markRead(id),
    markAllRead: () => markRead(null, displayed.latestSequence),
  };
}

export function NotificationBell({ inbox, onOpen }) {
  return (
    <button
      className={`staff-notification-bell ${inbox.unreadCount ? "has-unread" : ""}`}
      aria-label={`Notifications, ${inbox.unreadCount} unread`}
      aria-controls="staff-notifications-panel"
      title={inbox.error ? "Notifications need attention" : "Open account notifications"}
      onClick={onOpen}
    >
      <Bell size={20} />
      {inbox.unreadCount > 0 && (
        <span className="staff-notification-count" aria-hidden="true">
          {inbox.unreadCount > 99 ? "99+" : inbox.unreadCount}
        </span>
      )}
      {inbox.error && <span className="staff-notification-warning" aria-hidden="true" />}
    </button>
  );
}

function readableDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString("en-ZA", {
        timeZone: "Africa/Johannesburg",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export default function StaffNotifications({ inbox, onOpen }) {
  async function open(item) {
    if (item.readAt || await inbox.markRead(item.id)) {
      onOpen(item.target, { id: item.memberId, name: item.memberName });
    }
  }
  return (
    <section className="staff-notifications" aria-labelledby="staff-notifications-heading">
      <div className="staff-notifications-heading">
        <div>
          <span className="staff-eyebrow">ACCOUNT ACTIVITY</span>
          <h2 id="staff-notifications-heading">Your team inbox.</h2>
          <p>Member applications, verification updates, and profile changes in one private place.</p>
        </div>
        <button className="staff-secondary-button" onClick={inbox.refresh} disabled={inbox.loading || Boolean(inbox.mutation)}>
          <RefreshCw size={16} className={inbox.loading ? "staff-spin" : ""} />
          Refresh notifications
        </button>
      </div>
      <div className="staff-notifications-toolbar">
        <div className="staff-notification-filters" role="group" aria-label="Filter notifications">
          <button aria-pressed={!inbox.unreadOnly} onClick={() => inbox.filter(false)} disabled={Boolean(inbox.mutation)}>All activity</button>
          <button aria-pressed={inbox.unreadOnly} onClick={() => inbox.filter(true)} disabled={Boolean(inbox.mutation)}>Unread</button>
        </div>
        <button className="staff-secondary-button" onClick={inbox.markAllRead} disabled={!inbox.unreadCount || inbox.loading || Boolean(inbox.mutation) || !inbox.latestSequence}>
          {inbox.mutation === "all" ? <LoaderCircle size={15} className="staff-spin" /> : <CheckCheck size={15} />}
          Mark all read
        </button>
      </div>
      <div className="staff-notifications-status">
        <span><span className="staff-notification-live-dot" />{inbox.unreadCount} unread</span>
        <span>Updates every 15 seconds while this dashboard is visible.</span>
      </div>
      {inbox.error && (
        <div className="staff-service-error" role="alert">
          <span>{inbox.error}</span>
          <button onClick={inbox.refresh} disabled={Boolean(inbox.mutation)}>Try again <RefreshCw size={14} /></button>
        </div>
      )}
      {inbox.loading && !inbox.notifications.length ? (
        <div className="staff-notifications-loading" role="status"><LoaderCircle size={22} className="staff-spin" />Loading notifications…</div>
      ) : inbox.notifications.length ? (
        <ol className="staff-notification-list" aria-label="Account notifications">
          {inbox.notifications.map((item) => (
            <li key={item.id} className={`staff-notification-item ${item.readAt ? "is-read" : "is-unread"}`}>
              <span className="staff-notification-icon" aria-hidden="true">{item.readAt ? <Bell size={19} /> : <BellRing size={19} />}</span>
              <div className="staff-notification-content">
                <div className="staff-notification-title"><h3>{item.title}</h3>{!item.readAt && <span>Unread</span>}</div>
                <strong>{item.memberName}</strong>
                <p>{item.message}</p>
                <time dateTime={item.createdAt}>{readableDate(item.createdAt)}</time>
                <div className="staff-notification-item-actions">
                  <button className="staff-secondary-button" onClick={() => open(item)} disabled={Boolean(inbox.mutation)}>{item.target === "age" ? "Open application" : "Open member"}<ArrowRight size={14} /></button>
                  {!item.readAt && <button className="staff-notification-read-button" onClick={() => inbox.markRead(item.id)} disabled={Boolean(inbox.mutation)}>{inbox.mutation === item.id ? <LoaderCircle className="staff-spin" size={14} /> : <Check size={14} />}Mark as read</button>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : !inbox.error && (
        <div className="staff-empty staff-notifications-empty">
          <span><Bell size={30} /></span>
          <h3>{inbox.unreadOnly ? "You’re all caught up." : "Your inbox is ready."}</h3>
          <p>{inbox.unreadOnly ? "There are no unread notifications on this page." : "New member and verification activity will appear here automatically."}</p>
          {inbox.cursor && <button className="staff-secondary-button" onClick={inbox.newest}>Newest notifications</button>}
        </div>
      )}
      <div className="staff-notifications-footer">
        <span>{inbox.total} notification{inbox.total === 1 ? "" : "s"}{inbox.unreadOnly ? " matching your filter" : " in your inbox"}</span>
        <div>
          {inbox.cursor && <button className="staff-secondary-button" onClick={inbox.newest} disabled={inbox.loading || Boolean(inbox.mutation)}><ChevronLeft size={14} />Newest notifications</button>}
          {inbox.nextCursor && <button className="staff-secondary-button" onClick={inbox.older} disabled={inbox.loading || Boolean(inbox.mutation)}>Older notifications<ChevronRight size={14} /></button>}
        </div>
      </div>
      <p className="staff-notification-privacy"><ShieldCheck size={14} />Read status is personal to your staff account. Alerts are shown inside the dashboard; keep it open to receive updates.</p>
    </section>
  );
}
