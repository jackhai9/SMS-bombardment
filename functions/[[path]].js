/**
 * Cloudflare Pages Function - 通用 CORS 代理服务
 * 支持两种调用方式：
 * 1. 路径形式: https://your-domain.com/https://example.com
 * 2. 参数形式: https://your-domain.com/?url=https://example.com
 */

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1) 预检永远优先处理
  if (request.method === "OPTIONS") {
    return handleCORS();
  }

  // 2) 先取目标 URL
  let targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    const candidate = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    if (candidate.startsWith("http")) {
      targetUrl = decodeURIComponent(candidate) + url.search;
    }
  }

  // 3) 只有在没有代理目标时，才把根路径等交回静态站点处理
  const isStaticAsset =
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname === "/logo.ico" ||
    pathname === "/logo.gif" ||
    pathname === "/_headers" ||
    pathname === "/wrangler.toml" ||
    pathname === "/wrangler.json";

  if (isStaticAsset && !targetUrl) {
    return context.next();
  }

  // 4) 仍然没有目标就交回 Pages
  if (!targetUrl) {
    return context.next();
  }

  try {
    const decodedUrl = targetUrl.startsWith("http")
      ? targetUrl
      : decodeURIComponent(targetUrl);

    const proxyHeaders = new Headers();
    const excludeHeaders = ["host", "origin", "referer", "cookie"];
    // const excludeHeaders = [];

    for (const [key, value] of request.headers) {
      const lowerKey = key.toLowerCase();
      if (!excludeHeaders.includes(lowerKey)) {
        proxyHeaders.set(key, value);
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let body;
    const method = request.method.toUpperCase();
    const hasBody = !["GET", "HEAD"].includes(method);

    if (hasBody) {
      body = await request.arrayBuffer();
    }

    try {
      const upstream = await fetch(decodedUrl, {
        method,
        headers: proxyHeaders,
        body,
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const responseHeaders = new Headers(upstream.headers);
      const corsHeaders = getCORSHeaders();
      for (const [k, v] of Object.entries(corsHeaders)) {
        responseHeaders.set(k, v);
      }

      responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
      responseHeaders.set("Pragma", "no-cache");
      responseHeaders.set("Expires", "0");

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError && fetchError.name === "AbortError") {
        return new Response("代理请求超时", {
          status: 504,
          headers: getCORSHeaders(),
        });
      }
      throw fetchError;
    }
  } catch (error) {
    return new Response(`代理请求失败: ${error.message}`, {
      status: 500,
      headers: getCORSHeaders(),
    });
  }
}

function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders(),
  });
}

function getCORSHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": "*",
  };
}

