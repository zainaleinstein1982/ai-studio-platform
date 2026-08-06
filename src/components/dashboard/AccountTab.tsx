import { api } from "@/convex/_generated/api";
import { ROLE_LABEL } from "@/convex/permissions";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import {
  BadgeCheck,
  Building2,
  Crown,
  Loader2,
  LogOut,
  Mail,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionTitle } from "./bits";
import type { Id } from "@/convex/_generated/dataModel";

const ORG_ROLE_OPTIONS = ["member", "admin", "owner"] as const;

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-card p-6">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Profile + email verification                                        */
/* ------------------------------------------------------------------ */

function ProfileCard() {
  const { user } = useAuth();
  const updateProfile = useMutation(api.profile.updateProfile);
  const sendVerificationEmail = useMutation(api.profile.sendVerificationEmail);
  const verifyEmail = useMutation(api.profile.verifyEmail);

  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const verified = Boolean(user?.emailVerificationTime);

  async function handleSave() {
    if (!name.trim() || name.trim() === (user?.name ?? "")) return;
    setSaving(true);
    try {
      await updateProfile({ name: name.trim() });
      toast.success("Profile updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update profile.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSendCode() {
    setSendingCode(true);
    try {
      await sendVerificationEmail();
      setCodeSent(true);
      toast.success("Verification code sent — check your inbox.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send code.");
    } finally {
      setSendingCode(false);
    }
  }

  async function handleVerify() {
    setVerifying(true);
    try {
      await verifyEmail({ code });
      setCodeSent(false);
      setCode("");
      toast.success("Email verified. 🎉");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invalid code.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Panel>
      <SectionTitle kicker="STEP 02 · Authentication" title="Profile" />
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Display name
          </label>
          <div className="mt-2 flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-border bg-background"
              placeholder="Your name"
            />
            <Button
              onClick={() => void handleSave()}
              disabled={saving || !name.trim()}
              className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
        <div>
          <label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Email · verification
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
            <Mail className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{user?.email ?? "—"}</span>
            {verified ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-chart-2/50 bg-chart-2/10 px-2 py-0.5 text-[10.5px] font-medium text-chart-2">
                <BadgeCheck className="size-3" /> Verified
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-chart-5/50 bg-chart-5/10 px-2 py-0.5 text-[10.5px] font-medium text-chart-5">
                Unverified
              </span>
            )}
          </div>
          {!verified && user?.email && (
            <div className="mt-2">
              {codeSent ? (
                <div className="flex gap-2">
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="6-digit code"
                    className="border-border bg-background font-mono"
                    maxLength={6}
                  />
                  <Button
                    onClick={() => void handleVerify()}
                    disabled={verifying || code.length !== 6}
                    className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {verifying ? <Loader2 className="size-4 animate-spin" /> : "Verify"}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleSendCode()}
                  disabled={sendingCode}
                  className="border-border bg-background"
                >
                  {sendingCode ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                  Send verification code
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Organizations + team                                                */
/* ------------------------------------------------------------------ */

function OrganizationsCard() {
  const { user } = useAuth();
  const myOrgs = useQuery(api.organizations.listMyOrgs);
  const createOrg = useMutation(api.organizations.createOrg);
  const inviteMember = useMutation(api.organizations.inviteMember);
  const setMemberRole = useMutation(api.organizations.setMemberRole);
  const removeMember = useMutation(api.organizations.removeMember);
  const leaveOrg = useMutation(api.organizations.leaveOrg);
  const deleteOrg = useMutation(api.organizations.deleteOrg);

  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [newOrgName, setNewOrgName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState<string | null>(null);

  const orgs = myOrgs ?? [];
  const activeId = (activeOrgId ?? orgs[0]?.id ?? null) as Id<"organizations"> | null;
  const members = useQuery(
    api.organizations.listOrgMembers,
    activeId ? { orgId: activeId } : "skip",
  );
  const activeOrg = orgs.find((o) => o.id === activeId);
  const myRole = activeOrg?.role ?? null;

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Operation failed.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate() {
    if (newOrgName.trim().length < 2) return;
    const ok = await run("create", async () => {
      const { orgId } = await createOrg({ name: newOrgName.trim() });
      setActiveOrgId(orgId);
      setNewOrgName("");
    }, "Organization created.");
    void ok;
  }

  async function handleInvite() {
    if (!activeId || !inviteEmail.trim()) return;
    const ok = await run(
      "invite",
      () => inviteMember({ orgId: activeId, email: inviteEmail.trim(), role: inviteRole }),
      `${inviteEmail.trim()} added to the team.`,
    );
    if (ok) setInviteEmail("");
  }

  const canManage = myRole === "owner" || myRole === "admin";

  return (
    <Panel>
      <SectionTitle kicker="STEP 02 · Organization & Team" title="Organization" />

      {/* org selector + create */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Select
          value={activeId ?? undefined}
          onValueChange={(v) => setActiveOrgId(v)}
          disabled={orgs.length === 0}
        >
          <SelectTrigger className="w-56 border-border bg-background">
            <SelectValue placeholder="No organization yet" />
          </SelectTrigger>
          <SelectContent>
            {orgs.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="size-3.5" /> {o.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex min-w-0 flex-1 gap-2">
          <Input
            value={newOrgName}
            onChange={(e) => setNewOrgName(e.target.value)}
            placeholder="New organization name…"
            className="max-w-56 border-border bg-background"
            onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCreate()}
            disabled={busy === "create" || newOrgName.trim().length < 2}
            className="border-border bg-background"
          >
            {busy === "create" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Create
          </Button>
        </div>
      </div>

      {!activeOrg ? (
        <p className="mt-5 text-[12.5px] leading-6 text-muted-foreground">
          Create an organization to start a team. The first member becomes the owner; the
          owner can promote admins and invite teammates by email.
        </p>
      ) : (
        <div className="mt-5">
          <div className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-2.5">
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <Building2 className="size-4 text-chart-1" />
              {activeOrg.name}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
              {myRole === "owner" ? <Crown className="size-3 text-chart-5" /> : <Users className="size-3" />}
              {myRole} · you
            </span>
          </div>

          {/* invite */}
          {canManage && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
                type="email"
                className="max-w-56 border-border bg-background"
                onKeyDown={(e) => e.key === "Enter" && void handleInvite()}
              />
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as "member" | "admin")}
              >
                <SelectTrigger className="w-28 border-border bg-background text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={() => void handleInvite()}
                disabled={busy === "invite" || !inviteEmail.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {busy === "invite" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Invite
              </Button>
            </div>
          )}

          {/* members */}
          <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border">
            {(members ?? []).map((m) => {
              const isMe = m.userId === user?._id;
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-accent font-display text-[11.5px]">
                    {(m.name?.[0] ?? m.email?.[0] ?? "?").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {m.name ?? "Unnamed"}
                      {isMe && <span className="ml-1.5 text-[10.5px] text-muted-foreground">(you)</span>}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{m.email ?? "—"}</p>
                  </div>
                  {canManage && !isMe ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) =>
                        void run(
                          "role",
                          () =>
                            setMemberRole({
                              orgId: activeId!,
                              userId: m.userId,
                              role: v as "owner" | "admin" | "member",
                            }),
                          `${m.email ?? m.userId} is now ${v}.`,
                        )
                      }
                    >
                      <SelectTrigger className="h-8 w-28 border-border bg-background text-[12px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORG_ROLE_OPTIONS.map((r) => (
                          <SelectItem key={r} value={r} disabled={r === "owner" && myRole !== "owner"}>
                            {r[0].toUpperCase() + r.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="w-28 text-right text-[11.5px] capitalize text-muted-foreground">
                      {m.role}
                    </span>
                  )}
                  {canManage && !isMe && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        void run("remove", () => removeMember({ orgId: activeId!, userId: m.userId }), "Member removed.")
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              );
            })}
            {members && members.length === 0 && (
              <p className="px-4 py-4 text-center text-[12px] text-muted-foreground">
                No members yet — invite your first teammate.
              </p>
            )}
          </div>

          {/* danger zone */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
            <Button
              variant="outline"
              size="sm"
              className="border-border bg-background text-muted-foreground"
              onClick={() =>
                void run("leave", () => leaveOrg({ orgId: activeId! }), "You left the organization.")
              }
            >
              {busy === "leave" ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
              Leave
            </Button>
            {myRole === "owner" && (
              <Button
                variant="outline"
                size="sm"
                className="border-border bg-background text-destructive hover:text-destructive"
                onClick={() =>
                  void run("delete", () => deleteOrg({ orgId: activeId! }), "Organization deleted.")
                }
              >
                {busy === "delete" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Delete organization
              </Button>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

function AdminCard() {
  const { user } = useAuth();
  const users = useQuery(api.profile.listUsers);
  const setUserRole = useMutation(api.profile.setUserRole);
  const [busyRole, setBusyRole] = useState<string | null>(null);

  if (user?.role !== "admin") return null;

  return (
    <Panel>
      <SectionTitle kicker="STEP 02 · RBAC" title="Admin · platform users" />
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        You are an admin. Roles control access — member &lt; user &lt; admin — and gate
        mutations through the permission middleware.
      </p>
      <div className="mt-4 divide-y divide-border/70 overflow-hidden rounded-lg border border-border">
        {(users ?? []).map((u) => {
          const isMe = u.id === user._id;
          return (
            <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-accent font-display text-[11.5px]">
                {(u.name?.[0] ?? u.email?.[0] ?? "?").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">
                  {u.name ?? "Unnamed"}
                  {isMe && <span className="ml-1.5 text-[10.5px] text-muted-foreground">(you)</span>}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {u.email ?? "—"} · {u.emailVerified ? "verified" : "unverified"}
                </p>
              </div>
              <Select
                value={u.role}
                disabled={isMe}
                onValueChange={(v) => {
                  setBusyRole(u.id);
                  void setUserRole({ userId: u.id, role: v as "member" | "user" | "admin" })
                    .then(() => toast.success(`${u.email ?? u.id} is now ${ROLE_LABEL[v as keyof typeof ROLE_LABEL] ?? v}.`))
                    .catch((e) => toast.error(e instanceof Error ? e.message : "Could not update role."))
                    .finally(() => setBusyRole(null));
                }}
              >
                <SelectTrigger className="h-8 w-28 border-border bg-background text-[12px]">
                  {busyRole === u.id ? <Loader2 className="size-3.5 animate-spin" /> : <SelectValue />}
                </SelectTrigger>
                <SelectContent>
                  {(["member", "user", "admin"] as const).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

export function AccountTab() {
  return (
    <div className="grid gap-6">
      <ProfileCard />
      <OrganizationsCard />
      <AdminCard />
      <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <UserRound className="size-3.5 text-chart-1" />
        Sessions are JWT-backed with automatic refresh; RBAC + rate limits are enforced in
        the permission middleware.
      </p>
    </div>
  );
}
