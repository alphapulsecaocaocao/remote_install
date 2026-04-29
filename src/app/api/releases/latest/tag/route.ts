import { getLatestDeliveryVersion } from "@/lib/releases";

export const revalidate = 300;

export async function GET() {
  try {
    const latest = await getLatestDeliveryVersion();

    return new Response(`${latest.tagName}\n`, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return new Response(
      error instanceof Error
        ? `${error.message}\n`
        : "Unable to resolve the latest delivery version.\n",
      { status: 502 },
    );
  }
}
