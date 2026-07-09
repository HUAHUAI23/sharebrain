import { Button } from "@sharebrain/ui/components/button";
import { m } from "@sharebrain/i18n";
import { Input } from "@sharebrain/ui/components/input";
import { NotionIcon } from "@sharebrain/ui/components/notion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogIn, UserPlus } from "lucide-react";
import { useState } from "react";

import { LanguageSwitcher } from "../../components/language-switcher";
import { ApiClientError, apiRequest, queryKeys } from "../../lib/api-client";
import type { MeResponse } from "../workspace/workspace-types";

type AuthMode = "login" | "register";

export function AuthView() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("dev@sharebrain.local");
  const [password, setPassword] = useState("sharebrain123");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === "register";
  const auth = useMutation({
    mutationFn: () =>
      apiRequest<MeResponse>(isRegister ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: isRegister ? { email, password, displayName } : { email, password },
      }),
    async onSuccess(me) {
      setError(null);
      queryClient.setQueryData(queryKeys.me, me);
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: queryKeys.recents });
    },
    onError(errorValue) {
      setError(errorValue instanceof ApiClientError ? errorValue.message : m.auth_error_fallback());
    },
  });

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <section
        className="grid w-full max-w-sm justify-items-start gap-4"
        aria-label={isRegister ? m.auth_register_label() : m.auth_login_label()}
      >
        <div className="flex w-full justify-end">
          <LanguageSwitcher />
        </div>
        <NotionIcon size="md">S</NotionIcon>
        <header className="grid gap-1">
          <h1 className="m-0 text-2xl font-semibold leading-tight tracking-normal">
            {isRegister ? m.auth_register_title() : m.auth_login_title()}
          </h1>
          <p className="m-0 text-muted-foreground text-sm leading-6">
            {isRegister ? m.auth_register_hint() : m.auth_login_hint()}
          </p>
        </header>

        <form
          className="grid w-full gap-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            auth.mutate();
          }}
        >
          {isRegister && (
            <label className="grid gap-1 text-muted-foreground text-xs">
              <span>{m.auth_display_name_label()}</span>
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="border-border bg-sidebar"
                required
              />
            </label>
          )}
          <label className="grid gap-1 text-muted-foreground text-xs">
            <span>{m.auth_email_label()}</span>
            <Input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="border-border bg-sidebar"
              type="email"
              required
            />
          </label>
          <label className="grid gap-1 text-muted-foreground text-xs">
            <span>{m.auth_password_label()}</span>
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="border-border bg-sidebar"
              type="password"
              minLength={8}
              required
            />
          </label>
          {error && (
            <div className="rounded-sm bg-destructive/10 px-2 py-1.5 text-destructive text-sm leading-relaxed">
              {error}
            </div>
          )}
          <Button
            type="submit"
            disabled={auth.isPending || !email.trim() || !password.trim() || (isRegister && !displayName.trim())}
          >
            {isRegister ? <UserPlus size={15} /> : <LogIn size={15} />}
            {isRegister ? m.auth_register_label() : m.auth_login_label()}
          </Button>
        </form>

        <button
          type="button"
          className="cursor-pointer rounded-sm border-0 bg-transparent px-2 py-1 text-muted-foreground text-sm hover:bg-accent hover:text-foreground"
          onClick={() => {
            setError(null);
            setMode(isRegister ? "login" : "register");
          }}
        >
          {isRegister ? m.auth_switch_to_login() : m.auth_switch_to_register()}
        </button>
      </section>
    </main>
  );
}
