import { readFile } from "node:fs/promises";

import { NextRequest } from "next/server";

export const revalidate = 300;

export async function GET(request: NextRequest) {
  const scriptUrl = new URL("../../install/remote-install.sh", import.meta.url);
  const script = await readFile(scriptUrl, "utf8");
  const origin = request.nextUrl.origin;

  return new Response(script.replaceAll("__INSTALL_SERVICE_URL__", origin), {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
