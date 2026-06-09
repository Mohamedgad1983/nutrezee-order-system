# Module Analysis: Settings, Content, And Notifications

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Priority: P0 for critical business settings; P1/P2 for content and marketing modules

## Old Dashboard Evidence

| Screen / Route | Evidence Used |
| --- | --- |
| `/settings` | General/contact/checkout settings with social fields, WhatsApp, checkout gap, full capacity date, save action. |
| `/about_us` | About Us content form. |
| `/why_us` | Why Us content form. |
| `/terms` | Terms content form. |
| `/return-policy` | Return policy form. |
| `/gallery` | Common gallery/media list. |
| `/userVideoCategory` | Video category management. |
| `/userVideo/list` | User video list. |
| `/tutorialvideolist` | Tutorial video list. |
| `/advertise` | Advertisement/offer list. |
| `/socialmedia` | Social media links. |
| `/subscribers` | Subscriber list. |
| `/pushnotification` | Push notification list. |
| `/addpushnotification` | Push notification send form. |

## Current Purpose

The existing dashboard supports global settings, static content, legal/policy content, media/video content, ads/offers, social links, subscribers, and push notifications. Critical settings such as WhatsApp contact, checkout gap, and full-capacity date affect operations; content and marketing modules are useful but lower priority than order/kitchen/delivery foundations.

## Current Workflow

1. Admin can edit settings/content forms.
2. Admin can manage gallery/video/social/ad/subscriber/notification records through lists and forms.
3. Push notification send form can target users and send a production notification.
4. No approval, preview, versioning, or audit was confirmed.

## Data Shown Or Needed

- Existing: WhatsApp/contact settings, checkout days gap, full capacity date, static descriptions/images, legal/policy text, media, videos, social links, subscribers, notification title/message/send date.
- Needed: setting ownership, validation, version history, effective dates, previews, publishing status, notification templates, audience rules, approval status, delivery history, consent and unsubscribe rules.

## Visible Actions

- Save settings.
- Update/save static/legal content.
- Gallery/video/social/ad row operations.
- Push notification add/send and delete.
- Subscriber operation actions.

No save, update, send, delete, upload, operation, or subscriber action was clicked.

## State-Change Risks

- Settings changes can affect checkout availability, capacity, WhatsApp contact, and customer experience.
- Push notifications can send customer-visible messages.
- Legal/policy changes require versioning and effective dates.
- Content/media updates can affect public-facing app/site.
- Subscriber exports/actions can affect consent/privacy.

## Current Pain Points

- Settings are broad and not visibly audited.
- Notifications need templates, approvals, and delivery history.
- Customer communication channel needs confirmation.
- Content modules exist but should not distract from P0 operational workflows.
- Legal/return policy content is not visibly versioned.

## Preserve Decisions

- Preserve business settings, content pages, legal/policy pages, gallery/media, videos, social links, subscribers, advertisements/offers, and push notification history.
- Preserve WhatsApp settings as evidence of WhatsApp channel use.

## Improve Decisions

- Improve settings with scoped sections, validation, permissions, and audit.
- Improve legal/policy content with versioning and effective dates.
- Improve media/content with preview and publish status.
- Improve notifications with templates, audience preview, approval, and delivery history.
- Improve subscribers with consent/source tracking.

## Replace Decisions

- Replace direct production send notification workflow with approval-based notification center.
- Replace broad settings save with domain-specific settings workflows.
- Replace unversioned legal content updates with controlled policy publishing.

## Add Decisions

- Add notification templates for order confirmation, missing data, payment problem, kitchen exception, packing readiness, dispatch issue, delivery status, and renewal.
- Add role-scoped internal notifications.
- Add customer notification consent and channel rules.
- Add content versioning and publish workflow.
- Add settings audit events.

## Automation And AI Opportunities

- Suggest notification templates from approved operations language.
- Detect missing required fields before sending notifications.
- Warn when settings changes affect checkout capacity or active orders.
- Summarize content changes between versions.
- Segment subscribers/customers only under approved consent rules.

## Required New System Capabilities

- Business settings by domain.
- Capacity and checkout rule settings.
- WhatsApp/contact/channel settings.
- Content/media management.
- Legal/policy versioning.
- Promotion/advertisement scheduling.
- Subscriber/consent management.
- Notification templates and send workflow.
- Approval and audit for settings/notifications/content.

## Required Data Entities And Fields

- `Setting`: key, value, domain, environment, active version, updated by.
- `CapacityRule`: date, capacity status, reason, owner.
- `ContentPage`: type, language, content, media, status, version, effective date.
- `MediaAsset`: file reference, type, usage, metadata, status.
- `PromotionContent`: placement, language, media, start/end date, sort order, status.
- `Subscriber`: contact, status, consent source, opt-in/out timestamp.
- `NotificationTemplate`: channel, audience, title, body, variables, approval status.
- `NotificationSend`: template/message, audience, status, sent by, sent at, delivery summary.

## Required APIs High Level Only

- Settings API.
- Capacity/checkout rules API.
- Content page API.
- Media API.
- Promotion API.
- Subscriber/consent API.
- Notification template API.
- Notification send/preview API.
- Delivery history API.
- Settings/content/notification audit API.

## Role And Permission Needs

- System admin manages critical settings.
- Operations manages capacity/checkout operational settings.
- Marketing/content manages static pages, media, promotions, subscribers, and notifications.
- Management approves high-risk notifications or policy changes if required.
- Legal/management approves terms/return policy if required.
- Customer service can view notification history relevant to a customer/order.
- Notification send, settings save, legal publish, and export actions require audit.

## Reports And KPIs

- Settings changes by domain and actor.
- Capacity blocked dates and reasons.
- Notification sends by template, channel, audience, success/failure.
- Subscriber counts and consent status.
- Content versions and publish status.
- Promotion active/upcoming/expired list.
- Customer communication failures.

## Open Questions For Nutrezee

1. Which settings are operationally critical for day one?
2. Who can change checkout gap, full capacity dates, and WhatsApp contact settings?
3. Which customer notification channels are allowed?
4. Who approves production push notifications?
5. Are legal/policy versions and customer acceptance tracking required?
6. Which content/video modules are still used?
7. What subscriber consent rules are required?
8. Are advertisements/offers linked to packages, coupons, or customer segments?

## Assumptions Marked

- Notification templates and approval workflow are proposed improvements; old admin confirmed send/list surfaces only.
- Customer communication channels are not confirmed beyond old-admin push notification and WhatsApp setting evidence.
- Content/versioning needs are proposed improvements, not confirmed old-admin behavior.

## Recommended Build Order

1. Critical business settings with validation and audit.
2. Notification templates for internal operational events.
3. Customer notification channel/consent rules.
4. Legal/policy versioning.
5. Media/content and promotion management.
6. Subscriber and marketing workflows.
