import { readFile } from "node:fs/promises";

import { NextRequest } from "next/server";

import { readDeliveryEnvFileContent } from "../../lib/env-relay";

export const revalidate = 300;

export async function GET(request: NextRequest) {
  const scriptUrl = new URL("../../install/remote-install.sh", import.meta.url);
  const script = await readFile(scriptUrl, "utf8");
  const envFileContent = await readDeliveryEnvFileContent();
  const origin = request.nextUrl.origin;

  const responseBody = script
    .replaceAll("__INSTALL_SERVICE_URL__", origin)
    .replaceAll("__DELIVERY_ENV_AVAILABLE__", envFileContent ? "1" : "0")
    .replaceAll("__DELIVERY_ENV_CONTENT__", envFileContent ?? "");

  return new Response(responseBody, {
    headers: {
      "Cache-Control": envFileContent
        ? "no-store"
        : "public, max-age=300, s-maxage=300",
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
