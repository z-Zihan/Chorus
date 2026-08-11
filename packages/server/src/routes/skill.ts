import type { FastifyInstance } from "fastify";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let cachedSkill: string | null = null;

function loadSkillContent(): string {
  if (cachedSkill !== null) return cachedSkill;

  const candidates = [
    // dev mode: project root (cwd might be packages/server)
    resolve(process.cwd(), "skills/chorus-platform/SKILL.md"),
    resolve(process.cwd(), "../skills/chorus-platform/SKILL.md"),
    resolve(process.cwd(), "../../skills/chorus-platform/SKILL.md"),
    // from compiled file: packages/server/dist/routes/skill.js -> ../../../../skills/
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../skills/chorus-platform/SKILL.md"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../skills/chorus-platform/SKILL.md"),
    // from source: packages/server/src/routes/skill.ts -> ../../../../skills/
    resolve(dirname(fileURLToPath(import.meta.url)), "../../skills/chorus-platform/SKILL.md"),
    // tauri resources (production)
    resolve((process as typeof process & { resourcesPath?: string }).resourcesPath ?? "", "skills/chorus-platform/SKILL.md"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      cachedSkill = readFileSync(path, "utf8");
      return cachedSkill;
    }
  }

  cachedSkill = "";
  return cachedSkill;
}

export function registerSkillRoutes(app: FastifyInstance): void {
  app.get("/api/skill", async (_request, reply) => {
    const content = loadSkillContent();
    if (!content) {
      return reply.code(404).send({ error: "Skill not found" });
    }
    reply.type("text/markdown; charset=utf-8");
    return content;
  });

  app.get("/api/skill/meta", async () => {
    const content = loadSkillContent();
    if (!content) {
      return { available: false };
    }
    const titleMatch = content.match(/^#\s+(.+)$/mu);
    const descMatch = content.match(/^>\s*(.+)$/mu);
    return {
      available: true,
      title: titleMatch?.[1] ?? "Chorus Platform Skill",
      description: descMatch?.[1] ?? "External agent integration guide",
      endpoint: "/api/skill",
      contentType: "text/markdown",
    };
  });
}
