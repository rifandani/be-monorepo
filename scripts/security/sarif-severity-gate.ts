#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const SecurityPropertiesSchema = z.object({
  "security-severity": z.unknown().optional(),
});

const SarifRuleSchema = z.object({
  id: z.string(),
  properties: SecurityPropertiesSchema.optional(),
  defaultConfiguration: z.object({ level: z.string().optional() }).optional(),
});

const SarifResultSchema = z.object({
  ruleId: z.string().optional(),
  level: z.string().optional(),
  message: z.object({ text: z.string().optional() }).optional(),
  properties: SecurityPropertiesSchema.optional(),
  locations: z
    .array(
      z.object({
        physicalLocation: z
          .object({
            artifactLocation: z
              .object({ uri: z.string().optional() })
              .optional(),
          })
          .optional(),
      })
    )
    .optional(),
});

const SarifRunSchema = z.object({
  tool: z
    .object({
      driver: z
        .object({ rules: z.array(SarifRuleSchema).optional() })
        .optional(),
    })
    .optional(),
  results: z.array(SarifResultSchema).optional(),
});

const SarifLogSchema = z.object({
  runs: z.array(SarifRunSchema).optional(),
});

type SarifLog = z.infer<typeof SarifLogSchema>;

interface Blocker {
  ruleId: string;
  severity: number;
  message: string;
  file?: string;
}

const [arg] = process.argv.slice(2);
const minSeverity = Number(process.env.SAST_MIN_SECURITY_SEVERITY ?? "7.0");

if (arg === undefined || arg.length === 0) {
  console.error(
    "Usage: bun scripts/security/sarif-severity-gate.ts <sarif-path>"
  );
  process.exit(2);
}

const target = path.resolve(arg);

const collectSarifFiles = (dirOrFile: string): string[] => {
  const st = statSync(dirOrFile);

  if (st.isFile()) {
    return dirOrFile.endsWith(".sarif") || dirOrFile.endsWith(".sarif.json")
      ? [dirOrFile]
      : [];
  }

  return readdirSync(dirOrFile)
    .filter((f) => f.endsWith(".sarif") || f.endsWith(".sarif.json"))
    .map((f) => path.join(dirOrFile, f));
};

const files = collectSarifFiles(target);

if (files.length === 0) {
  console.log(`No SARIF files under ${target}; nothing to gate.`);
  process.exit(0);
}

const failParse = (message: string): never => {
  console.error(`::error::SAST gate: ${message}`);
  process.exit(1);
};

const readSarif = (file: string): SarifLog => {
  let json: unknown;

  try {
    json = JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    return failParse(
      `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const parsed = SarifLogSchema.safeParse(json);

  if (!parsed.success) {
    return failParse(
      `${file} is not a valid SARIF log:\n${z.prettifyError(parsed.error)}`
    );
  }

  return parsed.data;
};

const blockers: Blocker[] = [];

for (const file of files) {
  const sarif = readSarif(file);

  for (const run of sarif.runs ?? []) {
    const rules = new Map(
      (run.tool?.driver?.rules ?? []).map((r) => [r.id, r] as const)
    );

    for (const result of run.results ?? []) {
      const rule = rules.get(result.ruleId ?? "");

      const props = {
        ...rule?.properties,
        ...result.properties,
      };

      const securitySeverity = Number(props["security-severity"] ?? Number.NaN);

      const level =
        result.level ?? rule?.defaultConfiguration?.level ?? "warning";

      const isHigh =
        (!Number.isNaN(securitySeverity) && securitySeverity >= minSeverity) ||
        (Number.isNaN(securitySeverity) && level === "error");

      if (!isHigh) {
        continue;
      }

      const loc =
        result.locations?.[0]?.physicalLocation?.artifactLocation?.uri;

      if (loc !== undefined && loc.length > 0 && /(?:^|\/)repos\//u.test(loc)) {
        continue;
      }

      blockers.push({
        ruleId: result.ruleId ?? "unknown",
        severity: Number.isNaN(securitySeverity) ? -1 : securitySeverity,
        file: loc,
        message: result.message?.text ?? "",
      });
    }
  }
}

if (blockers.length === 0) {
  console.log(
    `SAST gate passed (no findings with security-severity >= ${minSeverity}).`
  );
  process.exit(0);
}

console.error(
  `::error::SAST gate failed: ${blockers.length} finding(s) at/above security-severity ${minSeverity}`
);

for (const b of blockers) {
  console.error(
    `- ${b.ruleId} (severity=${b.severity})${b.file !== undefined && b.file.length > 0 ? ` @ ${b.file}` : ""}: ${b.message}`
  );
}

process.exit(1);
