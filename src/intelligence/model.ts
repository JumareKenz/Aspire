/**
 * Language-model availability.
 *
 * Two conditions, both required:
 *
 * 1. A gateway credential is present.
 * 2. `ASPIRE_AI_ENABLED` is explicitly `true`.
 *
 * The second exists because sending DHIS2-derived material to an external
 * service is a decision for the operator, not a default that switches itself on
 * when a key happens to be in the environment. With the model unavailable the
 * platform still answers every question — by rules and templates — so this is a
 * quality setting, not a functionality switch.
 */
export const MODEL_ID = 'anthropic/claude-sonnet-5';

export function isModelEnabled(): boolean {
  const authorised = process.env.ASPIRE_AI_ENABLED === 'true';
  const credentialled = Boolean(process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN);
  return authorised && credentialled;
}

export function modelStatus(): { enabled: boolean; reason: string } {
  if (process.env.ASPIRE_AI_ENABLED !== 'true') {
    return {
      enabled: false,
      reason:
        'Language-model assistance is switched off. Questions are answered by the platform’s own analytical engine, which produces the same figures.',
    };
  }
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return {
      enabled: false,
      reason:
        'Language-model assistance is enabled but no gateway credential is configured, so answers are being written by the platform’s own templates.',
    };
  }
  return { enabled: true, reason: `Explanations are phrased by ${MODEL_ID} from figures the platform computed.` };
}
