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

const FALLBACK_DELIVERY_TAG = "v1.22.0.preview";
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
  const [releaseResponse, tagsResponse] = await Promise.all([
    fetcher(
      `https://api.github.com/repos/${DELIVERY_REPO}/releases/latest`,
      getRequestInit(),
    ),
    fetcher(
      `https://api.github.com/repos/${DELIVERY_REPO}/tags?per_page=100`,
      getRequestInit(),
    ),
  ]);

  const tags = tagsResponse.ok
    ? ((await tagsResponse.json()) as GitHubTag[])
        .map((tag) => normalizeTagName(tag.name ?? ""))
        .filter(isValidDeliveryTag)
        .sort(compareTagsDescending)
    : [];
  const latestTagName = tags[0] ?? null;
  let releaseVersion: LatestDeliveryVersion | null = null;

  if (releaseResponse.ok) {
    const release = (await releaseResponse.json()) as GitHubRelease;
    const releaseTagName = normalizeTagName(release.tag_name ?? "");

    if (isValidDeliveryTag(releaseTagName)) {
      releaseVersion = {
        source: "release",
        tagName: releaseTagName,
        archiveUrl: buildTagArchiveUrl(releaseTagName),
        htmlUrl:
          release.html_url ??
          `${DELIVERY_REPO_URL}/releases/tag/${releaseTagName}`,
        checksumUrl: findChecksumAssetUrl(release),
      };
    }
  }

  if (latestTagName) {
    return releaseVersion?.tagName === latestTagName
      ? releaseVersion
      : toLatestTagVersion(latestTagName);
  }

  return releaseVersion ?? getConfiguredDefaultVersion();
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

function toLatestTagVersion(tagName: string): LatestDeliveryVersion {
  return {
    source: "tag",
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
  "v1.22.0.preview": [
    {
      title: "新增",
      items: [
        "新增快速搜索客户评估、离线案例批处理和覆盖率回归能力，便于持续校验采购搜索策略效果。",
        "新增采购策略矩阵、品类归档和产品族画像数据，强化快速搜索的查询扩展与候选排序依据。",
        "新增快速搜索 search mode 数据库迁移，为后续按模式拆分搜索结果与策略提供结构支持。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化快速搜索入口、结果页、搜索工具排序和短缺分析，让物料页发起搜索与结果复核更稳定。",
        "优化 1688 聚合搜索、商家身份识别和持久化链路，降低候选来源错配与重复记录的风险。",
        "扩展 Hermes 商品链接查找 skill 的操作说明和 schema 校验，提升独立搜索流程的可维护性。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "更新快速搜索相关依赖、测试夹具和 `.env` 配置要求；生产部署需同步本次提供的 `.env` 文件。",
      ],
    },
  ],
  "v1.21.1.preview": [
    {
      title: "改进",
      items: [
        "优化 1688 商品关键词识别 skill 和独立快速搜索流程的 manifest，同步补齐搜索意图生成测试。",
        "补充快速搜索集成设计与执行计划文档，方便后续维护快速搜索、关键词识别和商品链接查找链路。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "补回项目报告大纲和 Prompt Store 设计说明，提升交付包内文档完整性。",
        "本 preview 小版本未引入新的应用配置项；生产部署仍需同步本次提供的 `.env` 文件。",
      ],
    },
  ],
  "v1.21.0.preview": [
    {
      title: "新增",
      items: [
        "新增快速搜索独立流程和结果页，支持从物料行发起搜索、跟踪运行事件、保存候选商品与联系人线索。",
        "新增 AI 询盘与外呼相关运行能力，支持按账号队列执行旺旺询盘、记录失败原因，并沉淀外呼任务数据。",
        "新增 SearXNG 部署配置和多组 1688 商品链接查找参考流程，为网页搜索与商品寻源提供可复用示例。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化物料、搜索结果、标准化和智能询盘页面的数据刷新与表格交互，减少状态滞后和跨页面缓存错配。",
        "优化 1688 登录、联系人导航、搜索阻断识别和浏览器 profile 管理，提高自动化搜索链路的稳定性。",
        "优化标准化失败提示、行级同步、搜索短缺总结和商家身份识别，使人工补充与后续搜索更容易衔接。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "新增快速搜索、AI 询盘、外呼、搜索状态审计和联系人补全相关数据库迁移，升级前需同步执行迁移。",
        "本 preview 版本更新 `.env.example` 和部署配置，生产部署需同步本次提供的 `.env` 文件。",
      ],
    },
  ],
  "v1.20.0.preview": [
    {
      title: "新增",
      items: [
        "新增固定搜索工作流诊断封装，外部搜索、验证码、登录态和页面超时等阻断会沉淀为可追踪的任务结果。",
        "新增在线标准化任务状态恢复与孤儿任务收敛逻辑，降低服务重启或中断后任务长期卡在运行中的风险。",
        "新增 AI 关键词规划回归能力，强化品牌约束、整机/系统类采购意图和无效配置词过滤。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化物料标准化选择、表格宽度填充和可见行勾选逻辑，减少跨批次误操作和表格窄屏错位。",
        "优化空字段占位符识别与 HTML 实体清洗，降低导入字段中的“待识别”“未提供”等占位文本污染后续流程。",
        "优化搜索任务状态、搜索结果和标准化页面的数据刷新与查询键复用。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "新增搜索读取路径优化迁移，并更新 Prompt Store 相关 schema 文档。",
        "本 preview 版本继续要求部署侧同步最新 `.env`，但本次 remote installer 更新未收到新的 `.env` 文件。",
      ],
    },
  ],
  "v1.19.1.preview.alpha": [
    {
      title: "新增",
      items: [
        "新增项目内置 Hermes skill catalog，交付包自带 1688 关键词识别、商品链接查找和商品识别说明三类 skill。",
        "新增 1688 商品链接查找的飞书截图报告参考流程，便于后续输出商家链接、商品链接和截图证据。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化 skill loader 默认路径，默认从交付包内 `automation/skills/catalog` 加载受控 skill，降低外部目录依赖。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "更新 skill 相关 `.env` 示例，部署时应同步新的 `SKILL_ROOTS`、allowlist 和 Agentic Web 配置。",
      ],
    },
  ],
  "v1.19.0.preview.alpha": [
    {
      title: "新增",
      items: [
        "新增 Agentic Web Tools 和 Firecrawl 后端接入，可在受控开关下为标准化和搜索链路补充网页搜索与内容抽取证据。",
        "新增 Hermes skill 加载、路由和运行框架，支持按采购任务选择关键词识别、商品链接查找和人工说明类 skill。",
        "新增基于 skill/web evidence 的标准化搜索词生成能力，将工具调用记录转化为可追踪的建议搜索词。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化固定搜索、搜索计划、联系人补全和行级同步流程，改用新的 skill/webtool 搜索链路承接搜索词与候选来源。",
        "优化标准化合同、失败补充和打印视图相关流程，使人工补充与后续搜索更容易追踪来源。",
        "优化 API 认证瞬时网络错误识别，减少 Supabase auth 短暂失败对自动化服务的影响。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "新增 Agentic Web、Firecrawl 和 skill allowlist 相关配置项，部署时需要同步新的 `.env`。",
        "本 preview 版本移除上一版部分固定搜索候选池和 AI 关键词规划实现，相关搜索能力迁移到 skill/webtool 路径。",
      ],
    },
  ],
  "v1.18.0.alpha": [
    {
      title: "新增",
      items: [
        "新增 AI 搜索词规划和固定搜索补抓词优化能力，基于标准化结果、命中率和拒绝原因生成更稳定的 1688 搜索词。",
        "新增固定搜索候选池去重与补抓调度，按商家、商品链接和关键词来源控制候选规模。",
        "新增标准化失败重试来源恢复能力，人工补充后可基于原始物料快照重新发起标准化。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化固定搜索、联系人补全和搜索登录交接流程，降低重复候选、低质量搜索方向和登录态中断的影响。",
        "优化物料页标准化选择逻辑，避免跨批次误操作，并提升单批次勾选标准化的稳定性。",
        "优化搜索结果、标准化列表和任务状态页面的数据刷新与查询复用。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "新增 Prompt Store 和关键词规划相关配置项，部署时需要同步新的 `.env`。",
        "新增搜索读取路径、结果标题和商家名称索引，降低任务列表、搜索结果和状态统计的数据库读取成本。",
      ],
    },
  ],
  "v1.17.6.fix.alpha": [
    {
      title: "新增",
      items: [
        "新增空闲感知轮询策略，任务活跃时保持快速刷新，空闲或页面不可见时降低前端轮询压力。",
        "新增标准化失败重试保护，避免普通批量标准化入口重复处理仍待人工补充的失败物料。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化搜索任务、标准化队列、手动介入和仪表盘的数据刷新链路，使任务状态反馈更稳定。",
        "优化批次可见性和数据访问范围查询，减少非管理员视角下的无效数据读取。",
      ],
    },
    {
      title: "运维 / 配置",
      items: [
        "新增 Supabase 索引和 RLS 策略调整，降低任务列表、批次访问和 1688 账号查询的数据库 egress 与扫描成本。",
      ],
    },
  ],
  "v1.17.6.alpha": [
    {
      title: "修复",
      items: [
        "修复 1688 登录检测、人工验证会话和登录交接中的稳定性问题。",
        "修复供应商联系页导航和搜索结果表格处理中的边界情况。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化 Playwright 自动化工具链，使登录态、联系人导航和搜索结果读取更可靠。",
      ],
    },
  ],
  "v1.17.5.alpha": [
    {
      title: "新增",
      items: [
        "新增持久化浏览器 profile、profile 锁和上下文管理能力，降低 1688 登录态丢失和并发冲突风险。",
        "新增搜索任务完成度、搜索进度指标和采购字典去重相关测试与服务逻辑。",
        "新增多项 Supabase 迁移，补齐搜索、标准化和联系人链路的数据结构演进。",
      ],
    },
    {
      title: "改进",
      items: [
        "优化固定搜索、联系人补全、行级同步和搜索结果抽取流程。",
        "优化 LLM provider、阶段模型配置和标准化/文档抽取链路。",
        "优化 chatbot 运行配置、1688 登录脚本和自动化控制服务。",
      ],
    },
    {
      title: "迁移与兼容性提示",
      items: [
        "本版本移除旧 BigModel 离线 batch 标准化实现，相关部署需同步使用新的文档抽取与标准化配置。",
        "部署时需要同步新的 `.env`、chatbot 配置和数据库迁移。",
      ],
    },
  ],
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
