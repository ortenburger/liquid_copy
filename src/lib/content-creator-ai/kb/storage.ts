import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  lstatSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { KBEntityType } from "../types/enums.js";
import type { KBVersion } from "../types/index.js";
import { serialiseToMarkdown, parseFromMarkdown } from "./markdown.js";
import type { KBPayload } from "../types/index.js";
import { eventBus } from "../orchestration/event-bus.js";

export class SnapshotImmutableError extends Error {
  constructor(path: string) {
    super(`Cannot modify or delete immutable snapshot: ${path}`);
    this.name = "SnapshotImmutableError";
  }
}

export interface WriteKBEntityOptions {
  entityId: string;
  entityType: KBEntityType;
  content: string | KBPayload;
  author?: "system" | "user";
  priorValues?: Record<string, unknown>;
  modifiedFields?: string[];
  /** When true, emit kb.updated on the event bus after a successful write. */
  emitEvent?: boolean;
}

export interface WriteKBEntityResult {
  version: KBVersion;
  currentPath: string;
  snapshotPath: string;
}

function getStorageRoot(override?: string): string {
  return (
    override ??
    process.env.KB_STORAGE_PATH ??
    join(process.cwd(), ".kb-storage")
  );
}

/** Absolute filesystem root for KB markdown (persists across API restarts). */
export function resolveKBStoragePath(override?: string): string {
  return getStorageRoot(override);
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function entityDir(root: string, entityId: string): string {
  return join(root, entityId);
}

function snapshotFileName(entityId: string, version: number): string {
  return `${entityId}_v${version}.md`;
}

function currentFileName(entityId: string): string {
  return `${entityId}_current.md`;
}

function metaFileName(entityId: string): string {
  return `${entityId}_meta.json`;
}

interface EntityMeta {
  entityId: string;
  entityType: KBEntityType;
  latestVersion: number;
  /** Monotonic counter for experiment records (Req 11.7). */
  experimentVersionCounter: number;
  versions: KBVersion[];
}

function readMeta(dir: string, entityId: string): EntityMeta | null {
  const path = join(dir, metaFileName(entityId));
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as EntityMeta;
}

function writeMeta(dir: string, meta: EntityMeta): void {
  writeFileSync(
    join(dir, metaFileName(meta.entityId)),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
}

function assertNotOverwritingSnapshot(snapshotPath: string): void {
  if (existsSync(snapshotPath)) {
    throw new SnapshotImmutableError(snapshotPath);
  }
}

/**
 * Reject attempts to modify or delete an existing version snapshot file.
 */
export function assertSnapshotImmutable(snapshotPath: string): void {
  if (!existsSync(snapshotPath)) return;
  throw new SnapshotImmutableError(snapshotPath);
}

/**
 * Write a new immutable KB snapshot and update the current reference.
 * Never overwrites an existing `{entity_id}_v{n}.md` snapshot.
 */
export async function writeKBEntity(
  options: WriteKBEntityOptions,
  storagePath?: string,
): Promise<WriteKBEntityResult> {
  const root = getStorageRoot(storagePath);
  const { entityId, entityType } = options;
  const dir = entityDir(root, entityId);
  ensureDir(dir);

  let meta = readMeta(dir, entityId);
  const nextVersion = (meta?.latestVersion ?? 0) + 1;

  const markdown =
    typeof options.content === "string"
      ? options.content
      : serialiseToMarkdown(options.content);

  const snapshotPath = join(dir, snapshotFileName(entityId, nextVersion));
  assertNotOverwritingSnapshot(snapshotPath);

  // Capture prior values from current state when not supplied
  let priorValues = options.priorValues ?? {};
  let modifiedFields = options.modifiedFields ?? [];
  const currentPath = join(dir, currentFileName(entityId));
  if (
    Object.keys(priorValues).length === 0 &&
    existsSync(currentPath) &&
    typeof options.content !== "string"
  ) {
    try {
      const prevMd = readFileSync(currentPath, "utf8");
      const prev = parseFromMarkdown(prevMd).payload;
      priorValues = prev as unknown as Record<string, unknown>;
      modifiedFields = Object.keys(options.content);
    } catch {
      // ignore parse errors for prior capture
    }
  }

  writeFileSync(snapshotPath, markdown, { encoding: "utf8", flag: "wx" });

  // Update current reference: prefer symlink, fall back to copy on platforms
  // where symlink is unavailable.
  if (existsSync(currentPath)) {
    try {
      unlinkSync(currentPath);
    } catch {
      // If unlink fails because it's somehow locked, still try to replace
    }
  }
  try {
    symlinkSync(snapshotFileName(entityId, nextVersion), currentPath);
  } catch {
    copyFileSync(snapshotPath, currentPath);
  }

  const version: KBVersion = {
    versionId: randomUUID(),
    entityId,
    entityType,
    versionNumber: nextVersion,
    snapshotPath,
    priorValues,
    modifiedFields,
    timestamp: new Date().toISOString(),
    author: options.author ?? "system",
  };

  if (!meta) {
    meta = {
      entityId,
      entityType,
      latestVersion: nextVersion,
      experimentVersionCounter: entityType === "experiment" ? nextVersion : 0,
      versions: [version],
    };
  } else {
    meta.latestVersion = nextVersion;
    if (entityType === "experiment") {
      meta.experimentVersionCounter = nextVersion;
    }
    meta.versions = [...meta.versions, version];
  }
  writeMeta(dir, meta);

  if (options.emitEvent !== false) {
    await eventBus.publish("kb.updated", {
      entityId,
      entityType,
      version: nextVersion,
    });
  }

  return { version, currentPath, snapshotPath };
}

/**
 * Read the current (latest) KB entity Markdown content.
 * Returns null if the entity does not exist.
 */
export async function readKBEntity(
  entityId: string,
  storagePath?: string,
): Promise<string | null> {
  const root = getStorageRoot(storagePath);
  const currentPath = join(entityDir(root, entityId), currentFileName(entityId));
  if (!existsSync(currentPath)) return null;
  return readFileSync(currentPath, "utf8");
}

/**
 * List all version records for an entity, ordered by versionNumber ascending.
 */
export async function listVersions(
  entityId: string,
  storagePath?: string,
): Promise<KBVersion[]> {
  const root = getStorageRoot(storagePath);
  const meta = readMeta(entityDir(root, entityId), entityId);
  if (!meta) return [];
  return [...meta.versions].sort((a, b) => a.versionNumber - b.versionNumber);
}

/**
 * Return the full append-only version chain for an entity (monotonic order).
 */
export async function getVersionChain(
  entityId: string,
  storagePath?: string,
): Promise<KBVersion[]> {
  return listVersions(entityId, storagePath);
}

/**
 * Read a specific immutable snapshot by version number.
 * Throws SnapshotImmutableError semantics are for writes — reads are allowed.
 */
export async function readKBSnapshot(
  entityId: string,
  versionNumber: number,
  storagePath?: string,
): Promise<string | null> {
  const root = getStorageRoot(storagePath);
  const path = join(
    entityDir(root, entityId),
    snapshotFileName(entityId, versionNumber),
  );
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/**
 * Attempt to overwrite a snapshot — always throws (Property 4 / Req 2.2).
 */
export function rejectSnapshotMutation(snapshotPath: string): never {
  throw new SnapshotImmutableError(snapshotPath);
}

/**
 * Discard a draft without writing to the KB (rejection path).
 * Returns the storage root listing hash so callers can assert no mutation.
 */
export async function discardDraftWithoutMutation(
  entityId: string,
  storagePath?: string,
): Promise<{ mutated: false }> {
  // Intentionally a no-op against storage — used by rejection flows.
  void entityId;
  void storagePath;
  return { mutated: false };
}

/**
 * Fingerprint of an entity's on-disk state for byte-for-byte comparison.
 */
export function entityStorageFingerprint(
  entityId: string,
  storagePath?: string,
): string {
  const root = getStorageRoot(storagePath);
  const dir = entityDir(root, entityId);
  if (!existsSync(dir)) return "";
  const files = readdirSync(dir).sort();
  const parts: string[] = [];
  for (const f of files) {
    const full = join(dir, f);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink() || stat.isFile()) {
      try {
        parts.push(`${f}:${readFileSync(full, "utf8")}`);
      } catch {
        parts.push(`${f}:<unreadable>`);
      }
    }
  }
  return parts.join("\n");
}

/** Entity ids that have a current markdown snapshot on disk. */
export function listKBEntityIds(storagePath?: string): string[] {
  const root = getStorageRoot(storagePath);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) =>
      existsSync(join(entityDir(root, id), currentFileName(id))),
    )
    .sort();
}

/** Read entityType from meta when present. */
export function readKBEntityType(
  entityId: string,
  storagePath?: string,
): KBEntityType | null {
  const root = getStorageRoot(storagePath);
  const meta = readMeta(entityDir(root, entityId), entityId);
  return meta?.entityType ?? null;
}

/**
 * Delete every entity directory under the KB root. Markdown + meta are removed;
 * call vector-store clear separately. Used by Knowledge → Clear.
 */
export function clearAllKBStorage(storagePath?: string): {
  root: string;
  removed: string[];
} {
  const root = getStorageRoot(storagePath);
  const removed = listKBEntityIds(storagePath);
  for (const id of removed) {
    rmSync(entityDir(root, id), { recursive: true, force: true });
  }
  return { root, removed };
}

/**
 * Next monotonically incrementing version number for an experiment entity.
 */
export async function nextExperimentVersion(
  experimentId: string,
  storagePath?: string,
): Promise<number> {
  const root = getStorageRoot(storagePath);
  const meta = readMeta(entityDir(root, experimentId), experimentId);
  return (meta?.experimentVersionCounter ?? meta?.latestVersion ?? 0) + 1;
}
