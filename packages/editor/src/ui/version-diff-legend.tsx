// 提供不依赖颜色的插入、删除和更新差异图例。
import { cn } from '@sharebrain/ui/lib/utils';

export type VersionDiffLegendProps = {
  className?: string;
  labels?: Partial<Record<'delete' | 'insert' | 'update', string>>;
};

export function VersionDiffLegend({ className, labels = {} }: VersionDiffLegendProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 text-xs text-muted-foreground', className)}>
      <ins className="bg-emerald-100/80 px-1 underline decoration-emerald-700">
        {labels.insert ?? 'Inserted'}
      </ins>
      <del className="bg-red-100/80 px-1 line-through decoration-red-700">
        {labels.delete ?? 'Deleted'}
      </del>
      <span className="bg-amber-100/80 px-1 underline decoration-amber-700">
        {labels.update ?? 'Updated'}
      </span>
    </div>
  );
}
