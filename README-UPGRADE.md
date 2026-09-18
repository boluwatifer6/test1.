# VERCELIX — Netlify Pro Upgrade

## What changed in this upgrade
1. **Working contact form (Netlify Forms)** — the "Start a project" form now actually delivers submissions to your Netlify dashboard. Pro includes **1,000 submissions/month** (free = 100). Honeypot spam protection is enabled out of the box.
2. **AJAX inline success** — visitors see a success state without leaving the page (the `/thank-you.html` fallback still exists for no-JS).
3. **New sections** — testimonials, pricing packages, and FAQ were added. These are proven conversion boosters for freelance studios.
4. **Fresh design system** — dark premium theme, custom cursor, magnetic buttons, scroll-reveal animations, animated stat counters, marquee, and mobile menu.
5. **SEO kit** — meta description, Open Graph/Twitter tags, JSON-LD structured data, `sitemap.xml`, and `robots.txt`.
6. **404 page** — branded instead of Netlify's default.
7. **Security + cache headers** — `netlify.toml` ships X-Frame-Options, nosniff, Referrer-Policy, and asset caching.

## Deploy
Replace your repo's files with these, then push. Netlify redeploys automatically.
(No build step needed — it's a static site. `netlify.toml` already sets `publish = "."`.)

## After deploying — 2-minute checklist
- [ ] **Forms → Notifications**: Netlify dashboard → *Forms* → enable email notifications so leads hit your inbox.
- [ ] **Verify the form**: submit a test, confirm it shows in *Forms*.
- [ ] **Swap placeholders**: prices in `#pricing`, testimonials, stats in the hero, email `hello@vercelix.studio`, social links in the footer.
- [ ] **sitemap.xml + OG url**: update if you connect a custom domain.

## Optional: reCAPTCHA 2 (Pro feature)
To block spam harder than the honeypot:
1. Get a reCAPTCHA v2 (checkbox) site + secret key at google.com/recaptcha.
2. Netlify dashboard → *Site settings → Forms* → add the keys.
3. In `index.html`, add `data-netlify-recaptcha="true"` to the `<form>` tag and drop `<div data-netlify-recaptcha="true"></div>` above the submit button.

## Other Pro perks you can now use
- **Split testing**: Site settings → Split testing — send traffic to a variant branch.
- **Branch deploys**: push any branch → get a preview URL to share with clients.
- **Password-protected previews**: gate staging branches (Site settings → Access control).
- **Netlify Analytics**: privacy-friendly, no cookies, works without JS.

---

## WebGL hero (round 2 — applied from iart-ai/webgl-animation-skills)

The hero now renders a real-time Three.js scene: a domain-warped fbm aurora
shader + an interactive constellation particle network, in the brand's
lime/violet palette.

- `webgl.js` — the whole scene (ES module). Three.js loads from the jsDelivr CDN
  via the importmap in `index.html` (pinned to `three@0.160.0`).
- **Fallbacks:** no WebGL / CDN blocked → the CSS gradient hero stays
  (`.hero.no-webgl`). `prefers-reduced-motion` → one static frame, no loop.
- **Performance:** DPR capped at 2, render loop pauses when the hero scrolls
  out of view or the tab hides, `dt` clamped to 1/30, connections found with a
  spatial grid (not O(n²)), segment cap of 700.
- **Interactions:** mouse repels nearby nodes; camera parallax is damped;
  scrolling zooms/fades the shader and sinks the constellation.
- **Tuning knobs (top of `webgl.js`):** `N` node count, `LINK` connection
  radius, aurora speed `t = u_time * 0.05` in `BG_FRAG`, colors `LIME`/`violet`.
- **Debug:** append `?t=4` to the URL to freeze a deterministic frame
  (seeded RNG — same number, same pixels) for screenshot review.
