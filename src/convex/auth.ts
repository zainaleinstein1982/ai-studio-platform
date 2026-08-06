// STEP 02 · Authentication — Password (register/login/reset), Email OTP,
// Anonymous, plus OAuth (Google/GitHub) configured in auth.config.ts.

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { emailOtp } from "./auth/emailOtp";
import { passwordResetEmail } from "./auth/passwordEmail";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      // Forgot-password: emails a 6-digit code via the shared gateway.
      reset: passwordResetEmail,
      // Capture the display name from the sign-up form.
      profile: (params) => ({
        email: params.email as string,
        ...(typeof params.name === "string" && params.name.trim()
          ? { name: params.name.trim().slice(0, 60) }
          : {}),
      }),
    }),
    emailOtp,
    Anonymous,
  ],
});
