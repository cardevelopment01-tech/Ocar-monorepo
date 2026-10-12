#!/usr/bin/env python3
"""Backend smoke test for the API deploy (.github/workflows/deploy.yml).

Runs against the IDLE color through the ALB (Host + X-Deploy-Preview headers) before traffic
is flipped. A failure rolls the idle color back with nothing user-facing changed. Every call is
harmless (reads, requests that must be rejected, or acknowledgements that change no state) and
asserts something specific about the release:

  health        db + redis reachable
  cities        public read path works end to end
  auth route    auth router + request validation loaded (rejected before any SMS)
  protected     auth middleware active on wallet / rides / admin routes
  PayU          the money routes exist: SDK signer + confirm (auth), return redirect, webhook ack

Usage: api_smoke.py <https://alb-dns> <host-header> [<preview-color>]
Exit 0 = all checks passed.
"""
import http.client
import json
import ssl
import sys
import time

CHECKS = [
    # name, method, path, body, content-type, expected status, substring expected in body/headers
    ("health", "GET", "/health", None, None, 200, ['"status":"ok"', '"db":"ok"', '"redis":"ok"']),
    ("cities", "GET", "/api/v1/geo/cities", None, None, 200, ['"slug"']),
    ("auth validation", "POST", "/api/v1/auth/otp/request", "{}", "application/json", 422, ["VALIDATION_ERROR"]),
    ("wallet requires auth", "GET", "/api/v1/payments/wallet/driver", None, None, 401, ["AUTH_UNAUTHORIZED"]),
    ("rides requires auth", "GET", "/api/v1/rides/active", None, None, 401, ["AUTH_UNAUTHORIZED"]),
    ("admin requires auth", "GET", "/api/v1/admin/drivers", None, None, 401, ["AUTH_UNAUTHORIZED"]),
    ("PayU sdk-hash route", "POST", "/api/v1/payments/payu/sdk-hash", "{}", "application/json", 401, ["AUTH_UNAUTHORIZED"]),
    ("PayU confirm route", "POST", "/api/v1/payments/payu/confirm", "{}", "application/json", 401, ["AUTH_UNAUTHORIZED"]),
    ("PayU return redirects", "POST", "/api/v1/payments/payu/return", "txnid=smoke", "application/x-www-form-urlencoded", 303, ["location:"]),
    ("PayU webhook acks", "POST", "/api/v1/payments/webhook/payu", "{}", "application/json", 200, ['"status":"ok"']),
]


def call(conn_args, host, color, method, path, body, ctype):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # same as the previous `curl -k`: the ALB is addressed by DNS name
    conn = http.client.HTTPSConnection(conn_args, timeout=8, context=ctx)
    headers = {"Host": host}
    if color:
        headers["X-Deploy-Preview"] = color
    if ctype:
        headers["Content-Type"] = ctype
    conn.request(method, path, body=body, headers=headers)
    r = conn.getresponse()
    data = r.read().decode("utf-8", "ignore")
    head = "".join(f"{k.lower()}: {v}\n" for k, v in r.getheaders())
    conn.close()
    return r.status, data.replace(" ", ""), head.lower()


def run_once(alb, host, color):
    failures = []
    for name, method, path, body, ctype, status, needles in CHECKS:
        try:
            got, data, head = call(alb, host, color, method, path, body, ctype)
        except Exception as e:  # noqa: BLE001
            failures.append(f"{name}: {e}")
            continue
        if got != status:
            failures.append(f"{name}: expected HTTP {status}, got {got}")
            continue
        haystack = data + "\n" + head
        missing = [n for n in needles if n.replace(" ", "").lower() not in haystack.lower()]
        if missing:
            failures.append(f"{name}: response lacks {missing}")
    return failures


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    alb, host = argv[1].replace("https://", "").rstrip("/"), argv[2]
    color = argv[3] if len(argv) > 3 else ""
    failures = []
    for attempt in range(1, 4):  # a freshly booted instance can take a moment
        failures = run_once(alb, host, color)
        if not failures:
            print(f"smoke test passed ({len(CHECKS)} checks, attempt {attempt})")
            return 0
        print(f"attempt {attempt}: " + "; ".join(failures))
        if attempt < 3:
            time.sleep(5)
    print(json.dumps({"smoke_failures": failures}))
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
