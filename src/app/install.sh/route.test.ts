import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./route";

describe("/install.sh", () => {
  const originalEnvFileContent = process.env.DELIVERY_ENV_FILE_CONTENT;
  const originalEnvFilePath = process.env.DELIVERY_ENV_FILE_PATH;

  afterEach(() => {
    process.env.DELIVERY_ENV_FILE_CONTENT = originalEnvFileContent;
    process.env.DELIVERY_ENV_FILE_PATH = originalEnvFilePath;
  });

  it("embeds configured env content in the generated installer", async () => {
    process.env.DELIVERY_ENV_FILE_CONTENT =
      "APP_ENV=production\nTOKEN=value-with-$-chars\n";
    process.env.DELIVERY_ENV_FILE_PATH = "/missing/.env";

    const response = await GET(
      new NextRequest("https://example.test/install.sh"),
    );
    const script = await response.text();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(script).toContain('EMBEDDED_ENV_AVAILABLE="1"');
    expect(script).toContain("APP_ENV=production\nTOKEN=value-with-$-chars");
    expect(script).not.toContain("__DELIVERY_ENV_CONTENT__");
  });

  it("leaves embedded env disabled when no env content is configured", async () => {
    delete process.env.DELIVERY_ENV_FILE_CONTENT;
    process.env.DELIVERY_ENV_FILE_PATH = "/missing/.env";

    const response = await GET(
      new NextRequest("https://example.test/install.sh"),
    );
    const script = await response.text();

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=300",
    );
    expect(script).toContain('EMBEDDED_ENV_AVAILABLE="0"');
    expect(script).not.toContain("__DELIVERY_ENV_CONTENT__");
  });
});
