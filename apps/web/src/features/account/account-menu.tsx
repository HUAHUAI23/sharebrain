// 提供全局账户入口，组织用户身份、空间容量与个人设置操作。
import { getLocale, localeLabels, m, setLocale, supportedLocales, type Locale } from "@sharebrain/i18n";
import { Avatar, AvatarFallback, AvatarImage } from "@sharebrain/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@sharebrain/ui/components/dropdown-menu";
import { Progress } from "@sharebrain/ui/components/progress";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Database, Languages, LayoutList, LogOut } from "lucide-react";
import { useState } from "react";

import { apiRequest, queryKeys } from "../../lib/api-client";
import { formatBytes } from "../storage/format-bytes";
import { AvatarEditorDialog } from "./avatar-editor-dialog";

import type { MeResponse, StorageSummary } from "@sharebrain/contracts";

export function AccountMenu() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const me = useQuery({ queryKey: queryKeys.me, queryFn: () => apiRequest<MeResponse>("/api/me") });
  const storage = useQuery({
    queryKey: queryKeys.storageSummary,
    queryFn: () => apiRequest<StorageSummary>("/api/storage/summary"),
    enabled: menuOpen,
    staleTime: 30_000,
  });
  const logout = useMutation({
    mutationFn: () => apiRequest("/api/auth/logout", { method: "POST" }),
    async onSuccess() {
      queryClient.clear();
      await navigate({ to: "/" });
      window.location.reload();
    },
  });
  const currentLocale = getLocale() as Locale;
  const user = me.data?.user;
  const tenant = me.data?.tenant;
  if (!user || !tenant) return null;

  const totalCounted = storage.data
    ? storage.data.usedBytes + storage.data.reservedBytes + storage.data.reclaimingBytes
    : 0;
  const progress = storage.data ? Math.min((totalCounted / storage.data.quotaBytes) * 100, 100) : 0;

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center overflow-hidden rounded-full border-0 bg-transparent p-0 outline-none ring-1 ring-border transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-(--ring-soft)"
            aria-label={m.account_menu_label()}
          >
            <Avatar>
              <AvatarImage src={user.avatar.url} alt={user.displayName} />
              <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-80 max-w-[calc(100vw-24px)] rounded-lg border-border/80 bg-popover p-1.5 shadow-lg"
          align="end"
          sideOffset={8}
        >
          <DropdownMenuItem
            className="grid grid-cols-[44px_minmax(0,1fr)_20px] items-center gap-3 rounded-md px-3 py-3"
            onSelect={() => {
              setMenuOpen(false);
              setAvatarOpen(true);
            }}
          >
            <Avatar className="size-11 ring-1 ring-border-subtle">
              <AvatarImage src={user.avatar.url} alt={user.displayName} />
              <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 gap-0.5 leading-tight">
              <strong className="truncate text-sm font-semibold">{user.displayName}</strong>
              <span className="truncate text-[12px] text-muted-foreground">{user.email}</span>
              <span className="truncate text-[11px] text-muted-foreground/80">
                {tenant.name} · {me.data?.role === "admin" ? m.account_role_admin() : m.account_role_member()}
              </span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground/60" />
            <span className="sr-only">{m.account_profile()}</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            className="mt-1 grid grid-cols-[32px_minmax(0,1fr)] items-start gap-3 rounded-md px-3 py-2.5"
            onSelect={() => void navigate({ to: "/settings/storage" })}
          >
            <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Database className="size-4" />
            </span>
            <span className="grid min-w-0 gap-2 pt-0.5">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{m.account_storage()}</span>
                {storage.data ? (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {formatBytes(totalCounted)} / {formatBytes(storage.data.quotaBytes)}
                  </span>
                ) : null}
              </span>
              {storage.data ? <Progress value={progress} className="h-1.5 bg-muted" /> : null}
              {storage.isLoading || storage.error || storage.data?.reclaimingBytes ? (
                <span className="text-[11px] text-muted-foreground">
                  {storage.isLoading
                    ? m.storage_loading()
                    : storage.error
                      ? m.storage_unavailable()
                      : m.storage_reclaiming({ size: formatBytes(storage.data?.reclaimingBytes ?? 0) })}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>

          <div className="mt-1 grid gap-0.5">
            <DropdownMenuItem
              className="h-10 rounded-md px-3"
              onSelect={() => void navigate({ to: "/settings/new-project" })}
            >
              <span className="flex size-7 items-center justify-center text-muted-foreground">
                <LayoutList className="size-4" />
              </span>
              <span className="font-medium">{m.account_new_project_settings()}</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="h-10 rounded-md px-3">
                <span className="flex size-7 items-center justify-center text-muted-foreground">
                  <Languages className="size-4" />
                </span>
                <span className="font-medium">{m.language_label()}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {localeLabels[currentLocale]}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-40 rounded-lg p-1.5">
                <DropdownMenuRadioGroup
                  value={currentLocale}
                  onValueChange={(locale) => void setLocale(locale as Locale)}
                >
                  {supportedLocales.map((locale) => (
                    <DropdownMenuRadioItem className="h-9 rounded-md" key={locale} value={locale}>
                      {localeLabels[locale]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </div>

          <DropdownMenuItem
            className="mt-1 h-10 rounded-md px-3"
            variant="destructive"
            disabled={logout.isPending}
            onSelect={() => logout.mutate()}
          >
            <LogOut />
            {m.account_logout()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AvatarEditorDialog open={avatarOpen} onOpenChange={setAvatarOpen} user={user} />
    </>
  );
}
