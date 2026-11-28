import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { queryKeys, useApiWrite } from '@/api/queries'
import { toApiError } from '@/api/errors'
import { PERSON_NAME_MAX, WORKSPACE_NAME_MAX } from '@contract/limits'
import { PRODUCT } from '@/lib/brand'

const anAddress = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)

/**
 * The first screen of an install on its own data: nobody is in the workspace, so its first visitor
 * says their name, their email and what the workspace is called, and becomes its admin. No sample
 * person is ever offered here.
 */
export function FirstPerson({ mark }: { mark: React.ReactNode }) {
  const queryClient = useQueryClient()
  const setUp = useApiWrite('setUpWorkspace')
  const [form, setForm] = React.useState({ name: '', email: '', workspace: '' })
  const [tried, setTried] = React.useState(false)
  const given = {
    name: form.name.trim(),
    email: form.email.trim(),
    workspace: form.workspace.trim(),
  }
  // Said once Start was pressed, each at its field.
  const problems = {
    name: given.name ? '' : 'Add your name.',
    email: !given.email
      ? 'Add your email address.'
      : anAddress(given.email)
        ? ''
        : 'That is not an email address.',
    workspace: given.workspace ? '' : 'Give the workspace a name.',
  }
  const shown = (field: keyof typeof problems) => (tried ? problems[field] : '')
  const field = (name: keyof typeof form) => ({
    id: `first-${name}`,
    value: form[name],
    'aria-invalid': !!shown(name),
    'aria-describedby': `first-${name}-note`,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [name]: e.target.value })),
  })
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        {mark}
        <Card>
          <CardHeader className="text-center">
            <CardTitle role="heading" aria-level={1} className="text-xl">
              Set up {PRODUCT}
            </CardTitle>
            <CardDescription className="text-balance">
              You are the first one here, so you are the admin. Say who you are.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                setTried(true)
                const wrong = (['name', 'email', 'workspace'] as const).find((f) => problems[f])
                if (wrong) {
                  document.getElementById(`first-${wrong}`)?.focus()
                  return
                }
                setUp.mutate(given, {
                  // Someone else was first: the page asks again how people sign in here.
                  onError: () =>
                    void queryClient.invalidateQueries({ queryKey: queryKeys.signInMethod }),
                })
              }}
            >
              <FieldGroup>
                <Field data-invalid={!!shown('name')}>
                  <FieldLabel htmlFor="first-name">Your name</FieldLabel>
                  <Input
                    {...field('name')}
                    autoComplete="name"
                    maxLength={PERSON_NAME_MAX}
                    autoFocus
                  />
                  <FieldError id="first-name-note">{shown('name')}</FieldError>
                </Field>
                <Field data-invalid={!!shown('email')}>
                  <FieldLabel htmlFor="first-email">Your email</FieldLabel>
                  <Input {...field('email')} type="email" autoComplete="email" maxLength={254} />
                  {shown('email') ? (
                    <FieldError id="first-email-note">{shown('email')}</FieldError>
                  ) : (
                    <FieldDescription id="first-email-note">
                      No email is sent. If you set up company sign-in later, it knows you by this
                      address.
                    </FieldDescription>
                  )}
                </Field>
                <Field data-invalid={!!shown('workspace')}>
                  <FieldLabel htmlFor="first-workspace">Workspace name</FieldLabel>
                  <Input
                    {...field('workspace')}
                    autoComplete="organization"
                    maxLength={WORKSPACE_NAME_MAX}
                  />
                  {shown('workspace') ? (
                    <FieldError id="first-workspace-note">{shown('workspace')}</FieldError>
                  ) : (
                    <FieldDescription id="first-workspace-note">
                      Most often your company's name. You can change it later, in Settings.
                    </FieldDescription>
                  )}
                </Field>
                {setUp.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {toApiError(setUp.error).message}
                  </p>
                )}
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  loading={setUp.isPending}
                  loadingLabel="Starting…"
                >
                  Start
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        <p className="px-6 text-center text-xs text-balance text-muted-foreground">
          This install asks for no password: it is for trying {PRODUCT} on a computer of your own.
        </p>
      </div>
    </main>
  )
}
