import fs from "node:fs/promises";
import path from "node:path";

const TIKTOK_API_BASE = "https://open.tiktokapis.com";
const TOKEN_FILE = path.join(process.cwd(), "data", "tiktok_tokens.json");

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env or your hosting environment.`);
  }
  return value;
}

async function readStoredTokens() {
  if (process.env.TIKTOK_ACCESS_TOKEN) {
    return {
      access_token: process.env.TIKTOK_ACCESS_TOKEN,
      refresh_token: process.env.TIKTOK_REFRESH_TOKEN,
      expires_at: Number(process.env.TIKTOK_ACCESS_TOKEN_EXPIRES_AT || 0),
    };
  }

  try {
    const raw = await fs.readFile(TOKEN_FILE, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function saveTokens(tokens) {
  const now = Math.floor(Date.now() / 1000);
  const normalized = {
    ...tokens,
    obtained_at: now,
    expires_at: tokens.expires_at || now + Number(tokens.expires_in || 0),
    refresh_expires_at: tokens.refresh_expires_at || now + Number(tokens.refresh_expires_in || 0),
  };

  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
  await fs.writeFile(TOKEN_FILE, JSON.stringify(normalized, null, 2));
  return normalized;
}

async function tokenRequest(body) {
  const response = await fetch(`${TIKTOK_API_BASE}/v2/oauth/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: new URLSearchParams(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`TikTok token request failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

export async function exchangeCodeForTokens(code) {
  return saveTokens(
    await tokenRequest({
      client_key: required("TIKTOK_CLIENT_KEY"),
      client_secret: required("TIKTOK_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
      redirect_uri: required("TIKTOK_REDIRECT_URI"),
    }),
  );
}

async function refreshTokens(tokens) {
  if (!tokens?.refresh_token) {
    throw new Error("TikTok refresh token is missing. Open /oauth/start and connect TikTok again.");
  }

  return saveTokens(
    await tokenRequest({
      client_key: required("TIKTOK_CLIENT_KEY"),
      client_secret: required("TIKTOK_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  );
}

export async function getAccessToken() {
  let tokens = await readStoredTokens();
  if (!tokens?.access_token) {
    throw new Error("TikTok is not connected yet. Open /oauth/start in this server first.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (tokens.expires_at && tokens.expires_at - now < 120) {
    tokens = await refreshTokens(tokens);
  }

  return tokens.access_token;
}

async function tiktokFetch(endpoint, { method = "GET", query, body } = {}) {
  const url = new URL(endpoint, TIKTOK_API_BASE);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`TikTok API failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

export async function getProfile() {
  const fields = process.env.TIKTOK_USER_FIELDS ||
    "open_id,union_id,avatar_url,display_name,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count";

  return tiktokFetch("/v2/user/info/", {
    query: { fields },
  });
}

export async function listVideos({ cursor = 0, max_count = 10 } = {}) {
  const fields = process.env.TIKTOK_VIDEO_FIELDS ||
    "id,title,video_description,duration,cover_image_url,share_url,embed_link,like_count,comment_count,share_count,view_count";

  return tiktokFetch("/v2/video/list/", {
    method: "POST",
    query: { fields },
    body: {
      cursor,
      max_count: Math.min(Math.max(Number(max_count) || 10, 1), 20),
    },
  });
}

