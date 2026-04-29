import { createTagEnvDownloadResponse } from "@/lib/env-relay";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/downloads/tags/[tag]/env">,
) {
  const { tag } = await context.params;

  return createTagEnvDownloadResponse(tag);
}
