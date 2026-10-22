#!/usr/bin/env node
/** Create a shareable release without dependencies, local databases, or secrets. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, "release");
const destination = path.join(release, "loud-cana-client.zip");
const stage = await mkdtemp(path.join(tmpdir(), "loud-cana-release-"));
const files = new Map();
const excludedDirectories = new Set([
  "node_modules",
  ".git",
  ".local",
  "release",
  "dist",
  ".aws",
  ".codex",
  ".agents",
  "__pycache__",
  ".pytest_cache",
  ".vite",
  "coverage",
  ".cache",
]);
const sourceDirectories = [
  ".github",
  "src",
  "server",
  "public",
  "scripts",
  "tests",
  "docs",
];
const sourceFiles = [
  "package.json",
  "package-lock.json",
  "README.md",
  "index.html",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "render.yaml",
  "Dockerfile",
  ".dockerignore",
  ".gitignore",
  ".node-version",
  ".nvmrc",
  ".env.example",
  "LICENSE",
];

function excluded(name) {
  return (
    excludedDirectories.has(name) ||
    (name.startsWith(".env") && name !== ".env.example") ||
    /\.(?:sqlite(?:-shm|-wal)?|db|log|pem|key|zip)$/i.test(name) ||
    name === ".DS_Store"
  );
}

async function addFile(source, target) {
  const stat = await lstat(source);
  if (stat.isSymbolicLink())
    throw new Error(`Refusing to package symlink: ${source}`);
  if (!stat.isFile()) throw new Error(`Expected a file: ${source}`);
  files.set(target.replaceAll(path.sep, "/"), await readFile(source));
}

async function addTree(source, target, filtering = true) {
  const directory = await lstat(source);
  if (directory.isSymbolicLink() || !directory.isDirectory())
    throw new Error(`Expected a real directory: ${source}`);
  for (const entry of (await readdir(source, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (filtering && excluded(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Refusing to package symlink: ${from}`);
    if (entry.isDirectory()) await addTree(from, to, filtering);
    else if (entry.isFile()) await addFile(from, to);
  }
}

async function exists(pathname) {
  try {
    await lstat(pathname);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

try {
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  await addFile(
    path.join(release, "loud-cana-preview.html"),
    "loud-cana-preview.html",
  );
  await addTree(path.join(root, "dist"), "static-site");
  // Use the fully self-contained catalog as the static entry point. This works
  // unchanged at an origin root or a GitHub Pages repository subpath (/Cana/).
  files.set("static-site/index.html", files.get("loud-cana-preview.html"));
  for (const directory of sourceDirectories) {
    if (await exists(path.join(root, directory)))
      await addTree(path.join(root, directory), path.join("source", directory));
  }
  for (const filename of sourceFiles) {
    if (await exists(path.join(root, filename)))
      await addFile(path.join(root, filename), path.join("source", filename));
  }
  await addFile(path.join(root, "docs", "HANDOFF.md"), "START-HERE.md");
  await addFile(path.join(root, "docs", "DEPLOYMENT.md"), "DEPLOYMENT.md");
  const checksums = [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([filename, bytes]) => ({
      filename,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }));
  const manifest = {
    application: "Loud + Cana",
    version: pkg.version,
    createdAt: new Date().toISOString(),
    region: "Gauteng, South Africa",
    currency: "ZAR",
    runtime: "Node.js 24",
    contents: {
      "loud-cana-preview.html":
        "Self-contained luxury catalog; no simulated checkout or live order submission.",
      "static-site/":
        "Production catalog website; static hosting cannot run the order service.",
      "source/":
        "Full application source and same-origin Node/SQLite service; dependencies excluded.",
    },
    publication:
      "Not published by this package. Configure and deploy to obtain an actual public URL.",
    launchStatus:
      "Live ordering remains disabled until the business and lawful-sales requirements are supplied and approved. No payment processor is connected.",
    checksumAlgorithm: "SHA-256",
    files: checksums,
  };
  files.set(
    "release-manifest.json",
    Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
  );
  files.set(
    "SHA256SUMS.txt",
    Buffer.from(
      checksums.map((file) => `${file.sha256}  ${file.filename}`).join("\n") +
        "\n",
    ),
  );
  for (const [filename, bytes] of files) {
    const target = path.join(stage, filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await mkdir(release, { recursive: true });
  await rm(destination, { force: true });
  const zipped = spawnSync("zip", ["-q", "-r", destination, "."], {
    cwd: stage,
    encoding: "utf8",
  });
  if (zipped.error?.code === "ENOENT") {
    const fallback = spawnSync(
      "python3",
      [
        "-c",
        "import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as archive:\n for file in sorted(root.rglob('*')):\n  if file.is_file(): archive.write(file,file.relative_to(root).as_posix())",
        stage,
        destination,
      ],
      { encoding: "utf8" },
    );
    if (fallback.error || fallback.status !== 0)
      throw new Error(
        fallback.stderr ||
          fallback.error?.message ||
          "Python ZIP creation failed",
      );
  } else if (zipped.error || zipped.status !== 0) {
    throw new Error(
      zipped.stderr || zipped.error?.message || "ZIP creation failed",
    );
  }
  const archive = await readFile(destination);
  const checksum = createHash("sha256").update(archive).digest("hex");
  await writeFile(
    `${destination}.sha256`,
    `${checksum}  ${path.basename(destination)}\n`,
  );
  await writeFile(
    path.join(release, "release-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    `Client package: release/loud-cana-client.zip (${Math.round(archive.length / 1024)} KB, ${files.size} files)`,
  );
  console.log(`SHA-256: ${checksum}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
