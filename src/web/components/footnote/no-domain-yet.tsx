import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { href } from '@/lib/router'
import { useAdminsSaid, useMe } from '@/lib/workspace'

/**
 * What a Domain field opens on before the workspace has a domain: an admin adds one from here, and
 * anyone else reads who does. Without it the field opened on an empty box.
 */
export function NoDomainYet() {
  const me = useMe()
  const admins = useAdminsSaid()
  return (
    <div className="flex flex-col items-start gap-2 p-2 text-sm">
      <p className="font-medium">No domain yet</p>
      <p className="text-muted-foreground">
        A domain is a part of the business with an owner, such as Sales.
        {!me.admin && ` An admin adds a domain${admins}.`}
      </p>
      {me.admin && (
        <a
          href={href('/settings/domains/new')}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          Add a domain
        </a>
      )}
    </div>
  )
}
