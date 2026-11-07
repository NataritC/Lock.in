// Generates a VAPID key pair for Web Push. Prints the two values to store as Worker secrets.
import { webcrypto as crypto } from "node:crypto";
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const b64u = b => Buffer.from(b).toString("base64url");
console.log(JSON.stringify({ VAPID_PUBLIC_KEY: b64u(raw), VAPID_PRIVATE_JWK: JSON.stringify(jwk) }, null, 2));
