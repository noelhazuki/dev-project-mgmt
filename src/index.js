import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ============================================================
// spec.json 読み書きヘルパー（KVアクセス）
// ============================================================
async function getSpec(env, project) {
  const raw = await env.PROJECT_MGMT_KV.get(`spec:${project}`);
  return raw ? JSON.parse(raw) : null;
}

async function putSpec(env, project, specObj) {
  await env.PROJECT_MGMT_KV.put(`spec:${project}`, JSON.stringify(specObj));
}

// ============================================================
// PROJECT_STATE 読み書きヘルパー（KVアクセス）
// ============================================================
async function getProjectState(env, project) {
  const raw = await env.PROJECT_MGMT_KV.get(`project_state:${project}`);
  return raw ? JSON.parse(raw) : null;
}

async function putProjectState(env, project, stateObj) {
  await env.PROJECT_MGMT_KV.put(`project_state:${project}`, JSON.stringify(stateObj));
}

// ============================================================
// ideas 読み書きヘルパー（KVアクセス）
// ============================================================
async function getIdeas(env, project) {
  const raw = await env.PROJECT_MGMT_KV.get(`ideas:${project}`);
  return raw ? JSON.parse(raw) : { "思いつき": [], "今後検討": [], "保留": [] };
}

async function putIdeas(env, project, ideasObj) {
  await env.PROJECT_MGMT_KV.put(`ideas:${project}`, JSON.stringify(ideasObj));
}

// ============================================================
// MCPサーバー本体（spec関連 + project_state関連 + ideas関連ツール）
// ============================================================
export class ProjectMgmtMCP extends McpAgent {
  server = new McpServer({ name: "dev-project-mgmt", version: "1.0.0" });

  async init() {
    // ▼ spec関連
    this.server.tool(
      "list_spec_sections",
      { project: z.string().describe("プロジェクトID（例：ADM-001）") },
      async ({ project }) => {
        const spec = await getSpec(this.env, project);
        if (!spec) {
          return {
            content: [{ type: "text", text: `spec not found for project: ${project}` }],
            isError: true
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ project, sections: Object.keys(spec) }) }]
        };
      }
    );

    this.server.tool(
      "read_spec_section",
      {
        project: z.string().describe("プロジェクトID"),
        key: z.string().describe("読みたいセクション名（トップレベルキー）")
      },
      async ({ project, key }) => {
        const spec = await getSpec(this.env, project);
        if (!spec) {
          return {
            content: [{ type: "text", text: `spec not found for project: ${project}` }],
            isError: true
          };
        }
        if (!(key in spec)) {
          return { content: [{ type: "text", text: `section not found: ${key}` }], isError: true };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ project, key, value: spec[key] }) }]
        };
      }
    );

    this.server.tool(
      "write_spec_section",
      {
        project: z.string().describe("プロジェクトID"),
        key: z.string().describe("更新するセクション名（トップレベルキー）"),
        value: z.any().describe("そのセクションに書き込む値（JSON。文字列・オブジェクト・配列いずれも可）")
      },
      async ({ project, key, value }) => {
        const spec = (await getSpec(this.env, project)) || {};
        spec[key] = value;
        await putSpec(this.env, project, spec);
        return { content: [{ type: "text", text: JSON.stringify({ project, key, saved: true }) }] };
      }
    );
    // ▲ spec関連

    // ▼ project_state関連
    this.server.tool(
      "read_project_state",
      { project: z.string().describe("プロジェクトID") },
      async ({ project }) => {
        const state = await getProjectState(this.env, project);
        if (!state) {
          return {
            content: [{ type: "text", text: `project_state not found for project: ${project}` }],
            isError: true
          };
        }
        return { content: [{ type: "text", text: JSON.stringify({ project, ...state }) }] };
      }
    );

    this.server.tool(
      "update_project_state",
      {
        project: z.string().describe("プロジェクトID"),
        genjou: z.string().describe("現状：今どういう状態か、短く一言"),
        kadai: z.string().describe("課題：検討中・結論が出てないこと"),
        tsugi: z.string().describe("次回やる事：箇条書きテキスト")
      },
      async ({ project, genjou, kadai, tsugi }) => {
        const state = { "現状": genjou, "課題": kadai, "次回やる事": tsugi };
        await putProjectState(this.env, project, state);
        return { content: [{ type: "text", text: JSON.stringify({ project, saved: true }) }] };
      }
    );
    // ▲ project_state関連

    // ▼ ideas関連
    this.server.tool(
      "read_ideas",
      { project: z.string().describe("プロジェクトID") },
      async ({ project }) => {
        const ideas = await getIdeas(this.env, project);
        return { content: [{ type: "text", text: JSON.stringify({ project, ideas }) }] };
      }
    );

    this.server.tool(
      "append_idea",
      {
        project: z.string().describe("プロジェクトID"),
        category: z.enum(["思いつき", "今後検討", "保留"]).describe("追記するカテゴリ"),
        text: z.string().describe("追記する内容"),
        date: z.string().describe("YYYY-MM-DD形式の日付（呼び出し前にuser_time_v0で現在時刻を取得すること）")
      },
      async ({ project, category, text, date }) => {
        const ideas = await getIdeas(this.env, project);
        ideas[category].push({ date, text });
        await putIdeas(this.env, project, ideas);
        return { content: [{ type: "text", text: JSON.stringify({ project, category, saved: true }) }] };
      }
    );
    // ▲ ideas関連

    // 疎通確認用。ログインが通っていれば userId が返る
    this.server.tool("whoami", {}, async () => {
      return { content: [{ type: "text", text: JSON.stringify({ userId: this.props?.userId ?? null }) }] };
    });
  }
}

// ============================================================
// ログイン画面（従来通り。固定ID・パスワードはWorker Secretsで設定済み。）
// ============================================================
const defaultHandler = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/authorize" && request.method === "GET") {
      const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const encodedReqInfo = btoa(JSON.stringify(oauthReqInfo));
      return new Response(
        `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>ログイン</title></head>
        <body style="font-family:sans-serif;max-width:320px;margin:60px auto;">
          <h2>dev-project-mgmt ログイン</h2>
          <form method="POST" action="/authorize">
            <input type="hidden" name="oauthReqInfo" value="${encodedReqInfo}">
            <p><input type="text" name="username" placeholder="ID" required style="width:100%;padding:8px;"></p>
            <p><input type="password" name="password" placeholder="パスワード" required style="width:100%;padding:8px;"></p>
            <button type="submit" style="width:100%;padding:10px;">ログイン</button>
          </form>
        </body>
        </html>
      `,
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }
    if (url.pathname === "/authorize" && request.method === "POST") {
      const formData = await request.formData();
      const username = formData.get("username");
      const password = formData.get("password");
      const encodedReqInfo = formData.get("oauthReqInfo");
      if (username !== env.AUTH_USERNAME || password !== env.AUTH_PASSWORD) {
        return new Response("ID または パスワードが違います", { status: 401 });
      }
      const oauthReqInfo = JSON.parse(atob(encodedReqInfo));
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        userId: "hanoi",
        metadata: { label: "hanoi" },
        scope: oauthReqInfo.scope,
        props: { userId: "hanoi" }
      });
      return Response.redirect(redirectTo, 302);
    }
    return new Response("dev-project-mgmt worker 起動中", { status: 200 });
  }
};

// ============================================================
// OAuthProvider（MCPエンドポイントを /mcp にマウント）
// ============================================================
export default new OAuthProvider({
  apiHandlers: {
    "/mcp": ProjectMgmtMCP.serve("/mcp", { binding: "MCP_OBJECT" })
  },
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register"
});
