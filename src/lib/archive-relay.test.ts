import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLatestArchiveDownloadResponse,
  createTagArchiveDownloadResponse,
} from "./archive-relay";

describe("createTagArchiveDownloadResponse", () => {
  const originalGithubToken = process.env.GITHUB_TOKEN;

  afterEach(() => {
    process.env.GITHUB_TOKEN = originalGithubToken;
  });

  it("streams a private GitHub tag archive through the public service", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    const archiveBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("archive"));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(archiveBody, {
        headers: {
          "content-length": "7",
          "content-type": "application/x-gzip",
        },
      }),
    );

    const response = await createTagArchiveDownloadResponse(
      "v1.15.1",
      fetchMock as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/yueyue27418/1688-autoprocurement/tarball/v1.15.1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="1688-autoprocurement-v1.15.1.tar.gz"',
    );
    expect(await response.text()).toBe("archive");
  });

  it("rejects invalid tags before contacting GitHub", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    const fetchMock = vi.fn();

    const response = await createTagArchiveDownloadResponse(
      "../main",
      fetchMock as typeof fetch,
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a server-side GitHub token", async () => {
    delete process.env.GITHUB_TOKEN;
    const fetchMock = vi.fn();

    const response = await createTagArchiveDownloadResponse(
      "v1.15.1",
      fetchMock as typeof fetch,
    );

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves and streams the latest private archive", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    const archiveBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("latest"));
        controller.close();
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          tag_name: "v1.17.6.alpha",
        }),
      )
      .mockResolvedValueOnce(
        Response.json([
          { name: "v1.17.6.alpha" },
          { name: "v1.17.5.alpha" },
          { name: "v1.15.1" },
        ]),
      )
      .mockResolvedValueOnce(new Response(archiveBody));

    const response = await createLatestArchiveDownloadResponse(
      fetchMock as typeof fetch,
    );

    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/yueyue27418/1688-autoprocurement/tarball/v1.17.6.alpha",
      expect.any(Object),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("latest");
  });
});
