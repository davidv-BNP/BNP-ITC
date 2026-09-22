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
// IMPORTANT: Node's built-in fetch(url, {redirect:'follow'}) does NOT carry
// a Set-Cookie from hop 1 into hop 2 the way a real browser does — there's
// no cookie jar. When Google's first response sets a cookie the second hop
// checks for, a plain automatic-follow request can 404 on that second hop
// every single time it's called from a server, even though the exact same
// URL usually succeeds in a browser. That's why this function follows the
// redirect chain MANUALLY below: it reads the Location + any Set-Cookie
// off each hop's response and explicitly resends that cookie on the next
// request, instead of trusting fetch's automatic redirect handling.
//
// It also caches briefly, so a burst of several TVs (or the Overview
// page's 6 iframes) polling at once only costs ONE real Apps Script call
// instead of one per screen.
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

var MAX_REDIRECTS = 5;

async function fetchUpstreamOnce(url) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 8000);
  try {
    var currentUrl = url;
    var cookieHeader = '';

    for (var hop = 0; hop < MAX_REDIRECTS; hop++) {
      var res = await fetch(currentUrl, {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: cookieHeader ? { Cookie: cookieHeader } : {}
      });

      // Carry forward any cookie this hop sets — this is the piece plain
      // fetch(..., {redirect:'follow'}) drops (see the comment up top).
      var setCookie = (typeof res.headers.getSetCookie === 'function')
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
      if (setCookie && setCookie.length) {
        var newPairs = setCookie.map(function (c) { return c.split(';')[0]; });
        cookieHeader = (cookieHeader ? cookieHeader + '; ' : '') + newPairs.join('; ');
      }

      if (res.status >= 300 && res.status < 400) {
        var loc = res.headers.get('location');
        if (!loc) throw new Error('Redirect response (status ' + res.status + ') had no Location header');
        currentUrl = new URL(loc, currentUrl).toString();
        continue; // follow it ourselves, cookie in hand
      }

      var text = await res.text();
      if (res.status !== 200) {
        throw new Error('Upstream returned HTTP ' + res.status + (text ? ': ' + text.slice(0, 200) : ''));
      }
      JSON.parse(text); // throws if we somehow still got an HTML error page
      return text;
    }

    throw new Error('Too many redirects (' + MAX_REDIRECTS + ') following the Apps Script response');
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
