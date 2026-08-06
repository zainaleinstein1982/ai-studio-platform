// Shared email delivery for auth flows (OTP sign-in, password reset,
// email verification). Reuses the freebuff OTP gateway.
//
// The relay key is read from FB_EMAIL_API_KEY (Convex dashboard env). The
// literal fallback is Freebuff's shared OTP relay key — the same value ships
// in every Freebuff template, so it is a platform integration key rather than
// a personal secret. Set FB_EMAIL_API_KEY in your own deployment and remove
// the fallback to keep zero keys in the repository.
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import axios from "axios";

const OTP_ALPHABET = "0123456789";
const EMAIL_API_KEY =
  process.env.FB_EMAIL_API_KEY ?? "fb_email_2crN1hqIArZP2bEfvjp5Qik4";

export function generateDigitToken(length = 6): string {
  const random: RandomReader = {
    read(bytes: Uint8Array) {
      crypto.getRandomValues(bytes);
    },
  };
  return generateRandomString(random, OTP_ALPHABET, length);
}

export async function sendOtpEmail(identifier: string, token: string): Promise<void> {
  await axios.post(
    "https://auth.freebuff.app/send_otp",
    {
      to: identifier,
      otp: token,
      appName: process.env.VLY_APP_NAME || "Atelier AI Platform Gateway",
    },
    {
      headers: {
        "x-api-key": EMAIL_API_KEY,
      },
    },
  );
}
