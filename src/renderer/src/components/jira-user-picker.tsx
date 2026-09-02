import React, { useEffect, useMemo, useState } from 'react'
import { ChevronsUpDown, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { jiraSearchUsers } from '@/runtime/runtime-jira-client'
import { translate } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { JiraUser } from '../../../shared/jira-types'
import type { TaskSourceContext } from '../../../shared/task-source-context'

const USER_SEARCH_DEBOUNCE_MS = 250

/** Renders selectable user rows inside a picker. */
export function JiraUserOptionItems({
  users,
  onSelect
}: {
  users: JiraUser[]
  onSelect: (user: JiraUser) => void
}): React.JSX.Element {
  return (
    <>
      {users.map((user) => (
        <CommandItem
          key={user.accountId}
          value={`${user.displayName} ${user.accountId}`}
          onSelect={() => onSelect(user)}
          className="jump-palette-item px-2 py-1.5 text-xs"
        >
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="size-5 rounded-full" />
          ) : null}
          <span className="truncate">{user.displayName}</span>
        </CommandItem>
      ))}
    </>
  )
}

/** Selects the account ID required by a scalar Jira user field. */
export function JiraUserPicker({
  providerSettings,
  siteId,
  value,
  selectedUser,
  onSelect,
  disabled,
  label
}: {
  providerSettings: TaskSourceContext | GlobalSettings | null
  siteId?: string | null
  value: string
  selectedUser: JiraUser | null
  onSelect: (user: JiraUser) => void
  disabled?: boolean
  label: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<JiraUser[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      void jiraSearchUsers(providerSettings, query, siteId)
        .then((found) => {
          if (!cancelled) {
            setUsers(found)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setUsers([])
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false)
          }
        })
    }, USER_SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, providerSettings, query, siteId])

  const triggerLabel = useMemo(() => {
    if (selectedUser?.displayName) {
      return selectedUser.displayName
    }
    return (
      value ||
      translate('components.jiraUserPicker.select', 'Select {{value0}}', {
        value0: label
      })
    )
  }, [label, selectedUser, value])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={label}
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between px-2 text-xs font-normal"
        >
          <span className={value ? 'truncate' : 'truncate text-muted-foreground'}>
            {triggerLabel}
          </span>
          {loading ? (
            <Loader2 className="size-4 shrink-0 animate-spin" />
          ) : (
            <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={translate('components.jiraUserPicker.search', 'Search users')}
            className="h-8 text-xs"
            wrapperClassName="px-2 py-0"
            trailing={loading ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
          />
          <CommandList className="max-h-60">
            {!loading ? (
              <CommandEmpty>
                {translate('components.jiraUserPicker.empty', 'No users found')}
              </CommandEmpty>
            ) : null}
            <JiraUserOptionItems
              users={users}
              onSelect={(user) => {
                onSelect(user)
                setOpen(false)
              }}
            />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
