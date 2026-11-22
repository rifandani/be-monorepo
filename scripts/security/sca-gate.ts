#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { isSeverityBand, LEVEL_RANK } from "./severity-band.ts";
import type { SeverityBand } from "./severity-band.ts";

const AllowEntrySchema = z.object({
  id: z.string(),
  package: z.string().optional(),
  severity: z.string().optional(),
  expires: z.string(),
  reason: z.string().optional(),
});

const AllowlistSchema = z.object({
  entries: z.array(AllowEntrySchema).optional(),
});

const OsvVulnSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  database_specific: z.object({ severity: z.string().optional() }).optional(),
});

const OsvGroupSchema = z.object({
  ids: z.array(z.string()).optional(),
  max_severity: z.string().optional(),
});

const OsvPackageSchema = z.object({
  package: z
    .object({ name: z.string().optional(), version: z.string().optional() })
    .optional(),
  vulnerabilities: z.array(OsvVulnSchema).optional(),
  groups: z.array(OsvGroupSchema).optional(),
});

const OsvDocumentSchema = z.object({
  results: z
    .array(z.object({ packages: z.array(OsvPackageSchema).optional() }))
    .optional(),
});

type AllowEntry = z.infer<typeof AllowEntrySchema>;

type OsvVuln = z.infer<typeof OsvVulnSchema>;

type OsvGroup = z.infer<typeof OsvGroupSchema>;

type OsvPackage = z.infer<typeof OsvPackageSchema>;

type OsvDocument = z.infer<typeof OsvDocumentSchema>;

interface Finding {
  id: string;
  package: string;
  version: string;
  severity: SeverityBand;
  summary: string;
}

const root = path.resolve(import.meta.dirname, "../..");

const allowlistPath = path.resolve(
  root,
  process.env.SCA_ALLOWLIST_PATH ?? ".github/security/sca-allowlist.json"
);

const auditLevel = (process.env.SCA_AUDIT_LEVEL ?? "high").toLowerCase();
const today = new Date().toISOString().slice(0, 10);
const lockfile = "bun.lock";

if (!isSeverityBand(auditLevel)) {
  console.error(
    `::error::invalid SCA_AUDIT_LEVEL=${auditLevel} (use low|moderate|high|critical)`
  );
  process.exit(2);
}

const minRank = LEVEL_RANK[auditLevel];

const failAllowlist = (message: string): never => {
  console.error(`::error::sca-allowlist: ${message}`);
  process.exit(1);
};

const readAllowlist = (): AllowEntry[] => {
  let json: unknown;

  try {
    json = JSON.parse(readFileSync(allowlistPath, "utf-8"));
  } catch (error) {
    return failAllowlist(
      `${allowlistPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const parsed = AllowlistSchema.safeParse(json);

  if (!parsed.success) {
    return failAllowlist(
      `${allowlistPath} does not match the allowlist schema:\n${z.prettifyError(parsed.error)}`
    );
  }

  return parsed.data.entries ?? [];
};

const entries = readAllowlist();

const errors: string[] = [];
const active: AllowEntry[] = [];

for (const entry of entries) {
  if (entry.id.length === 0 || entry.expires.length === 0) {
    errors.push(`invalid allowlist entry: ${JSON.stringify(entry)}`);
    continue;
  }

  if (entry.severity === "critical") {
    errors.push(`${entry.id}: critical advisories cannot be allowlisted`);
    continue;
  }

  if (entry.expires < today) {
    errors.push(
      `${entry.id}: allowlist expired on ${entry.expires} — remediate or renew`
    );
    continue;
  }

  active.push(entry);
}

if (errors.length > 0) {
  for (const line of errors) {
    console.error(`::error::sca-allowlist: ${line}`);
  }

  process.exit(1);
}

const bandFromCvss = (score: OsvGroup["max_severity"]): SeverityBand | null => {
  const n = Number(score);

  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }

  if (n >= 9) {
    return "critical";
  }

  if (n >= 7) {
    return "high";
  }

  if (n >= 4) {
    return "moderate";
  }

  return "low";
};

const normalizeBand = (
  value: NonNullable<OsvVuln["database_specific"]>["severity"]
): SeverityBand | null => {
  const v = (value ?? "").trim().toLowerCase();

  if (v === "medium") {
    return "moderate";
  }

  return isSeverityBand(v) ? v : null;
};

const maxBand = (
  a: SeverityBand | null,
  b: SeverityBand | null
): SeverityBand | null => {
  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
};

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, fsConstants.X_OK);

    return true;
  } catch {
    return false;
  }
};

const which = (cmd: string): string | null => {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) {
      continue;
    }

    const candidate = path.join(dir, cmd);

    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
};

const ensureOsvScanner = (): string => {
  const fromEnv = process.env.OSV_SCANNER_BIN;

  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }

  const onPath = which("osv-scanner");

  if (onPath !== null && onPath.length > 0) {
    return onPath;
  }

  const version = process.env.OSV_SCANNER_VERSION ?? "2.4.0";

  const platforms = new Map([
    ["darwin", "darwin"],
    ["linux", "linux"],
  ]);

  const arches = new Map([
    ["arm64", "arm64"],
    ["x64", "amd64"],
  ]);

  const platform = platforms.get(process.platform);
  const arch = arches.get(process.arch);

  if (platform === undefined || arch === undefined) {
    throw new Error(
      `osv-scanner not found and no binary for ${process.platform}/${process.arch}`
    );
  }

  const cacheDir = path.resolve(root, "node_modules/.cache/osv-scanner");
  mkdirSync(cacheDir, { recursive: true });

  const dest = path.resolve(
    cacheDir,
    `osv-scanner-${version}-${platform}-${arch}`
  );

  if (existsSync(dest)) {
    return dest;
  }

  const url = `https://github.com/google/osv-scanner/releases/download/v${version}/osv-scanner_${platform}_${arch}`;
  console.error(`Downloading osv-scanner v${version}…`);

  const curl = spawnSync("curl", ["-sSfL", url, "-o", dest], {
    stdio: "inherit",
  });

  if (curl.status !== 0) {
    throw new Error(
      `failed to download osv-scanner (curl exit ${curl.status}): ${url}`
    );
  }

  chmodSync(dest, 0o755);

  return dest;
};

const writeConfig = (activeEntries: AllowEntry[]) => {
  const lines = [
    "# Generated by scripts/security/sca-gate.ts — do not edit by hand.",
    `# Source: ${allowlistPath}`,
    "",
  ];

  for (const e of activeEntries) {
    lines.push(
      "[[IgnoredVulns]]",
      `id = ${JSON.stringify(e.id)}`,
      `ignoreUntil = ${e.expires}`
    );

    if (e.reason !== undefined && e.reason.length > 0) {
      lines.push(`reason = ${JSON.stringify(e.reason)}`);
    }

    lines.push("");
  }

  const configDir = mkdtempSync(path.join(tmpdir(), "osv-scanner-config-"));
  const configPath = path.join(configDir, "config.toml");

  try {
    writeFileSync(configPath, `${lines.join("\n")}`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    rmSync(configDir, { force: true, recursive: true });
    throw error;
  }

  return { configDir, configPath };
};

interface IdBands {
  idBand: Map<string, SeverityBand>;
  pkgMax: SeverityBand | null;
}

const buildIdBands = (groups: OsvGroup[]): IdBands => {
  const idBand = new Map<string, SeverityBand>();
  let pkgMax: SeverityBand | null = null;

  for (const g of groups) {
    const band = bandFromCvss(g.max_severity);

    if (!band) {
      continue;
    }

    pkgMax = maxBand(pkgMax, band);

    for (const id of g.ids ?? []) {
      idBand.set(id, band);
    }
  }

  return { idBand, pkgMax };
};

const resolveVulnSeverity = (
  vuln: OsvVuln,
  idBand: Map<string, SeverityBand>,
  pkgMax: SeverityBand | null
): SeverityBand => {
  let sev: SeverityBand | null =
    normalizeBand(vuln.database_specific?.severity) ??
    idBand.get(vuln.id) ??
    null;

  if (!sev) {
    for (const alias of vuln.aliases ?? []) {
      sev = idBand.get(alias) ?? null;

      if (sev) {
        break;
      }
    }
  }

  return sev ?? pkgMax ?? "high";
};

const groupKeyFor = (pkg: OsvPackage, vulnId: string): string => {
  const group =
    (pkg.groups ?? []).find((g) => (g.ids ?? []).includes(vulnId)) ?? null;

  return [...(group?.ids ?? [vulnId])].toSorted().join(",");
};

const collectPackageFindings = (pkg: OsvPackage): Finding[] => {
  const name = pkg.package?.name ?? "?";
  const version = pkg.package?.version ?? "?";
  const { idBand, pkgMax } = buildIdBands(pkg.groups ?? []);

  const byGroupKey = new Map<
    string,
    { id: string; severity: SeverityBand; summary: string }
  >();

  for (const vuln of pkg.vulnerabilities ?? []) {
    const sev = resolveVulnSeverity(vuln, idBand, pkgMax);

    if ((LEVEL_RANK[sev] ?? 0) < minRank) {
      continue;
    }

    const key = groupKeyFor(pkg, vuln.id);
    const prev = byGroupKey.get(key);

    if (!prev || LEVEL_RANK[sev] > LEVEL_RANK[prev.severity]) {
      byGroupKey.set(key, {
        id: vuln.id,
        severity: sev,
        summary: vuln.summary ?? vuln.id,
      });
    }
  }

  return [...byGroupKey.values()].map((finding) => ({
    id: finding.id,
    package: name,
    version,
    severity: finding.severity,
    summary: finding.summary,
  }));
};

const collectBlockers = (doc: OsvDocument): Finding[] => {
  const blockers: Finding[] = [];

  for (const result of doc.results ?? []) {
    for (const pkg of result.packages ?? []) {
      blockers.push(...collectPackageFindings(pkg));
    }
  }

  return blockers;
};

const bin = ensureOsvScanner();
const { configDir, configPath } = writeConfig(active);

console.log(
  `Running osv-scanner on bun.lock (${active.length} active allowlist entries, gate ≥ ${auditLevel})`
);

let proc: ReturnType<typeof spawnSync>;

try {
  proc = spawnSync(
    bin,
    [
      "scan",
      "source",
      "-L",
      lockfile,
      "--format=json",
      `--config=${configPath}`,
    ],
    {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    }
  );
} finally {
  rmSync(configDir, { force: true, recursive: true });
}

const stdout = String(proc.stdout ?? "");
const code = proc.status ?? 1;

if (code !== 0 && code !== 1) {
  console.error(`::error::osv-scanner exited with unexpected code ${code}`);
  process.exit(code === 0 ? 1 : code);
}

let json: unknown;

try {
  json = JSON.parse(stdout || "{}");
} catch {
  console.error("::error::failed to parse osv-scanner JSON output");
  console.error(stdout.slice(0, 2000));
  process.exit(1);
}

const parsedDoc = OsvDocumentSchema.safeParse(json);

if (!parsedDoc.success) {
  console.error(
    `::error::osv-scanner JSON output does not match the expected schema:\n${z.prettifyError(parsedDoc.error)}`
  );
  process.exit(1);
}

const doc: OsvDocument = parsedDoc.data;

const blockers = collectBlockers(doc);

if (blockers.length === 0) {
  console.log(`SCA gate passed (no findings ≥ ${auditLevel}).`);
  process.exit(0);
}

console.error(
  `::error::SCA gate failed: ${blockers.length} finding(s) ≥ ${auditLevel}`
);

for (const b of blockers) {
  console.error(
    `- ${b.severity.toUpperCase()} ${b.id} ${b.package}@${b.version}: ${b.summary}`
  );
}

process.exit(1);
