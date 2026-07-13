import { getLocale, localeLabels, m, setLocale, supportedLocales, type Locale } from "@sharebrain/i18n";
import { Avatar, AvatarFallback, AvatarImage } from "@sharebrain/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@sharebrain/ui/components/dropdown-menu";
import { Progress } from "@sharebrain/ui/components/progress";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Database, Languages, LayoutList, LogOut, UserRound } from "lucide-react";
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
          className="w-72 max-w-[calc(100vw-24px)] bg-popover p-1"
          align="end"
          sideOffset={8}
        >
          <DropdownMenuLabel className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-2.5 px-2 py-2 font-normal">
            <Avatar size="lg">
              <AvatarImage src={user.avatar.url} alt={user.displayName} />
              <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 gap-px leading-tight">
              <strong className="truncate text-[13px] font-semibold">{user.displayName}</strong>
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              <span className="truncate text-xs text-muted-foreground">
                {tenant.name} · {me.data?.role === "admin" ? m.account_role_admin() : m.account_role_member()}
              </span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => {
              setMenuOpen(false);
              setAvatarOpen(true);
            }}
          >
            <UserRound />
            {m.account_profile()}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="grid grid-cols-[18px_minmax(0,1fr)] items-start py-2.5"
            onSelect={() => void navigate({ to: "/settings/storage" })}
          >
            <Database className="mt-0.5" />
            <span className="grid min-w-0 gap-1.5">
              <span className="flex items-center justify-between gap-2">
                <span>{m.account_storage()}</span>
                {storage.data ? (
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(totalCounted)} / {formatBytes(storage.data.quotaBytes)}
                  </span>
                ) : null}
              </span>
              {storage.data ? <Progress value={progress} className="h-1 bg-muted" /> : null}
              <span className="text-xs text-muted-foreground">
                {storage.isLoading
                  ? m.storage_loading()
                  : storage.error
                    ? m.storage_unavailable()
                    : storage.data?.reclaimingBytes
                      ? m.storage_reclaiming({ size: formatBytes(storage.data.reclaimingBytes) })
                      : m.storage_counted_of_total({
                          counted: formatBytes(totalCounted),
                          total: formatBytes(storage.data?.quotaBytes ?? tenant.storageQuotaBytes),
                        })}
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void navigate({ to: "/settings/new-project" })}>
            <LayoutList />
            {m.account_new_project_settings()}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Languages />
              {m.language_label()}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={currentLocale}
                onValueChange={(locale) => void setLocale(locale as Locale)}
              >
                {supportedLocales.map((locale) => (
                  <DropdownMenuRadioItem key={locale} value={locale}>
                    {localeLabels[locale]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={logout.isPending} onSelect={() => logout.mutate()}>
            <LogOut />
            {m.account_logout()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AvatarEditorDialog open={avatarOpen} onOpenChange={setAvatarOpen} user={user} />
    </>
  );
}
