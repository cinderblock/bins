/**
 * Generate a VAPID keypair for web-push notifications.
 *
 *   bun scripts/generate-vapid.ts
 *
 * Run ONCE per deployment and keep the output in the environment. Rotating
 * the keypair invalidates every existing subscription — browsers bind a
 * subscription to the key that created it — so every admin would have to turn
 * notifications back on. The server drops the dead rows as the push services
 * reject them, so a rotation is survivable, just annoying.
 *
 * The private key is a credential: it is what proves to a push service that a
 * notification really came from this deployment. Treat it like the admin
 * password.
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`# Add to your environment (see .env.example):
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
# A contact the push service can reach about this deployment (RFC 8292).
VAPID_SUBJECT=mailto:you@example.org`);
