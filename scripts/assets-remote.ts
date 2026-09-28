/**
 * Share the built licensed assets (the Synty kits, the UI icon packs, the ground
 * textures) through a private S3 bucket instead of git, which must never carry them.
 *
 *   bun scripts/assets-remote.ts push   pack the folders, upload the pack under its
 *                                       content hash, and record it in assets.lock.json
 *   bun scripts/assets-remote.ts pull   fetch and unpack the pack assets.lock.json names,
 *                                       when the local copy is a different one
 *
 * `bun run dev` runs `pull --quiet` first, so a git pull that moves the lock brings the
 * matching assets with it. The quiet pull never blocks the dev server: without the AWS
 * CLI or credentials it prints what to do and lets Vite start on the assets already there.
 * Credentials come from the AWS CLI's usual chain (AWS_PROFILE, env keys, ~/.aws).
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUCKET = "barrow-assets-716001413835";
const REGION = "us-west-2";
/** The generated folders, relative to public/: each is gitignored and rebuilt by an assets: script. */
const FOLDERS = ["models/synty", "icons/packs", "textures/ground"];
const LOCK = "assets.lock.json";
/** Which pack public/ holds now (gitignored). */
const STAMP = "public/.assets-version";

interface Lock {
  /** Content hash of every file in FOLDERS: the pack's name. */
  version: string;
  key: string;
  bytes: number;
  /** Of the archive itself, checked after download. */
  sha256: string;
}

async function run(cmd: string[], quiet = false): Promise<boolean> {
  const proc = Bun.spawn(cmd, {
    stdout: quiet ? "ignore" : "inherit",
    stderr: quiet ? "ignore" : "inherit",
    // No AppleDouble ._ files in the archive when packing on a Mac.
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  return (await proc.exited) === 0;
}

async function listFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else if (entry.name !== ".DS_Store") out.push(path);
  }
  return out;
}

/** The pack's name: a hash over every file's path and bytes, so any change makes a new pack. */
async function contentVersion(): Promise<string> {
  const hash = createHash("sha256");
  const files = (await Promise.all(FOLDERS.map((f) => listFiles(join("public", f))))).flat().sort();
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(file));
  }
  return hash.digest("hex").slice(0, 16);
}

function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

async function readLock(): Promise<Lock | null> {
  try {
    return JSON.parse(await readFile(LOCK, "utf8")) as Lock;
  } catch {
    return null;
  }
}

async function readStamp(): Promise<string | null> {
  try {
    return (await readFile(STAMP, "utf8")).trim();
  } catch {
    return null;
  }
}

async function push(): Promise<void> {
  for (const f of FOLDERS) {
    if (!existsSync(join("public", f))) throw new Error(`public/${f} is missing: build it before pushing`);
  }
  const version = await contentVersion();
  const lock = await readLock();
  if (lock?.version === version) {
    console.log(`assets: pack ${version} is already the locked one`);
    await writeFile(STAMP, version);
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "barrow-assets-"));
  try {
    const archive = join(dir, `${version}.tar.gz`);
    console.log(`assets: packing ${FOLDERS.join(", ")}`);
    if (!(await run(["tar", "-czf", archive, "-C", "public", ...FOLDERS]))) throw new Error("tar failed");
    const key = `packs/${version}.tar.gz`;
    const next: Lock = { version, key, bytes: (await stat(archive)).size, sha256: await fileSha256(archive) };
    console.log(`assets: uploading ${(next.bytes / 1e6).toFixed(0)} MB to s3://${BUCKET}/${key}`);
    if (!(await run(["aws", "s3", "cp", archive, `s3://${BUCKET}/${key}`, "--region", REGION, "--only-show-errors"]))) {
      throw new Error("upload failed");
    }
    await writeFile(LOCK, `${JSON.stringify(next, null, 2)}\n`);
    await writeFile(STAMP, version);
    console.log(`assets: locked pack ${version}; commit ${LOCK}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function pull(quiet: boolean): Promise<void> {
  const lock = await readLock();
  if (!lock) {
    if (!quiet) console.log(`assets: no ${LOCK}, nothing to pull`);
    return;
  }
  if ((await readStamp()) === lock.version) {
    if (!quiet) console.log(`assets: pack ${lock.version} is already here`);
    return;
  }
  if (!(await run(["aws", "--version"], true))) {
    throw new Error("the AWS CLI is not installed (brew install awscli), so the asset pack can't be fetched");
  }
  const dir = await mkdtemp(join(tmpdir(), "barrow-assets-"));
  try {
    const archive = join(dir, "pack.tar.gz");
    console.log(`assets: fetching pack ${lock.version} (${(lock.bytes / 1e6).toFixed(0)} MB)`);
    if (!(await run(["aws", "s3", "cp", `s3://${BUCKET}/${lock.key}`, archive, "--region", REGION, "--only-show-errors"]))) {
      throw new Error("download failed: check the AWS credentials (see README, Assets)");
    }
    if ((await fileSha256(archive)) !== lock.sha256) throw new Error("the downloaded pack doesn't match its checksum");
    // Replace, don't merge: a piece dropped from the pack must not linger here.
    for (const f of FOLDERS) await rm(join("public", f), { recursive: true, force: true });
    if (!(await run(["tar", "-xzf", archive, "-C", "public"]))) throw new Error("unpacking failed");
    await writeFile(STAMP, lock.version);
    console.log(`assets: pack ${lock.version} unpacked into public/`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const [command, ...flags] = process.argv.slice(2);
const quiet = flags.includes("--quiet");
try {
  if (command === "push") await push();
  else if (command === "pull") await pull(quiet);
  else {
    console.log("usage: bun scripts/assets-remote.ts push | pull [--quiet]");
    process.exit(1);
  }
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  // Before the dev server: warn and let it start on whatever assets are present.
  if (quiet) console.warn(`assets: ${message}. Starting with the assets already in public/.`);
  else {
    console.error(`assets: ${message}`);
    process.exit(1);
  }
}
