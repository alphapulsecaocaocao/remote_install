import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { CUSTOMER_ENV_CONTENT } from "../install/customer-env";
import { createTagEnvDownloadResponse } from "./env-relay";

describe("createTagEnvDownloadResponse", () => {
  const originalEnvFileContent = process.env.DELIVERY_ENV_FILE_CONTENT;

  afterEach(() => {
    process.env.DELIVERY_ENV_FILE_CONTENT = originalEnvFileContent;
  });

  it("prefers env content from the deployment environment", async () => {
    process.env.DELIVERY_ENV_FILE_CONTENT = "APP_ENV=hosted\n";

    const response = await createTagEnvDownloadResponse("v1.17.6.alpha");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("APP_ENV=hosted\n");
  });

  it("serves the packaged customer env file for a valid tag", async () => {
    delete process.env.DELIVERY_ENV_FILE_CONTENT;

    const response = await createTagEnvDownloadResponse("v1.17.4.alpha");
    const responseBody = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="1688-autoprocurement-v1.17.4.alpha.env"',
    );
    expect(responseBody.length).toBe(CUSTOMER_ENV_CONTENT.length);
    expect(sha256(responseBody)).toBe(sha256(CUSTOMER_ENV_CONTENT));
  });

  it("rejects invalid tags before reading the env file", async () => {
    const response = await createTagEnvDownloadResponse("../main");

    expect(response.status).toBe(400);
  });
});

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
