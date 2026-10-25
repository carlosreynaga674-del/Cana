import JsBarcode from "jsbarcode";
import { MEMBERSHIP_NUMBER_PATTERN } from "./membership.js";
const QUIET_ZONE = 12;

/** A card reference only: no profile details, verification claims or credentials. */
export function createMembershipBarcode(number) {
  if (typeof number !== "string" || !MEMBERSHIP_NUMBER_PATTERN.test(number)) return null;
  const encoded = {};
  JsBarcode(encoded, number, { format: "CODE128B", displayValue: false, margin: 0 });
  const data = encoded.encodings?.map((encoding) => encoding.data).join("");
  if (!data || !/^[01]+$/.test(data)) throw new Error("Membership barcode could not be generated.");
  const bars = [];
  for (let offset = 0; offset < data.length;) {
    if (data[offset] === "0") { offset += 1; continue; }
    const start = offset;
    while (offset < data.length && data[offset] === "1") offset += 1;
    bars.push({ x: start + QUIET_ZONE, width: offset - start });
  }
  return {
    number, format: "CODE128", width: data.length + QUIET_ZONE * 2,
    height: 72, quietZone: QUIET_ZONE, barY: 8, barHeight: 56, bars,
  };
}
