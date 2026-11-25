import { useQuery } from '@tanstack/react-query'
import { CHECK_WORDS, QUESTION_WORDS } from '@domain/question-link'
import { shiftDate } from '@domain/validity'
import { toApiError } from '@/api/errors'
import { questionQuery, sessionQuery, useApiWrite } from '@/api/queries'
import { PersonAvatar } from '@/components/footnote/bits'
import { Logo } from '@/components/footnote/logo'
import { CalendarIcon, CircleCheckIcon, TriangleAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { usePageTitle } from '@/lib/page-title'
import { useRoute } from '@/lib/router'
import { SignInChoices } from '@/pages/signin'

// What the page a question link opens uses of the app (pages/question.tsx), handed to it as its
// parts. It loads when a link is opened; were it to import these itself, the bundler would split
// the code the first load shares with it into more chunks the first load then fetches too.
// Everything here is on the first load.

export const questionParts = {
  CHECK_WORDS,
  QUESTION_WORDS,
  useQuery,
  shiftDate,
  toApiError,
  questionQuery,
  sessionQuery,
  useApiWrite,
  PersonAvatar,
  Logo,
  CalendarIcon,
  CircleCheckIcon,
  TriangleAlertIcon,
  Button,
  Input,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Textarea,
  usePageTitle,
  useRoute,
  SignInChoices,
}
export type QuestionParts = typeof questionParts
