"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import type { Source } from "@/lib/types";
import { SourceCreateForm } from "@/components/features/source-create-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function CreateSourceDialog({
  onCreated,
  trigger,
}: {
  onCreated: (s: Source) => void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            新建信源
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>新建信源</DialogTitle>
          <DialogDescription>
            信源用来装内容。创建后上传文档，SAG 会自动解析、分块并抽取事件。
          </DialogDescription>
        </DialogHeader>

        <SourceCreateForm
          onCreated={(source) => {
            onCreated(source);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
