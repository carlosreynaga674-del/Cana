// Synthetic images and an isolated key for local upload tests only.
// These are not identity documents and never leave the local test service.
import sharp from "sharp";

export async function identityFixture() {
  const document = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 215, g: 225, b: 235 } } }).png().toBuffer();
  const selfie = await sharp({ create: { width: 480, height: 640, channels: 3, background: { r: 235, g: 215, b: 205 } } }).png().toBuffer();
  return { config: { storageKey: "61".repeat(32) }, body: { identityConsent: true, document: { data: document.toString("base64") }, selfie: { data: selfie.toString("base64") } }, document, selfie };
}
