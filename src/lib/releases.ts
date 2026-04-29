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
                title: "Change log unavailable",
                items: ["GitHub tag metadata is unavailable."],
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
          title: "Change log unavailable",
          items: ["GitHub did not return tree metadata for this tag."],
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
      sections: [
        {
          title: "Baseline snapshot",
          items: [`Initial listed delivery snapshot with ${fileCount} files.`],
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
    sections: groupChangesByArea(changes),
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

function groupChangesByArea(changes: FileChange[]) {
  const sections = new Map<string, string[]>();

  for (const change of changes) {
    const title = change.status === "removed" ? "Removed files" : getAreaTitle(change.path);
    const items = sections.get(title) ?? [];

    items.push(`${getChangeVerb(change.status)} ${change.path}`);
    sections.set(title, items);
  }

  if (sections.size === 0) {
    return [
      {
        title: "No file changes",
        items: ["This tag points to the same file tree as the previous listed tag."],
      },
    ];
  }

  return Array.from(sections, ([title, items]) => ({ title, items })).sort(
    (left, right) =>
      getAreaRank(left.title) - getAreaRank(right.title) ||
      left.title.localeCompare(right.title),
  );
}

function getAreaTitle(path: string) {
  if (path.startsWith("automation/internal/")) return "Automation server";
  if (path.startsWith("automation/pipelines/")) return "Search pipelines";
  if (path.startsWith("automation/playwright/")) return "Browser automation";
  if (path.startsWith("automation/core/")) return "Automation core";
  if (path.startsWith("automation/keywords/")) return "Keyword generation";
  if (path.startsWith("automation/procurement-list/")) return "Procurement extraction";
  if (path.startsWith("automation/standardization/")) return "Standardization";
  if (path.startsWith("chatbot/")) return "Chatbot";
  if (path.startsWith("scripts/") || path.startsWith("deploy/")) return "Deployment scripts";
  if (path.startsWith("src/")) return "App UI";
  if (path.startsWith("docs/") || path === "README.md") return "Documentation";
  if (
    path === "package.json" ||
    path === "pnpm-lock.yaml" ||
    path === "pnpm-workspace.yaml" ||
    path.endsWith("config.ts") ||
    path.endsWith("config.js")
  ) {
    return "Build and dependencies";
  }

  return "Project files";
}

function getAreaRank(title: string) {
  return [
    "Automation server",
    "Search pipelines",
    "Browser automation",
    "Automation core",
    "Keyword generation",
    "Procurement extraction",
    "Standardization",
    "Chatbot",
    "Deployment scripts",
    "App UI",
    "Documentation",
    "Build and dependencies",
    "Project files",
    "Removed files",
    "No file changes",
    "Baseline snapshot",
    "Change log unavailable",
  ].indexOf(title);
}

function getChangeVerb(status: FileChange["status"]) {
  if (status === "added") return "Added";
  if (status === "removed") return "Removed";

  return "Updated";
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
