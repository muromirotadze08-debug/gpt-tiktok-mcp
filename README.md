# TikTok MCP Server for ChatGPT

This is a small personal MCP server that lets a custom GPT read TikTok profile data and recent video performance through TikTok's official API.

## What it exposes

- `tiktok_get_profile` - connected TikTok profile and account stats.
- `tiktok_list_recent_videos` - recent videos with engagement fields.
- `tiktok_account_snapshot` - profile plus recent videos for analysis.

## Setup

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Fill `.env` with values from TikTok Developers:

   ```text
   TIKTOK_CLIENT_KEY=...
   TIKTOK_CLIENT_SECRET=...
   TIKTOK_REDIRECT_URI=http://127.0.0.1:3000/oauth/callback
   ```

3. In TikTok Developers, add the same redirect URI:

   ```text
   http://127.0.0.1:3000/oauth/callback
   ```

4. Start the server:

   ```bash
   npm start
   ```

5. Open this URL once to connect your TikTok account:

   ```text
   http://127.0.0.1:3000/oauth/start
   ```

6. After TikTok redirects back successfully, tokens are stored in:

   ```text
   data/tiktok_tokens.json
   ```

## Connect to ChatGPT

ChatGPT needs a public HTTPS URL for a remote MCP server. Localhost will not work from ChatGPT.

Deploy this folder to a Node host such as Render, Railway, Fly.io, or another HTTPS hosting service. Set the same environment variables in the host, then connect this endpoint in ChatGPT:

```text
https://your-domain.example/mcp
```

In ChatGPT:

```text
Settings -> Connectors -> Advanced -> Developer mode -> Add MCP server
```

Use the public `/mcp` URL.

## Important

- Do not paste `TIKTOK_CLIENT_SECRET` into chat.
- Do not commit `.env` or `data/tiktok_tokens.json`.
- The TikTok app must have the scopes listed in `TIKTOK_SCOPES`.
- If TikTok rejects a scope, remove it from `.env` or request access for that scope in TikTok Developers.
