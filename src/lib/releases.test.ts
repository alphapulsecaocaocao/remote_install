import { describe, expect, it, vi } from "vitest";

import { getDeliveryVersions, getLatestDeliveryVersion } from "./releases";

describe("getLatestDeliveryVersion", () => {
  it("uses release metadata when the latest release matches the newest tag", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tag_name: "v1.20.0.preview",
          html_url:
            "https://github.com/yueyue27418/1688-autoprocurement/releases/tag/v1.20.0.preview",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: "v1.20.0.preview" },
          { name: "v1.15.1" },
        ],
      });

    const latest = await getLatestDeliveryVersion(fetchMock as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/yueyue27418/1688-autoprocurement/releases/latest",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/yueyue27418/1688-autoprocurement/tags?per_page=100",
      expect.any(Object),
    );
    expect(latest).toMatchObject({
      source: "release",
      tagName: "v1.20.0.preview",
      archiveUrl:
        "https://1688autoprocurement.xleeelx.online/api/downloads/tags/v1.20.0.preview",
    });
  });

  it("prefers the newest delivery tag when GitHub latest release is stale", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tag_name: "v1.17.6.fix.alpha",
          html_url:
            "https://github.com/yueyue27418/1688-autoprocurement/releases/tag/v1.17.6.fix.alpha",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: "v1.20.0.preview" },
          { name: "v1.19.1.preview.alpha" },
          { name: "v1.19.0.preview.alpha" },
          { name: "v1.18.0.alpha" },
          { name: "v1.17.6.fix.alpha" },
          { name: "v1.17.6.alpha" },
          { name: "v1.17.5.alpha" },
          { name: "v1.17.4.fix.alpha" },
          { name: "v1.17.4.alpha" },
          { name: "v1.15.1" },
        ],
      });

    const latest = await getLatestDeliveryVersion(fetchMock as typeof fetch);

    expect(latest).toMatchObject({
      source: "tag",
      tagName: "v1.20.0.preview",
      archiveUrl:
        "https://1688autoprocurement.xleeelx.online/api/downloads/tags/v1.20.0.preview",
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

    expect(fetchMock).toHaveBeenCalledWith(
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
      tagName: "v1.20.0.preview",
      archiveUrl:
        "https://1688autoprocurement.xleeelx.online/api/downloads/tags/v1.20.0.preview",
    });
  });
});

describe("getDeliveryVersions", () => {
  it("lists valid delivery tags from v1.15.1 onward in newest-first order", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/tags?per_page=100")) {
        return Response.json([
          { name: "v1.20.0.preview" },
          { name: "v1.19.1.preview.alpha" },
          { name: "v1.19.0.preview.alpha" },
          { name: "v1.18.0.alpha" },
          { name: "v1.17.6.fix.alpha" },
          { name: "v1.17.6.alpha" },
          { name: "v1.17.5.alpha" },
          { name: "v1.17.4.fix.alpha" },
          { name: "v1.9.0" },
          { name: "v1.15.1" },
          { name: "v1.14.9" },
          { name: "bad tag" },
          { name: "v1.16.0" },
        ]);
      }

      if (url.endsWith("/commits/v1.20.0.preview")) {
        return Response.json({
          commit: {
            author: { date: "2026-05-13T15:14:37Z" },
            message: "delivery: 2026-05-13 snapshot from 3a29c8fbbeea",
          },
        });
      }

      if (url.endsWith("/commits/v1.19.1.preview.alpha")) {
        return Response.json({
          commit: {
            author: { date: "2026-05-13T05:14:04Z" },
            message: "delivery: 2026-05-13 snapshot from 3ed9d411f006",
          },
        });
      }

      if (url.endsWith("/commits/v1.19.0.preview.alpha")) {
        return Response.json({
          commit: {
            author: { date: "2026-05-13T04:33:16Z" },
            message: "delivery: 2026-05-13 snapshot from 5ea3f7187fc0",
          },
        });
      }

      if (url.endsWith("/commits/v1.18.0.alpha")) {
        return Response.json({
          commit: {
            author: { date: "2026-05-11T15:37:37Z" },
            message: "delivery: 2026-05-11 snapshot from fbd0bee4a444",
          },
        });
      }

      if (url.endsWith("/commits/v1.17.6.fix.alpha")) {
        return Response.json({
          commit: {
            author: { date: "2026-05-09T14:46:28Z" },
            message: "delivery: 2026-05-09 snapshot from 65650d9e4023",
          },
        });
      }

      if (url.endsWith("/commits/v1.17.6.alpha")) {
        return Response.json({
          commit: {
            author: { date: "2026-05-06T10:43:30Z" },
            message: "delivery: 2026-05-06 snapshot from bbe27e19de0c",
          },
        });
      }

      if (url.endsWith("/commits/v1.17.5.alpha")) {
        return Response.json({
          commit: {
            author: { date: "2026-05-06T08:36:26Z" },
            message: "delivery: 2026-05-06 snapshot from fed209cf4d35",
          },
        });
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

      if (url.endsWith("/git/trees/v1.20.0.preview?recursive=1")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "automation/agentic-tools/web/research.ts", sha: "web-research", type: "blob" },
            { path: "automation/agentic-tools/web/web-tools.ts", sha: "web-tools", type: "blob" },
            { path: "automation/internal/api-auth-errors.ts", sha: "api-auth", type: "blob" },
            { path: "automation/internal/login-1688.js", sha: "login-new", type: "blob" },
            { path: "automation/internal/server.ts", sha: "server-v120", type: "blob" },
            { path: "automation/internal/standardization-task-state.ts", sha: "standardization-task-state", type: "blob" },
            { path: "automation/keywords/ai-keyword-planner.ts", sha: "keyword-planner-v120", type: "blob" },
            { path: "automation/keywords/keyword-generator.ts", sha: "keyword-generator-v120", type: "blob" },
            { path: "automation/pipelines/search-workflow.ts", sha: "search-workflow", type: "blob" },
            { path: "automation/pipelines/skill-webtool-search.ts", sha: "skill-search-v120", type: "blob" },
            { path: "automation/playwright/contact-page-navigation.js", sha: "contact-v120", type: "blob" },
            { path: "automation/playwright/persistent-context.js", sha: "context", type: "blob" },
            { path: "automation/playwright/profile-lock.js", sha: "lock", type: "blob" },
            { path: "automation/playwright/search-blockage.js", sha: "search-blockage", type: "blob" },
            { path: "automation/skills/catalog/1688-find-product-links/SKILL.md", sha: "find-links-skill", type: "blob" },
            { path: "automation/skills/catalog/1688-identify-product-keywords/SKILL.md", sha: "keywords-skill", type: "blob" },
            { path: "automation/skills/catalog/1688-product-identification-search/SKILL.md", sha: "overview-skill", type: "blob" },
            { path: "automation/skills/skill-loader.ts", sha: "skill-loader-v1191", type: "blob" },
            { path: "automation/skills/skill-router.ts", sha: "skill-router", type: "blob" },
            { path: "automation/standardization/skill-search-terms.ts", sha: "skill-terms", type: "blob" },
            { path: "scripts/install.sh", sha: "install-new", type: "blob" },
            { path: "src/features/materials/lib/standardizationSelection.ts", sha: "selection-v120", type: "blob" },
            { path: "src/lib/emptyFieldPlaceholders.ts", sha: "empty-placeholders", type: "blob" },
            { path: "src/lib/pollingPolicy.ts", sha: "polling", type: "blob" },
            { path: "src/lib/visibleSelection.ts", sha: "visible-selection", type: "blob" },
            { path: "src/services/searchService.ts", sha: "search-service-v120", type: "blob" },
            { path: "supabase/migrations/20260506.sql", sha: "migration", type: "blob" },
            { path: "supabase/migrations/20260508000100_optimize_supabase_egress.sql", sha: "egress", type: "blob" },
            { path: "supabase/migrations/20260511000100_optimize_search_read_paths.sql", sha: "search-read", type: "blob" },
          ],
        });
      }

      if (url.endsWith("/git/trees/v1.19.1.preview.alpha?recursive=1")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "automation/agentic-tools/web/research.ts", sha: "web-research", type: "blob" },
            { path: "automation/agentic-tools/web/web-tools.ts", sha: "web-tools", type: "blob" },
            { path: "automation/internal/api-auth-errors.ts", sha: "api-auth", type: "blob" },
            { path: "automation/internal/login-1688.js", sha: "login-new", type: "blob" },
            { path: "automation/internal/server.ts", sha: "server-v119", type: "blob" },
            { path: "automation/keywords/keyword-generator.ts", sha: "keyword-generator-v119", type: "blob" },
            { path: "automation/pipelines/skill-webtool-search.ts", sha: "skill-search", type: "blob" },
            { path: "automation/playwright/contact-page-navigation.js", sha: "contact-v119", type: "blob" },
            { path: "automation/playwright/persistent-context.js", sha: "context", type: "blob" },
            { path: "automation/playwright/profile-lock.js", sha: "lock", type: "blob" },
            { path: "automation/skills/catalog/1688-find-product-links/SKILL.md", sha: "find-links-skill", type: "blob" },
            { path: "automation/skills/catalog/1688-identify-product-keywords/SKILL.md", sha: "keywords-skill", type: "blob" },
            { path: "automation/skills/catalog/1688-product-identification-search/SKILL.md", sha: "overview-skill", type: "blob" },
            { path: "automation/skills/skill-loader.ts", sha: "skill-loader-v1191", type: "blob" },
            { path: "automation/skills/skill-router.ts", sha: "skill-router", type: "blob" },
            { path: "automation/standardization/skill-search-terms.ts", sha: "skill-terms", type: "blob" },
            { path: "scripts/install.sh", sha: "install-new", type: "blob" },
            { path: "src/lib/pollingPolicy.ts", sha: "polling", type: "blob" },
            { path: "src/services/searchService.ts", sha: "search-service-v119", type: "blob" },
            { path: "supabase/migrations/20260506.sql", sha: "migration", type: "blob" },
            { path: "supabase/migrations/20260508000100_optimize_supabase_egress.sql", sha: "egress", type: "blob" },
          ],
        });
      }

      if (url.endsWith("/git/trees/v1.19.0.preview.alpha?recursive=1")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "automation/agentic-tools/web/research.ts", sha: "web-research", type: "blob" },
            { path: "automation/agentic-tools/web/web-tools.ts", sha: "web-tools", type: "blob" },
            { path: "automation/internal/api-auth-errors.ts", sha: "api-auth", type: "blob" },
            { path: "automation/internal/login-1688.js", sha: "login-new", type: "blob" },
            { path: "automation/internal/server.ts", sha: "server-v119", type: "blob" },
            { path: "automation/keywords/keyword-generator.ts", sha: "keyword-generator-v119", type: "blob" },
            { path: "automation/pipelines/skill-webtool-search.ts", sha: "skill-search", type: "blob" },
            { path: "automation/playwright/contact-page-navigation.js", sha: "contact-v119", type: "blob" },
            { path: "automation/playwright/persistent-context.js", sha: "context", type: "blob" },
            { path: "automation/playwright/profile-lock.js", sha: "lock", type: "blob" },
            { path: "automation/skills/skill-router.ts", sha: "skill-router", type: "blob" },
            { path: "automation/standardization/skill-search-terms.ts", sha: "skill-terms", type: "blob" },
            { path: "scripts/install.sh", sha: "install-new", type: "blob" },
            { path: "src/lib/pollingPolicy.ts", sha: "polling", type: "blob" },
            { path: "src/services/searchService.ts", sha: "search-service-v119", type: "blob" },
            { path: "supabase/migrations/20260506.sql", sha: "migration", type: "blob" },
            { path: "supabase/migrations/20260508000100_optimize_supabase_egress.sql", sha: "egress", type: "blob" },
          ],
        });
      }

      if (url.endsWith("/git/trees/v1.18.0.alpha?recursive=1")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "automation/internal/login-1688.js", sha: "login-new", type: "blob" },
            { path: "automation/internal/server.ts", sha: "server-v118", type: "blob" },
            { path: "automation/internal/standardization-failure-guard.test.ts", sha: "guard", type: "blob" },
            { path: "automation/internal/standardization-retry-source.ts", sha: "retry-source", type: "blob" },
            { path: "automation/keywords/ai-keyword-planner.ts", sha: "keyword-planner", type: "blob" },
            { path: "automation/pipelines/fixed-search-keyword-optimizer.ts", sha: "keyword-optimizer", type: "blob" },
            { path: "automation/playwright/fixed-runtime-candidate-pool.js", sha: "candidate-pool", type: "blob" },
            { path: "automation/playwright/contact-page-navigation.js", sha: "contact-v118", type: "blob" },
            { path: "automation/playwright/persistent-context.js", sha: "context", type: "blob" },
            { path: "automation/playwright/profile-lock.js", sha: "lock", type: "blob" },
            { path: "scripts/install.sh", sha: "install-new", type: "blob" },
            { path: "src/features/materials/lib/standardizationSelection.ts", sha: "selection", type: "blob" },
            { path: "src/lib/pollingPolicy.ts", sha: "polling", type: "blob" },
            { path: "supabase/migrations/20260506.sql", sha: "migration", type: "blob" },
            { path: "supabase/migrations/20260508000100_optimize_supabase_egress.sql", sha: "egress", type: "blob" },
            { path: "supabase/migrations/20260511000100_optimize_search_read_paths.sql", sha: "search-read", type: "blob" },
          ],
        });
      }

      if (url.endsWith("/git/trees/v1.17.6.fix.alpha?recursive=1")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "automation/internal/login-1688.js", sha: "login-new", type: "blob" },
            { path: "automation/internal/server.ts", sha: "server-refined", type: "blob" },
            { path: "automation/internal/standardization-failure-guard.test.ts", sha: "guard", type: "blob" },
            { path: "automation/playwright/contact-page-navigation.js", sha: "contact-new", type: "blob" },
            { path: "automation/playwright/persistent-context.js", sha: "context", type: "blob" },
            { path: "automation/playwright/profile-lock.js", sha: "lock", type: "blob" },
            { path: "scripts/install.sh", sha: "install-new", type: "blob" },
            { path: "src/lib/pollingPolicy.ts", sha: "polling", type: "blob" },
            { path: "supabase/migrations/20260506.sql", sha: "migration", type: "blob" },
            { path: "supabase/migrations/20260508000100_optimize_supabase_egress.sql", sha: "egress", type: "blob" },
          ],
        });
      }

      if (url.endsWith("/git/trees/v1.17.6.alpha?recursive=1")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "automation/internal/login-1688.js", sha: "login-new", type: "blob" },
            { path: "automation/playwright/contact-page-navigation.js", sha: "contact-new", type: "blob" },
            { path: "automation/playwright/persistent-context.js", sha: "context", type: "blob" },
            { path: "automation/playwright/profile-lock.js", sha: "lock", type: "blob" },
            { path: "scripts/install.sh", sha: "install-new", type: "blob" },
            { path: "supabase/migrations/20260506.sql", sha: "migration", type: "blob" },
          ],
        });
      }

      if (url.endsWith("/git/trees/v1.17.5.alpha?recursive=1")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "automation/internal/login-1688.js", sha: "login-old", type: "blob" },
            { path: "automation/playwright/contact-page-navigation.js", sha: "contact-old", type: "blob" },
            { path: "automation/playwright/persistent-context.js", sha: "context", type: "blob" },
            { path: "automation/playwright/profile-lock.js", sha: "lock", type: "blob" },
            { path: "scripts/install.sh", sha: "install-new", type: "blob" },
            { path: "supabase/migrations/20260506.sql", sha: "migration", type: "blob" },
          ],
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
      "v1.20.0.preview",
      "v1.19.1.preview.alpha",
      "v1.19.0.preview.alpha",
      "v1.18.0.alpha",
      "v1.17.6.fix.alpha",
      "v1.17.6.alpha",
      "v1.17.5.alpha",
      "v1.17.4.fix.alpha",
      "v1.16.0",
      "v1.15.1",
    ]);
    expect(versions[0]?.changelog.sections[0]).toMatchObject({
      title: "新增",
      items: expect.arrayContaining([
        "新增固定搜索工作流诊断封装，外部搜索、验证码、登录态和页面超时等阻断会沉淀为可追踪的任务结果。",
      ]),
    });
    expect(versions[0]).toMatchObject({
      changelog: {
        previousTagName: "v1.19.1.preview.alpha",
        sourceCommit: "3a29c8fbbeea",
        totals: {
          added: 8,
          modified: 5,
          removed: 0,
        },
      },
    });
    expect(versions[1]?.changelog.sections[0]).toMatchObject({
      title: "新增",
      items: expect.arrayContaining([
        "新增项目内置 Hermes skill catalog，交付包自带 1688 关键词识别、商品链接查找和商品识别说明三类 skill。",
      ]),
    });
    expect(versions[2]?.changelog.sections[0]).toMatchObject({
      title: "新增",
      items: expect.arrayContaining([
        "新增 Agentic Web Tools 和 Firecrawl 后端接入，可在受控开关下为标准化和搜索链路补充网页搜索与内容抽取证据。",
      ]),
    });
    expect(versions[3]?.changelog.sections[0]).toMatchObject({
      title: "新增",
      items: expect.arrayContaining([
        "新增 AI 搜索词规划和固定搜索补抓词优化能力，基于标准化结果、命中率和拒绝原因生成更稳定的 1688 搜索词。",
      ]),
    });
    expect(versions[4]?.changelog.sections[0]).toMatchObject({
      title: "新增",
      items: expect.arrayContaining([
        "新增空闲感知轮询策略，任务活跃时保持快速刷新，空闲或页面不可见时降低前端轮询压力。",
      ]),
    });
    expect(versions[5]?.changelog.sections[0]).toMatchObject({
      title: "修复",
      items: expect.arrayContaining([
        "修复 1688 登录检测、人工验证会话和登录交接中的稳定性问题。",
      ]),
    });
    expect(versions[6]?.changelog.sections[0]).toMatchObject({
      title: "新增",
      items: expect.arrayContaining([
        "新增持久化浏览器 profile、profile 锁和上下文管理能力，降低 1688 登录态丢失和并发冲突风险。",
      ]),
    });
    expect(versions[7]).toMatchObject({
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
    expect(versions[7]?.changelog.sections).toEqual([
      {
        title: "改进",
        items: [
          "优化交付快照内容，按业务能力整理版本变化，避免在页面中暴露内部文件路径。",
        ],
      },
    ]);
    expect(JSON.stringify(versions[7]?.changelog.sections)).not.toContain(
      "automation/",
    );
    expect(versions[9]?.changelog.sections).toEqual([
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
