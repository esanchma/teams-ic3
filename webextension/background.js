const NATIVE_HOST = "com.teams_ic3.host";
const RETRY_DELAY_MS = 30_000;

let lastAcceptedToken = null;
let inFlightToken = null;
let queuedToken = null;
let retryAfter = 0;

function isIc3Token(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload));
    return claims.aud === "https://ic3.teams.office.com";
  } catch {
    return false;
  }
}

function sendToken(token) {
  inFlightToken = token;
  chrome.runtime.sendNativeMessage(NATIVE_HOST, { ic3: token }, (response) => {
    const failed = chrome.runtime.lastError || !response?.ok;
    inFlightToken = null;

    if (failed) {
      retryAfter = Date.now() + RETRY_DELAY_MS;
      queuedToken = null;
      console.warn("[teams-ic3] Could not save the token. Check the native host; another attempt will be made when a new request is observed.");
      return;
    }

    lastAcceptedToken = token;
    retryAfter = 0;
    console.info("[teams-ic3] Token validated and saved by the native host.");
    if (queuedToken && queuedToken !== lastAcceptedToken) {
      const next = queuedToken;
      queuedToken = null;
      sendToken(next);
    } else {
      queuedToken = null;
    }
  });
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const header = details.requestHeaders?.find((item) => item.name.toLowerCase() === "authorization");
    const token = header?.value?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token || token === lastAcceptedToken || token === inFlightToken || !isIc3Token(token)) return;
    if (inFlightToken) queuedToken = token;
    else if (Date.now() >= retryAfter) sendToken(token);
  },
  { urls: ["https://teams.cloud.microsoft/api/chatsvc/*"] },
  ["requestHeaders"],
);

console.info("[teams-ic3] Extension active; waiting for Teams chat requests.");
