"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useMemo, useRef, useState } from "react";
import { Shield, Loader2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatModified, getFileIcon } from "@/lib/file-manager/utils";
import type { FileEntry } from "@/lib/file-manager/types";

type Props = {
  rows: FileEntry[];
  selectedPaths: string[];
  loading?: boolean;
  onSelect: (paths: string[]) => void;
  onOpen: (entry: FileEntry) => void;
  onContextAction: (entry: FileEntry, action: string) => void;
};

export const FileDataTable = React.memo(function FileDataTable({ rows, selectedPaths, loading, onSelect, onOpen, onContextAction }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const parentRef = useRef<HTMLDivElement>(null);

  const columns = useMemo<ColumnDef<FileEntry>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
            onCheckedChange={(value) => {
              if (value) onSelect(rows.map((r) => r.path));
              else onSelect([]);
            }}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selectedPaths.includes(row.original.path)}
            onCheckedChange={(checked) => {
              if (checked) onSelect([...new Set([...selectedPaths, row.original.path])]);
              else onSelect(selectedPaths.filter((p) => p !== row.original.path));
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label="Select row"
          />
        ),
        size: 40,
      },
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => {
          const Icon = getFileIcon(row.original.name, row.original.kind);
          return (
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{row.original.name}</span>
              {row.original.readonly && <Shield className="h-3 w-3 text-amber-500 shrink-0" />}
            </div>
          );
        },
      },
      {
        accessorKey: "size_label",
        header: "Size",
        size: 100,
      },
      {
        id: "modified",
        accessorFn: (row) => row.modified,
        header: "Modified",
        cell: ({ row }) => formatModified(row.original.modified),
        size: 160,
      },
      {
        accessorKey: "kind",
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="secondary" className="capitalize text-[10px]">
            {row.original.kind}
          </Badge>
        ),
        size: 80,
      },
      {
        id: "tags",
        header: "Tags",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1 max-w-[180px]">
            {row.original.category && (
              <Badge variant="outline" className="text-[10px]">
                {row.original.category}
              </Badge>
            )}
            {(row.original.tags || []).slice(0, 2).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        ),
      },
    ],
    [onSelect, rows, selectedPaths]
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const tableRows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const isVirtual = virtualItems.length > 0;
  const paddingTop = isVirtual ? virtualItems[0]?.start ?? 0 : 0;
  const paddingBottom = isVirtual
    ? virtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end ?? 0)
    : 0;

  const rowsToRender = isVirtual
    ? virtualItems.map((v) => ({ row: tableRows[v.index], virtualRow: v }))
    : tableRows.map((row) => ({ row, virtualRow: null }));

  return (
    <div ref={parentRef} className="h-full overflow-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                  className="cursor-pointer select-none"
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {tableRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span>Loading files…</span>
                  </div>
                ) : (
                  "This folder is empty"
                )}
              </TableCell>
            </TableRow>
          ) : (
            <>
              {paddingTop > 0 && (
                <TableRow style={{ height: `${paddingTop}px` }}>
                  <TableCell colSpan={columns.length} className="p-0 border-0" />
                </TableRow>
              )}
              {rowsToRender.map(({ row, virtualRow }) => {
                const selected = selectedPaths.includes(row.original.path);
                return (
                  <ContextMenu key={row.id}>
                    <ContextMenuTrigger asChild>
                      <TableRow
                        data-index={virtualRow?.index}
                        ref={virtualRow ? virtualizer.measureElement : undefined}
                        draggable={row.original.kind === "file"}
                        onDragStart={(e) => {
                          if (row.original.kind !== "file") return;
                          e.dataTransfer.setData("application/x-zenvora-file", row.original.path);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        className={cn("cursor-pointer", selected && "bg-accent/20 hover:bg-accent/25")}
                        onClick={() => onSelect([row.original.path])}
                        onDoubleClick={() => onOpen(row.original)}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                        ))}
                      </TableRow>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      <ContextMenuItem onClick={() => onContextAction(row.original, "open")}>Open</ContextMenuItem>
                      <ContextMenuItem onClick={() => onContextAction(row.original, "download")}>Download</ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => onContextAction(row.original, "rename")}>Rename</ContextMenuItem>
                      <ContextMenuItem onClick={() => onContextAction(row.original, "copy")}>Copy to…</ContextMenuItem>
                      <ContextMenuItem onClick={() => onContextAction(row.original, "move")}>Move to…</ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => onContextAction(row.original, "zip")}>Compress</ContextMenuItem>
                      {row.original.name.endsWith(".zip") && (
                        <ContextMenuItem onClick={() => onContextAction(row.original, "unzip")}>Extract</ContextMenuItem>
                      )}
                      <ContextMenuItem onClick={() => onContextAction(row.original, "backup")}>Cloud backup</ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem className="text-destructive" onClick={() => onContextAction(row.original, "delete")}>
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
              {paddingBottom > 0 && (
                <TableRow style={{ height: `${paddingBottom}px` }}>
                  <TableCell colSpan={columns.length} className="p-0 border-0" />
                </TableRow>
              )}
            </>
          )}
        </TableBody>
      </Table>
    </div>
  );
});
