// Auth.js-style email provider for the Password provider's reset flow.
// Sends 6-digit codes through the shared freebuff OTP gateway.
import { Email } from "@convex-dev/auth/providers/Email";
import { generateDigitToken, sendOtpEmail } from "./email";

export const passwordResetEmail = Email({
  id: "password-reset",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return generateDigitToken(6);
  },
  async sendVerificationRequest({ identifier, token }) {
    await sendOtpEmail(identifier, token);
  },
});
