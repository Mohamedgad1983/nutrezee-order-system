// Contract types are mirrored from 11_API_Design/module_api_contracts.md from WP-01
// onward. The markdown contract document is the single source of truth; if code and
// document diverge, log an amendment and fix the types.

export interface HealthStatus {
  status: 'ok';
  service: string;
}
