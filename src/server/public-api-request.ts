import "server-only";

const JSON_CONTENT_TYPE = "application/json";
const MAX_JSON_BYTES = 32 * 1024;

type PublicApiRequestErrorCode =
  | "CROSS_SITE_REQUEST"
  | "INVALID_CONTENT_TYPE"
  | "INVALID_JSON"
  | "PAYLOAD_TOO_LARGE";

type PublicApiRequestResult =
  | { ok: true; body: unknown }
  | { ok: false; response: Response };

const ERROR_MESSAGES: Record<PublicApiRequestErrorCode, string> = {
  CROSS_SITE_REQUEST: "허용되지 않은 출처의 요청입니다.",
  INVALID_CONTENT_TYPE: "JSON 형식의 요청만 사용할 수 있습니다.",
  INVALID_JSON: "요청 내용을 JSON으로 확인하지 못했습니다.",
  PAYLOAD_TOO_LARGE: "요청 내용이 허용된 크기를 초과했습니다.",
};

function errorResponse(
  status: number,
  code: PublicApiRequestErrorCode,
): Response {
  return Response.json(
    { error: { code, message: ERROR_MESSAGES[code] } },
    {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function isCrossSite(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

function exceedsDeclaredLimit(request: Request): boolean {
  const value = request.headers.get("content-length");
  if (!value) return false;

  const contentLength = Number(value);
  return (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > MAX_JSON_BYTES
  );
}

async function readBodyWithinLimit(request: Request): Promise<string | null> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_JSON_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function readPublicApiJson(
  request: Request,
): Promise<PublicApiRequestResult> {
  if (isCrossSite(request)) {
    return {
      ok: false,
      response: errorResponse(403, "CROSS_SITE_REQUEST"),
    };
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType?.trim().toLowerCase() !== JSON_CONTENT_TYPE) {
    return {
      ok: false,
      response: errorResponse(415, "INVALID_CONTENT_TYPE"),
    };
  }

  if (exceedsDeclaredLimit(request)) {
    return {
      ok: false,
      response: errorResponse(413, "PAYLOAD_TOO_LARGE"),
    };
  }

  const rawBody = await readBodyWithinLimit(request);
  if (rawBody === null) {
    return {
      ok: false,
      response: errorResponse(413, "PAYLOAD_TOO_LARGE"),
    };
  }

  try {
    return { ok: true, body: JSON.parse(rawBody) as unknown };
  } catch {
    return {
      ok: false,
      response: errorResponse(400, "INVALID_JSON"),
    };
  }
}
