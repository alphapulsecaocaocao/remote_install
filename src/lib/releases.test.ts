import { describe, expect, it, vi } from "vitest";

import { getDeliveryVersions, getLatestDeliveryVersion } from "./releases";

describe("getLatestDeliveryVersion", () => {
  it("uses the delivery repository latest release when GitHub releases exist", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tag_name: "v1.15.1",
        html_url:
          "https://github.com/yueyue27418/1688-autoprocurement/releases/tag/v1.15.1",
      }),
    });

    const latest = await getLatestDeliveryVersion(fetchMock as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/yueyue27418/1688-autoprocurement/releases/latest",
      expect.any(Object),
    );
    expect(latest).toMatchObject({
      source: "release",
      tagName: "v1.15.1",
      archiveUrl:
        "https://1688autoprocurement.xleeelx.online/api/downloads/tags/v1.15.1",
    });
  });

  it("falls back to delivery repository tags when no latest release exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: "v1.9.0" },
          { name: "v1.15.1" },
          { name: "v1.10.0" },
        ],
      });

    const latest = await getLatestDeliveryVersion(fetchMock as typeof fetch);

    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/yueyue27418/1688-autoprocurement/tags?per_page=100",
      expect.any(Object),
    );
    expect(latest).toMatchObject({
      source: "tag",
      tagName: "v1.15.1",
    });
  });

  it("uses the configured default tag when GitHub metadata is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const latest = await getLatestDeliveryVersion(fetchMock as typeof fetch);

    expect(latest).toMatchObject({
      source: "configured",
      tagName: "v1.17.4.fix.alpha",
      archiveUrl:
        "https://1688autoprocurement.xleeelx.online/api/downloads/tags/v1.17.4.fix.alpha",
    });
  });
});

describe("getDeliveryVersions", () => {
  it("lists valid delivery tags from v1.15.1 onward in newest-first order", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/tags?per_page=100")) {
        return Response.json([
          { name: "v1.17.4.fix.alpha" },
          { name: "v1.9.0" },
          { name: "v1.15.1" },
          { name: "v1.14.9" },
          { name: "bad tag" },
          { name: "v1.16.0" },
        ]);
      }

      if (url.endsWith("/commits/v1.17.4.fix.alpha")) {
        return Response.json({
          commit: {
            author: { date: "2026-04-29T13:49:52Z" },
            message: "delivery: 2026-04-29 snapshot from abcdef123456",
          },
        });
      }

      if (url.endsWith("/commits/v1.16.0")) {
        return Response.json({
          commit: {
            author: { date: "2026-04-26T10:00:00Z" },
            message: "delivery: 2026-04-26 snapshot from 111111111111",
          },
        });
      }

      if (url.endsWith("/commits/v1.15.1")) {
        return Response.json({
          commit: {
            author: { date: "2026-04-26T09:00:00Z" },
            message: "delivery: 2026-04-26 snapshot from 000000000000",
          },
        });
      }

      if (url.endsWith("/git/trees/v1.17.4.fix.alpha?recursive=1")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "automation/internal/server.ts", sha: "server-new", type: "blob" },
            { path: "automation/pipelines/row-pipeline.ts", sha: "pipeline", type: "blob" },
            { path: "chatbot/src/chat-worker.js", sha: "chat", type: "blob" },
            { path: "scripts/install.sh", sha: "install-new", type: "blob" },
          ],
        });
      }

      if (url.endsWith("/git/trees/v1.16.0?recursive=1")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "automation/internal/server.ts", sha: "server-old", type: "blob" },
            { path: "automation/pipelines/row-pipeline.ts", sha: "pipeline", type: "blob" },
            { path: "scripts/install.sh", sha: "install-old", type: "blob" },
            { path: "markitdown/legacy.py", sha: "removed", type: "blob" },
          ],
        });
      }

      if (url.endsWith("/git/trees/v1.15.1?recursive=1")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "automation/internal/server.ts", sha: "server-oldest", type: "blob" },
            { path: "scripts/install.sh", sha: "install-old", type: "blob" },
          ],
        });
      }

      return new Response("not found", { status: 404 });
    });

    const versions = await getDeliveryVersions(fetchMock as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/yueyue27418/1688-autoprocurement/tags?per_page=100",
      expect.any(Object),
    );
    expect(versions.map((version) => version.tagName)).toEqual([
      "v1.17.4.fix.alpha",
      "v1.16.0",
      "v1.15.1",
    ]);
    expect(versions[0]).toMatchObject({
      archiveUrl:
        "https://1688autoprocurement.xleeelx.online/api/downloads/tags/v1.17.4.fix.alpha",
      htmlUrl:
        "https://github.com/yueyue27418/1688-autoprocurement/releases/tag/v1.17.4.fix.alpha",
      changelog: {
        previousTagName: "v1.16.0",
        sourceCommit: "abcdef123456",
        totals: {
          added: 1,
          modified: 2,
          removed: 1,
        },
      },
    });
    expect(versions[0]?.changelog.sections).toEqual([
      {
        title: "改进",
        items: [
          "优化交付快照内容，按业务能力整理版本变化，避免在页面中暴露内部文件路径。",
        ],
      },
    ]);
    expect(JSON.stringify(versions[0]?.changelog.sections)).not.toContain(
      "automation/",
    );
    expect(versions[2]?.changelog.sections).toEqual([
      {
        title: "新增",
        items: [
          "建立 1688 自动采购交付基线，包含搜索、标准化、文档抽取、chatbot 和自动化运行时主体能力。",
          "提供基础安装脚本、部署文档和运行配置样例，作为后续交付版本的起点。",
        ],
      },
      {
        title: "运维 / 配置",
        items: [
          "包含首个可列出的 delivery snapshot，后续版本均以此为兼容性对比基线。",
        ],
      },
    ]);
  });
});
