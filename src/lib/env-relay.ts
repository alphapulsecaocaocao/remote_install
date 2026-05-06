import {
  DELIVERY_REPO_NAME,
  isValidDeliveryTag,
  normalizeTagName,
} from "./delivery-repo";
import { CUSTOMER_ENV_CONTENT } from "../install/customer-env";

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
  return process.env.DELIVERY_ENV_FILE_CONTENT ?? CUSTOMER_ENV_CONTENT;
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
