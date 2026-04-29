import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createTagEnvDownloadResponse } from "./env-relay";

describe("createTagEnvDownloadResponse", () => {
  const originalEnvFilePath = process.env.DELIVERY_ENV_FILE_PATH;
  const originalEnvFileContent = process.env.DELIVERY_ENV_FILE_CONTENT;
  const tempDirs: string[] = [];

  afterEach(async () => {
    process.env.DELIVERY_ENV_FILE_PATH = originalEnvFilePath;
    process.env.DELIVERY_ENV_FILE_CONTENT = originalEnvFileContent;

    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
    );
  });

  it("serves the configured env file for a valid tag", async () => {
    const dir = await mkdtemp(join(tmpdir(), "remote-install-env-"));
    const envPath = join(dir, ".env");
    tempDirs.push(dir);
    process.env.DELIVERY_ENV_FILE_PATH = envPath;
    await writeFile(envPath, "APP_ENV=production\n");

    const response = await createTagEnvDownloadResponse("v1.17.4.alpha");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="1688-autoprocurement-v1.17.4.alpha.env"',
    );
    expect(await response.text()).toBe("APP_ENV=production\n");
  });

  it("prefers configured env content when present", async () => {
    process.env.DELIVERY_ENV_FILE_CONTENT = "APP_ENV=hosted\n";
    process.env.DELIVERY_ENV_FILE_PATH = "/missing/.env";

    const response = await createTagEnvDownloadResponse("v1.17.4.alpha");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("APP_ENV=hosted\n");
  });

  it("rejects invalid tags before reading the env file", async () => {
    const response = await createTagEnvDownloadResponse("../main");

    expect(response.status).toBe(400);
  });
});
