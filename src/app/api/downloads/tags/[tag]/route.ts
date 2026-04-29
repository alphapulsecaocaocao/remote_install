import { createTagArchiveDownloadResponse } from "@/lib/archive-relay";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/downloads/tags/[tag]">,
) {
  const { tag } = await context.params;

  return createTagArchiveDownloadResponse(tag);
}
