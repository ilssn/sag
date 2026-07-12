export type NavItem = {
  title: string;
  href: string;
  description?: string;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const DOC_NAV: NavGroup[] = [
  {
    title: "开始",
    items: [
      {
        title: "什么是 Open Context？",
        href: "/docs/introduction",
        description: "格式定位、核心价值与阅读入口",
      },
    ],
  },
  {
    title: "格式规范",
    items: [
      {
        title: "OCTX v0.1",
        href: "/docs/specification",
        description: "容器、manifest、身份与完整性",
      },
      {
        title: "Machine Schemas",
        href: "/docs/schemas",
        description: "JSON Schema 2020-12",
      },
    ],
  },
  {
    title: "SAG",
    items: [
      {
        title: "SAG 是什么？",
        href: "/docs/sag",
        description: "应用、检索架构与 OCTX 的关系",
      },
      {
        title: "SAG-structured",
        href: "/docs/sag-structured",
        description: "Chunk、Event、Entity、关系与向量",
      },
    ],
  },
  {
    title: "构建与集成",
    items: [
      {
        title: "工具链概览",
        href: "/docs/tooling",
        description: "分层与核心领域对象",
      },
      {
        title: "创建 OCTX",
        href: "/docs/creating-octx",
        description: "首次创建与 Release",
      },
      {
        title: "打开与校验",
        href: "/docs/opening-validating-octx",
        description: "安全读取与完整校验",
      },
      {
        title: "导入与安装",
        href: "/docs/importing-octx",
        description: "导入、升级、冲突与重建",
      },
      {
        title: "导出与配置",
        href: "/docs/exporting-octx",
        description: "导出与本地配置边界",
      },
    ],
  },
  {
    title: "参考",
    items: [
      {
        title: "领域词汇表",
        href: "/docs/glossary",
        description: "统一术语与概念边界",
      },
    ],
  },
];

export const API_NAV: NavGroup[] = [
  {
    title: "入门",
    items: [
      {
        title: "API 概览",
        href: "/api",
        description: "安装、调用顺序与公开入口",
      },
    ],
  },
  {
    title: "核心函数",
    items: [
      {
        title: "create_octx()",
        href: "/api/create-octx",
        description: "创建 Package 与发布 Release",
      },
      {
        title: "打开与校验",
        href: "/api/open-octx",
        description: "open_octx() 与 validate_octx()",
      },
      {
        title: "unpack_octx()",
        href: "/api/unpack-octx",
        description: "校验后安全展开",
      },
    ],
  },
  {
    title: "数据对象",
    items: [
      {
        title: "OctxPackage",
        href: "/api/octx-package",
        description: "读取 Markdown、JSONL 与向量",
      },
      {
        title: "数据类型与资源限制",
        href: "/api/models-and-limits",
        description: "结果对象、报告与 ArchiveLimits",
      },
    ],
  },
  {
    title: "命令行与错误",
    items: [
      {
        title: "CLI",
        href: "/api/cli",
        description: "create、inspect、validate、unpack",
      },
      {
        title: "错误处理",
        href: "/api/errors",
        description: "异常层级、错误码与处理方式",
      },
    ],
  },
];

export const PRIMARY_DOCS = DOC_NAV.flatMap((group) => group.items);
export const PRIMARY_API_DOCS = API_NAV.flatMap((group) => group.items);

export const TOP_NAV = [
  { title: "文档", href: "/docs/introduction", activePrefix: "/docs" },
  { title: "API", href: "/api", activePrefix: "/api" },
];
