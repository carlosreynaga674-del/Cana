import React, { useCallback, useEffect, useRef, useState } from "react";
import Code128Reader from "@zxing/library/esm/core/oned/Code128Reader.js";
import RGBLuminanceSource from "@zxing/library/esm/core/RGBLuminanceSource.js";
import BinaryBitmap from "@zxing/library/esm/core/BinaryBitmap.js";
import HybridBinarizer from "@zxing/library/esm/core/common/HybridBinarizer.js";
import { ArrowRight, Camera, CameraOff, LoaderCircle, ScanLine, Search, ShieldCheck, Upload, X } from "lucide-react";
import { hasCompletedVerification, MEMBERSHIP_NUMBER_PATTERN, LEGACY_MEMBERSHIP_NUMBER_PATTERN, normalizeMembershipNumber } from "../lib/membership.js";
import "../member-scanner.css";

const normalized = normalizeMembershipNumber;

function decodeImage(source) {
  const width = source.videoWidth || source.naturalWidth;
  const height = source.videoHeight || source.naturalHeight;
  if (!width || !height) throw new Error("Image not ready");
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    pixels[index] = (rgba[offset] + 2 * rgba[offset + 1] + rgba[offset + 2]) >> 2;
  }
  return new Code128Reader().decode(new BinaryBitmap(
    new HybridBinarizer(new RGBLuminanceSource(pixels, canvas.width, canvas.height)),
  ));
}

function statusFor(member) {
  if (member.verified && hasCompletedVerification(member)) return { code: "verified", label: "Verified member" };
  if (member.ageVerification.status === "required") return { code: "required", label: "Verification required" };
  if (member.ageVerification.status === "rejected" || member.identityVerification.status === "rejected")
    return { code: "rejected", label: "Review not approved" };
  return { code: "pending", label: "Verification pending" };
}

export default function MemberScanner({ request, onSessionExpired, onForbidden, onOpen, initialNumber = "" }) {
  const [number, setNumber] = useState(initialNumber);
  const [member, setMember] = useState(null);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [camera, setCamera] = useState("idle");
  const [error, setError] = useState("");
  const video = useRef(null);
  const input = useRef(null);
  const resultPanel = useRef(null);
  const mounted = useRef(true);
  const stream = useRef(null);
  const cameraVersion = useRef(0);
  const lookupVersion = useRef(0);
  const imageVersion = useRef(0);
  const lookupController = useRef(null);
  const imageUrl = useRef(null);
  const scanTimer = useRef(null);

  const stopCamera = useCallback(() => {
    cameraVersion.current += 1;
    clearTimeout(scanTimer.current);
    scanTimer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) {
      video.current.pause();
      video.current.srcObject = null;
    }
    if (mounted.current) setCamera("idle");
  }, []);

  const cancelLookup = useCallback(() => {
    lookupVersion.current += 1;
    lookupController.current?.abort();
    lookupController.current = null;
    if (mounted.current) setBusy(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden) stopCamera(); };
    window.addEventListener("pagehide", stopCamera);
    document.addEventListener("visibilitychange", hide);
    return () => {
      mounted.current = false;
      stopCamera();
      cancelLookup();
      imageVersion.current += 1;
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
      window.removeEventListener("pagehide", stopCamera);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [cancelLookup, stopCamera]);

  useEffect(() => {
    if (initialNumber) void findMember(initialNumber);
  }, [initialNumber]);

  useEffect(() => {
    if (!member) return;
    resultPanel.current?.focus({ preventScroll: true });
    resultPanel.current?.scrollIntoView({ block: "nearest" });
  }, [member]);

  async function findMember(value) {
    stopCamera();
    cancelLookup();
    const code = normalized(value);
    setMember(null);
    setError("");
    if (!MEMBERSHIP_NUMBER_PATTERN.test(code) && !LEGACY_MEMBERSHIP_NUMBER_PATTERN.test(code)) {
      setError("Scan a Loud + Cana membership barcode or enter the membership number printed on the card.");
      return;
    }
    setNumber(code);
    const version = ++lookupVersion.current;
    const controller = new AbortController();
    lookupController.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    setBusy(true);
    try {
      const data = await request("/api/admin/members/lookup", {
        method: "POST", body: JSON.stringify({ membershipNumber: code }), signal: controller.signal,
      });
      if (!mounted.current || version !== lookupVersion.current || controller.signal.aborted) return;
      const result = data?.member;
      if (!result || !MEMBERSHIP_NUMBER_PATTERN.test(result.membershipNumber) || typeof result.id !== "string" ||
          typeof result.name !== "string" || typeof result.verified !== "boolean" ||
          !result.ageVerification || !result.identityVerification ||
          (result.verified && !hasCompletedVerification(result)))
        throw new Error("The member record could not be confirmed. Please try again.");
      setMember(result);
    } catch (problem) {
      if (!mounted.current || version !== lookupVersion.current) return;
      if (problem.status === 401 || problem.status === 403) {
        setMember(null);
        if (problem.status === 401) onSessionExpired();
        else onForbidden();
      } else if (!controller.signal.aborted || timedOut) {
        setError(timedOut ? "Member lookup timed out. Please try again." : problem.message || "The member could not be found.");
      }
    } finally {
      clearTimeout(timeout);
      if (lookupController.current === controller) lookupController.current = null;
      if (mounted.current && version === lookupVersion.current) setBusy(false);
    }
  }

  function clearResult() {
    stopCamera();
    cancelLookup();
    imageVersion.current += 1;
    setImageBusy(false);
    setNumber("");
    setMember(null);
    setError("");
    input.current?.focus();
  }

  async function startCamera() {
    if (camera !== "idle" || imageBusy) return;
    cancelLookup();
    setMember(null);
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera scanning is unavailable in this browser. Use a barcode image, a USB scanner, or the membership number.");
      return;
    }
    const version = ++cameraVersion.current;
    setCamera("starting");
    let opened;
    try {
      opened = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false,
      });
      if (!mounted.current || version !== cameraVersion.current || document.hidden) {
        opened.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = opened;
      setCamera("active");
      video.current.srcObject = opened;
      await video.current.play();
      if (!mounted.current || version !== cameraVersion.current) {
        opened.getTracks().forEach((track) => track.stop());
        return;
      }
      const scanFrame = () => {
        if (!mounted.current || version !== cameraVersion.current || document.hidden) return;
        let result;
        try { result = decodeImage(video.current); } catch { /* Keep looking while the camera is active. */ }
        if (result) { void findMember(result.getText()); return; }
        scanTimer.current = setTimeout(scanFrame, 250);
      };
      scanFrame();
    } catch (problem) {
      opened?.getTracks().forEach((track) => track.stop());
      if (!mounted.current || version !== cameraVersion.current) return;
      stopCamera();
      setError(problem.name === "NotAllowedError"
        ? "Camera access was not allowed. You can scan an image or enter the membership number instead."
        : "The camera could not be started. Check the device or use a barcode image or membership number.");
    }
  }

  async function scanImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    stopCamera();
    cancelLookup();
    const version = ++imageVersion.current;
    setMember(null);
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 6 * 1024 * 1024) {
      setError("Choose a JPEG, PNG or WebP photo or screenshot of at most 6 MiB.");
      return;
    }
    setImageBusy(true);
    const url = URL.createObjectURL(file);
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = url;
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!mounted.current || version !== imageVersion.current) return;
      if (image.naturalWidth * image.naturalHeight > 20000000) throw new Error("Image too large");
      const result = decodeImage(image);
      if (!mounted.current || version !== imageVersion.current) return;
      await findMember(result.getText());
    } catch {
      if (mounted.current && version === imageVersion.current)
        setError("No readable membership barcode was found. Use a clear photo showing the whole barcode, or enter the number.");
    } finally {
      URL.revokeObjectURL(url);
      if (imageUrl.current === url) imageUrl.current = null;
      if (mounted.current && version === imageVersion.current) setImageBusy(false);
    }
  }

  const status = member ? statusFor(member) : null;
  return (
    <section className="member-scanner" aria-labelledby="member-scanner-heading">
      <div className="member-scanner-heading">
        <span className="staff-eyebrow">MEMBERSHIP LOOKUP</span>
        <h2 id="member-scanner-heading">A familiar face. One quick scan.</h2>
        <p>Scan the barcode on a member's card to find their current account and verification status.</p>
      </div>
      <div className="member-scanner-methods">
        <div className="member-scanner-camera">
          <ScanLine size={32} aria-hidden="true" />
          <h3>Scan a member card</h3>
          <p>Use the back camera and keep the full barcode inside the frame.</p>
          <div className="member-camera-preview" hidden={camera === "idle"}>
            <video ref={video} autoPlay playsInline muted aria-label="Membership barcode camera" />
            <span aria-hidden="true" />
          </div>
          {camera === "idle" ? (
            <button className="staff-action-button" onClick={startCamera} disabled={busy || imageBusy}>
              <Camera size={16} />Start camera
            </button>
          ) : (
            <button className="staff-secondary-button" onClick={stopCamera}>
              {camera === "starting" ? <LoaderCircle size={16} className="staff-spin" /> : <CameraOff size={16} />}
              Stop camera
            </button>
          )}
          <span className="member-scanner-camera-note">The camera starts only when you choose it. Images stay on this device.</span>
        </div>
        <div className="member-scanner-manual">
          <h3>Have the number instead?</h3>
          <p>Type it, or use a USB barcode scanner in the number field and press Enter.</p>
          <form onSubmit={(event) => { event.preventDefault(); imageVersion.current += 1; setImageBusy(false); void findMember(number); }}>
            <label htmlFor="scanner-member-number">Membership number</label>
            <input id="scanner-member-number" ref={input} value={number} maxLength={80} autoComplete="off" spellCheck={false}
              placeholder="LC-123456" onChange={(event) => {
                stopCamera(); cancelLookup(); imageVersion.current += 1; setImageBusy(false);
                setNumber(event.target.value); setMember(null); setError("");
              }} />
            <button className="staff-action-button" disabled={busy || imageBusy}>
              {busy ? <LoaderCircle size={16} className="staff-spin" /> : <Search size={16} />}Find member
            </button>
          </form>
          <label className="member-scanner-image-label" htmlFor="scanner-barcode-image"><Upload size={16} />Barcode image</label>
          <input id="scanner-barcode-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={scanImage}
            disabled={busy || imageBusy || camera !== "idle"} />
          <small>Choose a photo or screenshot. JPEG, PNG or WebP, up to 6 MiB.</small>
        </div>
      </div>
      {(busy || imageBusy) && <p className="member-scanner-status" role="status"><LoaderCircle size={16} className="staff-spin" />{imageBusy ? "Reading barcode…" : "Looking up member…"}</p>}
      {error && <p className="staff-error-message member-scanner-error" role="alert">{error}</p>}
      {member && (
        <div className="member-scanner-result" ref={resultPanel} tabIndex={-1} role="region" aria-label="Member lookup result">
          <span className={"member-lookup-status is-" + status.code} data-verification-status={status.code}><ShieldCheck size={16} />{status.label}</span>
          <h3>{member.name}</h3>
          <p className="member-lookup-number">{member.membershipNumber}</p>
          <p>This status was checked against the current member record. A copied barcode does not establish the holder's identity.</p>
          <div className="member-scanner-result-actions">
            <button className="staff-secondary-button" onClick={() => onOpen("members", member)}>Open member record<ArrowRight size={15} /></button>
            {!member.verified && <button className="staff-secondary-button" onClick={() => onOpen("age", member)}>Review application<ArrowRight size={15} /></button>}
          </div>
        </div>
      )}
      {(member || error || busy || imageBusy) && <button className="staff-secondary-button member-scanner-clear" onClick={clearResult}><X size={15} />Clear result</button>}
    </section>
  );
}
