import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import { useAuth } from "@/hooks/use-auth";
import {
  ArrowRight,
  ArrowLeft,
  Github,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  UserX,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { cn } from "@/lib/utils";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Wordmark() {
  return (
    <span className="inline-flex flex-col items-center leading-none">
      <span className="font-display text-3xl font-medium tracking-tight text-foreground">
        Atelier
      </span>
      <span className="mt-1.5 text-[9px] font-medium uppercase tracking-[0.32em] text-muted-foreground">
        AI Platform Gateway
      </span>
    </span>
  );
}

type PwView = "signIn" | "signUp" | "reset" | "resetCode";

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );

  // STEP 02 · password / magic-link / oauth / guest
  const [method, setMethod] = useState<"password" | "otp">("password");
  const [pwView, setPwView] = useState<PwView>("signIn");
  const [resetEmail, setResetEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  function begin(fn: () => Promise<void>) {
    setIsLoading(true);
    setError(null);
    setNotice(null);
    return fn().finally(() => setIsLoading(false));
  }

  function friendlyMessage(raw: unknown): string {
    const msg = raw instanceof Error ? raw.message : "";
    if (msg.includes("Invalid password")) return "Password must be at least 8 characters.";
    if (msg.includes("Invalid credentials")) return "Incorrect email or password.";
    if (msg.includes("already")) return "An account with this email already exists — try signing in.";
    if (msg.includes("Unknown provider") || msg.includes("not configured") || msg.includes("no OAuth") || msg.includes("OAuthClient")) {
      return "That sign-in isn't configured yet — add the provider keys, then try again.";
    }
    return msg || "Something went wrong. Please try again.";
  }

  /* Password flows */
  const handlePasswordSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("flow", pwView === "signUp" ? "signUp" : "signIn");
    void begin(async () => {
      try {
        await signIn("password", formData);
      } catch (e) {
        setError(friendlyMessage(e));
        throw e;
      }
    }).catch(() => {});
  };

  const handleResetRequest = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = (formData.get("email") as string).trim();
    if (!email) return;
    setResetEmail(email);
    formData.set("flow", "reset");
    void begin(async () => {
      try {
        await signIn("password", formData);
        setPwView("resetCode");
        setNotice("Reset code sent — check your inbox (valid for 15 minutes).");
      } catch (e) {
        setError(friendlyMessage(e));
        throw e;
      }
    }).catch(() => {});
  };

  const handleResetVerify = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("email", resetEmail);
    formData.set("flow", "reset-verification");
    void begin(async () => {
      try {
        await signIn("password", formData);
        setPwView("signIn");
        setNotice("Password updated — sign in with your new password.");
      } catch (e) {
        setError(friendlyMessage(e));
        throw e;
      }
    }).catch(() => {});
  };

  /* Magic-link (OTP) flows */
  const handleEmailSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setOtpEmail(formData.get("email") as string);
    void begin(async () => {
      try {
        await signIn("email-otp", formData);
        setNotice("Code sent — check your inbox (valid for 15 minutes).");
      } catch (e) {
        setError(friendlyMessage(e));
        throw e;
      }
    }).catch(() => {});
  };

  const handleOtpSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void begin(async () => {
      try {
        await signIn("email-otp", formData);
      } catch (e) {
        setError("The verification code you entered is incorrect.");
        setOtp("");
        throw e;
      }
    }).catch(() => {});
  };

  /* OAuth + guest */
  const handleOAuth = (provider: "google" | "github") => {
    void begin(async () => {
      try {
        await signIn(provider);
      } catch (e) {
        setError(friendlyMessage(e));
        throw e;
      }
    }).catch(() => {});
  };

  const handleGuestLogin = () => {
    void begin(async () => {
      try {
        await signIn("anonymous");
      } catch (e) {
        setError(friendlyMessage(e));
        throw e;
      }
    }).catch(() => {});
  };

  const pwTitle =
    pwView === "signUp"
      ? "Create your account"
      : pwView === "reset"
        ? "Reset your password"
        : pwView === "resetCode"
          ? "Enter the reset code"
          : "Welcome back";

  const pwDescription =
    pwView === "signUp"
      ? "Register with email and password — 100 free credits on sign-up."
      : pwView === "reset"
        ? "We'll email a 6-digit code to reset your password."
        : pwView === "resetCode"
          ? `A code was sent to ${resetEmail || "your email"}`
          : "Sign in to open the console.";

  const inputCls = "border-border bg-background focus-visible:ring-chart-1/30";

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_400px_at_50%_-10%,oklch(0.9_0.02_80/0.6),transparent_65%)]"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link to="/" aria-label="Atelier home">
            <Wordmark />
          </Link>
        </div>

        <Card className="rounded-lg border-border bg-card pb-0 shadow-sm">
          <CardHeader className="text-center">
            <CardTitle className="font-display text-2xl font-normal tracking-tight">
              {method === "otp" ? (otp ? "Check your email" : "Magic link") : pwTitle}
            </CardTitle>
            <CardDescription className="text-[13px]">
              {method === "otp" && !otp
                ? "Enter your email and we'll send a sign-in code."
                : pwDescription}
            </CardDescription>
          </CardHeader>

          {/* method toggle */}
          {method === "otp" && !otp ? null : (
            <div className="mx-6 mb-4 grid grid-cols-2 rounded-md border border-border bg-background p-1">
              {(["password", "otp"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMethod(m);
                    setError(null);
                    setNotice(null);
                  }}
                  className={cn(
                    "rounded-[4px] px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                    method === m
                      ? "bg-accent text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "password" ? "Password" : "Magic link"}
                </button>
              ))}
            </div>
          )}

          {/* password method */}
          {method === "password" && pwView !== "resetCode" && (
            <CardContent>
              <form
                onSubmit={
                  pwView === "reset" ? handleResetRequest : handlePasswordSubmit
                }
                className="space-y-3"
              >
                {pwView === "signUp" && (
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      name="name"
                      placeholder="Display name"
                      className={cn(inputCls, "pl-9")}
                      disabled={isLoading}
                      required
                    />
                  </div>
                )}
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    name="email"
                    placeholder="name@example.com"
                    type="email"
                    className={cn(inputCls, "pl-9")}
                    disabled={isLoading}
                    required
                  />
                </div>
                {pwView !== "reset" && (
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      name="password"
                      placeholder="Password"
                      type="password"
                      className={cn(inputCls, "pl-9")}
                      disabled={isLoading}
                      required
                    />
                  </div>
                )}
                {error && <p className="text-[12.5px] text-destructive">{error}</p>}
                {notice && <p className="text-[12.5px] text-chart-2">{notice}</p>}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : pwView === "reset" ? (
                    "Send reset code"
                  ) : pwView === "signUp" ? (
                    "Create account"
                  ) : (
                    "Sign in"
                  )}
                  {!isLoading && <ArrowRight className="size-4" />}
                </Button>
              </form>

              <div className="mt-4 flex flex-col gap-1.5 text-center text-[12.5px]">
                {pwView === "signIn" && (
                  <>
                    <button
                      onClick={() => {
                        setPwView("reset");
                        setError(null);
                      }}
                      className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Forgot password?
                    </button>
                    <p className="text-muted-foreground">
                      New here?{" "}
                      <button
                        onClick={() => {
                          setPwView("signUp");
                          setError(null);
                        }}
                        className="font-medium text-chart-1 hover:underline"
                      >
                        Create an account
                      </button>
                    </p>
                  </>
                )}
                {pwView === "signUp" && (
                  <p className="text-muted-foreground">
                    Already have an account?{" "}
                    <button
                      onClick={() => {
                        setPwView("signIn");
                        setError(null);
                      }}
                      className="font-medium text-chart-1 hover:underline"
                    >
                      Sign in
                    </button>
                  </p>
                )}
                {pwView === "reset" && (
                  <button
                    onClick={() => {
                      setPwView("signIn");
                      setError(null);
                    }}
                    className="inline-flex items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="size-3.5" /> Back to sign in
                  </button>
                )}
              </div>
            </CardContent>
          )}

          {/* reset code step */}
          {method === "password" && pwView === "resetCode" && (
            <CardContent>
              <form onSubmit={handleResetVerify} className="space-y-3">
                <input type="hidden" name="code" value={otp} />
                <InputOTP
                  value={otp}
                  onChange={setOtp}
                  maxLength={6}
                  disabled={isLoading}
                >
                  <InputOTPGroup className="w-full justify-center">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
                <Input
                  name="newPassword"
                  type="password"
                  placeholder="New password (min 8 characters)"
                  className={inputCls}
                  disabled={isLoading}
                  required
                />
                {error && <p className="text-[12.5px] text-destructive">{error}</p>}
                {notice && <p className="text-[12.5px] text-chart-2">{notice}</p>}
                <Button
                  type="submit"
                  disabled={isLoading || otp.length !== 6}
                  className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : "Reset password"}
                </Button>
              </form>
              <p className="mt-3 text-center text-[12.5px]">
                <button
                  onClick={() => {
                    setPwView("reset");
                    setError(null);
                    setOtp("");
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Resend code or change email
                </button>
              </p>
            </CardContent>
          )}

          {/* magic link (OTP) method */}
          {method === "otp" && !otp && (
            <CardContent>
              <form onSubmit={handleEmailSubmit} className="space-y-3">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    name="email"
                    placeholder="name@example.com"
                    type="email"
                    className={cn(inputCls, "pl-9")}
                    disabled={isLoading}
                    required
                  />
                </div>
                {error && <p className="text-[12.5px] text-destructive">{error}</p>}
                {notice && <p className="text-[12.5px] text-chart-2">{notice}</p>}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : "Send code"}
                  {!isLoading && <ArrowRight className="size-4" />}
                </Button>
              </form>
            </CardContent>
          )}

          {method === "otp" && otp && (
            <CardContent className="pb-4">
              <form onSubmit={handleOtpSubmit}>
                <input type="hidden" name="email" value={otpEmail} />
                <input type="hidden" name="code" value={otp} />
                <div className="flex justify-center">
                  <InputOTP
                    value={otp}
                    onChange={setOtp}
                    maxLength={6}
                    disabled={isLoading}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                        const form = (e.target as HTMLElement).closest("form");
                        if (form) form.requestSubmit();
                      }
                    }}
                  >
                    <InputOTPGroup>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                {error && (
                  <p className="mt-2 text-center text-[12.5px] text-destructive">{error}</p>
                )}
                {notice && (
                  <p className="mt-2 text-center text-[12.5px] text-chart-2">{notice}</p>
                )}
                <Button
                  type="submit"
                  disabled={isLoading || otp.length !== 6}
                  className="mt-4 w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : "Verify code"}
                  {!isLoading && <ArrowRight className="size-4" />}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setOtp("");
                    setError(null);
                    setNotice(null);
                  }}
                  className="mt-3 w-full text-center text-[12.5px] text-muted-foreground hover:text-foreground"
                >
                  Use a different email
                </button>
              </form>
            </CardContent>
          )}

          {/* divider + oauth */}
          {method === "password" && pwView === "signIn" && (
            <CardContent className="pb-1">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/70" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-card px-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Or continue with
                  </span>
                </div>
              </div>
            </CardContent>
          )}

          {method === "password" && pwView === "signIn" && (
            <CardContent className="pb-1 pt-0">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-border bg-background"
                  disabled={isLoading}
                  onClick={() => handleOAuth("google")}
                >
                  <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
                    <path
                      fill="currentColor"
                      d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"
                    />
                  </svg>
                  Google
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-border bg-background"
                  disabled={isLoading}
                  onClick={() => handleOAuth("github")}
                >
                  <Github className="size-4" />
                  GitHub
                </Button>
              </div>
            </CardContent>
          )}

          {/* guest */}
          <CardContent className="pb-5">
            <Button
              type="button"
              variant="ghost"
              className="w-full text-muted-foreground hover:bg-accent"
              disabled={isLoading}
              onClick={handleGuestLogin}
            >
              <UserX className="mr-2 size-4" />
              Continue as Guest
            </Button>
          </CardContent>

          <div className="flex items-center justify-center gap-2 rounded-b-lg border-t border-border/70 bg-muted/60 px-6 py-3 text-center text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            Secured by{" "}
            <a
              href="https://freebuff.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline transition-colors hover:text-foreground"
            >
              freebuff.com
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
