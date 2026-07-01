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
    <main className="auth-shell">
      <section className="auth-panel" aria-label={isRegister ? m.auth_register_label() : m.auth_login_label()}>
        <div className="auth-toolbar">
          <LanguageSwitcher />
        </div>
        <NotionIcon size="md">S</NotionIcon>
        <header className="auth-title">
          <h1>{isRegister ? m.auth_register_title() : m.auth_login_title()}</h1>
          <p>{isRegister ? m.auth_register_hint() : m.auth_login_hint()}</p>
        </header>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            auth.mutate();
          }}
        >
          {isRegister && (
            <label className="auth-field">
              <span>{m.auth_display_name_label()}</span>
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
            </label>
          )}
          <label className="auth-field">
            <span>{m.auth_email_label()}</span>
            <Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label className="auth-field">
            <span>{m.auth_password_label()}</span>
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              minLength={8}
              required
            />
          </label>
          {error && <div className="auth-error">{error}</div>}
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
          className="auth-switch"
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
