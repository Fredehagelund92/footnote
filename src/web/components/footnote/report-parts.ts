import { CheckIcon, PencilIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { DockFrame, DockMissing } from '@/components/dock'
import { useWrite } from '@/api/queries'
import { useReported } from '@/lib/reported'
import { closeDock } from '@/lib/dock'
import { navigate } from '@/lib/router'
import { markReportSent, useReportSent, useShownAnswer } from '@/lib/shown-answers'
import { cn } from '@/lib/utils'
import { useDomains, useMe } from '@/lib/workspace'
import { askedOf } from '@/model/ask'
import { listOf } from '@/model/people'

/**
 * What Something wrong? (report-panel.tsx) uses of the app, handed to it by the answer and by the
 * right panel, as a family's panel is given its parts (family-parts.ts). The form loads when it
 * first opens; were it to import these itself, the bundler would split the code the first load
 * shares with it into more chunks, which the first load then fetches too.
 */
export const reportParts = {
  CheckIcon,
  PencilIcon,
  Button,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Textarea,
  DockFrame,
  DockMissing,
  useWrite,
  useReported,
  closeDock,
  navigate,
  markReportSent,
  useReportSent,
  useShownAnswer,
  cn,
  useDomains,
  useMe,
  askedOf,
  listOf,
}
export type ReportParts = typeof reportParts
