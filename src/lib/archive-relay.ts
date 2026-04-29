import {
  DELIVERY_REPO_NAME,
  buildGitHubTagArchiveUrl,
  isValidDeliveryTag,
  normalizeTagName,
} from "./delivery-repo";
import { getLatestDeliveryVersion } from "./releases";

type Fetcher = typeof fetch;

export async function createTagArchiveDownloadResponse(
  tagName: string,
  fetcher: Fetcher = fetch,
) {
  const normalizedTag = normalizeTagName(tagName);

  if (!isValidDeliveryTag(normalizedTag)) {
    return new Response("Invalid delivery tag.\n", { status: 400 });
  }

  if (!process.env.GITHUB_TOKEN) {
    return new Response("GITHUB_TOKEN is required to relay private archives.\n", {
      status: 503,
    });
  }

  const upstream = await fetcher(buildGitHubTagArchiveUrl(normalizedTag), {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "User-Agent": "1688-autoprocurement-remote-install",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "follow",
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Unable to download the delivery archive.\n", {
      status: upstream.status === 404 ? 404 : 502,
    });
  }

  const headers = new Headers({
    "Cache-Control": "public, max-age=300, s-maxage=3600",
    "Content-Disposition": `attachment; filename="${DELIVERY_REPO_NAME}-${normalizedTag}.tar.gz"`,
    "Content-Type":
      upstream.headers.get("content-type") ?? "application/gzip",
    "X-Content-Type-Options": "nosniff",
  });
  const contentLength = upstream.headers.get("content-length");

  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(upstream.body, {
    headers,
    status: 200,
  });
}

export async function createLatestArchiveDownloadResponse(
  fetcher: Fetcher = fetch,
) {
  const latest = await getLatestDeliveryVersion(fetcher);

  return createTagArchiveDownloadResponse(latest.tagName, fetcher);
}
