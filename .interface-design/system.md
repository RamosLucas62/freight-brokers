# Portal interface system — optional TMS integrations

This records the existing portal's reusable integration pattern, using the Rose Rocket card in `public/dashboard.js` and `public/dashboard.css` as the reference. It is not a redesign of the whole portal.

## Direction and feel

Calm, operational, and trustworthy for freight-broker owners and billing administrators. The person is setting up document intake and must see what works now versus what is merely verified or awaiting a pilot. Use the vocabulary of loads, carrier invoices, rate confirmations, proof of delivery, audit status, and evidence. An optional TMS connection must never interrupt account creation or the existing private-email intake.

## Foundation

- Reuse the portal's light surfaces and semantic tokens: `--paper #f7f8fa`, `--sheet #fff`, `--ink #1d2e40`, `--secondary #607080`, `--muted #8994a0`, `--line #e4e8ed`, `--blue #214fc1`, `--blue-soft #edf2ff`, `--amber #a26512`, `--amber-soft #fff5df`, `--green #267859`, `--green-soft #edf8f2`. Blue is for action and links; amber is pending/attention; green is active/confirmed. Never use color alone to convey status.
- Depth: the settings area uses white cards on the paper canvas, a quiet `--line` border and `--radius: 8px`; no extra elevation or decorative shadows on integration cards. Buttons and inputs use the existing 6px radius and focus outline. Do not introduce a separate palette, font, or shadow system for each vendor.
- Typography: portal body is 14px/1.5 system sans-serif. Existing page headings are 32px and 28px; settings-card titles are subordinate to them. Small, tracked 10px eyebrows label sections; the title and plain-language state lead the card; 11–12px metadata and links recede. Prefer weight and semantic text color over extra heading sizes. The working scale is roughly 10/12/14/18/28/32, with a ~1.25 step through the central sizes.
- Spacing: use a 4px base unit for new work, favoring 12px between related fields, 16px for form groups, and 24px between larger areas. Preserve the current integration card's deliberate 14px internal gap and 18px mobile padding when reusing it; do not silently mix new one-off gaps into the pattern. Density is moderate: enough room to review access details without making setup look like a marketing page.

## Navigation and hierarchy

- Place the optional connection in **Settings & billing**, at full width before the report-delivery and account cards (`.settings-grid`, `.integration-card`). The existing private intake remains available and is described as the working fallback.
- The first-login guide may point to the optional connection after required account/legal steps, but must not require it to complete onboarding.
- The focal sequence within the card is vendor name and status → what that status actually permits → available action → vendor setup help. Never display “connected” merely because credentials were accepted.

## Reusable connection card

- Reuse `.settings-card.integration-card`: full grid row; 24px padding and 14px content gap on desktop, 18px padding at widths ≤700px. Heading and action rows are horizontal with a 16px gap on desktop, stacked and left-aligned on mobile.
- Status badge `.integration-state`: minimum 28px tall, 4px 10px padding, 4px radius, 11px bold text and a dot. Neutral means not connected, amber means access verified/pilot pending, green means a pilot link was activated. Pair every badge with explicit explanatory copy.
- Disconnected and enabled: show a labeled native form for organization ID, service-account user ID, client ID, and masked client secret. Fields are two columns with 12px vertical/16px horizontal gaps on desktop, one column on mobile; form sections have 16px spacing. The primary action has at least 44px height and becomes full width on mobile. Never request the person's password or echo a secret after submission.
- Disabled rollout: explain that setup is unavailable and keep email intake usable. Unauthorized viewer: explain that only the owner or billing administrator can manage it; do not present a usable credential form. Submission feedback uses a live status region and buttons have a loading/disabled state.
- Verified/pending: display the organization identifier and verification time, plus a disconnect action, but say clearly that documents are **not** being read yet. Active: say the pilot link is enabled while distinguishing it from a fully configured worker/webhook and automatic audit. Disconnect clears the connection; audit history remains.
- Keep a clearly named external vendor setup link, not an implied one-click OAuth authorization flow. A true OAuth consent button may replace the service-account form only after that vendor flow is implemented and verified.

## Accessibility and rollout checks

- Use native `button`, `input`, `label`, and `a` elements. Preserve visible focus, keyboard operation, descriptive status text, and at least 44px primary touch targets. Check disconnected, pending, active, disabled, unauthorized, loading, and error states at desktop and mobile widths.
- The Rose Rocket connection is feature-flagged off by default. A saved visual pattern is not evidence of a live customer connection, enabled document synchronization, or a completed deployment.
