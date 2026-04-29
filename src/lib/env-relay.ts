import { readFile } from "node:fs/promises";

import {
  DELIVERY_REPO_NAME,
  isValidDeliveryTag,
  normalizeTagName,
} from "./delivery-repo";

const DEFAULT_DELIVERY_ENV_FILE_PATH =
  "/Users/damien/git/Github/alphapulsecaocaocao/1688-autoprocurement-pulse/.env";

export async function createTagEnvDownloadResponse(tagName: string) {
  const normalizedTag = normalizeTagName(tagName);

  if (!isValidDeliveryTag(normalizedTag)) {
    return new Response("Invalid delivery tag.\n", { status: 400 });
  }

  const envFileContent = await readDeliveryEnvFileContent();

  if (envFileContent) {
    return buildEnvResponse(normalizedTag, envFileContent);
  }
  return new Response("Configured env file is unavailable.\n", {
    status: 404,
  });
}

export async function readDeliveryEnvFileContent() {
  const envFileContent = process.env.DELIVERY_ENV_FILE_CONTENT;

  if (envFileContent) {
    return envFileContent;
  }

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const envFilePath =
    process.env.DELIVERY_ENV_FILE_PATH ?? DEFAULT_DELIVERY_ENV_FILE_PATH;

  try {
    return await readFile(envFilePath, "utf8");
  } catch {
    return null;
  }
}

function buildEnvResponse(tagName: string, body: BodyInit) {
  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${DELIVERY_REPO_NAME}-${tagName}.env"`,
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
