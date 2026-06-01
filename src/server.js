import "dotenv/config";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import * as z from "zod/v4";
import { exchangeCodeForTokens, getProfile, listVideos } from "./tiktok.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const OAUTH_STATES = new Set();

function jsonText(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function createServer() {
  const server = new McpServer({
    name: "tiktok-manager-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "tiktok_get_profile",
    {
      title: "Get TikTok profile",
      description: "Fetch the connected TikTok account profile and public stats.",
      inputSchema: {},
    },
    async () => jsonText(await getProfile()),
  );

  server.registerTool(
    "tiktok_list_recent_videos",
    {
      title: "List recent TikTok videos",
      description: "Fetch recent videos for the connected TikTok account with engagement stats.",
      inputSchema: {
        cursor: z.number().optional().describe("Pagination cursor returned by TikTok. Use 0 for the first page."),
        max_count: z.number().min(1).max(20).optional().describe("Number of videos to return. Maximum 20."),
      },
    },
    async ({ cursor = 0, max_count = 10 }) => jsonText(await listVideos({ cursor, max_count })),
  );

  server.registerTool(
    "tiktok_account_snapshot",
    {
      title: "TikTok account snapshot",
      description: "Fetch profile data plus recent videos so the GPT can analyze content performance.",
      inputSchema: {
        max_count: z.number().min(1).max(20).optional().describe("Number of recent videos to include."),
      },
    },
    async ({ max_count = 10 }) => {
      const [profile, videos] = await Promise.all([
        getProfile(),
        listVideos({ cursor: 0, max_count }),
      ]);

      return jsonText({ profile, videos });
    },
  );

  return server;
}

const app = createMcpExpressApp({ host: HOST });

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "tiktok-manager-mcp" });
});

app.get("/oauth/start", (req, res) => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!clientKey || !redirectUri) {
    res.status(500).send("Missing TIKTOK_CLIENT_KEY or TIKTOK_REDIRECT_URI in .env.");
    return;
  }

  const state = crypto.randomBytes(24).toString("hex");
  OAUTH_STATES.add(state);

  const scopes = process.env.TIKTOK_SCOPES || "user.info.basic";
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);

  res.redirect(url.toString());
});

app.get("/oauth/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    res.status(400).send(`TikTok OAuth error: ${error_description || error}`);
    return;
  }

  if (!code || !state || !OAUTH_STATES.has(String(state))) {
    res.status(400).send("Invalid OAuth callback. Start again from /oauth/start.");
    return;
  }

  OAUTH_STATES.delete(String(state));

  try {
    await exchangeCodeForTokens(String(code));
    res.send("TikTok connected. You can close this tab and connect /mcp in ChatGPT.");
  } catch (exchangeError) {
    res.status(500).send(exchangeError.message);
  }
});

app.post("/mcp", async (req, res) => {
  const server = createServer();

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Use POST /mcp for Streamable HTTP.",
    },
    id: null,
  });
});

const httpServer = app.listen(PORT, HOST, (error) => {
  if (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }

  console.log(`TikTok MCP server listening at http://${HOST}:${PORT}`);
  console.log(`OAuth start: http://${HOST}:${PORT}/oauth/start`);
  console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
});

process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
