export const DELIVERY_REPO_OWNER = "yueyue27418";
export const DELIVERY_REPO_NAME = "1688-autoprocurement";
export const DELIVERY_REPO = `${DELIVERY_REPO_OWNER}/${DELIVERY_REPO_NAME}`;
export const DELIVERY_REPO_URL = `https://github.com/${DELIVERY_REPO}`;
export const DEFAULT_INSTALL_ROOT = "/opt/1688-autoprocurement";

export function normalizeTagName(tagName: string) {
  return tagName.trim().replace(/^refs\/tags\//, "");
}

export function isValidDeliveryTag(tagName: string) {
  const normalizedTag = normalizeTagName(tagName);

  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalizedTag) &&
    !normalizedTag.includes("..")
  );
}

export function buildTagArchiveUrl(tagName: string) {
  const normalizedTag = normalizeTagName(tagName);

  if (!isValidDeliveryTag(normalizedTag)) {
    throw new Error(`Invalid delivery tag: ${tagName}`);
  }

  return `${DELIVERY_REPO_URL}/archive/refs/tags/${normalizedTag}.tar.gz`;
}

export function getSiteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "https://<vercel-domain>"
  );
}
