import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  Copy,
  Fingerprint,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import "../membership-card.css";
import { hasCompletedVerification } from "../lib/membership.js";

const CARD_NUMBER = /^LC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

function memberStatus(member) {
  const age = member.ageVerification?.status;
  const identity = member.identityVerification || {};
  if (hasCompletedVerification(member))
    return { code: "verified", label: "Verified member", detail: "Your required staff verification is complete." };
  if (age === "rejected" || identity.status === "rejected")
    return { code: "rejected", label: "Review not approved", detail: "Check the review details below for your next step." };
  if (!age || age === "required" || identity.status === "expired")
    return { code: "required", label: "Verification required", detail: "Complete the verification steps below to update your application." };
  if (identity.required && ["not_started", "unavailable"].includes(identity.status))
    return { code: "required", label: "ID upload needed", detail: "Your account is created. Complete your private ID and selfie submission below." };
  return { code: "pending", label: "Verification pending", detail: "Follow your current application and staff review below." };
}

function joinedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", month: "short", year: "numeric",
  }).format(date);
}

function cardSvg({ name, number, joined, status }) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 1080 680");
  svg.setAttribute("width", "1080");
  svg.setAttribute("height", "680");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Loud + Cana digital membership card");
  const element = (tag, attributes, content) => {
    const node = document.createElementNS(namespace, tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== undefined) node.setAttribute(key, String(value));
    });
    if (content !== undefined) node.textContent = content;
    svg.append(node);
    return node;
  };
  element("title", {}, "Loud + Cana digital membership card");
  element("rect", { width: 1080, height: 680, rx: 36, fill: "#0b1209" });
  element("rect", { x: 2, y: 2, width: 1076, height: 676, rx: 34, fill: "none", stroke: "#637d35", "stroke-width": 3 });
  element("circle", { cx: 1000, cy: 70, r: 250, fill: "none", stroke: "#26391c", "stroke-width": 50 });
  element("circle", { cx: 1000, cy: 70, r: 340, fill: "none", stroke: "#1a2914", "stroke-width": 2 });
  const text = (x, y, content, size, fill, extra = {}) => element("text", {
    x, y, "font-family": "Arial, sans-serif", "font-size": size, fill, ...extra,
  }, content);
  text(65, 104, "LOUD + CANA", 45, "#d4ff00", { "font-weight": 800, "letter-spacing": 3 });
  text(65, 151, "DIGITAL MEMBERSHIP CARD", 19, "#adbf9c", { "letter-spacing": 4 });
  text(65, 286, name, 48, "#f4f8ed", { "font-weight": 700, textLength: name.length > 29 ? 920 : undefined, lengthAdjust: "spacingAndGlyphs" });
  text(65, 340, "MEMBERSHIP NUMBER", 17, "#9db18b", { "letter-spacing": 3 });
  text(65, 391, number, 39, "#d4ff00", { "font-family": "monospace", "letter-spacing": 2 });
  text(65, 485, `Member since ${joined}`, 23, "#d7e4cb");
  text(65, 541, status, 24, "#f4f8ed", { "font-weight": 700 });
  element("line", { x1: 65, x2: 1015, y1: 580, y2: 580, stroke: "#32462a" });
  text(65, 625, "Account identifier only. Not proof of age or identity.", 19, "#a8b89a");
  return new XMLSerializer().serializeToString(svg);
}

export default function MembershipCard({ member }) {
  const number = CARD_NUMBER.test(member.membershipNumber || "") ? member.membershipNumber : "";
  const status = memberStatus(member);
  const joined = joinedDate(member.createdAt);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const downloadUrls = useRef(new Set());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      downloadUrls.current.forEach((url) => URL.revokeObjectURL(url));
      downloadUrls.current.clear();
    };
  }, []);
  useEffect(() => { setNotice(""); setFailure(""); }, [member.id, number]);

  async function copyNumber() {
    setNotice(""); setFailure("");
    if (!number) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(number);
      if (mounted.current) setNotice("Membership number copied.");
    } catch {
      if (mounted.current) setFailure("Copy is unavailable in this browser. Select and copy the membership number on your card.");
    }
  }

  function downloadCard() {
    setNotice(""); setFailure("");
    if (!number) return;
    try {
      const name = (member.name || "Member").replace(/[\u0000-\u001f\u007f]/g, "");
      const bytes = cardSvg({ name, number, joined, status: status.label });
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml;charset=utf-8" }));
      downloadUrls.current.add(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = `loud-cana-membership-${number}.svg`;
      document.body.append(link);
      link.click();
      link.remove();
      // Give the browser time to finish opening its save operation.
      setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 30_000);
      setNotice("Your membership card download has started. Saved cards show the status at the time of download.");
    } catch {
      setFailure("Your card could not be downloaded. Please try again in this browser.");
    }
  }

  return (
    <section className="membership-card-panel" aria-labelledby="membership-card-heading">
      <div className="member-panel-heading">
        <span className="member-panel-icon"><Fingerprint size={19} aria-hidden="true" /></span>
        <div><span className="eyebrow">YOUR OWN LITTLE CORNER</span><h2 id="membership-card-heading">Make it yours.</h2></div>
      </div>
      <article className={`digital-member-card is-${status.code}`} aria-label="Digital membership card">
        <span className="digital-card-orbit" aria-hidden="true" />
        <div className="digital-card-top"><strong>LOUD<span>+CANA</span></strong><span>MEMBER<br />CARD</span></div>
        <div className="digital-card-person"><span>CARDHOLDER</span><h3>{member.name}</h3></div>
        <div className="digital-card-number"><span>MEMBERSHIP NUMBER</span><strong>{number || "Unavailable"}</strong></div>
        <div className="digital-card-bottom"><span>Member since <strong>{joined}</strong></span><span className="member-card-status" data-verification-status={status.code}><span />{status.label}</span></div>
      </article>
      <div className="member-card-actions">
        <button type="button" className="button lime" onClick={downloadCard} disabled={!number}><ArrowDownToLine size={16} />Download membership card</button>
        <button type="button" className="button outline" onClick={copyNumber} disabled={!number}><Copy size={16} />Copy membership number</button>
      </div>
      <p className="member-card-fineprint">Your membership number identifies your account. This card is not proof of age or identity. A downloaded card is a snapshot; check this dashboard for the latest status.</p>
      {!number && <p className="member-card-feedback" role="status">Your membership number is unavailable. Refresh your account or contact support.</p>}
      {notice && <p className="member-card-feedback" role="status"><Check size={15} aria-hidden="true" />{notice}</p>}
      {failure && <p className="member-card-feedback is-error" role="alert">{failure}</p>}
    </section>
  );
}

export function MemberSetupJourney({ member, savedCount }) {
  const status = memberStatus(member);
  const identity = member.identityVerification || {};
  const documentsReceived = identity.required
    ? ["pending", "verified", "rejected"].includes(identity.status)
    : status.code === "verified";
  const complete = status.code === "verified";
  if (complete) {
    return (
      <section className="member-journey-panel" aria-labelledby="member-journey-heading">
        <div className="member-journey-copy">
          <span className="member-welcome-sticker"><Sparkles size={14} aria-hidden="true" /> GOOD TO HAVE YOU HERE</span>
          <h2 id="member-journey-heading">Your space.<br /><span>Your pace.</span></h2>
          <p>Your account is approved. Keep your membership card handy and make this space your own.</p>
        </div>
        <div className="member-journey-stats">
          <span><strong>All set</strong>your member account</span>
          <span><strong>{savedCount}</strong>{savedCount === 1 ? "saved favourite" : "saved favourites"}</span>
        </div>
        <a className="member-verification-jump" href="#member-profile"><Fingerprint size={16} aria-hidden="true" />Manage your profile</a>
      </section>
    );
  }
  const steps = [
    { title: "Your account", detail: "A space that belongs to you", done: true },
    { title: identity.required ? "Private ID + selfie" : "Original ID check", detail: documentsReceived ? "Submission received" : "Complete your verification step below", done: documentsReceived },
    { title: "Staff review", detail: complete ? "Required verification complete" : status.code === "rejected" ? "Review needs your attention" : "Follow the current status below", done: complete },
  ];
  const completed = steps.filter((step) => step.done).length;
  return (
    <section className="member-journey-panel" aria-labelledby="member-journey-heading">
      <div className="member-journey-copy"><span className="member-welcome-sticker"><Sparkles size={14} aria-hidden="true" /> GOOD TO HAVE YOU HERE</span><h2 id="member-journey-heading">Your space.<br /><span>Your pace.</span></h2><p>{status.detail}</p></div>
      <div className="member-journey-stats"><span><strong>{completed}<small> / 3</small></strong>setup steps complete</span><span><strong>{savedCount}</strong>{savedCount === 1 ? "saved favourite" : "saved favourites"}</span></div>
      <div className="member-setup-track" role="progressbar" aria-label="Membership setup progress" aria-valuemin={0} aria-valuemax={3} aria-valuenow={completed} aria-valuetext={`${completed} of 3 setup steps complete`}><span style={{ width: `${completed / 3 * 100}%` }} /></div>
      <ol className="member-setup-steps">{steps.map((step, index) => <li key={step.title} className={step.done ? "is-complete" : ""}><span className="member-step-number" aria-hidden="true">{step.done ? <Check size={14} /> : index + 1}</span><div><strong>{step.title}</strong><small>{step.detail}</small></div></li>)}</ol>
      <a className="member-verification-jump" href="#member-verification"><ShieldCheck size={16} aria-hidden="true" />View verification details</a>
    </section>
  );
}
