import {
  DELIVERY_REPO,
  DELIVERY_REPO_URL,
  buildTagArchiveUrl,
  isValidDeliveryTag,
  normalizeTagName,
} from "./delivery-repo";

export type LatestDeliveryVersion = {
  source: "release" | "tag" | "configured";
  tagName: string;
  archiveUrl: string;
  htmlUrl: string;
  checksumUrl: string | null;
};

export type DeliveryVersion = {
  tagName: string;
  archiveUrl: string;
  htmlUrl: string;
  changelog: DeliveryChangelog;
};

export type DeliveryChangelog = {
  previousTagName: string | null;
  releasedAt: string | null;
  sourceCommit: string | null;
  compareUrl: string | null;
  totals: {
    added: number;
    modified: number;
    removed: number;
  };
  sections: Array<{
    title: string;
    items: string[];
  }>;
};

type Fetcher = typeof fetch;

type GitHubRelease = {
  tag_name?: string;
  html_url?: string;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
  }>;
};

type GitHubTag = {
  name?: string;
};

type GitHubCommit = {
  commit?: {
    author?: {
      date?: string;
    };
    message?: string;
  };
};

type GitHubTree = {
  truncated?: boolean;
  tree?: Array<{
    path?: string;
    sha?: string;
    type?: string;
  }>;
};

const FALLBACK_DELIVERY_TAG = "v1.17.4.fix.alpha";
const MINIMUM_LISTED_DELIVERY_TAG = "v1.15.1";

function getRequestInit() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "1688-autoprocurement-remote-install",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return {
    headers,
    next: { revalidate: 300 },
  };
}

export async function getLatestDeliveryVersion(
  fetcher: Fetcher = fetch,
): Promise<LatestDeliveryVersion> {
  const releaseResponse = await fetcher(
    `https://api.github.com/repos/${DELIVERY_REPO}/releases/latest`,
    getRequestInit(),
  );

  if (releaseResponse.ok) {
    const release = (await releaseResponse.json()) as GitHubRelease;
    const tagName = normalizeTagName(release.tag_name ?? "");

    if (isValidDeliveryTag(tagName)) {
      return {
        source: "release",
        tagName,
        archiveUrl: buildTagArchiveUrl(tagName),
        htmlUrl: release.html_url ?? `${DELIVERY_REPO_URL}/releases/tag/${tagName}`,
        checksumUrl: findChecksumAssetUrl(release),
      };
    }
  }

  const tagsResponse = await fetcher(
    `https://api.github.com/repos/${DELIVERY_REPO}/tags?per_page=100`,
    getRequestInit(),
  );

  if (!tagsResponse.ok) {
    return getConfiguredDefaultVersion();
  }

  const tags = ((await tagsResponse.json()) as GitHubTag[])
    .map((tag) => normalizeTagName(tag.name ?? ""))
    .filter(isValidDeliveryTag)
    .sort(compareTagsDescending);

  const tagName = tags[0];

  if (!tagName) {
    return getConfiguredDefaultVersion();
  }

  return {
    source: "tag",
    tagName,
    archiveUrl: buildTagArchiveUrl(tagName),
    htmlUrl: `${DELIVERY_REPO_URL}/releases/tag/${tagName}`,
    checksumUrl: null,
  };
}

export async function getDeliveryVersions(
  fetcher: Fetcher = fetch,
): Promise<DeliveryVersion[]> {
  const tagsResponse = await fetcher(
    `https://api.github.com/repos/${DELIVERY_REPO}/tags?per_page=100`,
    getRequestInit(),
  );

  if (!tagsResponse.ok) {
    const configured = getConfiguredDefaultVersion();

    return isListedDeliveryTag(configured.tagName)
      ? [
          toDeliveryVersion(configured.tagName, {
            previousTagName: null,
            releasedAt: null,
            sourceCommit: null,
            compareUrl: null,
            totals: { added: 0, modified: 0, removed: 0 },
            sections: [
              {
                title: "无法生成 changelog",
                items: ["GitHub 暂未返回 tag 元数据。"],
              },
            ],
          }),
        ]
      : [];
  }

  const tagNames = ((await tagsResponse.json()) as GitHubTag[])
    .map((tag) => normalizeTagName(tag.name ?? ""))
    .filter(isListedDeliveryTag)
    .sort(compareTagsDescending);

  return Promise.all(
    tagNames.map(async (tagName, index) =>
      toDeliveryVersion(
        tagName,
        await buildDeliveryChangelog(
          tagName,
          tagNames[index + 1] ?? null,
          fetcher,
        ),
      ),
    ),
  );
}

function getConfiguredDefaultVersion(): LatestDeliveryVersion {
  const tagName = process.env.DELIVERY_DEFAULT_TAG ?? FALLBACK_DELIVERY_TAG;

  if (!isValidDeliveryTag(tagName)) {
    throw new Error(`Invalid configured delivery tag: ${tagName}`);
  }

  return {
    source: "configured",
    tagName,
    archiveUrl: buildTagArchiveUrl(tagName),
    htmlUrl: `${DELIVERY_REPO_URL}/releases/tag/${tagName}`,
    checksumUrl: null,
  };
}

function findChecksumAssetUrl(release: GitHubRelease) {
  return (
    release.assets?.find((asset) => asset.name?.endsWith(".sha256"))
      ?.browser_download_url ?? null
  );
}

function isListedDeliveryTag(tagName: string) {
  return (
    isValidDeliveryTag(tagName) &&
    tagName.localeCompare(MINIMUM_LISTED_DELIVERY_TAG, undefined, {
      numeric: true,
      sensitivity: "base",
    }) >= 0
  );
}

async function buildDeliveryChangelog(
  tagName: string,
  previousTagName: string | null,
  fetcher: Fetcher,
): Promise<DeliveryChangelog> {
  const [commit, currentTree, previousTree] = await Promise.all([
    fetchCommitMetadata(tagName, fetcher),
    fetchTagTree(tagName, fetcher),
    previousTagName ? fetchTagTree(previousTagName, fetcher) : null,
  ]);
  const sourceCommit = extractSourceCommit(commit?.commit?.message ?? "");

  if (!currentTree) {
    return {
      previousTagName,
      releasedAt: commit?.commit?.author?.date ?? null,
      sourceCommit,
      compareUrl: buildCompareUrl(previousTagName, tagName),
      totals: { added: 0, modified: 0, removed: 0 },
      sections: [
        {
          title: "无法生成 changelog",
          items: ["GitHub 暂未返回该版本的交付快照元数据。"],
        },
      ],
    };
  }

  if (!previousTree) {
    const fileCount = currentTree.size;

    return {
      previousTagName: null,
      releasedAt: commit?.commit?.author?.date ?? null,
      sourceCommit,
      compareUrl: null,
      totals: { added: fileCount, modified: 0, removed: 0 },
      sections: CURATED_CHANGELOGS[tagName] ?? [
        {
          title: "新增",
          items: [`建立首个可列出的交付基线，包含 ${fileCount} 个交付文件。`],
        },
      ],
    };
  }

  const changes = diffTrees(currentTree, previousTree);

  return {
    previousTagName,
    releasedAt: commit?.commit?.author?.date ?? null,
    sourceCommit,
    compareUrl: buildCompareUrl(previousTagName, tagName),
    totals: {
      added: changes.filter((change) => change.status === "added").length,
      modified: changes.filter((change) => change.status === "modified")
        .length,
      removed: changes.filter((change) => change.status === "removed").length,
    },
    sections: buildSemanticChangelogSections(tagName, changes),
  };
}

async function fetchCommitMetadata(tagName: string, fetcher: Fetcher) {
  const response = await fetcher(
    `https://api.github.com/repos/${DELIVERY_REPO}/commits/${tagName}`,
    getRequestInit(),
  );

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as GitHubCommit;
}

async function fetchTagTree(tagName: string, fetcher: Fetcher) {
  const response = await fetcher(
    `https://api.github.com/repos/${DELIVERY_REPO}/git/trees/${tagName}?recursive=1`,
    getRequestInit(),
  );

  if (!response.ok) {
    return null;
  }

  return new Map(
    ((await response.json()) as GitHubTree).tree
      ?.filter((entry) => entry.type === "blob" && entry.path && entry.sha)
      .map((entry) => [entry.path as string, entry.sha as string]) ?? [],
  );
}

type FileChange = {
  path: string;
  status: "added" | "modified" | "removed";
};

const CURATED_CHANGELOGS: Record<
  string,
  DeliveryChangelog["sections"]
> = {
  "v1.17.4.fix.alpha": [
    {
      title: "改进",
      items: [
        "优化交付快照内容，按业务能力整理版本变化，避免在页面中暴露内部文件路径。",
      ],
    },
  ],
  "v1.17.4.alpha": [
    {
      title: "新增",
      items: [
        "新增 Supabase Realtime 驱动的界面刷新能力，搜索、标准化和询盘相关数据变更后可自动同步。",
        "新增多组实时刷新和查询失效回归测试，覆盖批次、搜索结果、标准化状态和智能询盘场景。",
        "新增智能询盘页面测试，补齐询盘流程的前端回归保护。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化搜索结果、标准化列表和智能询盘的数据查询键，减少跨页面缓存错配。",
        "优化标准化状态栏和搜索进度弹窗，使后台任务状态变化更及时地反馈到页面。",
        "优化固定搜索 LLM 批处理和行级同步链路，降低长任务状态滞后的风险。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "新增实时刷新相关数据库配置和环境示例，部署时需要同步启用对应实时表配置。",
      ],
    },
  ],
  "v1.17.3.fix.alpha": [
    {
      title: "修复",
      items: [
        "修复 1688 登录接管和搜索登录交接流程的稳定性问题。",
        "修复搜索计划执行中验证码、登录态和人工介入状态的衔接问题。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化搜索进度弹窗的状态工具函数，使任务反馈更容易理解。",
        "优化浏览器自动化登录检测，减少重复登录和误判。",
      ],
    },
  ],
  "v1.17.3.alpha": [
    {
      title: "新增",
      items: [
        "新增源文件、文档抽取和模型 override 相关服务测试，增强标准化输入链路的回归覆盖。",
        "新增文档抽取服务和模型配置服务的状态跟踪能力。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化标准化页面和搜索结果页面的数据加载、错误提示和任务状态同步。",
        "优化自动化控制服务，提升后台任务重启、暂停和状态读取的可靠性。",
      ],
    },
    {
      title: "修复",
      items: [
        "修复文档抽取与标准化结果之间的状态映射问题。",
        "修复旧 MarkItDown runtime 残留导致的文档抽取路径混乱。",
      ],
    },
    {
      title: "迁移与兼容性提示",
      items: [
        "本版本移除内置 MarkItDown runtime，文档抽取链路改由新的服务和模型配置承接。",
      ],
    },
  ],
  "v1.17.2.alpha": [
    {
      title: "新增",
      items: [
        "新增多 provider 模型配置管理能力，支持不同阶段独立维护模型和 provider。",
        "新增搜索启动、搜索进度和搜索任务状态面板的回归测试。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化搜索任务状态面板和搜索阶段配置，提升批量搜索任务的可读性。",
        "优化模型配置弹窗和模型 override 字典配置，降低阶段模型配置成本。",
        "优化自动化服务指标和侧边栏状态提示，使运行状态更清晰。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "补充模型配置、任务监控和搜索阶段相关配置项，部署前应同步检查环境变量。",
      ],
    },
  ],
  "v1.17.1.alpha": [
    {
      title: "新增",
      items: [
        "新增搜索人工介入提示栏和标准化状态栏，增强长流程任务的可观测性。",
        "新增失败处理补充打印视图测试，覆盖线下核对场景。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化搜索任务状态、标准化队列和自动化服务状态之间的页面联动。",
        "优化部署与安装脚本，使交付包安装流程更稳定。",
      ],
    },
    {
      title: "修复",
      items: [
        "修复自动化任务状态刷新不及时的问题。",
        "修复部分失败补录视图的 fallback 展示。",
      ],
    },
  ],
  "v1.17.0.alpha": [
    {
      title: "新增",
      items: [
        "新增标准化任务监控和标准化上传识别入口，完善标准化任务操作闭环。",
        "新增搜索结果目录树和搜索阶段配置组件，提升搜索结果管理能力。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化应用布局、导航和批次选择控件，使运营页面更适合连续操作。",
        "优化搜索计划、搜索表格和搜索视觉模型配置，提升搜索链路稳定性。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "补充前端组件和服务层测试，为后续搜索、标准化和询盘流程迭代提供基础。",
      ],
    },
  ],
  "v1.16.1.fix_1.alpha": [
    {
      title: "修复",
      items: [
        "修复固定搜索 LLM 批处理和行级同步中的异常状态恢复问题。",
        "修复自动化服务在登录态、验证码和人工介入状态下的任务交接问题。",
        "修复标准化失败补录、文档抽取和搜索结果同步中的多处边界情况。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化 LLM 调用日志、阶段耗时统计和错误反馈，便于定位限流、模型失败和网络异常。",
        "优化 1688 搜索计划和搜索结果抽取工具，提高联系人补全链路的稳定性。",
        "优化数据库 schema、迁移脚本和部署文档，使交付部署更容易复现。",
      ],
    },
    {
      title: "迁移与兼容性提示",
      items: [
        "本版本包含多项数据库和配置调整，升级前应同步执行新增迁移并核对环境变量。",
      ],
    },
  ],
  "v1.16.1.alpha": [
    {
      title: "新增",
      items: [
        "新增采购字典和供应商联系人补全链路，增强 1688 搜索后的联系人整理能力。",
        "新增 chatbot intent 阶段模型配置，使客服聊天意图识别可独立调参。",
        "新增多组搜索、联系人、标准化和模型配置测试。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化固定搜索、图片搜索关键词和搜索结果抽取流程。",
        "优化标准化文档抽取输入和源文件状态追踪。",
        "优化供应商联系页导航和旺旺 RPA 交互。",
      ],
    },
    {
      title: "修复",
      items: [
        "修复搜索账号锁定和 profile workspace 相关稳定性问题。",
        "修复部分标准化失败提示和人工修复提示文案。",
      ],
    },
  ],
  "v1.16.0.alpha": [
    {
      title: "新增",
      items: [
        "新增标准化失败补录流程，支持失败物料的补充字段映射、人工修复弹窗、补录卡片和重试标准化。",
        "新增标准化失败补录草稿能力，降低人工处理中断后重复填写的成本。",
        "新增失败补录打印视图，便于线下核对和交付。",
        "新增文档抽取 JSON contract，统一文档抽取结果结构和后续标准化输入。",
        "新增 GLM 原始文件抽取能力，并补充源文件抽取状态追踪。",
        "新增采购字典、联系人捕获和供应商联系页导航能力，增强 1688 搜索后的联系人补全链路。",
        "新增多阶段 LLM 模型配置，支持标准化、文档抽取、搜索视觉、固定搜索 batch、chatbot intent 等阶段独立指定模型。",
        "新增 DeepSeek 阶段模型和多 provider LLM 路由支持。",
        "新增单提交交付脚本和 delivery source tag 自动创建能力。",
        "新增多组自动化、标准化、文档抽取、上传识别和模型配置回归测试。",
      ],
    },
    {
      title: "改进",
      items: [
        "文档 OCR 默认切换到 `GLM-5V-Turbo`，提升文档和图片识别链路的一致性。",
        "优化物料上传路由，强化源文件、抽取状态和标准化结果之间的同步。",
        "优化搜索关键词、搜索计划、搜索表格和搜索视觉模型配置。",
        "优化 chatbot 意图识别模型配置，使聊天意图判断与其他 LLM 阶段解耦。",
        "优化人工修复提示文案和失败处理闭环，提升异常物料处理可读性。",
        "优化 1688 滑块验证码处理。",
        "更新发布脚本默认源引用为 `origin/main`，并支持跳过 fetch。",
      ],
    },
    {
      title: "修复",
      items: [
        "修复文档抽取 PDF 解析问题。",
        "修复文档 OCR 路由和模型选择问题。",
        "修复失败补录打印 fallback。",
        "修复自动化 API 重启控制。",
        "修复 LLM 限流失败反馈，使限流类错误能够更明确地暴露给操作侧。",
        "修复搜索账号锁定和搜索 profile workspace 相关流程的稳定性问题。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "新增 `.env.example` 和 `chatbot/.env.example` 中的多阶段、多 provider LLM 配置项。",
        "新增 source file 抽取审计、多 provider LLM 配置和采购字典相关迁移。",
        "新增交付发布脚本和最终产品回填脚本。",
        "CI 测试构建 workflow 被改为 disabled 文件保留。",
        "移除旧部署脚本作为主要发布入口。",
      ],
    },
    {
      title: "迁移与兼容性提示",
      items: [
        "本版本包含数据库迁移，升级前需要应用新增迁移。",
        "本版本移除了仓库内置的 MarkItDown runtime，文档抽取链路改由新的 GLM/OCR 与 JSON contract 流程承接。",
        "LLM 配置新增多个阶段级环境变量；部署前应同步更新生产环境配置，避免部分阶段回退到非预期模型。",
        "自动化发布流程改用新的交付脚本和 source tag 机制，旧部署脚本不再作为主要入口。",
        "GitHub Actions 测试构建 workflow 当前处于禁用状态，如需 CI 自动校验，需要重新启用或接入新的 CI 配置。",
      ],
    },
  ],
  "v1.15.1": [
    {
      title: "新增",
      items: [
        "建立 1688 自动采购交付基线，包含搜索、标准化、文档抽取、chatbot 和自动化运行时主体能力。",
        "提供基础安装脚本、部署文档和运行配置样例，作为后续交付版本的起点。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "包含首个可列出的 delivery snapshot，后续版本均以此为兼容性对比基线。",
      ],
    },
  ],
};

function diffTrees(
  currentTree: Map<string, string>,
  previousTree: Map<string, string>,
) {
  const changes: FileChange[] = [];

  for (const [path, sha] of currentTree) {
    const previousSha = previousTree.get(path);

    if (!previousSha) {
      changes.push({ path, status: "added" });
    } else if (previousSha !== sha) {
      changes.push({ path, status: "modified" });
    }
  }

  for (const path of previousTree.keys()) {
    if (!currentTree.has(path)) {
      changes.push({ path, status: "removed" });
    }
  }

  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

function buildSemanticChangelogSections(
  tagName: string,
  changes: FileChange[],
): DeliveryChangelog["sections"] {
  const curatedSections = CURATED_CHANGELOGS[tagName];

  if (curatedSections) {
    return curatedSections;
  }

  if (changes.length === 0) {
    return [
      {
        title: "改进",
        items: ["本版本与上一个列出版本的交付内容一致，作为重新发布或校验标签保留。"],
      },
    ];
  }

  const addedAreas = getChangedAreas(changes, "added");
  const modifiedAreas = getChangedAreas(changes, "modified");
  const removedAreas = getChangedAreas(changes, "removed");
  const sections: DeliveryChangelog["sections"] = [];

  if (addedAreas.length > 0) {
    sections.push({
      title: "新增",
      items: addedAreas.map((area) => `新增${area}相关交付内容。`),
    });
  }

  if (modifiedAreas.length > 0) {
    sections.push({
      title: "改进",
      items: modifiedAreas.map((area) => `优化${area}相关能力。`),
    });
  }

  if (removedAreas.length > 0) {
    sections.push({
      title: "移除",
      items: removedAreas.map((area) => `移除${area}中不再使用的交付内容。`),
    });
  }

  return sections;
}

function getChangedAreas(
  changes: FileChange[],
  status: FileChange["status"],
) {
  return Array.from(
    new Set(
      changes
        .filter((change) => change.status === status)
        .map((change) => getAreaTitle(change.path)),
    ),
  );
}

function getAreaTitle(path: string) {
  if (path.startsWith("automation/internal/")) return "自动化服务";
  if (path.startsWith("automation/pipelines/")) return "搜索 pipeline";
  if (path.startsWith("automation/playwright/")) return "浏览器自动化";
  if (path.startsWith("automation/core/")) return "自动化核心";
  if (path.startsWith("automation/keywords/")) return "关键词生成";
  if (path.startsWith("automation/procurement-list/")) return "采购清单抽取";
  if (path.startsWith("automation/standardization/")) return "标准化";
  if (path.startsWith("chatbot/")) return "chatbot";
  if (path.startsWith("scripts/") || path.startsWith("deploy/")) return "安装与交付脚本";
  if (path.startsWith("src/")) return "安装页面";
  if (path.startsWith("docs/") || path === "README.md") return "文档";
  if (
    path === "package.json" ||
    path === "pnpm-lock.yaml" ||
    path === "pnpm-workspace.yaml" ||
    path.endsWith("config.ts") ||
    path.endsWith("config.js")
  ) {
    return "构建与依赖配置";
  }

  return "项目交付";
}

function buildCompareUrl(previousTagName: string | null, tagName: string) {
  return previousTagName
    ? `${DELIVERY_REPO_URL}/compare/${previousTagName}...${tagName}`
    : null;
}

function extractSourceCommit(message: string) {
  return message.match(/snapshot from ([a-f0-9]+)/i)?.[1] ?? null;
}

function toDeliveryVersion(
  tagName: string,
  changelog: DeliveryChangelog,
): DeliveryVersion {
  return {
    tagName,
    archiveUrl: buildTagArchiveUrl(tagName),
    htmlUrl: `${DELIVERY_REPO_URL}/releases/tag/${tagName}`,
    changelog,
  };
}

function compareTagsDescending(left: string, right: string) {
  return right.localeCompare(left, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
