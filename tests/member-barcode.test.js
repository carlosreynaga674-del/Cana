import test from "node:test";
import assert from "node:assert/strict";
import {
  BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer,
  MultiFormatReader, RGBLuminanceSource,
} from "@zxing/library";
import { createMembershipBarcode } from "../src/lib/member-barcode.js";

function decodeGeometry(barcode, scale) {
  const width = barcode.width * scale;
  const height = barcode.height * scale;
  const pixels = new Uint8ClampedArray(width * height).fill(255);
  for (const bar of barcode.bars) {
    for (let y = barcode.barY * scale; y < (barcode.barY + barcode.barHeight) * scale; y += 1) {
      pixels.fill(0, y * width + bar.x * scale, y * width + (bar.x + bar.width) * scale);
    }
  }
  const source = new RGBLuminanceSource(pixels, width, height);
  const reader = new MultiFormatReader();
  return reader.decode(new BinaryBitmap(new HybridBinarizer(source)),
    new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]]));
}

test("membership barcodes decode independently as exact Code 128 references at screen and print scales", () => {
  for (const number of ["LC-012345", "LC-000000", "LC-999999", "LC-123456"]) {
    const barcode = createMembershipBarcode(number);
    assert.ok(barcode);
    assert.ok(barcode.quietZone >= 10, "A readable Code 128 needs a quiet zone at both ends.");
    for (const scale of [1, 3]) {
      const decoded = decodeGeometry(barcode, scale);
      assert.equal(decoded.getText(), number);
      assert.equal(decoded.getBarcodeFormat(), BarcodeFormat.CODE_128);
    }
  }
});

test("invalid identifiers and personal information never become membership barcodes", () => {
  for (const input of [undefined, null, 12345, "", "lc-123456", "LC-12345A", "LC-12345", "LC-1234567",
    "LC-0123-ABCD-WXYZ", "LC-123456\n", " LC-123456", "person@example.test", "https://example.test/member",
    "<script>alert(1)</script>", "2000-01-01", "LC-123456 extra"]) {
    assert.equal(createMembershipBarcode(input), null);
  }
});
