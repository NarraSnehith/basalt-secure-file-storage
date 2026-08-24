# A free permanent subdomain

`is-a.dev` hands out subdomains for free, forever, by pull request. This is the
only genuinely free *and* permanent custom domain left — Freenom, the one people
remember, stopped issuing them.

It needs a host that serves custom domains. Render's free plan does; Koyeb's does
not, so pair this with Render.

## What to submit

1. Fork <https://github.com/is-a-dev/register>
2. Add `domains/basalt.json` — replacing the target with your host's:

```json
{
  "owner": {
    "username": "NarraSnehith",
    "email": "you@example.com"
  },
  "records": {
    "CNAME": "basalt-q5h1.onrender.com"
  }
}
```

3. Open a pull request. Once merged, `basalt.is-a.dev` resolves to your app.

## Then, on the host

1. Add `basalt.is-a.dev` as a custom domain (Render: Settings → Custom Domains).
   TLS is issued automatically.
2. Set `WEB_ORIGIN=https://basalt.is-a.dev`.

That last step matters: `WEB_ORIGIN` is the CORS allowlist, the cookie scope and
the host written into every share and upload link. The app infers it from the
platform's own hostname, so once you put your own domain in front you have to say
so explicitly — otherwise the links you send people will point at the
`onrender.com` address.

## Alternatives

- `js.org` — same model, for JavaScript projects, via pull request.
- `eu.org` — free, permanent, but the application is reviewed by a human and can
  take weeks.
- Your host's own subdomain is already permanent and free, and needs none of
  this.
