// deploy trigger
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