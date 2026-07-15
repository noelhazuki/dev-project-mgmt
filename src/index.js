import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

// ▼ ログイン画面まわり（認証されてないリクエストはここに来る）
const defaultHandler = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/authorize" && request.method === "GET") {
      const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const encodedReqInfo = btoa(JSON.stringify(oauthReqInfo));

      return new Response(`
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
      `, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/authorize" && request.method === "POST") {
      const formData = await request.formData();
      const username = formData.get("username");
      const password = formData.get("password");
      const encodedReqInfo = formData.get("oauthReqInfo");

      if (username !== env.AUTH_USERNAME || password !== env.AUTH_PASSWORD) {
        return new Response("ID またはパスワードが違います", { status: 401 });
      }

      const oauthReqInfo = JSON.parse(atob(encodedReqInfo));

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        userId: "hanoi",
        metadata: { label: "hanoi" },
        scope: oauthReqInfo.scope,
        props: { userId: "hanoi" },
      });

      return Response.redirect(redirectTo, 302);
    }

    return new Response("dev-project-mgmt worker 起動中", { status: 200 });
  },
};
// ▲ ログイン画面まわり

// ▼ 認証済みAPIリクエストの処理（spec/project_state/ideasツールはこの中に今後追加していく）
const apiHandler = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/whoami") {
      return new Response(JSON.stringify({ userId: ctx.props.userId }), {
        headers: { "Content-Type": "application/json" },
      });
    }
// ▼ spec関連ツール（list_spec_sections / read_spec_section / write_spec_section）
    const jsonResponse = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    const getSpec = async (project) => {
      const raw = await env.PROJECT_MGMT_KV.get(`spec:${project}`);
      return raw ? JSON.parse(raw) : null;
    };

    const putSpec = async (project, specObj) => {
      await env.PROJECT_MGMT_KV.put(`spec:${project}`, JSON.stringify(specObj));
    };

    if (url.pathname === "/api/spec/sections" && request.method === "GET") {
      const project = url.searchParams.get("project");
      if (!project) return jsonResponse({ error: "project is required" }, 400);

      const spec = await getSpec(project);
      if (!spec) return jsonResponse({ error: "spec not found for this project" }, 404);

      return jsonResponse({ project, sections: Object.keys(spec) });
    }

    if (url.pathname === "/api/spec/section" && request.method === "GET") {
      const project = url.searchParams.get("project");
      const key = url.searchParams.get("key");
      if (!project || !key) return jsonResponse({ error: "project and key are required" }, 400);

      const spec = await getSpec(project);
      if (!spec) return jsonResponse({ error: "spec not found for this project" }, 404);
      if (!(key in spec)) return jsonResponse({ error: "section not found" }, 404);

      return jsonResponse({ project, key, value: spec[key] });
    }

    if (url.pathname === "/api/spec/section" && request.method === "POST") {
      const project = url.searchParams.get("project");
      const key = url.searchParams.get("key");
      if (!project || !key) return jsonResponse({ error: "project and key are required" }, 400);

      let value;
      try {
        value = await request.json();
      } catch {
        return jsonResponse({ error: "invalid JSON body" }, 400);
      }

      const spec = (await getSpec(project)) || {};
      spec[key] = value;
      await putSpec(project, spec);

      return jsonResponse({ project, key, saved: true });
    }
    // ▲ spec関連ツール
    return new Response("Not found", { status: 404 });
  },
};
// ▲ 認証済みAPIリクエストの処理

export default new OAuthProvider({
  apiRoute: "/api/",
  apiHandler,
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
