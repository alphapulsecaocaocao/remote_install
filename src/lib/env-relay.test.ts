import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { CUSTOMER_ENV_CONTENT } from "../install/customer-env";
import {
  buildTagEnvVariableName,
  createTagEnvDownloadResponse,
} from "./env-relay";

describe("createTagEnvDownloadResponse", () => {
  const originalEnvFileContent = process.env.DELIVERY_ENV_FILE_CONTENT;
  const v120EnvKey = buildTagEnvVariableName("v1.20.0.preview");
  const originalV120EnvFileContent = process.env[v120EnvKey];

  afterEach(() => {
    restoreEnv("DELIVERY_ENV_FILE_CONTENT", originalEnvFileContent);
    restoreEnv(v120EnvKey, originalV120EnvFileContent);
  });

  it("prefers tag-specific env content from the deployment environment", async () => {
    process.env.DELIVERY_ENV_FILE_CONTENT = "APP_ENV=generic\n";
    process.env[v120EnvKey] = "APP_ENV=v120\n";

    const response = await createTagEnvDownloadResponse("v1.20.0.preview");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("APP_ENV=v120\n");
  });

  it("falls back to generic env content from the deployment environment", async () => {
    process.env.DELIVERY_ENV_FILE_CONTENT = "APP_ENV=hosted\n";
    delete process.env[v120EnvKey];

    const response = await createTagEnvDownloadResponse("v1.17.6.fix.alpha");

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

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
