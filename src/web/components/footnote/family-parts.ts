import { useQuery } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { toApiError } from '@/api/errors'
import { namesQuery, useWrite } from '@/api/queries'
import {
  ArrowRightIcon,
  CircleDotIcon,
  FlaskConicalIcon,
  LayersIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UserIcon,
} from '@/components/icons'
import { DockFrame, DockMissing, DockWaiting, PeekBar } from '@/components/dock'
import { TypeTile } from '@/components/footnote/definition'
import {
  MeaningDialog,
  MeaningWords,
  meaningParts,
  meaningSource,
} from '@/components/footnote/family-meaning'
import { DockStepper } from '@/components/footnote/list'
import {
  PeekAttention,
  PeekBand,
  PeekBands,
  PeekDetails,
  PeekFact,
  PeekFacts,
  PeekLabel,
  PeekLink,
  PeekTitle,
} from '@/components/footnote/peek'
import { Related } from '@/components/footnote/related'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useRelated } from '@/hooks/use-related'
import { differingWords } from '@/lib/differing-words'
import { familyBy, useGlossary } from '@/lib/definitions'
import { closeDock, openDock } from '@/lib/dock'
import { useFigures } from '@/lib/figures'
import { mentionId } from '@/lib/mentions'
import { useReported } from '@/lib/reported'
import { href, navigate, useRoute } from '@/lib/router'
import { useOnline } from '@/lib/send'
import { cn } from '@/lib/utils'
import { useDomains, useFacts, useMe } from '@/lib/workspace'

// What a family's quick view and a suggested family's panel use of the app (family-peek.tsx,
// suggested-family-peek.tsx), handed to them as their parts. They load when one first opens; were
// they to import these themselves, the bundler would split the code the first load shares with
// them into more chunks the first load then fetches too. Everything here is on the first load.

export const familyParts = {
  useQuery,
  toast,
  toApiError,
  namesQuery,
  useWrite,
  ArrowRightIcon,
  CircleDotIcon,
  FlaskConicalIcon,
  LayersIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UserIcon,
  DockFrame,
  DockMissing,
  DockWaiting,
  PeekBar,
  TypeTile,
  MeaningDialog,
  MeaningWords,
  meaningParts,
  meaningSource,
  DockStepper,
  PeekAttention,
  PeekBand,
  PeekBands,
  PeekDetails,
  PeekFact,
  PeekFacts,
  PeekLabel,
  PeekLink,
  PeekTitle,
  Related,
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useRelated,
  differingWords,
  familyBy,
  useGlossary,
  closeDock,
  openDock,
  useFigures,
  mentionId,
  useReported,
  href,
  navigate,
  useRoute,
  useOnline,
  cn,
  useDomains,
  useFacts,
  useMe,
}
export type FamilyParts = typeof familyParts
