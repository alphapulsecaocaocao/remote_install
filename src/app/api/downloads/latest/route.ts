import { createLatestArchiveDownloadResponse } from "@/lib/archive-relay";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await createLatestArchiveDownloadResponse();
  } catch (error) {
    return new Response(
      error instanceof Error
        ? `${error.message}\n`
        : "Unable to download the latest delivery archive.\n",
      { status: 502 },
    );
  }
}
