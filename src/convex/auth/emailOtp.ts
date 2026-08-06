import { Email } from "@convex-dev/auth/providers/Email";
import { generateDigitToken, sendOtpEmail } from "./email";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return generateDigitToken(6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    await sendOtpEmail(email, token);
  },
});
