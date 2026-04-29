import { getLatestDeliveryVersion } from "@/lib/releases";

export const revalidate = 300;

export async function GET() {
  try {
    const latest = await getLatestDeliveryVersion();

    return Response.json(latest, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to resolve the latest delivery version.",
      },
      { status: 502 },
    );
  }
}
