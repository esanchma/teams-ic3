export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export async function httpRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {},
): Promise<HttpResponse> {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.headers,
    body: options.body,
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs || 30000),
  });

  return {
    status: response.status,
    headers: response.headers.toJSON(),
    body: await response.text(),
  };
}
