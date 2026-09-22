// Thin, cached, same-origin proxy in front of the Apps Script /exec
// endpoint. The TV boards and both manager dashboards call THIS
// (/.netlify/functions/board-data) instead of talking to
// script.google.com directly.
//
// WHY THIS EXISTS: every Apps Script web app response is actually served
// through a second redirect, from script.google.com to
// script.googleusercontent.com, carrying a short-lived one-time token.
// Browsers — Safari in particular, via background-tab throttling and
// Intelligent Tracking Prevention — can delay following that second
// redirect just long enough for the token to expire, which comes back as
// a 404 HTML page instead of JSON. That's the confirmed cause of the
// "Could not reach the Apps Script data endpoint" / JSON SyntaxError that
// was popping up on the TVs and dashboards.
//
// A server has no such throttling, so this function follows that redirect
// itself, on Node, every time — removing the flaky part entirely instead
// of just retrying around it. It also caches briefly, so a burst of
// several TVs (or the Overview page's 6 iframes) polling at once only
// costs ONE real Apps Script call instead of one per screen.
//
// Requires Node 18+ (for global fetch/AbortController/URLSearchParams) —
// see the netlify.toml alongside this file.

var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxam4BfUlwb6ugCosvQ4BHKsTwklUcTo-z1D6UL67iEBu7jelq6fF4jOv6ZouSd_sJG4g/exec';

// Must stay comfortably under the clients' own poll intervals (30s for the
// TVs, 15s for the dashboards) so a normal poll cycle nearly always finds a
// warm cache entry instead of forcing a fresh upstream call.
var CACHE_MS = 12000;

// Module-level, so it's shared across requests that land on the same warm
// function instance. Wiped on a cold start — that's fine, it just means the
// next request after a cold start does one real upstream fetch, same as
// today's behavior for everyone.
var cache = {};

function cacheKeyFor(params) {
  var entries = [];
  params.forEach(function (value, key) {
    if (key === '_') return; // the client's own cache-buster isn't part of the request's identity
    entries.push(key + '=' + value);
  });
  entries.sort();
  return entries.join('&');
}

async function fetchUpstreamOnce(url) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 8000);
  try {
    var res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    var text = await res.text();
    JSON.parse(text); // throws if we somehow still got an HTML error page
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUpstream(url) {
  try {
    return await fetchUpstreamOnce(url);
  } catch (err) {
    // One immediate server-side retry. This is the same mitigation as the
    // client-side quick-retry, just running somewhere that isn't subject to
    // Safari's redirect-timing quirk in the first place — so this should
    // rarely even need to fire, and almost never fail twice in a row.
    return fetchUpstreamOnce(url);
  }
}

function respond(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: body
  };
}

exports.handler = async function (event) {
  var qs = event.queryStringParameters || {};
  var params = new URLSearchParams();
  Object.keys(qs).forEach(function (k) {
    if (k === '_') return; // the client's own cache-buster — pointless once we have our own cache, and dropping it keeps identical requests looking identical to Apps Script's own layer too
    if (qs[k] !== undefined && qs[k] !== null) params.set(k, qs[k]);
  });

  var upstreamUrl = APPS_SCRIPT_URL + '?' + params.toString();
  var isWrite = params.get('action') === 'setFlag';
  var key = cacheKeyFor(params);
  var now = Date.now();

  if (!isWrite) {
    var hit = cache[key];
    if (hit && hit.expiresAt > now) {
      return respond(200, hit.body);
    }
  }

  var body;
  try {
    body = await fetchUpstream(upstreamUrl);
  } catch (err) {
    return respond(
      502,
      JSON.stringify({ error: 'Upstream Apps Script call failed: ' + (err && err.message ? err.message : String(err)) })
    );
  }

  if (isWrite) {
    // A state change just happened (a dashboard button click) — nothing
    // cached should keep serving pre-change data for any board.
    cache = {};
  } else {
    cache[key] = { body: body, expiresAt: now + CACHE_MS };
  }

  return respond(200, body);
};
