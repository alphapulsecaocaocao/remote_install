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
      ? [toDeliveryVersion(configured.tagName)]
      : [];
  }

  return ((await tagsResponse.json()) as GitHubTag[])
    .map((tag) => normalizeTagName(tag.name ?? ""))
    .filter(isListedDeliveryTag)
    .sort(compareTagsDescending)
    .map(toDeliveryVersion);
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

function toDeliveryVersion(tagName: string): DeliveryVersion {
  return {
    tagName,
    archiveUrl: buildTagArchiveUrl(tagName),
    htmlUrl: `${DELIVERY_REPO_URL}/releases/tag/${tagName}`,
  };
}

function compareTagsDescending(left: string, right: string) {
  return right.localeCompare(left, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
