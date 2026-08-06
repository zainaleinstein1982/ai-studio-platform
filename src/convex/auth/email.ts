// Shared email delivery for auth flows (OTP sign-in, password reset,
// email verification). Reuses the freebuff OTP gateway.
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import axios from "axios";

const OTP_ALPHABET = "0123456789";

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
        "x-api-key": "fb_email_2crN1hqIArZP2bEfvjp5Qik4",
      },
    },
  );
}
