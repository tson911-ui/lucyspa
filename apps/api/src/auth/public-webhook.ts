import { SetMetadata } from '@nestjs/common';

export const PUBLIC_WEBHOOK = 'lucy:public-webhook';

/**
 * Marks ONE controller route as a server-to-server provider webhook (design 16.4). It is the only way past the
 * global CSRF/Origin/session guard, it is declared on the handler (never a path pattern or a relaxed guard),
 * and the handler must verify the provider signature before it changes any state. Never use it on a route a
 * browser or a signed-in user calls.
 */
export const PublicWebhook = () => SetMetadata(PUBLIC_WEBHOOK, true);
