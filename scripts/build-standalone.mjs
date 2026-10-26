#!/usr/bin/env node
/** Build a truly offline catalog without changing the full-service Vite output. */
import { readFile, readdir, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = await mkdtemp(resolve(tmpdir(), "loud-cana-standalone-"));
const release = resolve(root, "release");
const mime = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};

function localPath(reference) {
  if (/^(?:[a-z]+:)?\/\//i.test(reference)) {
    throw new Error(
      `The standalone build cannot depend on an external URL: ${reference}`,
    );
  }
  const path = resolve(dist, reference.replace(/^\.?\//, "").split(/[?#]/)[0]);
  const inside = relative(dist, path);
  if (inside === ".." || inside.startsWith(`..${sep}`))
    throw new Error("Asset escapes dist");
  return path;
}

async function dataURI(path) {
  const contentType = mime[extname(path)];
  if (!contentType) throw new Error(`Unsupported inline asset: ${path}`);
  return `data:${contentType};base64,${(await readFile(path)).toString("base64")}`;
}

async function inlineStyles(css, path) {
  const matches = [...css.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g)];
  for (const [, , ref] of matches) {
    if (ref.startsWith("data:")) continue;
    const asset = ref.startsWith("/")
      ? localPath(ref)
      : resolve(dirname(path), ref);
    css = css.replaceAll(ref, await dataURI(asset));
  }
  return css.replace(/<\/style/gi, "<\\/style");
}

try {
  await build({ root, mode: "standalone", logLevel: "warn", build: { outDir: dist, emptyOutDir: true } });
  let html = await readFile(resolve(dist, "index.html"), "utf8");
  const assets = {};
  for (const name of await readdir(resolve(dist, "images"))) {
    if (mime[extname(name)])
      assets[`/images/${name}`] = await dataURI(resolve(dist, "images", name));
  }
  const scriptMatches = [
    ...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/g),
  ];
  if (scriptMatches.length !== 1)
    throw new Error("Expected one fully bundled Vite entry script.");
  for (const [tag, ref] of scriptMatches) {
    let js = await readFile(localPath(ref), "utf8");
    if (/\bimport\s*(?:\(|["'])/.test(js))
      throw new Error(
        "Split JavaScript chunks must be bundled before exporting.",
      );
    js = js.replace(
      /(["'`])\/images\/[^"'`]+\1/g,
      (expression) => `globalThis.__LOUD_CANA_ASSET__(${expression})`,
    );
    const bootstrap = `globalThis.__LC_OFFLINE_PREVIEW__=true;\nglobalThis.__LOUD_CANA_ASSET__=(path)=>(${JSON.stringify(assets)})[path]||path;\n`;
    const inline = (bootstrap + js).replace(/<\/script/gi, "<\\/script");
    html = html.replace(tag, "");
    html = html.replace(
      "</body>",
      () => `<script type="module">${inline}</script>\n</body>`,
    );
  }
  for (const [tag, ref] of [
    ...html.matchAll(
      /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/g,
    ),
  ]) {
    const path = localPath(ref);
    const css = await inlineStyles(await readFile(path, "utf8"), path);
    html = html.replace(tag, () => `<style>${css}</style>`);
  }
  for (const [tag, ref] of [
    ...html.matchAll(
      /<link\b[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["'][^>]*>/g,
    ),
  ]) {
    const icon = await dataURI(localPath(ref));
    html = html.replace(tag, () => `<link rel="icon" href="${icon}">`);
  }
  html = html.replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>/g, "");
  if (
    /<(?:script|link)\b[^>]*(?:src|href)=["']\/?(?:assets|images)\//.test(html)
  ) {
    throw new Error("The export still contains an external asset reference.");
  }
  await mkdir(release, { recursive: true });
  const output = resolve(release, "loud-cana-preview.html");
  html = html.replace(/^[\t ]+$/gm, "");
  await writeFile(output, html);
  console.log(
    `Standalone client preview: ${relative(root, output)} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`,
  );
} finally {
  await rm(dist, { recursive: true, force: true });
}
