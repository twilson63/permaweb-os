import { PodSkill, WorkspaceSkill } from "./types";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SKILLS_PER_WORKSPACE = 5;
const MAX_SKILL_MARKDOWN_BYTES = 64 * 1024;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
const SKILL_BASE_PATH = "/workspace/.opencode/skills";

type SkillPayload = {
  name?: unknown;
  description?: unknown;
  markdown?: unknown;
  content?: unknown;
};

type ParsedFrontmatter = {
  name?: string;
  description?: string;
};

export function normalizeWorkspaceSkills(input: unknown): WorkspaceSkill[] {
  if (input === undefined || input === null) {
    return [];
  }

  const entries = Array.isArray(input) ? input : [input];

  if (entries.length > MAX_SKILLS_PER_WORKSPACE) {
    throw new Error(`A workspace can include at most ${MAX_SKILLS_PER_WORKSPACE} skills`);
  }

  const seenNames = new Set<string>();
  return entries.map((entry, index) => {
    const normalized = normalizeWorkspaceSkill(entry, index);

    if (seenNames.has(normalized.name)) {
      throw new Error(`Duplicate workspace skill name: ${normalized.name}`);
    }

    seenNames.add(normalized.name);
    return normalized;
  });
}

export function getPodSkillSummaries(skills: WorkspaceSkill[] = []): PodSkill[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    path: skill.path
  }));
}

function normalizeWorkspaceSkill(entry: unknown, index: number): WorkspaceSkill {
  const payload = normalizeSkillPayload(entry, index);
  const markdown = normalizeMarkdown(payload.markdown ?? payload.content, index);
  const frontmatter = parseSkillFrontmatter(markdown);
  const providedName = getOptionalString(payload.name);
  const frontmatterName = frontmatter?.name;
  const name = normalizeSkillName(providedName || frontmatterName, index);

  if (providedName && frontmatterName && providedName !== frontmatterName) {
    throw new Error(`Workspace skill ${name} has a frontmatter name that does not match its payload name`);
  }

  const description = normalizeSkillDescription(
    getOptionalString(payload.description) || frontmatter?.description,
    name,
    index,
    Boolean(frontmatter)
  );
  const skillMarkdown = frontmatter ? markdown : addSkillFrontmatter(markdown, name, description);

  return {
    name,
    description,
    markdown: skillMarkdown,
    path: `${SKILL_BASE_PATH}/${name}/SKILL.md`
  };
}

function normalizeSkillPayload(entry: unknown, index: number): SkillPayload {
  if (typeof entry === "string") {
    return { markdown: entry };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`Workspace skill ${index + 1} must be an object or markdown string`);
  }

  return entry as SkillPayload;
}

function normalizeMarkdown(value: unknown, index: number): string {
  if (typeof value !== "string") {
    throw new Error(`Workspace skill ${index + 1} is missing markdown content`);
  }

  const markdown = value.replace(/\r\n/g, "\n").trim();

  if (!markdown) {
    throw new Error(`Workspace skill ${index + 1} is missing markdown content`);
  }

  if (Buffer.byteLength(markdown, "utf8") > MAX_SKILL_MARKDOWN_BYTES) {
    throw new Error(`Workspace skill ${index + 1} exceeds the ${MAX_SKILL_MARKDOWN_BYTES} byte limit`);
  }

  return markdown;
}

function normalizeSkillName(value: string | undefined, index: number): string {
  const name = value?.trim();

  if (!name) {
    throw new Error(`Workspace skill ${index + 1} is missing a name`);
  }

  if (name.length > 64 || !SKILL_NAME_PATTERN.test(name)) {
    throw new Error(
      `Workspace skill name must be 1-64 lowercase letters or numbers with single hyphen separators`
    );
  }

  return name;
}

function normalizeSkillDescription(
  value: string | undefined,
  name: string,
  index: number,
  hasFrontmatter: boolean
): string {
  const description = value?.trim();

  if (!description) {
    if (hasFrontmatter) {
      throw new Error(`Workspace skill ${index + 1} frontmatter is missing a description`);
    }

    return `Workspace skill ${name}`;
  }

  if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    throw new Error(`Workspace skill ${index + 1} description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters`);
  }

  return description;
}

function parseSkillFrontmatter(markdown: string): ParsedFrontmatter | null {
  const lines = markdown.split("\n");

  if (lines[0]?.trim() !== "---") {
    return null;
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");

  if (endIndex < 0) {
    return null;
  }

  const parsed: ParsedFrontmatter = {};
  for (const line of lines.slice(1, endIndex)) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);

    if (!match) {
      continue;
    }

    const key = match[1];
    const value = unwrapYamlScalar(match[2]);

    if (key === "name") {
      parsed.name = value;
    } else if (key === "description") {
      parsed.description = value;
    }
  }

  return parsed;
}

function unwrapYamlScalar(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function addSkillFrontmatter(markdown: string, name: string, description: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${escapeYamlScalar(description)}`,
    "compatibility: opencode",
    "---",
    "",
    markdown
  ].join("\n");
}

function escapeYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
