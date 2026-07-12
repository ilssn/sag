import "server-only";

import fs from "node:fs";
import path from "node:path";
import GithubSlugger from "github-slugger";
import { PRIMARY_API_DOCS, PRIMARY_DOCS } from "@/lib/site-config";
import type { SearchItem } from "@/lib/types";

export type Heading = {
  id: string;
  text: string;
  level: 2 | 3;
};

export type Doc = {
  slug: string;
  title: string;
  description: string;
  group: string;
  section: "docs" | "api";
  sourceFile?: string;
  content: string;
  headings: Heading[];
  href: string;
};

const CONTENT_ROOT = path.resolve(process.cwd(), "..");

const DOCUMENTS = [
  {
    slug: "introduction",
    title: "什么是 Open Context？",
    description: "Open Context 的核心价值、技术简称与文档入口。",
    group: "开始",
    section: "docs",
    href: "/docs/introduction",
    file: "README.md",
  },
  {
    slug: "sag",
    title: "SAG 是什么？",
    description: "了解 SAG 应用、检索架构、zleap-sag 及其与 Open Context 的关系。",
    group: "开始",
    section: "docs",
    href: "/docs/sag",
    file: "sag.md",
  },
  {
    slug: "specification",
    title: "OCTX v0.1 规范",
    description: "容器、manifest、知识文档、身份、摘要、版本和扩展规则。",
    group: "格式规范",
    section: "docs",
    href: "/docs/specification",
    file: "spec-v0.1.md",
  },
  {
    slug: "sag-structured",
    title: "SAG-structured Profile 0.1",
    description: "Chunks、Events、Entities、关系、向量和完整覆盖约束。",
    group: "格式规范",
    section: "docs",
    href: "/docs/sag-structured",
    file: "sag-structured-v0.1.md",
  },
  {
    slug: "schemas",
    title: "Machine Schemas",
    description: "OCTX v0.1 的 JSON Schema Draft 2020-12 与语义校验边界。",
    group: "格式规范",
    section: "docs",
    href: "/docs/schemas",
    file: "schemas/README.md",
  },
  {
    slug: "tooling",
    title: "工具与生命周期",
    description: "创建、读取、校验、导入、导出以及 Asset 与 Release 生命周期。",
    group: "构建与集成",
    section: "docs",
    href: "/docs/tooling",
    file: "tooling-lifecycle.md",
  },
  {
    slug: "glossary",
    title: "Open Context 领域词汇表",
    description: "OCTX、SAG 与 zleap-sag 的统一领域语言。",
    group: "参考",
    section: "docs",
    href: "/docs/glossary",
    file: "GLOSSARY.md",
  },
  {
    slug: "api-overview",
    title: "Open Context Python API",
    description: "安装 octx，了解公开入口、调用顺序与最小使用示例。",
    group: "入门",
    section: "api",
    href: "/api",
    file: "api/overview.md",
  },
  {
    slug: "create-octx",
    title: "create_octx()",
    description: "从 Markdown 和可选结构化数据创建 OCTX Package，并管理稳定身份。",
    group: "核心函数",
    section: "api",
    href: "/api/create-octx",
    file: "api/create-octx.md",
  },
  {
    slug: "open-octx",
    title: "open_octx()",
    description: "安全打开 OCTX Package 并返回只读 OctxPackage，不执行完整规范校验。",
    group: "核心函数",
    section: "api",
    href: "/api/open-octx",
    file: "api/open-octx.md",
  },
  {
    slug: "validate-octx",
    title: "validate_octx()",
    description: "完整校验 OCTX Package，并以结构化报告返回错误和警告。",
    group: "核心函数",
    section: "api",
    href: "/api/validate-octx",
    file: "api/validate-octx.md",
  },
  {
    slug: "unpack-octx",
    title: "unpack_octx()",
    description: "先校验再安全展开 OCTX Package，防止覆盖与不安全路径。",
    group: "核心函数",
    section: "api",
    href: "/api/unpack-octx",
    file: "api/unpack-octx.md",
  },
  {
    slug: "octx-package",
    title: "OctxPackage",
    description: "读取 Package 的 manifest、Markdown、JSONL、向量和原始成员。",
    group: "读取与模型",
    section: "api",
    href: "/api/octx-package",
    file: "api/octx-package.md",
  },
  {
    slug: "models-and-limits",
    title: "数据模型与限制",
    description: "CreateResult、ValidationReport、Document、ArchiveLimits 等公开类型。",
    group: "读取与模型",
    section: "api",
    href: "/api/models-and-limits",
    file: "api/models-and-limits.md",
  },
  {
    slug: "cli",
    title: "命令行接口",
    description: "使用 octx create、inspect、validate 和 unpack 命令。",
    group: "命令行与错误",
    section: "api",
    href: "/api/cli",
    file: "api/cli.md",
  },
  {
    slug: "errors",
    title: "错误处理",
    description: "理解异常层级、错误码以及推荐的调用方处理方式。",
    group: "命令行与错误",
    section: "api",
    href: "/api/errors",
    file: "api/errors.md",
  },
] as const;

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(CONTENT_ROOT, relativePath), "utf8");
}

function cleanHeadingText(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[\\*~]/g, "")
    .trim();
}

function stripFirstHeading(markdown: string) {
  return markdown.replace(/^#\s+[^\n]+\n+/, "");
}

function extractHeadings(markdown: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  let inFence = false;

  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(##|###)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = cleanHeadingText(match[2]);
    headings.push({
      id: slugger.slug(text),
      text,
      level: match[1].length as 2 | 3,
    });
  }

  return headings;
}

function loadDocument(definition: (typeof DOCUMENTS)[number]): Doc {
  const raw = readSource(definition.file);
  const content = stripFirstHeading(raw);
  return {
    slug: definition.slug,
    title: definition.title,
    description: definition.description,
    group: definition.group,
    section: definition.section,
    sourceFile: definition.file,
    content,
    headings: extractHeadings(content),
    href: definition.href,
  };
}

export function getAllDocs(): Doc[] {
  return DOCUMENTS.map(loadDocument);
}

export function getDoc(slug: string) {
  return getAllDocs().find((doc) => doc.slug === slug);
}

export function getSearchItems(): SearchItem[] {
  return getAllDocs().map((doc) => ({
    title: doc.title,
    description: doc.description,
    href: doc.href,
    group: doc.group,
    text: `${doc.title}\n${doc.description}\n${doc.content}`.slice(0, 12000),
  }));
}

export function getAdjacentDocs(slug: string) {
  const current = getDoc(slug);
  if (!current) return { previous: undefined, next: undefined };
  const navigation = current.section === "api" ? PRIMARY_API_DOCS : PRIMARY_DOCS;
  const orderedHrefs = navigation.map((item) => item.href);
  const currentHref = current.href;
  const index = orderedHrefs.indexOf(currentHref);
  if (index < 0) return { previous: undefined, next: undefined };
  return {
    previous: index > 0 ? navigation[index - 1] : undefined,
    next: index < navigation.length - 1 ? navigation[index + 1] : undefined,
  };
}
