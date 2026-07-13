import type { Area } from "react-easy-crop";
import { m } from "@sharebrain/i18n";
import { Avatar, AvatarFallback, AvatarImage } from "@sharebrain/ui/components/avatar";
import { Button } from "@sharebrain/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sharebrain/ui/components/dialog";
import { Slider } from "@sharebrain/ui/components/slider";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, RotateCcw, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import Cropper from "react-easy-crop";

import { ApiClientError, apiRequest, queryKeys } from "../../lib/api-client";
import { formatBytes } from "../storage/format-bytes";

import type { MediaLimits, MediaObject, MediaUploadResponse, StorageSummary, User } from "@sharebrain/contracts";

type AvatarEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
};

const avatarMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function AvatarEditorDialog({ open, onOpenChange, user }: AvatarEditorDialogProps) {
  const queryClient = useQueryClient();
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const limits = useQuery({
    queryKey: queryKeys.mediaLimits,
    queryFn: () => apiRequest<MediaLimits>("/api/media/limits"),
    enabled: open,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const storage = useQuery({
    queryKey: queryKeys.storageSummary,
    queryFn: () => apiRequest<StorageSummary>("/api/storage/summary"),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);

  const upload = useMutation({
    async mutationFn() {
      if (!sourceUrl || !croppedArea) return;
      const blob = await cropImage(sourceUrl, croppedArea);
      const session = await apiRequest<MediaUploadResponse>("/api/media/uploads", {
        method: "POST",
        body: {
          fileName: "avatar.webp",
          mimeType: blob.type,
          byteSize: blob.size,
          usageKind: "avatar",
        },
      });
      const formData = new FormData();
      for (const [key, value] of Object.entries(session.fields)) formData.append(key, value);
      formData.append("file", blob, "avatar.webp");
      const response = await fetch(session.url, { method: "POST", body: formData });
      if (!response.ok) throw new Error(m.media_avatar_upload_failed());
      await apiRequest<MediaObject>(`/api/media/uploads/${session.uploadId}/complete`, {
        method: "POST",
        body: { byteSize: blob.size, mimeType: blob.type },
      });
    },
    async onSuccess() {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.storageSummary }),
      ]);
      resetSelection();
      onOpenChange(false);
    },
  });

  const remove = useMutation({
    mutationFn: () => apiRequest("/api/me/avatar", { method: "DELETE" }),
    async onSuccess() {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.storageSummary }),
      ]);
      resetSelection();
      onOpenChange(false);
    },
  });

  function resetSelection() {
    setSourceUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
    setFileError(null);
  }

  const error = fileError ?? getMutationError(upload.error ?? remove.error);
  const isPending = upload.isPending || remove.isPending;

  useEffect(() => {
    if (!open) return;
    upload.reset();
    remove.reset();
    setFileError(null);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isPending) return;
        if (!nextOpen) resetSelection();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-5 overflow-y-auto sm:max-w-[520px]">
        <DialogHeader className="gap-1 pr-8 text-left">
          <DialogTitle className="leading-tight">{m.avatar_dialog_title()}</DialogTitle>
          <DialogDescription className="leading-snug">
            {limits.data
              ? m.avatar_dialog_description({ size: formatBytes(limits.data.avatarMaxBytes) })
              : m.avatar_dialog_description_loading()}
          </DialogDescription>
        </DialogHeader>

        {sourceUrl ? (
          <div className="grid gap-4">
            <div className="relative mx-auto aspect-square w-full max-w-[380px] overflow-hidden rounded-md bg-muted">
              <Cropper
                image={sourceUrl}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setCroppedArea(pixels)}
              />
            </div>
            <label className="mx-auto grid w-full max-w-[380px] gap-2 text-sm font-medium">
              <span>{m.avatar_zoom()}</span>
              <Slider value={[zoom]} min={1} max={3} step={0.05} onValueChange={([value]) => setZoom(value ?? 1)} />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-[144px_minmax(0,1fr)] items-center gap-5 max-[520px]:grid-cols-1">
            <div className="flex aspect-square items-center justify-center rounded-md bg-muted/60 max-[520px]:w-44 max-[520px]:justify-self-center">
              <Avatar className="size-24 ring-1 ring-border">
                <AvatarImage src={user.avatar.url} alt={user.displayName} />
                <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
            </div>
            <div className="grid min-w-0 gap-3">
              <div className="grid gap-0.5">
                <span className="text-xs text-muted-foreground">{m.avatar_current_size()}</span>
                <strong className="truncate text-sm font-medium">
                  {user.avatar.byteSize === null ? m.avatar_generated_size() : formatBytes(user.avatar.byteSize)}
                </strong>
              </div>
              <div className="h-px bg-border-subtle" />
              <div className="grid gap-0.5">
                <span className="text-xs text-muted-foreground">{m.storage_available()}</span>
                <strong className="truncate text-sm font-medium">
                  {storage.data ? formatBytes(storage.data.availableBytes) : m.storage_loading_short()}
                </strong>
              </div>
            </div>
          </div>
        )}

        {sourceUrl ? (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border-subtle max-[420px]:grid-cols-1">
            <div className="grid gap-0.5 bg-muted/50 px-3 py-2.5">
              <span className="text-xs text-muted-foreground">{m.avatar_current_size()}</span>
              <strong className="truncate text-sm font-medium">
                {user.avatar.byteSize === null ? m.avatar_generated_size() : formatBytes(user.avatar.byteSize)}
              </strong>
            </div>
            <div className="grid gap-0.5 bg-muted/50 px-3 py-2.5">
              <span className="text-xs text-muted-foreground">{m.storage_available()}</span>
              <strong className="truncate text-sm font-medium">
                {storage.data ? formatBytes(storage.data.availableBytes) : m.storage_loading_short()}
              </strong>
            </div>
          </div>
        ) : null}

        {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="items-stretch border-t border-border-subtle pt-4 sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild type="button" variant="outline" disabled={isPending}>
              <label>
                <ImagePlus />
                {m.avatar_choose()}
                <input
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    const avatarMaxBytes = limits.data?.avatarMaxBytes;
                    if (!avatarMimeTypes.has(file.type) || (avatarMaxBytes !== undefined && file.size > avatarMaxBytes)) {
                      setFileError(
                        avatarMaxBytes
                          ? m.avatar_dialog_description({ size: formatBytes(avatarMaxBytes) })
                          : m.avatar_dialog_description_loading(),
                      );
                      return;
                    }
                    upload.reset();
                    remove.reset();
                    setSourceUrl((current) => {
                      if (current) URL.revokeObjectURL(current);
                      return URL.createObjectURL(file);
                    });
                    setFileError(null);
                  }}
                />
              </label>
            </Button>
            {user.avatar.kind === "uploaded" ? (
              <Button type="button" variant="ghost" disabled={isPending} onClick={() => remove.mutate()}>
                <RotateCcw />
                {m.avatar_remove()}
              </Button>
            ) : null}
          </div>
          {sourceUrl ? (
            <Button type="button" disabled={!croppedArea || isPending} onClick={() => upload.mutate()}>
              <Upload />
              {upload.isPending ? m.media_uploading() : m.avatar_upload()}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getMutationError(error: unknown) {
  if (!error) return null;
  return error instanceof ApiClientError || error instanceof Error ? error.message : m.media_avatar_upload_failed();
}

async function cropImage(sourceUrl: string, area: Area) {
  const image = await loadImage(sourceUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(m.media_avatar_upload_failed());
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, 512, 512);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(m.media_avatar_upload_failed()))),
      "image/webp",
      0.88,
    );
  });
}

function loadImage(sourceUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(m.media_avatar_upload_failed()));
    image.src = sourceUrl;
  });
}
